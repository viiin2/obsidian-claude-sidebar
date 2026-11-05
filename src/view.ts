// 오른쪽 사이드바의 Claude 채팅 화면.

import {
  Component,
  FileSystemAdapter,
  HoverPopover,
  ItemView,
  Keymap,
  MarkdownRenderer,
  Notice,
  WorkspaceLeaf,
  moment,
  setIcon,
} from "obsidian";
import type ClaudeSidebarPlugin from "./main";
import { RunHandle, runClaude } from "./claude";
import { NoteMode, NoteSeg, noteBlocks, parseSegments } from "./segments";
import { diffLines, diffStats, hunks } from "./diff";
import { applyNote, cleanPath, getFile } from "./apply";
import { SYSTEM_PROMPT, contextHeader, dailyPrompt, polishPrompt, savePrompt } from "./prompts";
import { openToday, recentDailies } from "./daily";

export const VIEW_TYPE = "claude-sidebar-view";

export interface ToolUse {
  name: string;
  detail: string;
  path?: string;
}

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  /** user: 빠른 버튼으로 보낸 경우 화면에 보일 짧은 말 */
  label?: string;
  icon?: string;
  tools?: ToolUse[];
  error?: string;
  /** assistant: 적용한 제안 블록 번호 */
  applied?: number[];
  ms?: number;
}

interface SendOptions {
  /** Claude에게 실제로 보낼 글 (없으면 화면에 보인 글 그대로) */
  prompt?: string;
  label?: string;
  icon?: string;
  /** full: 날짜 + 열린 노트 + 선택 부분, date: 날짜만 */
  context?: "full" | "date";
  /** 끝나면 제안 블록을 바로 적용 (대화 저장) */
  autoApply?: boolean;
}

const MODE_ICON: Record<NoteMode, string> = {
  replace: "pencil",
  prepend: "arrow-up-to-line",
  append: "arrow-down-to-line",
  create: "file-plus",
};
const MODE_LABEL: Record<NoteMode, string> = { replace: "고침", prepend: "맨 위", append: "맨 끝", create: "새 노트" };
const TOOL_ICON: Record<string, string> = { Grep: "search", Glob: "folder-search", Read: "file-text" };

const baseName = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
const lineCount = (s: string) => (s ? s.split("\n").length : 0);

export class ClaudeView extends ItemView {
  hoverPopover: HoverPopover | null = null;

  private msgsEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private ctxEl!: HTMLElement;

  private run: RunHandle | null = null;
  private runIdx = -1;
  private runStart = 0;
  private tick: number | null = null;
  private renderTimer: number | null = null;
  private renderSeq = new Map<number, number>();
  private components = new Map<number, Component>();
  /** 제안 카드별 적용 전 내용 (비교·되돌리기용). 키: "메시지번호:블록번호" */
  private before = new Map<string, string | null>();
  private undos = new Map<string, () => Promise<void>>();
  private includeNote = true;
  private resizeObs: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ClaudeSidebarPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Claude";
  }
  getIcon(): string {
    return "bot";
  }

  private get msgs(): ChatMsg[] {
    return this.plugin.chat.messages;
  }

  // ─── 화면 만들기 ───────────────────────────────────────────

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("cs-root");

    const head = root.createDiv("cs-head");
    const logo = head.createDiv("cs-logo");
    setIcon(logo, "bot");
    const actions = head.createDiv("cs-actions");
    this.iconButton(actions, "calendar-check", "오늘 노트", () => void this.runDaily());
    this.iconButton(actions, "sparkles", "지금 노트 다듬기", () => void this.runPolish());
    this.iconButton(actions, "save", "대화를 노트로 저장", () => void this.runSave());
    this.iconButton(actions, "square-pen", "새 대화", () => this.newChat());

    this.msgsEl = root.createDiv("cs-msgs");
    this.bindLinks(this.msgsEl);

    const foot = root.createDiv("cs-foot");
    this.ctxEl = foot.createDiv("cs-ctx");
    const box = foot.createDiv("cs-box");
    this.inputEl = box.createEl("textarea", { cls: "cs-input", attr: { rows: "1", placeholder: "물어보기…" } });
    this.sendBtn = box.createEl("button", { cls: "cs-send" });
    setIcon(this.sendBtn, "arrow-up");
    this.sendBtn.setAttr("aria-label", "보내기");

    this.inputEl.addEventListener("keydown", (e) => {
      // 한글 입력 중(조합 중)의 Enter는 글자 확정이므로 보내지 않음
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape" && this.run) {
        this.run.stop();
      }
    });
    this.inputEl.addEventListener("input", () => this.autoGrow());
    this.inputEl.addEventListener("focus", () => this.updateCtx());
    this.sendBtn.addEventListener("click", () => (this.run ? this.run.stop() : this.submit()));

    this.renderAll();
    this.updateCtx();

    // 옵시디언 아래쪽 상태 표시줄이 입력창을 가리지 않게 겹치는 만큼 띄움
    const fit = () => this.fitStatusBar();
    this.registerEvent(this.app.workspace.on("layout-change", fit));
    this.registerEvent(this.app.workspace.on("resize", fit));
    this.registerDomEvent(window, "resize", fit);
    this.resizeObs = new ResizeObserver(fit);
    this.resizeObs.observe(this.contentEl);
    const bar = document.body.querySelector(".status-bar");
    if (bar) this.resizeObs.observe(bar);
    window.setTimeout(fit, 100);
  }

  private fitStatusBar(): void {
    const bar = document.body.querySelector(".status-bar") as HTMLElement | null;
    let h = 0;
    if (bar && getComputedStyle(bar).display !== "none") {
      const b = bar.getBoundingClientRect();
      const v = this.contentEl.getBoundingClientRect();
      const overlaps = b.height > 0 && b.left < v.right && b.right > v.left && b.top < v.bottom && b.bottom > v.top;
      if (overlaps) h = Math.ceil(v.bottom - b.top);
    }
    this.contentEl.style.setProperty("--cs-status-h", `${h}px`);
  }

  async onClose(): Promise<void> {
    this.resizeObs?.disconnect();
    this.run?.stop();
    if (this.tick) window.clearInterval(this.tick);
    this.components.forEach((c) => c.unload());
    this.components.clear();
  }

  focusInput(): void {
    window.setTimeout(() => this.inputEl?.focus(), 50);
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
    const b = parent.createEl("button", { cls: "cs-icon-btn clickable-icon", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", onClick);
    return b;
  }

  private autoGrow(): void {
    const el = this.inputEl;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  /** 열린 노트(와 선택한 부분)를 함께 보낼지 보여 주는 칩 */
  updateCtx(): void {
    if (!this.ctxEl) return;
    this.ctxEl.empty();
    const f = this.plugin.lastFile();
    if (!f) return;
    const chip = this.ctxEl.createDiv({ cls: "cs-chip" });
    chip.toggleClass("is-off", !this.includeNote);
    setIcon(chip.createSpan("cs-chip-icon"), "file-text");
    chip.createSpan({ cls: "cs-chip-name", text: f.basename });
    const sel = this.plugin.lastSelection();
    if (sel && this.includeNote) {
      const s = chip.createSpan("cs-chip-sel");
      setIcon(s.createSpan("cs-chip-icon"), "text-cursor");
      s.createSpan({ text: String(lineCount(sel)) });
    }
    chip.setAttr("aria-label", this.includeNote ? "열린 노트를 함께 봐요 · 누르면 끄기" : "열린 노트 안 봐요 · 누르면 켜기");
    chip.addEventListener("click", () => {
      this.includeNote = !this.includeNote;
      this.updateCtx();
    });
  }

  private bindLinks(el: HTMLElement): void {
    const linkOf = (e: MouseEvent) => (e.target as HTMLElement).closest("a.internal-link") as HTMLAnchorElement | null;
    el.addEventListener("click", (e) => {
      const a = linkOf(e);
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
      void this.app.workspace.openLinkText(href, "", Keymap.isModEvent(e));
    });
    el.addEventListener("mouseover", (e) => {
      const a = linkOf(e);
      if (!a) return;
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: VIEW_TYPE,
        hoverParent: this,
        targetEl: a,
        linktext: a.getAttribute("data-href") ?? "",
      });
    });
  }

  // ─── 메시지 그리기 ─────────────────────────────────────────

  private nearBottom(): boolean {
    const el = this.msgsEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  private scrollBottom(): void {
    this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
  }

  private renderAll(): void {
    this.components.forEach((c) => c.unload());
    this.components.clear();
    this.msgsEl.empty();
    if (!this.msgs.length) {
      this.renderEmpty();
      return;
    }
    this.msgs.forEach((_, i) => void this.renderMsg(i));
    window.setTimeout(() => this.scrollBottom(), 50);
  }

  private renderEmpty(): void {
    const e = this.msgsEl.createDiv("cs-empty");
    setIcon(e.createDiv("cs-empty-bot"), "bot");
    const row = e.createDiv("cs-empty-row");
    const pill = (icon: string, text: string, fn: () => void) => {
      const b = row.createEl("button", { cls: "cs-pill" });
      setIcon(b.createSpan(), icon);
      b.createSpan({ text });
      b.addEventListener("click", fn);
    };
    pill("calendar-check", "오늘", () => void this.runDaily());
    pill("sparkles", "다듬기", () => void this.runPolish());
  }

  private scheduleRender(i: number): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.renderMsg(i);
    }, 60);
  }

  /** 새 내용을 화면 밖에서 다 그린 뒤 한 번에 바꿔 끼웁니다 (깜빡임 방지). */
  private async renderMsg(i: number): Promise<void> {
    const m = this.msgs[i];
    if (!m) return;
    const seq = (this.renderSeq.get(i) ?? 0) + 1;
    this.renderSeq.set(i, seq);

    let el = this.msgsEl.querySelector(`:scope > [data-idx="${i}"]`) as HTMLElement | null;
    const isNew = !el;
    if (!el) el = this.msgsEl.createDiv({ attr: { "data-idx": String(i) } });

    const comp = new Component();
    comp.load();
    const fresh = createDiv();
    const jobs: Promise<unknown>[] = [];
    if (m.role === "user") this.drawUser(fresh, m);
    else this.drawBot(fresh, i, m, comp, jobs);
    await Promise.all(jobs);

    if (this.renderSeq.get(i) !== seq) {
      comp.unload();
      return;
    }
    const stick = this.nearBottom();
    this.components.get(i)?.unload();
    this.components.set(i, comp);
    el.className = `cs-msg ${m.role === "user" ? "cs-user" : "cs-bot"}${isNew ? " is-new" : ""}`;
    el.replaceChildren(...Array.from(fresh.childNodes));
    if (stick) this.scrollBottom();
  }

  private drawUser(el: HTMLElement, m: ChatMsg): void {
    const b = el.createDiv("cs-bubble");
    if (m.icon) setIcon(b.createSpan("cs-bubble-icon"), m.icon);
    b.createSpan({ text: m.label ?? m.text });
  }

  private drawBot(el: HTMLElement, i: number, m: ChatMsg, comp: Component, jobs: Promise<unknown>[]): void {
    const running = !!this.run && this.runIdx === i;

    if (m.tools?.length) this.drawTools(el, m.tools);

    for (const s of parseSegments(m.text, running)) {
      if (s.kind === "text") {
        const md = el.createDiv("cs-md");
        jobs.push(MarkdownRenderer.render(this.app, s.text, md, "", comp));
      } else {
        jobs.push(this.drawCard(el, i, m, s, comp));
      }
    }

    if (running) {
      const t = el.createDiv("cs-typing");
      t.createSpan("cs-dot");
      t.createSpan("cs-dot");
      t.createSpan("cs-dot");
      t.createSpan({ cls: "cs-secs", text: this.elapsed() });
    }

    if (m.error) {
      const er = el.createDiv("cs-err");
      setIcon(er.createSpan("cs-err-icon"), "alert-circle");
      er.createSpan({ text: m.error });
    }

    if (!running && m.text.trim()) {
      const meta = el.createDiv("cs-meta");
      if (m.ms) meta.createSpan({ text: `${(m.ms / 1000).toFixed(1)}s` });
      const copy = meta.createEl("button", { cls: "cs-meta-btn clickable-icon", attr: { "aria-label": "복사" } });
      setIcon(copy, "copy");
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(m.text);
        setIcon(copy, "check");
        window.setTimeout(() => setIcon(copy, "copy"), 1200);
      });
    }
  }

  private drawTools(el: HTMLElement, tools: ToolUse[]): void {
    const row = el.createDiv("cs-tools");
    const shown = tools.slice(-4);
    if (tools.length > shown.length) row.createSpan({ cls: "cs-tool cs-tool-more", text: `+${tools.length - shown.length}` });
    for (const t of shown) {
      const chip = row.createSpan("cs-tool");
      setIcon(chip.createSpan("cs-tool-icon"), TOOL_ICON[t.name] ?? "wrench");
      chip.createSpan({ cls: "cs-tool-text", text: t.detail });
      if (t.path) {
        chip.addClass("is-link");
        chip.setAttr("aria-label", t.path);
        const p = t.path;
        chip.addEventListener("click", () => void this.app.workspace.openLinkText(p, "", false));
      }
    }
  }

  private async beforeContent(key: string, path: string): Promise<string | null> {
    if (this.before.has(key)) return this.before.get(key) ?? null;
    const f = getFile(this.app, path);
    const v = f ? await this.app.vault.read(f) : null;
    this.before.set(key, v);
    return v;
  }

  private async drawCard(parent: HTMLElement, i: number, m: ChatMsg, s: NoteSeg, comp: Component): Promise<void> {
    const key = `${i}:${s.index}`;
    const applied = m.applied?.includes(s.index) ?? false;
    const path = cleanPath(s.path);

    const card = parent.createDiv("cs-card");
    card.toggleClass("is-writing", !s.complete);
    card.toggleClass("is-applied", applied);

    const head = card.createDiv("cs-card-head");
    setIcon(head.createSpan("cs-card-icon"), MODE_ICON[s.mode]);
    const name = head.createSpan({ cls: "cs-card-name", text: baseName(path ?? s.path) || "?" });
    if (path) {
      name.setAttr("aria-label", path);
      name.addEventListener("click", () => {
        if (getFile(this.app, path)) void this.app.workspace.openLinkText(path, "", false);
      });
    }
    head.createSpan({ cls: "cs-card-mode", text: MODE_LABEL[s.mode] });
    const stats = head.createSpan("cs-card-stats");

    if (!s.complete) {
      card.createDiv({ cls: "cs-card-writing", text: `${lineCount(s.content)}줄` });
      return;
    }
    if (!path) {
      card.createDiv({ cls: "cs-err", text: `쓸 수 없는 경로: ${s.path}` });
      return;
    }

    // 적용 전/후 비교 (고침) 또는 미리보기 (나머지)
    let drewDiff = false;
    if (s.mode === "replace" && (!applied || this.before.has(key))) {
      const old = await this.beforeContent(key, path);
      const d = old !== null ? diffLines(old, s.content) : null;
      if (d) {
        const st = diffStats(d);
        stats.createSpan({ cls: "cs-add", text: `+${st.add}` });
        stats.createSpan({ cls: "cs-del", text: `−${st.del}` });
        drewDiff = true;
        if (!applied) {
          const box = card.createDiv("cs-diff");
          for (const l of hunks(d, 1)) {
            if (l.t === "…") box.createDiv({ cls: "cs-diff-skip", text: `⋯ ${l.s}` });
            else box.createDiv({ cls: `cs-diff-line ${l.t === "+" ? "is-add" : l.t === "-" ? "is-del" : ""}`, text: l.s || " " });
          }
          if (st.add + st.del === 0) box.createDiv({ cls: "cs-diff-skip", text: "바뀐 곳 없음" });
        }
      }
    } else if (s.mode !== "replace") {
      stats.createSpan({ cls: "cs-add", text: `+${lineCount(s.content)}` });
    }
    if (!drewDiff && !applied) {
      const pv = card.createDiv("cs-card-preview");
      await MarkdownRenderer.render(this.app, s.content, pv, path, comp);
    }

    const actions = card.createDiv("cs-card-actions");
    if (!applied) {
      const ok = actions.createEl("button", { cls: "cs-apply mod-cta" });
      setIcon(ok.createSpan(), "check");
      ok.createSpan({ text: "적용" });
      ok.addEventListener("click", () => void this.applyBlock(i, s));
      const cp = actions.createEl("button", { cls: "cs-icon-btn clickable-icon", attr: { "aria-label": "내용 복사" } });
      setIcon(cp, "copy");
      cp.addEventListener("click", () => {
        void navigator.clipboard.writeText(s.content);
        setIcon(cp, "check");
      });
    } else {
      const done = actions.createSpan("cs-done");
      setIcon(done.createSpan(), "check");
      done.createSpan({ text: "적용됨" });
      if (this.undos.has(key)) {
        const ub = actions.createEl("button", { cls: "cs-icon-btn clickable-icon", attr: { "aria-label": "되돌리기" } });
        setIcon(ub, "undo-2");
        ub.addEventListener("click", () => void this.undoBlock(i, s));
      }
    }
  }

  private async applyBlock(i: number, s: NoteSeg): Promise<void> {
    const m = this.msgs[i];
    const key = `${i}:${s.index}`;
    if (m.applied?.includes(s.index)) return;
    try {
      const path = cleanPath(s.path);
      if (path) await this.beforeContent(key, path);
      const res = await applyNote(this.app, s);
      this.undos.set(key, res.undo);
      m.applied = [...(m.applied ?? []), s.index];
      void this.plugin.saveChat();
      await this.renderMsg(i);
      if (s.mode === "create") await this.app.workspace.getLeaf(false).openFile(res.file);
    } catch (e) {
      new Notice(`적용하지 못했어요: ${(e as Error).message}`);
    }
  }

  private async undoBlock(i: number, s: NoteSeg): Promise<void> {
    const m = this.msgs[i];
    const key = `${i}:${s.index}`;
    const undo = this.undos.get(key);
    if (!undo) return;
    try {
      await undo();
      this.undos.delete(key);
      m.applied = (m.applied ?? []).filter((x) => x !== s.index);
      void this.plugin.saveChat();
      await this.renderMsg(i);
    } catch (e) {
      new Notice(`되돌리지 못했어요: ${(e as Error).message}`);
    }
  }

  // ─── 보내기 ───────────────────────────────────────────────

  private submit(): void {
    const t = this.inputEl.value.trim();
    if (!t || this.run) return;
    this.inputEl.value = "";
    this.autoGrow();
    void this.send(t);
  }

  private elapsed(): string {
    return `${Math.floor((Date.now() - this.runStart) / 1000)}s`;
  }

  private setRunning(idx: number): void {
    this.runIdx = idx;
    const on = idx >= 0;
    this.contentEl.toggleClass("is-running", on);
    setIcon(this.sendBtn, on ? "square" : "arrow-up");
    this.sendBtn.setAttr("aria-label", on ? "멈추기" : "보내기");
    if (this.tick) window.clearInterval(this.tick);
    this.tick = null;
    if (on) {
      this.runStart = Date.now();
      this.tick = window.setInterval(() => {
        const s = this.msgsEl.querySelector(`[data-idx="${idx}"] .cs-secs`);
        if (s) s.textContent = this.elapsed();
      }, 1000);
    }
  }

  private context(kind: "full" | "date"): string {
    const today = moment().format("YYYY-MM-DD (ddd)");
    if (kind === "date" || !this.includeNote) return contextHeader({ today });
    const f = this.plugin.lastFile();
    const sel = this.plugin.lastSelection();
    return contextHeader({ today, notePath: f?.path, selection: sel ? sel.slice(0, 6000) : null });
  }

  private toolUse(name: string, input: Record<string, unknown>): ToolUse {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    if (name === "Read") {
      const abs = str(input.file_path);
      const base = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : "";
      const rel = base && abs.startsWith(base + "/") ? abs.slice(base.length + 1) : abs;
      return { name, detail: baseName(rel), path: getFile(this.app, rel) ? rel : undefined };
    }
    if (name === "Grep" || name === "Glob") return { name, detail: str(input.pattern) };
    return { name, detail: name };
  }

  async send(text: string, o: SendOptions = {}): Promise<void> {
    if (this.run) {
      new Notice("답하는 중이에요");
      return;
    }
    const claudePath = this.plugin.claudePath();
    if (!claudePath) {
      new Notice("Claude Code를 찾지 못했어요. 설정에서 경로를 넣어 주세요.");
      return;
    }
    const body = o.prompt ?? text;
    if (!body.trim()) return;

    const prompt = `${this.context(o.context ?? "full")}\n\n${body}`;
    if (!this.msgs.length) this.msgsEl.empty();
    this.msgs.push({ role: "user", text, label: o.label, icon: o.icon });
    this.msgs.push({ role: "assistant", text: "", tools: [] });
    const idx = this.msgs.length - 1;
    await this.renderMsg(idx - 1);
    this.setRunning(idx);
    await this.renderMsg(idx);
    this.scrollBottom();

    await this.execute(idx, prompt, claudePath, false);

    const a = this.msgs[idx];
    if (o.autoApply && !a.error) {
      for (const b of noteBlocks(a.text)) if (b.complete) await this.applyBlock(idx, b);
    }
  }

  private async execute(idx: number, prompt: string, claudePath: string, retried: boolean): Promise<void> {
    const a = this.msgs[idx];
    // 도중에 "새 대화"를 눌러도 새 대화에 옛 세션이 섞이지 않도록 지금 대화를 붙잡아 둠
    const chat = this.plugin.chat;
    const resume = chat.sessionId;
    let ok = false;
    let failText = "";

    this.run = runClaude({
      claudePath,
      cwd: this.plugin.vaultPath(),
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      model: this.plugin.settings.model || undefined,
      effort: this.plugin.settings.effort || undefined,
      resume,
      onEvent: (e) => {
        if (e.type === "session") {
          chat.sessionId = e.id;
        } else if (e.type === "text") {
          a.text += e.delta;
          this.scheduleRender(idx);
        } else if (e.type === "tool") {
          (a.tools ??= []).push(this.toolUse(e.name, e.input));
          this.scheduleRender(idx);
        } else if (e.type === "result") {
          ok = e.ok;
          if (e.sessionId) chat.sessionId = e.sessionId;
          if (!e.ok) failText = e.text;
          else if (!a.text.trim() && e.text) a.text = e.text;
        }
      },
    });
    await this.run.done;
    this.run = null;
    if (chat !== this.plugin.chat) {
      this.setRunning(-1);
      return;
    }

    // 이전 대화가 사라졌으면 새 대화로 한 번 다시 시도
    if (!ok && !retried && resume && !a.text && /no conversation found/i.test(failText)) {
      chat.sessionId = null;
      a.tools = [];
      return this.execute(idx, prompt, claudePath, true);
    }

    a.ms = Date.now() - this.runStart;
    if (!ok) a.error = friendlyError(failText);
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.setRunning(-1);
    await this.renderMsg(idx);
    void this.plugin.saveChat();
  }

  // ─── 빠른 버튼 ────────────────────────────────────────────

  async runDaily(): Promise<void> {
    if (this.run) return;
    const today = await openToday(this.app);
    const recent = recentDailies(this.app, 3);
    if (!recent.length) {
      new Notice("이전 데일리 노트가 없어요");
      return;
    }
    const notes = await Promise.all(
      recent.map(async (f) => ({ path: f.path, content: (await this.app.vault.cachedRead(f)).slice(0, 6000) })),
    );
    await this.send("", { label: "오늘", icon: "calendar-check", prompt: dailyPrompt(today.path, notes), context: "date" });
  }

  async runPolish(): Promise<void> {
    if (this.run) return;
    const f = this.plugin.lastFile();
    if (!f || f.extension !== "md") {
      new Notice("다듬을 노트를 먼저 열어 주세요");
      return;
    }
    const content = await this.app.vault.read(f);
    if (!content.trim()) {
      new Notice("빈 노트예요");
      return;
    }
    if (content.length > 40000) {
      new Notice("노트가 너무 길어요 (4만 자까지)");
      return;
    }
    await this.send("", { label: f.basename, icon: "sparkles", prompt: polishPrompt(f.path, content), context: "date" });
  }

  async runSave(): Promise<void> {
    if (this.run) return;
    if (!this.plugin.chat.sessionId || !this.msgs.some((m) => m.role === "assistant" && m.text.trim())) {
      new Notice("저장할 대화가 없어요");
      return;
    }
    const prompt = savePrompt(this.plugin.settings.saveFolder, moment().format("YYYY-MM-DD"));
    await this.send("", { label: "저장", icon: "save", prompt, context: "date", autoApply: true });
  }

  newChat(): void {
    this.run?.stop();
    this.plugin.chat = { sessionId: null, messages: [] };
    this.before.clear();
    this.undos.clear();
    this.renderSeq.clear();
    void this.plugin.saveChat();
    this.renderAll();
    this.focusInput();
  }
}

function friendlyError(raw: string): string {
  const t = raw.trim();
  if (/not logged in|\/login|invalid api key|authentication/i.test(t))
    return "Claude Code 로그인이 필요해요. 터미널에서 claude 를 한 번 실행해 로그인해 주세요.";
  if (/usage limit|rate limit|limit reached|overloaded/i.test(t)) return "사용량 한도에 걸렸어요. 잠시 뒤 다시 해 주세요.";
  if (t === "멈췄어요") return t;
  return t.slice(0, 300) || "알 수 없는 오류";
}
