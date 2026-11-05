// 아침 브리핑: 수집 → 프로젝트 노트 → 현황표 → 오늘 할 일 → 데일리 노트.
// 옵시디언 밖(launchd)에서도, 옵시디언 안(사이드바 버튼)에서도 같은 함수를 씁니다.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { RunHandle, runClaude } from "../claude";
import { findBin } from "../exec";
import { noteBlocks } from "../segments";
import { Project, Snapshot, collect } from "./collect";
import { AssistantConfig, SNAPSHOT_PATH, SUPPORT_DIR, loadState, saveState } from "./config";
import { FiledNote, listInbox, processInbox } from "./inbox";
import { daysAgo, formatDate, relDay, ymd } from "./datefmt";
import { BriefProject, briefingPrompt, draftPrompt } from "./prompts";
import { DashRow, Progress, checklistProgress, progressBar, readFm, renderDashboard, setFm, upsertBriefing } from "./projects";

export interface MorningHooks {
  step?(icon: string, label: string): void;
  log?(msg: string): void;
  /** 멈추기 버튼용: 지금 돌고 있는 Claude */
  onClaude?(h: RunHandle | null): void;
  /** true를 돌려주면 다음 단계로 넘어가지 않고 멈춤 */
  isAborted?(): boolean;
  /** 받은자료 정리는 따로 할 때 (옵시디언 안에서) */
  skipInbox?: boolean;
}

function checkAbort(hooks: MorningHooks): void {
  if (hooks.isAborted?.()) throw new Error("멈췄어요");
}

export interface MorningResult {
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

interface DailyOpts {
  folder: string;
  format: string;
  template: string;
}

function dailyOpts(vault: string): DailyOpts {
  try {
    const o = JSON.parse(readFileSync(join(vault, ".obsidian/daily-notes.json"), "utf8"));
    return { folder: (o.folder ?? "").replace(/^\/+|\/+$/g, ""), format: o.format || "YYYY-MM-DD", template: o.template ?? "" };
  } catch {
    return { folder: "", format: "YYYY-MM-DD", template: "" };
  }
}

function dailyPath(o: DailyOpts, d: Date): string {
  const name = `${formatDate(d, o.format)}.md`;
  return o.folder ? `${o.folder}/${name}` : name;
}

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

async function askClaude(cfg: AssistantConfig, prompt: string, hooks: MorningHooks, addDirs: string[] = []): Promise<string> {
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
    effort: "medium",
    addDirs,
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

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

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

export async function runMorning(cfg: AssistantConfig, hooks: MorningHooks = {}, now = new Date()): Promise<MorningResult> {
  const log = hooks.log ?? (() => undefined);
  const today = ymd(now);
  const vault = cfg.vault;
  if (!existsSync(join(vault, ".obsidian"))) throw new Error(`볼트를 찾지 못했어요: ${vault}`);

  // 0. 밤사이 받은자료 (폰에서 넣은 것 등) 먼저 정리
  let filed: FiledNote[] = [];
  if (!hooks.skipInbox && listInbox(cfg).length) filed = await processInbox(cfg, hooks);

  // 1. 수집
  hooks.step?.("github", "GitHub·폴더");
  const snap = await collect(cfg, now);
  mkdirSync(SUPPORT_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
  log(`프로젝트 ${snap.projects.length}개: ${snap.projects.map((p) => p.id).join(", ")}`);
  snap.errors.forEach((e) => log(`경고: ${e}`));

  // 2. 프로젝트 노트 (없으면 Claude가 체크리스트 초안 작성)
  const folder = cfg.projectFolder.replace(/^\/+|\/+$/g, "") || "프로젝트";
  let notes = listProjectNotes(vault, folder);
  const noteFor = (p: Project) =>
    notes.find((n) => p.repo && n.fm["저장소"]?.toLowerCase() === p.repo.toLowerCase()) ??
    notes.find((n) => n.rel === `${folder}/${safeName(p.id)}.md`);

  const missing = snap.projects.filter((p) => !noteFor(p));
  const created: string[] = [];
  await pool(missing, 3, async (p) => {
    if (hooks.isAborted?.()) return;
    const rel = `${folder}/${safeName(p.id)}.md`;
    hooks.step?.("file-plus", p.id);
    try {
      const out = await askClaude(cfg, draftPrompt(p, rel), hooks, p.localPath ? [p.localPath] : []);
      const block = noteBlocks(out).find((b) => b.complete);
      const body = block?.content ?? `# ${p.id}\n${p.description ?? ""}\n\n## 할 일\n- [ ] 다음 할 일 적기\n\n## 메모\n`;
      writeText(join(vault, rel), body.trimEnd() + "\n");
      created.push(rel);
    } catch (e) {
      if (hooks.isAborted?.()) return;
      log(`체크리스트 초안 실패 (${p.id}): ${(e as Error).message}`);
      writeText(join(vault, rel), `# ${p.id}\n${p.description ?? ""}\n\n## 할 일\n- [ ] 다음 할 일 적기\n\n## 메모\n`);
      created.push(rel);
    }
  });
  checkAbort(hooks);
  if (created.length) notes = listProjectNotes(vault, folder);

  // 3. 노트 프로퍼티 갱신 + 현황표
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
    rows.push({ id: n.rel.split("/").pop()!.replace(/\.md$/, ""), done: progress.done, total: progress.total, last: p.lastActivity, week: p.weekCommits, status, dirty: p.dirty, unpushed: p.unpushed, team: p.team });
    if (status !== "완료") brief.push({ p: { ...p, id: rows[rows.length - 1].id }, progress });
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
  writeText(join(vault, folder, `${DASHBOARD}.md`), renderDashboard(rows, today, formatDate(now, "YYYY-MM-DD HH:mm")));

  // 4. 오늘 할 일 (Claude)
  checkAbort(hooks);
  hooks.step?.("sparkles", "오늘 할 일");
  const dOpts = dailyOpts(vault);
  const todayRel = dailyPath(dOpts, now);
  const dailies: { path: string; content: string }[] = [];
  for (let i = 1; i <= 14 && dailies.length < 3; i++) {
    const rel = dailyPath(dOpts, daysAgo(i, now));
    const text = readText(join(vault, rel));
    if (text.trim()) dailies.push({ path: rel, content: text.slice(0, 3000) });
  }
  const out = await askClaude(
    cfg,
    briefingPrompt({ today: formatDate(now, "YYYY-MM-DD (ddd)"), todayPath: todayRel, days: cfg.days, projects: brief, dailies }),
    hooks,
  );
  const notify = (out.match(/<notify>([\s\S]*?)<\/notify>/)?.[1] ?? "").trim().split("\n")[0];
  const main = noteBlocks(out).find((b) => b.complete)?.content.trim();
  if (!main) throw new Error(`브리핑 형식이 이상해요: ${out.slice(0, 200)}`);

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
  const block = `${main}\n\n${summary}${filedLine}`;

  // 5. 데일리 노트에 쓰기
  const todayAbs = join(vault, todayRel);
  let md = readText(todayAbs);
  if (!existsSync(todayAbs) && dOpts.template) {
    md = readText(join(vault, dOpts.template.endsWith(".md") ? dOpts.template : `${dOpts.template}.md`))
      .replace(/{{\s*date\s*}}/g, today)
      .replace(/{{\s*title\s*}}/g, formatDate(now, dOpts.format))
      .replace(/{{\s*time\s*}}/g, formatDate(now, "HH:mm"));
  }
  writeText(todayAbs, upsertBriefing(md, block));
  saveState({ ...loadState(), lastBriefing: today, lastError: undefined });
  log(`브리핑 완료 → ${todayRel}`);

  return { todayPath: todayRel, block, notify, created, filed, snapshot: snap };
}
