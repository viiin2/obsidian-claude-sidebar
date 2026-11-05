// 비서가 하루 동안 하는 일:
//   아침 브리핑 (수집 → 프로젝트 노트 → 현황표 → 오늘 할 일)
//   점심 점검 (오전에 한 것 → 오후 할 일)
//   저녁 회고 (오늘 한 것 → 내일 이어갈 것)
//   현황 새로고침 (Claude 없이 진행도·현황표만)
//   일정·루틴·캘린더 맞추기 (일정.md ↔ 📌 줄, 루틴.md → 🔁 줄, 애플 캘린더 → 📆 줄)
// 옵시디언 밖(예약 실행)에서도, 옵시디언 안(사이드바 버튼)에서도 같은 함수를 씁니다.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { RunHandle, runClaude } from "../claude";
import { findBin } from "../exec";
import { noteBlocks } from "../segments";
import {
  AgendaItem,
  addAgenda,
  dropPinDuplicates,
  insertPinRows,
  itemKey,
  keepCheckedPins,
  parseAgenda,
  pinLine,
  pinsFor,
  removeAgenda,
  removePin,
  removePinKey,
  shiftDate,
  syncPins,
} from "./agenda";
import { CalEvent, calPinRow, eventLine, eventSpan, eventsLeft, eventsOn } from "./calendar";
import { calAdd, calList, calRemove, calendarSupported, readCalCache } from "./maccal";
import { Project, Snapshot, collect } from "./collect";
import { AssistantConfig, SNAPSHOT_PATH, SUPPORT_DIR, patchState } from "./config";
import { dailyOpts, dailyRel, dailyResolver, newDailyText } from "./daily";
import { daysAgo, formatDate, relDay, ymd } from "./datefmt";
import { FiledNote, listInbox, processInbox } from "./inbox";
import { BriefProject, DayCommits, briefingPrompt, draftPrompt, eveningPrompt, middayPrompt } from "./prompts";
import {
  BriefSlot,
  DashRow,
  Progress,
  carryChecks,
  checklistProgress,
  escapeNumberTags,
  getBriefing,
  progressBar,
  readFm,
  renderDashboard,
  setFm,
  upsertBriefing,
} from "./projects";
import {
  Routine,
  RoutineStat,
  addRoutine,
  parseRoutines,
  removeRoutine,
  removeRoutinePin,
  routineChecks,
  routinePinLine,
  routineStats,
  routineSummary,
  routinesOn,
} from "./routines";

export interface BriefHooks {
  step?(icon: string, label: string): void;
  log?(msg: string): void;
  /** 멈추기 버튼용: 지금 돌고 있는 Claude */
  onClaude?(h: RunHandle | null): void;
  /** true를 돌려주면 다음 단계로 넘어가지 않고 멈춤 */
  isAborted?(): boolean;
  /** 받은자료 정리는 따로 할 때 (옵시디언 안에서) */
  skipInbox?: boolean;
}

function checkAbort(hooks: BriefHooks): void {
  if (hooks.isAborted?.()) throw new Error("멈췄어요");
}

export interface BriefResult {
  slot: BriefSlot;
  todayPath: string;
  block: string;
  notify: string;
  created: string[];
  filed: FiledNote[];
  snapshot: Snapshot;
}

const BRIEF_SYSTEM = `너는 사용자의 개인 비서야. 사용자의 옵시디언 볼트가 작업 폴더야.
한국어로, 짧고 구체적으로. 요청한 형식의 블록만 출력해.
검색할 땐 Grep에 glob "*.md"를 붙여. .obsidian 폴더와 첨부파일 폴더는 보지 마.`;

const DASHBOARD = "현황";

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "프로젝트";

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

async function askClaude(
  cfg: AssistantConfig,
  prompt: string,
  hooks: BriefHooks,
  o: { addDirs?: string[]; effort?: string } = {},
): Promise<string> {
  const claudePath = findBin("claude", cfg.claudePath);
  if (!claudePath) throw new Error("Claude Code(claude)를 찾지 못했어요");
  let text = "";
  let ok = false;
  let fail = "";
  const h = runClaude({
    claudePath,
    cwd: cfg.vault,
    prompt,
    systemPrompt: BRIEF_SYSTEM,
    model: cfg.model || undefined,
    effort: o.effort ?? "medium",
    addDirs: o.addDirs ?? [],
    onEvent: (e) => {
      if (e.type === "text") text += e.delta;
      else if (e.type === "result") {
        ok = e.ok;
        if (!e.ok) fail = e.text;
      }
    },
  });
  hooks.onClaude?.(h);
  await h.done;
  hooks.onClaude?.(null);
  if (!ok) throw new Error(fail || "Claude가 답하지 못했어요");
  return text;
}

/** Claude 답에서 알림 한 줄과 노트 블록을 꺼냄 */
function readAnswer(out: string): { notify: string; main: string } {
  const notify = (out.match(/<notify>([\s\S]*?)<\/notify>/)?.[1] ?? "").trim().split("\n")[0];
  const main = noteBlocks(out).find((b) => b.complete)?.content.trim();
  if (!main) throw new Error(`브리핑 형식이 이상해요: ${out.slice(0, 200)}`);
  return { notify, main: escapeNumberTags(main) };
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

function checkVault(cfg: AssistantConfig): void {
  if (!existsSync(join(cfg.vault, ".obsidian"))) throw new Error(`볼트를 찾지 못했어요: ${cfg.vault}`);
}

// ─── 일정 목록 ─────────────────────────────────────────────

function agendaAbs(cfg: AssistantConfig): string {
  const rel = (cfg.agendaFile || "일정.md").replace(/^\/+/, "");
  return join(cfg.vault, rel.endsWith(".md") ? rel : `${rel}.md`);
}

export function loadAgenda(cfg: AssistantConfig): AgendaItem[] {
  return parseAgenda(readText(agendaAbs(cfg)));
}

/** 일정 목록에 넣고, 오늘 일이면 데일리 노트 오늘 할 일 칸에도 넣음. 이미 있으면 false */
export function addToAgenda(cfg: AssistantConfig, it: AgendaItem, now = new Date()): boolean {
  const abs = agendaAbs(cfg);
  const md = readText(abs);
  const next = addAgenda(md, it);
  if (next === md) return false;
  writeText(abs, next);
  syncAgenda(cfg, now);
  return true;
}

export function removeFromAgenda(cfg: AssistantConfig, it: AgendaItem, now = new Date()): void {
  const abs = agendaAbs(cfg);
  const md = readText(abs);
  const next = removeAgenda(md, it);
  if (next !== md) writeText(abs, next);
  const todayAbs = join(cfg.vault, dailyRel(cfg.vault, now));
  const daily = readText(todayAbs);
  const block = getBriefing(daily, "morning");
  if (block !== null) {
    const b = removePin(block, it);
    if (b !== block) writeText(todayAbs, upsertBriefing(daily, b, "morning"));
  }
}

// ─── 애플 캘린더 ───────────────────────────────────────────

const CAL_DAYS = 14;
const CAL_FRESH_MIN = 20;

function calOn(cfg: AssistantConfig): boolean {
  return cfg.calendarOn && calendarSupported();
}

/** 캘린더에서 오늘~2주 일정을 새로 읽어 둠 (20분 안에 읽었으면 건너뜀). 실패하면 전에 읽은 것을 씀 */
export async function refreshCalendar(cfg: AssistantConfig, now = new Date(), force = false, log?: (m: string) => void): Promise<void> {
  if (!calOn(cfg)) return;
  const today = ymd(now);
  const c = readCalCache();
  const fresh = c && c.from <= today && (now.getTime() - Date.parse(c.at)) / 60000 < CAL_FRESH_MIN;
  if (fresh && !force) return;
  try {
    await calList(today, shiftDate(today, CAL_DAYS));
  } catch (e) {
    log?.(`캘린더를 읽지 못했어요: ${(e as Error).message}`);
  }
}

/** 마지막으로 읽어 둔 캘린더 일정 (연동이 꺼져 있으면 없음) */
export function calendarEvents(cfg: AssistantConfig): CalEvent[] {
  return calOn(cfg) ? readCalCache()?.events ?? [] : [];
}

export interface AddedTodo {
  /** 어디에 넣었나: 애플 캘린더 / 일정 노트 */
  where: "calendar" | "agenda";
  /** 캘린더 일정 id (빼기용) */
  id?: string;
}

/**
 * 대화에서 말한 일정 넣기: 시각이 있고 캘린더가 연결돼 있으면 애플 캘린더(알림 포함), 아니면 일정 노트.
 * 오늘 일이면 데일리 노트 오늘 할 일 칸에도 바로 붙음.
 */
export async function addTodo(cfg: AssistantConfig, it: AgendaItem, end?: string, now = new Date()): Promise<AddedTodo> {
  if (calOn(cfg) && it.time) {
    const span = eventSpan(it.date, it.time, end);
    const id = await calAdd({ title: it.text, ...span, calendarId: cfg.calendarId, alarmMin: cfg.calendarAlarm });
    await refreshCalendar(cfg, now, true);
    syncAgenda(cfg, now);
    return { where: "calendar", id };
  }
  addToAgenda(cfg, it, now);
  return { where: "agenda" };
}

export async function removeTodo(cfg: AssistantConfig, it: AgendaItem, added: AddedTodo, end?: string, now = new Date()): Promise<void> {
  if (added.where === "agenda" || !added.id) {
    removeFromAgenda(cfg, it, now);
    return;
  }
  await calRemove(added.id);
  // 오늘 할 일 칸에 붙은 📆 줄도 (체크 안 했으면) 뺌
  if (it.time) {
    const span = eventSpan(it.date, it.time, end);
    const key = calPinRow({ id: "", title: it.text, start: span.start, end: span.end, allDay: false, calendar: "" }, it.date).key;
    const todayAbs = join(cfg.vault, dailyRel(cfg.vault, now));
    const daily = readText(todayAbs);
    const block = getBriefing(daily, "morning");
    if (block !== null) {
      const b = removePinKey(block, key);
      if (b !== block) writeText(todayAbs, upsertBriefing(daily, b, "morning"));
    }
  }
  await refreshCalendar(cfg, now, true);
}

// ─── 루틴 ──────────────────────────────────────────────────

function routineAbs(cfg: AssistantConfig): string {
  const rel = (cfg.routineFile || "루틴.md").replace(/^\/+/, "");
  return join(cfg.vault, rel.endsWith(".md") ? rel : `${rel}.md`);
}

export function loadRoutines(cfg: AssistantConfig): Routine[] {
  return parseRoutines(readText(routineAbs(cfg)));
}

/** 루틴 노트에 넣고, 오늘 할 날이면 데일리 노트 오늘 할 일 칸에도 넣음. 이미 있으면 false */
export function addToRoutines(cfg: AssistantConfig, r: Routine, now = new Date()): boolean {
  const abs = routineAbs(cfg);
  const md = readText(abs);
  const next = addRoutine(md, r);
  if (next === md) return false;
  writeText(abs, next);
  syncAgenda(cfg, now);
  return true;
}

export function removeFromRoutines(cfg: AssistantConfig, r: Routine, now = new Date()): void {
  const abs = routineAbs(cfg);
  const md = readText(abs);
  const next = removeRoutine(md, r);
  if (next !== md) writeText(abs, next);
  const todayAbs = join(cfg.vault, dailyRel(cfg.vault, now));
  const daily = readText(todayAbs);
  const block = getBriefing(daily, "morning");
  if (block !== null) {
    const b = removeRoutinePin(block, r);
    if (b !== block) writeText(todayAbs, upsertBriefing(daily, b, "morning"));
  }
}

/** 루틴마다 연속 기록과 이번 주 달성 (지난 데일리 노트의 🔁 체크를 읽음) */
export function routineStatus(cfg: AssistantConfig, now = new Date(), routines = loadRoutines(cfg)): RoutineStat[] {
  if (!routines.length) return [];
  const resolve = dailyResolver(cfg.vault);
  const checks = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    const block = getBriefing(readText(join(cfg.vault, resolve(new Date(y, m - 1, day)))), "morning");
    return block === null ? null : routineChecks(block);
  };
  return routineStats(routines, ymd(now), checks);
}

/** 오늘 할 일 칸 맨 위에 넣을 줄: 🔁 루틴 → 📆 캘린더 → 📌 일정 */
function pinRows(routines: RoutineStat[], events: CalEvent[], pins: AgendaItem[], today: string): { key: string; line: string }[] {
  return [
    ...routines.filter((s) => s.today !== null).map((s) => ({ key: `🔁 ${itemKey(s.r)}`, line: routinePinLine(s.r, s.before) })),
    ...eventsOn(events, today).map((e) => calPinRow(e, today)),
    ...pins.map((p) => ({ key: `📌 ${itemKey(p)}`, line: pinLine(p, today) })),
  ];
}

/**
 * 오늘 데일리 노트의 오늘 할 일 칸을 일정·루틴과 맞춤:
 * 빠진 📌 일정·🔁 루틴 넣기 + 📌 체크 상태를 일정 목록과 양쪽으로. 바꿨으면 true
 */
export function syncAgenda(cfg: AssistantConfig, now = new Date()): boolean {
  const abs = agendaAbs(cfg);
  const agenda = readText(abs);
  const routines = loadRoutines(cfg);
  const events = calendarEvents(cfg);
  if (!agenda.trim() && !routines.length && !events.length) return false;
  const today = ymd(now);
  const todayAbs = join(cfg.vault, dailyRel(cfg.vault, now));
  const daily = readText(todayAbs);
  const block = getBriefing(daily, "morning");
  if (block === null) return false;
  const synced = syncPins(block, agenda, today);
  const stats = routines.length ? routineStatus(cfg, now, routinesOn(routines, today)) : [];
  const nextBlock = insertPinRows(synced.block, pinRows(stats, events, pinsFor(parseAgenda(synced.agenda), today), today));
  let changed = false;
  if (synced.agenda !== agenda) {
    writeText(abs, synced.agenda);
    changed = true;
  }
  if (nextBlock !== block) {
    writeText(todayAbs, upsertBriefing(daily, nextBlock, "morning"));
    changed = true;
  }
  return changed;
}

// ─── 프로젝트 수집·노트·현황표 ──────────────────────────────

interface NoteInfo {
  rel: string;
  abs: string;
  md: string;
  fm: Record<string, string>;
}

function listProjectNotes(vault: string, folder: string): NoteInfo[] {
  const dir = join(vault, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== `${DASHBOARD}.md`)
    .map((f) => {
      const abs = join(dir, f);
      const md = readText(abs);
      return { rel: `${folder}/${f}`, abs, md, fm: readFm(md) };
    });
}

function statusOf(p: Project | undefined, fm: Record<string, string>, today: Date): string {
  if (fm["상태"] === "완료") return "완료";
  // git 없이 직접 만든 노트(영어 공부 등)는 사용자가 적은 상태를 따름 (없으면 진행중)
  if (!p) return fm["저장소"] || fm["폴더"] ? "멈춤" : fm["상태"] || "진행중";
  return p.lastActivity >= ymd(daysAgo(7, today)) ? "진행중" : "멈춤";
}

function firstLine(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
}

interface Refreshed {
  snap: Snapshot;
  rows: DashRow[];
  brief: BriefProject[];
  created: string[];
  folder: string;
}

/** GitHub·폴더를 모으고, 프로젝트 노트 프로퍼티와 현황표를 새로 씀. draft면 노트가 없는 프로젝트에 Claude가 체크리스트 초안을 씀 */
async function refreshProjects(cfg: AssistantConfig, hooks: BriefHooks, now: Date, draft: boolean): Promise<Refreshed> {
  const log = hooks.log ?? (() => undefined);
  const vault = cfg.vault;
  const today = ymd(now);

  hooks.step?.("github", "GitHub·폴더");
  const snap = await collect(cfg, now);
  mkdirSync(SUPPORT_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
  log(`프로젝트 ${snap.projects.length}개: ${snap.projects.map((p) => p.id).join(", ")}`);
  snap.errors.forEach((e) => log(`경고: ${e}`));

  const folder = cfg.projectFolder.replace(/^\/+|\/+$/g, "") || "프로젝트";
  let notes = listProjectNotes(vault, folder);
  const noteFor = (p: Project) =>
    notes.find((n) => p.repo && n.fm["저장소"]?.toLowerCase() === p.repo.toLowerCase()) ??
    notes.find((n) => n.rel === `${folder}/${safeName(p.id)}.md`);

  const created: string[] = [];
  if (draft) {
    const missing = snap.projects.filter((p) => !noteFor(p));
    const fallback = (p: Project) => `# ${p.id}\n${p.description ?? ""}\n\n## 할 일\n- [ ] 다음 할 일 적기\n\n## 메모\n`;
    await pool(missing, 3, async (p) => {
      if (hooks.isAborted?.()) return;
      const rel = `${folder}/${safeName(p.id)}.md`;
      hooks.step?.("file-plus", p.id);
      try {
        const out = await askClaude(cfg, draftPrompt(p, rel), hooks, { addDirs: p.localPath ? [p.localPath] : [] });
        const block = noteBlocks(out).find((b) => b.complete);
        writeText(join(vault, rel), escapeNumberTags(block?.content ?? fallback(p)).trimEnd() + "\n");
      } catch (e) {
        if (hooks.isAborted?.()) return;
        log(`체크리스트 초안 실패 (${p.id}): ${(e as Error).message}`);
        writeText(join(vault, rel), fallback(p));
      }
      created.push(rel);
    });
    checkAbort(hooks);
    if (created.length) notes = listProjectNotes(vault, folder);
  }

  hooks.step?.("table", "현황표");
  const rows: DashRow[] = [];
  const brief: BriefProject[] = [];
  const seen = new Set<string>();
  for (const p of snap.projects) {
    const n = noteFor(p);
    if (!n) continue;
    seen.add(n.rel);
    const progress = checklistProgress(n.md);
    const status = statusOf(p, n.fm, now);
    const next = setFm(n.md, {
      저장소: p.repo,
      폴더: p.localPath,
      마지막작업: p.lastActivity,
      이번주커밋: p.weekCommits,
      진행도: progress.total ? `${progress.done}/${progress.total}` : undefined,
      상태: status,
    });
    if (next !== n.md) writeText(n.abs, next);
    const id = n.rel.split("/").pop()!.replace(/\.md$/, "");
    rows.push({ id, done: progress.done, total: progress.total, last: p.lastActivity, week: p.weekCommits, status, dirty: p.dirty, unpushed: p.unpushed, team: p.team });
    if (status !== "완료") brief.push({ p: { ...p, id }, progress });
  }
  for (const n of notes) {
    if (seen.has(n.rel)) continue;
    const progress: Progress = checklistProgress(n.md);
    const status = statusOf(undefined, n.fm, now);
    const next = setFm(n.md, { 진행도: progress.total ? `${progress.done}/${progress.total}` : undefined, 상태: status });
    if (next !== n.md) writeText(n.abs, next);
    const id = n.rel.split("/").pop()!.replace(/\.md$/, "");
    const last = n.fm["마지막작업"] ?? "";
    rows.push({ id, done: progress.done, total: progress.total, last, week: 0, status });
    if (status === "진행중") {
      brief.push({
        p: { id, team: false, lastActivity: last, commits: [], weekCommits: 0, myCommits: 0, issues: [], description: firstLine(n.md) },
        progress,
      });
    }
  }
  const order = { 진행중: 0, 멈춤: 1, 완료: 2 } as Record<string, number>;
  rows.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || b.last.localeCompare(a.last));
  const routines = routineStatus(cfg, now).map((x) => ({ name: itemKey(x.r), weekDone: x.weekDone, weekTotal: x.weekTotal, streak: x.streak }));
  writeText(join(vault, folder, `${DASHBOARD}.md`), renderDashboard(rows, today, formatDate(now, "YYYY-MM-DD HH:mm"), routines));
  patchState({ lastRefreshAt: now.toISOString() });
  return { snap, rows, brief, created, folder };
}

/** 오늘 커밋 (프로젝트별) */
function todayCommits(snap: Snapshot, today: string): DayCommits[] {
  return snap.projects
    .map((p) => ({ id: p.id, msgs: p.commits.filter((c) => c.date === today).map((c) => (c.mine ? c.msg : `${c.msg} (${c.author})`)) }))
    .filter((x) => x.msgs.length);
}

/** 오늘 데일리 노트를 읽음 (없으면 템플릿으로 시작) */
function openToday(cfg: AssistantConfig, now: Date): { rel: string; abs: string; md: string } {
  const o = dailyOpts(cfg.vault);
  const rel = dailyRel(cfg.vault, now, o);
  const abs = join(cfg.vault, rel);
  const md = existsSync(abs) ? readText(abs) : newDailyText(cfg.vault, now, o);
  return { rel, abs, md };
}

// ─── 아침 브리핑 ───────────────────────────────────────────

export async function runMorning(cfg: AssistantConfig, hooks: BriefHooks = {}, now = new Date()): Promise<BriefResult> {
  const log = hooks.log ?? (() => undefined);
  const today = ymd(now);
  checkVault(cfg);

  // 0. 밤사이 받은자료 (폰에서 넣은 것 등) 먼저 정리
  let filed: FiledNote[] = [];
  if (!hooks.skipInbox && listInbox(cfg).length) filed = await processInbox(cfg, hooks);

  // 1~3. 수집 → 프로젝트 노트 → 현황표
  const { snap, rows, brief, created, folder } = await refreshProjects(cfg, hooks, now, true);

  // 4. 오늘 할 일 (Claude)
  checkAbort(hooks);
  hooks.step?.("sparkles", "오늘 할 일");
  const o = dailyOpts(cfg.vault);
  const day = openToday(cfg, now);
  const dailies: { path: string; content: string }[] = [];
  for (let i = 1; i <= 14 && dailies.length < 3; i++) {
    const rel = dailyRel(cfg.vault, daysAgo(i, now), o);
    const text = readText(join(cfg.vault, rel));
    if (text.trim()) dailies.push({ path: rel, content: text.slice(0, 3000) });
  }
  const agenda = loadAgenda(cfg);
  const pinned = pinsFor(agenda, today);
  const in2w = shiftDate(today, 14);
  const upcoming = agenda.filter((x) => !x.done && x.date > today && x.date <= in2w);
  const routines = routineStatus(cfg, now, routinesOn(loadRoutines(cfg), today));
  await refreshCalendar(cfg, now, true, log);
  const events = calendarEvents(cfg);
  const todayEvents = eventsOn(events, today);
  const out = await askClaude(
    cfg,
    briefingPrompt({
      today: formatDate(now, "YYYY-MM-DD (ddd) HH:mm"),
      todayPath: day.rel,
      days: cfg.days,
      projects: brief,
      dailies,
      pinned,
      upcoming,
      routines: routines.map((x) => x.r),
      todayEvents: todayEvents.map((e) => eventLine(e, false)),
      upcomingEvents: events.filter((e) => e.start.slice(0, 10) > today).map((e) => eventLine(e, true)),
    }),
    hooks,
  );
  const { notify, main } = readAnswer(out);

  const active = rows.filter((r) => r.status !== "완료");
  const week = snap.projects.reduce((s, p) => s + p.weekCommits, 0);
  const summary = [
    `> [!info]- 프로젝트 ${active.length}개 · 이번 주 커밋 ${week} · [[${folder}/${DASHBOARD}|현황표]]`,
    ...active.map((r) => `> - ${r.status === "멈춤" ? "💤" : "🔥"} [[${r.id}]] ${r.total ? `${progressBar(r.done, r.total, 5)} ${r.done}/${r.total}` : ""} · ${relDay(r.last, today)}`),
  ].join("\n");
  const ok = filed.filter((f) => f.note);
  const filedLine = ok.length
    ? `\n\n> [!example]- 받은자료 ${ok.length}개 정리함\n${ok.map((f) => `> - ${f.category} · [[${f.note!.replace(/\.md$/, "")}|${f.note!.split("/").pop()!.replace(/\.md$/, "")}]]`).join("\n")}`
    : "";
  const deduped = dropPinDuplicates(main, [...pinned, ...routines.map((x) => x.r), ...todayEvents.map((e) => ({ text: e.title }))]);
  let block = `${insertPinRows(deduped, pinRows(routines, events, pinned, today))}\n\n${summary}${filedLine}`;
  // 다시 만들 때는 전에 체크해 둔 항목을 그대로 둠
  const old = getBriefing(day.md, "morning");
  if (old) block = carryChecks(old, keepCheckedPins(old, block));

  // 5. 데일리 노트에 쓰기
  writeText(day.abs, upsertBriefing(day.md, block, "morning"));
  syncAgenda(cfg, now);
  patchState({ lastBriefing: today, lastBriefingAt: now.toISOString(), lastError: undefined });
  log(`아침 브리핑 → ${day.rel}`);

  return { slot: "morning", todayPath: day.rel, block, notify, created, filed, snapshot: snap };
}

// ─── 점심 점검 · 저녁 회고 ─────────────────────────────────

const hhmm = (d: Date) => formatDate(d, "HH:mm");

export async function runMidday(cfg: AssistantConfig, hooks: BriefHooks = {}, now = new Date()): Promise<BriefResult> {
  const today = ymd(now);
  checkVault(cfg);
  const { snap, created } = await refreshProjects(cfg, hooks, now, false);
  checkAbort(hooks);
  hooks.step?.("sun", "오후 할 일");
  await refreshCalendar(cfg, now, true, hooks.log);
  syncAgenda(cfg, now);
  const day = openToday(cfg, now);
  const left = loadAgenda(cfg).filter((x) => x.date === today && !x.done && (!x.time || x.time >= hhmm(now)));
  for (const r of routineStatus(cfg, now, routinesOn(loadRoutines(cfg), today))) {
    if (r.today === false) left.push({ date: today, time: r.r.time, text: `🔁 ${r.r.text} (루틴)`, done: false });
  }
  for (const e of eventsLeft(calendarEvents(cfg), today, hhmm(now))) {
    left.push({ date: today, time: e.allDay ? undefined : e.start.slice(11, 16), text: `📆 ${e.title} (캘린더)`, done: false });
  }
  const out = await askClaude(
    cfg,
    middayPrompt({ now: formatDate(now, "YYYY-MM-DD (ddd) HH:mm"), todayPath: day.rel, daily: day.md.slice(0, 6000), commits: todayCommits(snap, today), left }),
    hooks,
    { effort: "low" },
  );
  const { notify, main } = readAnswer(out);
  const old = getBriefing(day.md, "midday");
  const block = old ? carryChecks(old, main) : main;
  writeText(day.abs, upsertBriefing(day.md, block, "midday"));
  patchState({ lastMidday: today, lastError: undefined });
  hooks.log?.(`점심 점검 → ${day.rel}`);
  return { slot: "midday", todayPath: day.rel, block, notify, created, filed: [], snapshot: snap };
}

export async function runEvening(cfg: AssistantConfig, hooks: BriefHooks = {}, now = new Date()): Promise<BriefResult> {
  const today = ymd(now);
  checkVault(cfg);
  const { snap, created } = await refreshProjects(cfg, hooks, now, false);
  checkAbort(hooks);
  hooks.step?.("moon", "오늘 회고");
  await refreshCalendar(cfg, now, true, hooks.log);
  syncAgenda(cfg, now);
  const day = openToday(cfg, now);
  const tmr = shiftDate(today, 1);
  const tomorrow = loadAgenda(cfg).filter((x) => x.date === tmr && !x.done);
  for (const e of eventsOn(calendarEvents(cfg), tmr)) {
    tomorrow.push({ date: tmr, time: e.allDay || e.start.slice(0, 10) !== tmr ? undefined : e.start.slice(11, 16), text: `📆 ${e.title}`, done: false });
  }
  const out = await askClaude(
    cfg,
    eveningPrompt({ today: formatDate(now, "YYYY-MM-DD (ddd)"), todayPath: day.rel, daily: day.md.slice(0, 8000), commits: todayCommits(snap, today), tomorrow }),
    hooks,
  );
  const { notify, main: answer } = readAnswer(out);
  // 루틴 달성은 프로그램이 셈: "오늘 한 것" 칸 맨 위에 한 줄
  const rline = routineSummary(routineStatus(cfg, now, routinesOn(loadRoutines(cfg), today)));
  const main = rline ? insertAfterCallout(answer, /^>\s*\[!success\]/i, rline) : answer;
  writeText(day.abs, upsertBriefing(day.md, main, "evening"));
  patchState({ lastEvening: today, lastError: undefined });
  hooks.log?.(`저녁 회고 → ${day.rel}`);
  return { slot: "evening", todayPath: day.rel, block: main, notify, created, filed: [], snapshot: snap };
}

function insertAfterCallout(block: string, head: RegExp, line: string): string {
  const lines = block.split("\n");
  const i = lines.findIndex((l) => head.test(l));
  if (i < 0) return `${block}\n\n> [!success] 루틴\n${line}`;
  lines.splice(i + 1, 0, line);
  return lines.join("\n");
}

export function runSlot(cfg: AssistantConfig, slot: BriefSlot, hooks: BriefHooks = {}, now = new Date()): Promise<BriefResult> {
  if (slot === "midday") return runMidday(cfg, hooks, now);
  if (slot === "evening") return runEvening(cfg, hooks, now);
  return runMorning(cfg, hooks, now);
}

/** Claude 없이: 진행도·현황표 새로고침 + 일정 맞추기 */
export async function runRefresh(cfg: AssistantConfig, hooks: BriefHooks = {}, now = new Date()): Promise<void> {
  checkVault(cfg);
  await refreshCalendar(cfg, now, false, hooks.log);
  await refreshProjects(cfg, hooks, now, false);
  syncAgenda(cfg, now);
}
