// 루틴(매일·요일마다 하는 일)과 연속 기록. 모두 문자열 → 문자열 함수라 테스트하기 쉽습니다.
//
// 루틴 노트(루틴.md) 한 줄:
//   - 07:00 영어 단어 20개 🔁 매일
//   - 헬스 🔁 월 수 금
//   - 독서 🔁 평일
// 그 요일 데일리 노트의 오늘 할 일 칸에:
//   > - [ ] 🔁 07:00 영어 단어 20개 · 🔥4
// 체크 기록은 따로 저장하지 않고 지난 데일리 노트의 🔁 줄 체크를 읽어서 셉니다.

import { itemKey, normTime, pinText, shiftDate } from "./agenda";

export interface Routine {
  time?: string;
  text: string;
  /** 0=일 … 6=토 */
  days: number[];
}

const DAY_CHARS = "일월화수목금토";
/** 월요일부터 보여 줌 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseDays(s: string): number[] | null {
  const t = s.replace(/\s+/g, "").replace(/요일/g, "").replace(/[,·/|]/g, "");
  if (/^(매일|날마다|every ?day|daily)$/i.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  if (t === "평일") return [1, 2, 3, 4, 5];
  if (t === "주말") return [0, 6];
  if (!t) return null;
  const ds = [...new Set([...t].map((c) => DAY_CHARS.indexOf(c)))];
  if (ds.some((d) => d < 0)) return null;
  return ds.sort((a, b) => a - b);
}

export function daysLabel(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return "매일";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "평일";
  if (set.size === 2 && set.has(0) && set.has(6)) return "주말";
  return WEEK_ORDER.filter((d) => set.has(d)).map((d) => DAY_CHARS[d]).join("");
}

const LINE = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*?)\s*🔁\s*(.+?)\s*$/;

export function parseRoutineLine(line: string): Routine | null {
  const m = line.match(LINE);
  if (!m) return null;
  const days = parseDays(m[2]);
  if (!days) return null;
  let text = squash(m[1]);
  let time: string | undefined;
  const t = text.match(/^(\d{1,2}:\d{2})\s+/);
  if (t && normTime(t[1])) {
    time = normTime(t[1]);
    text = text.slice(t[0].length).trim();
  }
  return text ? { time, text, days } : null;
}

export function parseRoutines(md: string): Routine[] {
  return md.split("\n").map(parseRoutineLine).filter((x): x is Routine => !!x);
}

export function routineLine(r: Routine): string {
  return `- ${itemKey(r)} 🔁 ${daysLabel(r.days)}`;
}

export const ROUTINE_HEADER = "# 루틴\n\n";

/** 맨 끝 루틴 다음에 넣습니다. 같은 루틴(시각+이름)이 있으면 요일만 바꿉니다. */
export function addRoutine(md: string, r: Routine): string {
  const lines = md ? md.replace(/\n+$/, "").split("\n") : [];
  const parsed = lines.map(parseRoutineLine);
  const same = parsed.findIndex((x) => x && itemKey(x) === itemKey(r));
  if (same >= 0) {
    if (daysLabel(parsed[same]!.days) === daysLabel(r.days)) return md;
    lines[same] = routineLine(r);
    return lines.join("\n") + "\n";
  }
  if (!parsed.some(Boolean)) return (md.trim() ? md.replace(/\n+$/, "") + "\n\n" : ROUTINE_HEADER) + routineLine(r) + "\n";
  lines.splice(parsed.map(Boolean).lastIndexOf(true) + 1, 0, routineLine(r));
  return lines.join("\n") + "\n";
}

export function removeRoutine(md: string, r: Routine): string {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => {
    const x = parseRoutineLine(l);
    return x !== null && itemKey(x) === itemKey(r);
  });
  if (i < 0) return md;
  lines.splice(i, 1);
  return lines.join("\n");
}

export function dayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function routinesOn(rs: Routine[], ymd: string): Routine[] {
  const d = dayOf(ymd);
  return rs.filter((r) => r.days.includes(d)).sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

// ── 데일리 노트의 🔁 줄 ──

const PIN = /^>\s*[-*+]\s+\[([ xX])\]\s+🔁\s+(.*)$/;

export function routinePinLine(r: Routine, streak = 0): string {
  return `> - [ ] 🔁 ${itemKey(r)}${streak >= 2 ? ` · 🔥${streak}` : ""}`;
}

/** 브리핑 칸의 🔁 줄 체크 상태 (열쇠: "07:00 영어 단어 20개") */
export function routineChecks(block: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const l of block.split("\n")) {
    const m = l.match(PIN);
    if (m) out.set(pinText(m[2]), m[1] !== " ");
  }
  return out;
}

export function removeRoutinePin(block: string, r: Routine): string {
  const key = itemKey(r);
  return block
    .split("\n")
    .filter((l) => {
      const m = l.match(PIN);
      return !m || m[1] !== " " || pinText(m[2]) !== key;
    })
    .join("\n");
}

// ── 연속 기록·이번 주 ──

export interface RoutineStat {
  r: Routine;
  /** 어제까지 이어 온 연속 일수 (오늘은 아직 안 셈) */
  before: number;
  /** 오늘까지 (오늘 했으면 +1) */
  streak: number;
  /** 오늘 할 날이면 true/false, 아니면 null */
  today: boolean | null;
  weekDone: number;
  weekTotal: number;
}

/**
 * checks(날짜) → 그날 데일리 노트의 🔁 체크 (노트·브리핑이 없으면 null = 안 한 것으로 셈).
 * 이번 주는 월요일부터 오늘까지.
 */
export function routineStats(rs: Routine[], today: string, checks: (ymd: string) => Map<string, boolean> | null, maxBack = 60): RoutineStat[] {
  const cache = new Map<string, Map<string, boolean> | null>();
  const get = (d: string) => {
    if (!cache.has(d)) cache.set(d, checks(d));
    return cache.get(d)!;
  };
  const didOn = (r: Routine, d: string) => get(d)?.get(itemKey(r)) === true;
  const monday = shiftDate(today, -((dayOf(today) + 6) % 7));
  return rs.map((r) => {
    let before = 0;
    for (let i = 1, d = shiftDate(today, -1); i <= maxBack; i++, d = shiftDate(d, -1)) {
      if (!r.days.includes(dayOf(d))) continue;
      if (!didOn(r, d)) break;
      before++;
    }
    const todayOn = r.days.includes(dayOf(today));
    const todayDone = todayOn ? didOn(r, today) : null;
    let weekDone = 0;
    let weekTotal = 0;
    for (let d = monday; d <= today; d = shiftDate(d, 1)) {
      if (!r.days.includes(dayOf(d))) continue;
      weekTotal++;
      if (didOn(r, d)) weekDone++;
    }
    return { r, before, streak: before + (todayDone ? 1 : 0), today: todayDone, weekDone, weekTotal };
  });
}

/** 저녁 회고 "오늘 한 것" 칸에 넣는 한 줄: 🔁 루틴 2/3 · 영어 단어 🔥5일째 */
export function routineSummary(stats: RoutineStat[]): string | null {
  const todays = stats.filter((s) => s.today !== null);
  if (!todays.length) return null;
  const done = todays.filter((s) => s.today).length;
  const best = todays.filter((s) => s.today && s.streak >= 2).sort((a, b) => b.streak - a.streak)[0];
  return `> - 🔁 루틴 ${done}/${todays.length}${best ? ` · ${best.r.text} 🔥${best.streak}일째` : ""}`;
}
