import { App, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { ChatMsg, ClaudeView, VIEW_TYPE } from "./view";
import { claudeVersion, findClaude } from "./claude";

interface Settings {
  claudePath: string;
  model: string;
  effort: string;
  saveFolder: string;
}

const DEFAULTS: Settings = { claudePath: "", model: "sonnet", effort: "low", saveFolder: "Claude" };
const MAX_SAVED_MSGS = 200;

export interface Chat {
  sessionId: string | null;
  messages: ChatMsg[];
}

export default class ClaudeSidebarPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  chat: Chat = { sessionId: null, messages: [] };
  private lastMd: MarkdownView | null = null;

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
    this.addCommand({ id: "daily", name: "오늘 노트 정리", callback: async () => (await this.openView()).runDaily() });
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
    this.app.workspace.onLayoutReady(() => {
      const v = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getMostRecentLeaf()?.view;
      if (v instanceof MarkdownView) this.lastMd = v;
      refresh();
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
}

class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ClaudeSidebarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveChat();
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
      .setDesc("낮을수록 빨리 답해요.")
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
      .setDesc("💾 버튼으로 저장한 대화가 들어가요.")
      .addText((t) =>
        t
          .setPlaceholder("Claude")
          .setValue(s.saveFolder)
          .onChange(async (v) => {
            s.saveFolder = v.trim() || "Claude";
            await save();
          }),
      );
  }
}
