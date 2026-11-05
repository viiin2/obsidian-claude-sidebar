import { App, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ChatMsg, ClaudeView, VIEW_TYPE } from "./view";
import { claudeVersion, findClaude } from "./claude";
import { AssistantConfig, DEFAULT_CONFIG, LOG_PATH, SNAPSHOT_PATH, SUPPORT_DIR, saveConfig } from "./assistant/config";
import type { Snapshot } from "./assistant/collect";
import type { AgendaItem } from "./assistant/agenda";
import type { Routine } from "./assistant/routines";
import { AddedTodo, addToRoutines, addTodo, refreshCalendar, removeFromRoutines, removeTodo } from "./assistant/briefing";
import { CAL_CACHE, CalInfo, calAuth, calCalendars, calendarSupported } from "./assistant/maccal";
import { listInbox, processInbox } from "./assistant/inbox";
import { copyScript, installSchedule, normalizeTime, scheduleInstalled, scheduleSupported, uninstallSchedule } from "./assistant/schedule";

interface Settings {
  claudePath: string;
  model: string;
  effort: string;
  saveFolder: string;
  // 비서
  assistantOn: boolean;
  briefTime: string;
  middayOn: boolean;
  middayTime: string;
  eveningOn: boolean;
  eveningTime: string;
  refreshHours: number;
  remind: boolean;
  agendaFile: string;
  routineFile: string;
  calendarOn: boolean;
  calendarId: string;
  scanRoots: string;
  projectFolder: string;
  autoInbox: boolean;
  inboxFolder: string;
  materialsFolder: string;
}

const DEFAULTS: Settings = {
  claudePath: "",
  model: "sonnet",
  effort: "low",
  saveFolder: "Claude",
  assistantOn: false,
  briefTime: DEFAULT_CONFIG.time,
  middayOn: DEFAULT_CONFIG.middayOn,
  middayTime: DEFAULT_CONFIG.middayTime,
  eveningOn: DEFAULT_CONFIG.eveningOn,
  eveningTime: DEFAULT_CONFIG.eveningTime,
  refreshHours: DEFAULT_CONFIG.refreshHours,
  remind: DEFAULT_CONFIG.remind,
  agendaFile: DEFAULT_CONFIG.agendaFile,
  routineFile: DEFAULT_CONFIG.routineFile,
  calendarOn: DEFAULT_CONFIG.calendarOn,
  calendarId: DEFAULT_CONFIG.calendarId,
  scanRoots: DEFAULT_CONFIG.scanRoots.join(", "),
  projectFolder: DEFAULT_CONFIG.projectFolder,
  autoInbox: true,
  inboxFolder: DEFAULT_CONFIG.inboxFolder,
  materialsFolder: DEFAULT_CONFIG.materialsFolder,
};
const MAX_SAVED_MSGS = 200;
const CAN_SCHEDULE = scheduleSupported();

// iCloud에서 아직 안 받은 첨부파일을 검색하다 멈추는 것을 막음: 노트(.md, .canvas)만 검색
const RGIGNORE = `# Claude Sidebar: 노트(.md, .canvas)만 검색합니다.
# iCloud에서 아직 안 받은 첨부파일을 열다가 검색이 멈추는 걸 막아요.
*
!*/
!*.md
!*.canvas
.obsidian/
.trash/
`;

export interface Chat {
  sessionId: string | null;
  messages: ChatMsg[];
}

export default class ClaudeSidebarPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  chat: Chat = { sessionId: null, messages: [] };
  private lastMd: MarkdownView | null = null;
  private inboxBusy = false;
  private inboxAgain = false;
  private inboxTimer: number | null = null;
  private inboxLabel: string | null = null;

  async onload(): Promise<void> {
    const data = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULTS, ...(data.settings ?? {}) };
    this.chat = {
      sessionId: data.chat?.sessionId ?? null,
      messages: Array.isArray(data.chat?.messages) ? data.chat.messages : [],
    };

    this.registerView(VIEW_TYPE, (leaf) => new ClaudeView(leaf, this));
    this.registerHoverLinkSource(VIEW_TYPE, { display: "Claude", defaultMod: true });
    this.addRibbonIcon("bot", "Claude", () => void this.openView(true));

    this.addCommand({ id: "open", name: "열기", callback: () => void this.openView(true) });
    this.addCommand({ id: "briefing", name: "브리핑 (지금 시각에 맞게)", callback: async () => (await this.openView()).runBriefing() });
    this.addCommand({ id: "morning", name: "아침 브리핑", callback: async () => (await this.openView()).runBriefing("morning") });
    this.addCommand({ id: "midday", name: "점심 점검", callback: async () => (await this.openView()).runBriefing("midday") });
    this.addCommand({ id: "evening", name: "저녁 회고", callback: async () => (await this.openView()).runBriefing("evening") });
    this.addCommand({ id: "inbox", name: "받은자료 정리", callback: async () => (await this.openView(), this.queueInbox()) });
    this.addCommand({ id: "polish", name: "지금 노트 다듬기", callback: async () => (await this.openView()).runPolish() });
    this.addCommand({ id: "save", name: "대화를 노트로 저장", callback: async () => (await this.openView()).runSave() });
    this.addCommand({ id: "new", name: "새 대화", callback: async () => (await this.openView(true)).newChat() });

    const refresh = () => this.views().forEach((v) => v.updateCtx());
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.lastMd = leaf.view;
        refresh();
      }),
    );
    this.registerEvent(this.app.workspace.on("file-open", refresh));

    this.app.workspace.onLayoutReady(async () => {
      // 받은자료 폴더에 새 파일이 들어오면 (폰에서 iCloud로 넣은 것 포함) 정리.
      // 옵시디언은 켜질 때 모든 파일에 create를 보내므로 준비가 끝난 뒤에 등록
      this.registerEvent(
        this.app.vault.on("create", (f) => {
          if (this.settings.autoInbox && f instanceof TFile && f.path.startsWith(normalizePath(this.settings.inboxFolder) + "/")) this.queueInbox();
        }),
      );
      const v = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getMostRecentLeaf()?.view;
      if (v instanceof MarkdownView) this.lastMd = v;
      refresh();
      this.ensureRgignore();
      this.syncAssistant();
      if (this.settings.calendarOn) void refreshCalendar(this.assistantConfig(), new Date(), true).catch(() => undefined);
      if (this.settings.autoInbox) {
        await this.ensureFolder(this.settings.inboxFolder);
        this.queueInbox();
      }
    });

    this.addSettingTab(new SettingsTab(this.app, this));
  }

  views(): ClaudeView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((l) => l.view)
      .filter((v): v is ClaudeView => v instanceof ClaudeView);
  }

  async openView(focus = false): Promise<ClaudeView> {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false) ?? ws.getLeaf("split");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await ws.revealLeaf(leaf);
    await leaf.loadIfDeferred();
    const view = leaf.view as ClaudeView;
    if (focus) view.focusInput();
    return view;
  }

  /** 마지막으로 보던 노트 편집기 (사이드바를 눌러도 기억) */
  private liveMd(): MarkdownView | null {
    const v = this.lastMd;
    if (v && this.app.workspace.getLeavesOfType("markdown").some((l) => l.view === v)) return v;
    return null;
  }

  lastFile(): TFile | null {
    return this.liveMd()?.file ?? this.app.workspace.getActiveFile();
  }

  lastSelection(): string {
    return this.liveMd()?.editor?.getSelection() ?? "";
  }

  vaultPath(): string {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : "";
  }

  claudePath(): string | null {
    return findClaude(this.settings.claudePath);
  }

  async saveChat(): Promise<void> {
    if (this.chat.messages.length > MAX_SAVED_MSGS) this.chat.messages = this.chat.messages.slice(-MAX_SAVED_MSGS);
    await this.saveData({ settings: this.settings, chat: this.chat });
  }

  private ensureRgignore(): void {
    const p = join(this.vaultPath(), ".rgignore");
    try {
      if (this.vaultPath() && !existsSync(p)) writeFileSync(p, RGIGNORE);
    } catch {
      /* 쓰기 권한 없음 등: 검색이 조금 느릴 뿐 */
    }
  }

  // ─── 비서 ─────────────────────────────────────────────────

  assistantConfig(): AssistantConfig {
    const s = this.settings;
    return {
      ...DEFAULT_CONFIG,
      vault: this.vaultPath(),
      enabled: s.assistantOn,
      time: s.briefTime,
      middayOn: s.middayOn,
      middayTime: s.middayTime,
      eveningOn: s.eveningOn,
      eveningTime: s.eveningTime,
      refreshHours: s.refreshHours,
      remind: s.remind,
      agendaFile: s.agendaFile,
      routineFile: s.routineFile,
      calendarOn: s.calendarOn,
      calendarId: s.calendarId,
      scanRoots: s.scanRoots.split(",").map((x) => x.trim()).filter(Boolean),
      projectFolder: s.projectFolder,
      inboxFolder: s.inboxFolder,
      materialsFolder: s.materialsFolder,
      model: s.model,
      claudePath: s.claudePath,
    };
  }

  /** 볼트 밖 아침 작업이 읽는 설정 파일과 실행 파일을 최신으로 맞춤 */
  syncAssistant(): void {
    try {
      saveConfig(this.assistantConfig());
      if (this.settings.assistantOn) copyScript(this.scriptPath());
    } catch (e) {
      console.error("[claude-sidebar]", e);
    }
  }

  scriptPath(): string {
    return join(this.vaultPath(), this.manifest.dir ?? "", "assistant.js");
  }

  async setSchedule(on: boolean): Promise<void> {
    if (on && !CAN_SCHEDULE) throw new Error("자동 비서는 macOS와 Windows에서만 돼요");
    this.settings.assistantOn = on;
    await this.saveChat();
    this.syncAssistant();
    if (on) await installSchedule(this.scriptPath());
    else await uninstallSchedule();
  }

  /** 대화에서 말한 일정 넣기: 시각이 있고 캘린더가 연결돼 있으면 애플 캘린더, 아니면 일정 노트 */
  addAgenda(it: AgendaItem, end?: string): Promise<AddedTodo> {
    return addTodo(this.assistantConfig(), it, end);
  }

  removeAgenda(it: AgendaItem, added: AddedTodo, end?: string): Promise<void> {
    return removeTodo(this.assistantConfig(), it, added, end);
  }

  /** 애플 캘린더 연결: 허용을 묻고(처음 한 번), 캘린더 목록을 가져옴 */
  calendars: CalInfo[] = [];
  async connectCalendar(on: boolean): Promise<void> {
    if (on) {
      if (!calendarSupported()) throw new Error("애플 캘린더는 맥에서만 돼요");
      const st = await calAuth();
      if (st !== "full") throw new Error("캘린더 접근을 허용하지 않았어요");
      this.calendars = await calCalendars();
    }
    this.settings.calendarOn = on;
    await this.saveChat();
    this.syncAssistant();
    if (on) await refreshCalendar(this.assistantConfig(), new Date(), true);
  }

  calendarCache(): string {
    return CAL_CACHE;
  }

  /** 대화에서 말한 루틴을 루틴 노트(와 오늘 할 날이면 데일리 노트)에 넣음 */
  addRoutine(r: Routine): boolean {
    return addToRoutines(this.assistantConfig(), r);
  }

  removeRoutine(r: Routine): void {
    removeFromRoutines(this.assistantConfig(), r);
  }

  /** 대화에서 읽어도 되는 볼트 밖 폴더: 최근 프로젝트 폴더 + 현황 파일 폴더 */
  projectDirs(): string[] {
    const dirs = existsSync(SUPPORT_DIR) ? [SUPPORT_DIR] : [];
    try {
      const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
      for (const p of snap.projects) if (p.localPath && existsSync(p.localPath)) dirs.push(p.localPath);
    } catch {
      /* 아직 브리핑을 안 돌렸으면 없음 */
    }
    return dirs;
  }

  async ensureFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(p)) {
      try {
        await this.app.vault.createFolder(p);
      } catch {
        /* 이미 있음 */
      }
    }
  }

  async writeToInbox(name: string, data: ArrayBuffer): Promise<void> {
    const dir = normalizePath(this.settings.inboxFolder);
    await this.ensureFolder(dir);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let path = `${dir}/${name}`;
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${dir}/${stem} ${n}${ext}`;
    await this.app.vault.createBinary(path, data);
  }

  /** 받은자료 정리를 잠시 뒤에 한 번에 (여러 파일이 연달아 들어와도 한 번만) */
  queueInbox(label?: string): void {
    if (label) this.inboxLabel = label;
    if (this.inboxTimer !== null) window.clearTimeout(this.inboxTimer);
    this.inboxTimer = window.setTimeout(() => {
      this.inboxTimer = null;
      void this.runInbox();
    }, 1500);
  }

  private async runInbox(): Promise<void> {
    if (this.inboxBusy) {
      this.inboxAgain = true;
      return;
    }
    const cfg = this.assistantConfig();
    if (!this.claudePath()) return;
    this.inboxBusy = true;
    try {
      do {
        this.inboxAgain = false;
        const items = listInbox(cfg);
        if (!items.length) break;
        const label = this.inboxLabel ?? `받은자료 ${items.length}개`;
        this.inboxLabel = null;
        const task = this.views()[0]?.startTask(label, "inbox");
        const results = await processInbox(cfg, { step: (_, name) => task?.step("file", name) }, items);
        const ok = results.filter((r) => r.note);
        const bad = results.filter((r) => r.error);
        const lines = ok.map((r) => {
          const link = r.note!.replace(/\.md$/, "");
          return `- ${r.category} · [[${link}|${link.split("/").pop()}]]`;
        });
        const text = ok.length ? `**${ok.length}개 정리함**\n${lines.join("\n")}` : "";
        const err = bad.length ? bad.map((b) => `${b.source.split("/").pop()}: ${b.error}`).join("\n") : undefined;
        if (task) await task.finish(text, err);
        else new Notice(`📥 ${ok.length}개 정리함${bad.length ? ` · ${bad.length}개 실패` : ""}`);
      } while (this.inboxAgain);
    } finally {
      this.inboxBusy = false;
    }
  }
}

class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ClaudeSidebarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveChat();
      this.plugin.syncAssistant();
    };
    containerEl.empty();

    const found = this.plugin.claudePath();
    new Setting(containerEl)
      .setName("Claude Code 경로")
      .setDesc(found ? `찾음: ${found}` : "못 찾았어요. 터미널에서 `which claude` 결과를 넣어 주세요.")
      .addText((t) =>
        t
          .setPlaceholder(findClaude() ?? "/Users/이름/.local/bin/claude")
          .setValue(s.claudePath)
          .onChange(async (v) => {
            s.claudePath = v.trim();
            await save();
          }),
      )
      .addButton((b) =>
        b.setButtonText("연결 확인").onClick(async () => {
          const p = this.plugin.claudePath();
          if (!p) return void new Notice("Claude Code를 찾지 못했어요");
          try {
            new Notice(`연결됨 · ${await claudeVersion(p)}`);
          } catch (e) {
            new Notice(`실패: ${(e as Error).message}`);
          }
        }),
      );

    new Setting(containerEl)
      .setName("모델")
      .setDesc("Sonnet이 빠르고 무난해요. Opus는 더 똑똑하지만 사용량을 많이 써요.")
      .addDropdown((d) =>
        d
          .addOptions({ "": "Claude Code 기본값", sonnet: "Sonnet", opus: "Opus", haiku: "Haiku (가장 빠름)" })
          .setValue(s.model)
          .onChange(async (v) => {
            s.model = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("생각 깊이")
      .setDesc("대화할 때. 낮을수록 빨리 답해요.")
      .addDropdown((d) =>
        d
          .addOptions({ low: "낮음", medium: "보통", high: "높음" })
          .setValue(s.effort)
          .onChange(async (v) => {
            s.effort = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("대화 저장 폴더")
      .addText((t) =>
        t.setPlaceholder("Claude").setValue(s.saveFolder).onChange(async (v) => {
          s.saveFolder = v.trim() || "Claude";
          await save();
        }),
      );

    // ── 비서 ──
    new Setting(containerEl).setName("비서").setHeading();

    const on = s.assistantOn && scheduleInstalled();
    new Setting(containerEl)
      .setName("자동 비서")
      .setDesc(
        !CAN_SCHEDULE
          ? "macOS와 Windows에서만 돼요. 📅 버튼으로 직접 브리핑할 수는 있어요"
          : on
          ? "켜짐 · 옵시디언이 꺼져 있어도 아래 시각에 데일리 노트에 쓰고 알려요"
          : "정한 시각에 오늘 할 일, 오후 점검, 저녁 회고를 데일리 노트에 쓰고 알림을 띄워요",
      )
      .addToggle((t) =>
        t.setDisabled(!CAN_SCHEDULE).setValue(on).onChange(async (v) => {
          try {
            await this.plugin.setSchedule(v);
            new Notice(v ? "켰어요 · 지금 할 일이 있으면 바로 해요" : "자동 비서를 껐어요");
          } catch (e) {
            new Notice(`실패: ${(e as Error).message}`);
          }
          this.display();
        }),
      );

    type TimeKey = "briefTime" | "middayTime" | "eveningTime";
    const slot = (name: string, desc: string, onKey: "middayOn" | "eveningOn" | null, timeKey: TimeKey) => {
      const row = new Setting(containerEl).setName(name).setDesc(desc);
      row.addText((t) =>
        t.setPlaceholder(DEFAULTS[timeKey]).setValue(s[timeKey]).onChange(async (v) => {
          const n = normalizeTime(v);
          if (!n) return;
          s[timeKey] = n;
          await save();
        }),
      );
      if (onKey) {
        row.addToggle((t) =>
          t.setValue(s[onKey]).onChange(async (v) => {
            s[onKey] = v;
            await save();
          }),
        );
      }
      row.settingEl.addClass("cs-slot-setting");
    };
    slot("아침 브리핑", "오늘 할 일 · 다가오는 일정 · 프로젝트 현황", null, "briefTime");
    slot("점심 점검", "오전에 한 것을 보고 오후 할 일 1~3개", "middayOn", "middayTime");
    slot("저녁 회고", "오늘 한 것 · 내일 이어갈 것", "eveningOn", "eveningTime");

    new Setting(containerEl)
      .setName("현황 새로고침")
      .setDesc("커밋과 체크를 보고 진행도·현황표만 고쳐요 (Claude 안 씀)")
      .addDropdown((d) =>
        d
          .addOptions({ "0": "끄기", "1": "1시간마다", "2": "2시간마다", "4": "4시간마다" })
          .setValue(String(s.refreshHours))
          .onChange(async (v) => {
            s.refreshHours = Number(v);
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("일정 알림 · 일정 노트")
      .setDesc(`사이드바에 "금요일 3시 치과"처럼 말하면 일정 노트에 들어가고, 그날 할 일에 붙고, 15분 전에 알려요`)
      .addToggle((t) =>
        t.setValue(s.remind).onChange(async (v) => {
          s.remind = v;
          await save();
        }),
      )
      .addText((t) =>
        t.setPlaceholder("일정.md").setValue(s.agendaFile).onChange(async (v) => {
          s.agendaFile = v.trim() || "일정.md";
          await save();
        }),
      );

    if (calendarSupported()) {
      const calRow = new Setting(containerEl)
        .setName("애플 캘린더")
        .setDesc(
          s.calendarOn
            ? "연결됨 · 오늘 일정이 할 일에 📆로 붙고, 시각을 말한 일정은 아래 캘린더에 들어가요 (15분 전 알림)"
            : "켜면 캘린더 일정을 브리핑에 쓰고, \"금요일 3시 치과\"처럼 말한 일정을 캘린더에 넣어요. 처음에 맥이 접근 허용을 물어요",
        )
        .addToggle((t) =>
          t.setValue(s.calendarOn).onChange(async (v) => {
            try {
              await this.plugin.connectCalendar(v);
              new Notice(v ? "애플 캘린더를 연결했어요" : "애플 캘린더 연결을 껐어요");
            } catch (e) {
              new Notice(`실패: ${(e as Error).message}`);
            }
            this.display();
          }),
        );
      if (s.calendarOn) {
        const writable = this.plugin.calendars.filter((c) => c.writable);
        if (!writable.length) void calCalendars().then((c) => ((this.plugin.calendars = c), c.length && this.display())).catch(() => undefined);
        calRow.addDropdown((d) => {
          d.addOption("", "기본 캘린더");
          for (const c of writable) d.addOption(c.id, `${c.title} · ${c.source}`);
          d.setValue(s.calendarId).onChange(async (v) => {
            s.calendarId = v;
            await save();
          });
        });
      }
    }

    new Setting(containerEl)
      .setName("루틴 노트")
      .setDesc(`"매일 7시 영어 단어", "월수금 헬스"처럼 말하면 들어가요. 그 요일 할 일에 🔁로 붙고, 체크하면 연속 기록(🔥)이 쌓여요`)
      .addText((t) =>
        t.setPlaceholder("루틴.md").setValue(s.routineFile).onChange(async (v) => {
          s.routineFile = v.trim() || "루틴.md";
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("프로젝트 찾을 곳")
      .setDesc("git 폴더를 찾을 위치. 쉼표로 여러 개.")
      .addText((t) =>
        t.setPlaceholder("~/Desktop").setValue(s.scanRoots).onChange(async (v) => {
          s.scanRoots = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("프로젝트 노트 폴더")
      .addText((t) =>
        t.setPlaceholder("프로젝트").setValue(s.projectFolder).onChange(async (v) => {
          s.projectFolder = v.trim() || "프로젝트";
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("받은자료 자동 정리")
      .setDesc(`"${s.inboxFolder}" 폴더에 파일이 들어오면 정리해서 "${s.materialsFolder}/분류/"에 저장해요`)
      .addToggle((t) =>
        t.setValue(s.autoInbox).onChange(async (on) => {
          s.autoInbox = on;
          await save();
          if (on) await this.plugin.ensureFolder(s.inboxFolder);
        }),
      );

    new Setting(containerEl)
      .setName("받은자료 폴더 · 자료 폴더")
      .addText((t) =>
        t.setPlaceholder("받은자료").setValue(s.inboxFolder).onChange(async (v) => {
          s.inboxFolder = v.trim() || "받은자료";
          await save();
        }),
      )
      .addText((t) =>
        t.setPlaceholder("자료").setValue(s.materialsFolder).onChange(async (v) => {
          s.materialsFolder = v.trim() || "자료";
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("기록")
      .setDesc(LOG_PATH)
      .addButton((b) =>
        b.setButtonText("지금 브리핑").onClick(async () => (await this.plugin.openView()).runBriefing()),
      );
  }
}
