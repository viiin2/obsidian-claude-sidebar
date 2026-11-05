// 일정 목록(볼트의 일정.md)과 데일리 노트 "오늘 할 일" 칸의 📌 줄을 다룹니다.
// 모두 문자열 → 문자열 함수라 테스트하기 쉽습니다.
//
// 일정 한 줄 (Tasks 플러그인과 같은 📅 형식):
//   - [ ] 14:00 치과 📅 2026-11-07
//   - [ ] 발표 자료 만들기 📅 2026-11-10
// 데일리 노트 브리핑 칸에 들어가는 줄:
//   > - [ ] 📌 14:00 치과
//   > - [ ] 📌 발표 자료 만들기 (11/3부터)      ← 밀린 일

export interface AgendaItem {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (없으면 하루 종일) */
  time?: string;
  text: string;
  done: boolean;
}

const LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*?)\s*📅\s*(\d{4}-\d{2}-\d{2})(.*)$/;
const TIME = /^(\d{1,2}):(\d{2})\s+/;
/** Tasks 플러그인이 붙이는 다른 표시(완료일, 우선순위 등)는 글에서 뺌 */
const TASKS_FIELDS = /\s*(?:[⏳🛫➕✅❌]\s*\d{4}-\d{2}-\d{2}|[⏫🔼🔽⏬🔺])/gu;

const pad2 = (n: number) => String(n).padStart(2, "0");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function normTime(t: string | undefined): string | undefined {
  const m = (t ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return `${pad2(Number(m[1]))}:${m[2]}`;
}

export function parseAgendaLine(line: string): AgendaItem | null {
  const m = line.match(LINE);
  if (!m) return null;
  let text = squash(m[2].replace(TASKS_FIELDS, ""));
  let time: string | undefined;
  const t = text.match(TIME);
  if (t) {
    time = normTime(`${t[1]}:${t[2]}`);
    if (time) text = text.slice(t[0].length).trim();
  }
  if (!text) return null;
  return { date: m[3], time, text, done: m[1] !== " " };
}

export function agendaLine(it: AgendaItem): string {
  return `- [${it.done ? "x" : " "}] ${it.time ? it.time + " " : ""}${squash(it.text)} 📅 ${it.date}`;
}

export function parseAgenda(md: string): AgendaItem[] {
  return md.split("\n").map(parseAgendaLine).filter((x): x is AgendaItem => !!x);
}

/** 같은 일인지 가리는 열쇠: "14:00 치과" */
export function itemKey(it: { time?: string; text: string }): string {
  return squash(`${it.time ?? ""} ${it.text}`);
}

const sortKey = (it: AgendaItem) => `${it.date} ${it.time ?? "99:99"}`;
const same = (a: AgendaItem, b: AgendaItem) => a.date === b.date && itemKey(a) === itemKey(b);

export const AGENDA_HEADER = "# 일정\n\n";

/** 날짜·시각 순서에 맞는 자리에 넣습니다. 이미 같은 일이 있으면 그대로 둡니다. */
export function addAgenda(md: string, it: AgendaItem): string {
  const lines = md ? md.replace(/\n+$/, "").split("\n") : [];
  const items = lines.map(parseAgendaLine);
  if (items.some((x) => x && same(x, it))) return md;
  const line = agendaLine(it);
  if (!items.some(Boolean)) {
    const base = md.trim() ? md.replace(/\n+$/, "") + "\n\n" : AGENDA_HEADER;
    return base + line + "\n";
  }
  let at = items.findIndex((x) => x !== null && sortKey(x) > sortKey(it));
  if (at < 0) at = items.map((x) => x !== null).lastIndexOf(true) + 1;
  lines.splice(at, 0, line);
  return lines.join("\n") + "\n";
}

export function removeAgenda(md: string, it: AgendaItem): string {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => {
    const x = parseAgendaLine(l);
    return x !== null && same(x, it);
  });
  if (i < 0) return md;
  lines.splice(i, 1);
  return lines.join("\n");
}

function setAgendaDone(md: string, date: string, key: string): string {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => {
    const x = parseAgendaLine(l);
    return x !== null && !x.done && x.date === date && itemKey(x) === key;
  });
  if (i < 0) return md;
  lines[i] = lines[i].replace(/\[ \]/, "[x]");
  return lines.join("\n");
}

// ── 데일리 노트의 📌 줄 ──

const PIN = /^>\s*[-*+]\s+\[([ xX])\]\s+📌\s+(.*)$/;

/** 📌·🔁 줄의 글에서 Tasks 플러그인 표시(✅ 날짜 등)와 뒤에 붙인 (11/3부터), · 🔥4 를 뺌 */
export function pinText(raw: string): string {
  return squash(raw.replace(TASKS_FIELDS, "")).replace(/\s+\(\d{1,2}\/\d{1,2}부터\)$|\s+·\s+🔥\d+$/, "");
}

export function pinLine(it: AgendaItem, today: string): string {
  const late = it.date < today ? ` (${Number(it.date.slice(5, 7))}/${Number(it.date.slice(8, 10))}부터)` : "";
  return `> - [${it.done ? "x" : " "}] 📌 ${itemKey(it)}${late}`;
}

function readPin(line: string): { done: boolean; key: string } | null {
  const m = line.match(PIN);
  return m ? { done: m[1] !== " ", key: pinText(m[2]) } : null;
}

/** 오늘 데일리 노트에 넣을 일: 오늘 일정 + 최근 7일 안에 밀린 일 */
export function pinsFor(items: AgendaItem[], today: string): AgendaItem[] {
  const weekAgo = shiftDate(today, -7);
  return items
    .filter((x) => x.date === today || (!x.done && x.date < today && x.date >= weekAgo))
    .sort((a, b) => (a.date < today ? 0 : 1) - (b.date < today ? 0 : 1) || sortKey(a).localeCompare(sortKey(b)));
}

/** 브리핑 블록의 "오늘 할 일" 칸에 빠진 📌 줄을 넣습니다 (칸이 없으면 맨 위에 새로). */
export function insertPins(block: string, pins: AgendaItem[], today: string): string {
  return insertPinRows(block, pins.map((p) => ({ key: `📌 ${itemKey(p)}`, line: pinLine(p, today) })));
}

/** 📌·🔁·📆 줄 공통: "📌 14:00 치과" / "🔁 07:00 영어 단어" / "📆 10:00–11:00 회의" (뒤에 붙는 (11/3부터), · 🔥4 는 뺌) */
const ANY_PIN = /^>\s*[-*+]\s+\[[ xX]\]\s+(📌|🔁|📆)\s+(.*)$/;
function pinKey(line: string): string | null {
  const m = line.match(ANY_PIN);
  return m ? `${m[1]} ${pinText(m[2])}` : null;
}

/** 오늘 할 일 칸 맨 위(이미 있는 📌·🔁 줄 다음)에 빠진 줄을 넣습니다. 칸이 없으면 새로 만듭니다. */
export function insertPinRows(block: string, rows: { key: string; line: string }[]): string {
  const lines = block.split("\n");
  const have = new Set(lines.map(pinKey).filter(Boolean));
  const add = rows.filter((r) => !have.has(r.key)).map((r) => r.line);
  if (!add.length) return block;
  const head = lines.findIndex((l) => /^>\s*\[!todo\]/i.test(l));
  if (head < 0) return [`> [!todo] 오늘 할 일`, ...add, ...(block.trim() ? ["", block] : [])].join("\n");
  let at = head + 1;
  while (at < lines.length && pinKey(lines[at])) at++;
  lines.splice(at, 0, ...add);
  return lines.join("\n");
}

/** 브리핑을 다시 만들 때, 전에 체크해 둔 📌·🔁 줄이 새 목록에서 빠졌으면 (끝낸 밀린 일 등) 그대로 남깁니다. */
export function keepCheckedPins(oldBlock: string, next: string): string {
  const rows = oldBlock
    .split("\n")
    .filter((l) => /^>\s*[-*+]\s+\[[xX]\]/.test(l))
    .map((l) => ({ key: pinKey(l), line: l }))
    .filter((r): r is { key: string; line: string } => r.key !== null);
  return rows.length ? insertPinRows(next, rows) : next;
}

/** Claude가 📌 일정과 같은 일을 할 일로 한 번 더 쓴 줄은 뺍니다. */
export function dropPinDuplicates(block: string, pins: { text: string }[]): string {
  if (!pins.length) return block;
  const names = pins.map((p) => squash(p.text));
  return block
    .split("\n")
    .filter((l) => {
      const m = l.match(/^>\s*[-*+]\s+\[[ xX]\]\s+(?!📌|🔁|📆)(.*)$/);
      if (!m) return true;
      const head = squash(
        m[1]
          .split(" — ")[0]
          .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
          .replace(/^\d{1,2}:\d{2}\s+/, ""),
      );
      return !names.some((n) => head === n || (n.length >= 4 && head.startsWith(n)));
    })
    .join("\n");
}

/** 아직 체크 안 한 📌·🔁·📆 줄 하나를 열쇠("📆 15:00–16:00 치과")로 뺍니다. */
export function removePinKey(block: string, key: string): string {
  return block
    .split("\n")
    .filter((l) => !(pinKey(l) === key && /^>\s*[-*+]\s+\[ \]/.test(l)))
    .join("\n");
}

/** 브리핑 블록 안에서 📌 줄을 빼냅니다 (되돌리기). */
export function removePin(block: string, it: AgendaItem): string {
  const key = itemKey(it);
  return block
    .split("\n")
    .filter((l) => readPin(l)?.key !== key)
    .join("\n");
}

/**
 * 체크 상태를 양쪽으로 맞춥니다: 데일리 노트에서 체크했으면 일정 목록도, 일정 목록에서 체크했으면 데일리 노트도.
 * (한쪽에서 체크를 풀어도 다른 쪽이 체크돼 있으면 다시 체크됨: "끝냄"이 이김)
 */
export function syncPins(block: string, agenda: string, today: string): { block: string; agenda: string } {
  const items = parseAgenda(agenda);
  const lines = block.split("\n");
  let next = agenda;
  for (let i = 0; i < lines.length; i++) {
    const p = readPin(lines[i]);
    if (!p) continue;
    const cands = items.filter((x) => itemKey(x) === p.key && x.date <= today);
    const it = cands.find((x) => x.date === today) ?? cands.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!it) continue;
    if (p.done && !it.done) next = setAgendaDone(next, it.date, p.key);
    else if (!p.done && it.done) lines[i] = lines[i].replace(/\[ \]/, "[x]");
  }
  return { block: lines.join("\n"), agenda: next };
}

// ── 알림 ──

export const reminderKey = (it: AgendaItem) => `${it.date} ${itemKey(it)}`;

/** 시각이 있는 오늘 일정 중 곧(lead분 안) 시작하거나 막 시작한(30분 안) 것 */
export function dueReminders(items: AgendaItem[], now: Date, sent: string[], leadMin = 15): AgendaItem[] {
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return items.filter((it) => {
    if (it.done || !it.time || it.date !== today || sent.includes(reminderKey(it))) return false;
    const [h, m] = it.time.split(":").map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
    const diff = (at - now.getTime()) / 60000;
    return diff <= leadMin && diff >= -30;
  });
}

// ── 날짜 ──

export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

/** "2026-11-07" → "11/7 (토)" */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d} (${day})`;
}
