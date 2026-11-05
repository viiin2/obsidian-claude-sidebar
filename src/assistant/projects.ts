// 프로젝트 노트(할 일 체크리스트)와 현황표, 데일리 노트 브리핑 블록을 다룹니다.
// 모두 문자열 → 문자열 함수라 테스트하기 쉽습니다.

import { relDay } from "./datefmt";

export interface Progress {
  done: number;
  total: number;
  open: string[];
}

const TODO_HEADING = /^#{2,3}\s*(할\s*일|todo|to-do|체크리스트)\s*$/i;
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

/** "## 할 일" 아래 체크박스를 셉니다. 그 제목이 없으면 노트 전체의 체크박스를 셉니다. */
export function checklistProgress(md: string): Progress {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => TODO_HEADING.test(l.trim()));
  let scope = lines;
  if (start >= 0) {
    const level = lines[start].trim().match(/^#+/)![0].length;
    const end = lines.findIndex((l, i) => i > start && /^#+\s/.test(l.trim()) && l.trim().match(/^#+/)![0].length <= level);
    scope = lines.slice(start + 1, end < 0 ? undefined : end);
  }
  let done = 0;
  let total = 0;
  const open: string[] = [];
  for (const l of scope) {
    const m = l.match(CHECKBOX);
    if (!m) continue;
    total++;
    if (m[1] !== " ") done++;
    else open.push(m[2].trim());
  }
  return { done, total, open };
}

export function splitFm(md: string): { fm: string[] | null; body: string } {
  if (!md.startsWith("---\n")) return { fm: null, body: md };
  const end = md.indexOf("\n---", 3);
  if (end < 0) return { fm: null, body: md };
  const after = md.indexOf("\n", end + 4);
  return { fm: md.slice(4, end).split("\n"), body: after < 0 ? "" : md.slice(after + 1) };
}

export function readFm(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of splitFm(md).fm ?? []) {
    const m = l.match(/^([^:#\s][^:]*):\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function yamlValue(v: string | number): string {
  const s = String(v);
  return /^[\w가-힣./ -]*$/.test(s) && !/^\s|\s$/.test(s) && s !== "" ? s : JSON.stringify(s);
}

/** 프로퍼티 몇 개만 바꾸거나 더하고, 나머지 줄은 그대로 둡니다. */
export function setFm(md: string, fields: Record<string, string | number | undefined>): string {
  const { fm, body } = splitFm(md);
  const lines = fm ? [...fm] : [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === "") continue;
    const line = `${k}: ${yamlValue(v)}`;
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  return `---\n${lines.join("\n")}\n---\n${fm ? body : md.replace(/^\n+/, "")}`;
}

export function progressBar(done: number, total: number, width = 8): string {
  if (!total) return "";
  const n = Math.round((done / total) * width);
  return "▰".repeat(n) + "▱".repeat(width - n);
}

export interface DashRow {
  id: string;
  done: number;
  total: number;
  last: string;
  week: number;
  status: string;
  dirty?: number;
  unpushed?: number;
  team?: boolean;
}

export function renderDashboard(rows: DashRow[], today: string, updated: string): string {
  const head = [
    "---",
    `updated: ${updated}`,
    "---",
    "",
    "| | 프로젝트 | 진행 | 마지막 | 이번 주 |",
    "|---|---|---|---|---|",
  ];
  const icon = (s: string) => (s === "완료" ? "✅" : s === "멈춤" ? "💤" : "🔥");
  const body = rows.map((r) => {
    const prog = r.total ? `${progressBar(r.done, r.total)} ${r.done}/${r.total}` : "-";
    const flags = [r.unpushed ? `⬆${r.unpushed}` : "", r.dirty ? `✎${r.dirty}` : "", r.team ? "👥" : ""].filter(Boolean).join(" ");
    return `| ${icon(r.status)} | [[${r.id}]] ${flags} | ${prog} | ${relDay(r.last, today)} | ${r.week || ""} |`;
  });
  const legend = "\n🔥 진행 중 · 💤 일주일 넘게 멈춤 · ✅ 완료 · ⬆ 안 올린 커밋 · ✎ 저장 안 한 파일 · 👥 팀\n";
  return [...head, ...body].join("\n") + "\n" + legend;
}

export const BRIEF_START = "%% 비서 시작 %%";
export const BRIEF_END = "%% 비서 끝 %%";

/** 데일리 노트에 브리핑을 넣습니다. 이미 있으면 그 자리를 바꾸고, 없으면 맨 위(프로퍼티 다음)에 넣습니다. */
export function upsertBriefing(md: string, block: string): string {
  const wrapped = `${BRIEF_START}\n${block.trim()}\n${BRIEF_END}`;
  const s = md.indexOf(BRIEF_START);
  const e = md.indexOf(BRIEF_END);
  if (s >= 0 && e > s) return md.slice(0, s) + wrapped + md.slice(e + BRIEF_END.length);
  const { fm, body } = splitFm(md);
  const fmText = fm ? `---\n${fm.join("\n")}\n---\n` : "";
  const rest = body.replace(/^\n+/, "");
  return fmText + wrapped + "\n" + (rest ? "\n" + rest : "");
}
