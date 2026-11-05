// 애플 캘린더 (macOS 전용). 캘린더 도우미 앱(ClaudeCalendar.app, native/calendar-helper.swift)을
// 지원 폴더에 풀어 두고 `open -W` 로 불러서 읽고 씁니다. 처음 한 번 맥이 캘린더 접근 허용을 묻습니다.
// 읽은 일정은 calendar.json 에 모아 두고(대화 중 Claude도 읽음), 도우미를 못 부를 때는 그걸 씁니다.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { IS_MAC, exec } from "../exec";
import type { CalEvent } from "./calendar";
import { HELPER_FILES } from "./calhelper-bundle";
import { SUPPORT_DIR } from "./config";

export const CAL_APP = join(SUPPORT_DIR, "ClaudeCalendar.app");
export const CAL_CACHE = join(SUPPORT_DIR, "calendar.json");

export function calendarSupported(): boolean {
  return IS_MAC;
}

/** 도우미 앱을 지원 폴더에 풀어 둠. 내용이 같으면 그대로 둠 (바뀌면 맥이 허용을 다시 물으므로) */
export function installHelper(): void {
  if (!IS_MAC) throw new Error("애플 캘린더는 맥에서만 돼요");
  let changed = false;
  for (const [rel, b64] of Object.entries(HELPER_FILES)) {
    const abs = join(CAL_APP, rel);
    const data = Buffer.from(b64, "base64");
    if (existsSync(abs) && readFileSync(abs).equals(data)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data, { mode: rel.startsWith("Contents/MacOS/") ? 0o755 : 0o644 });
    changed = true;
  }
  if (changed) void exec("xattr", ["-cr", CAL_APP]);
}

interface HelperResult {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

let seq = 0;

/** 도우미 앱 실행. 처음엔 허용 창에 답할 때까지 기다리므로 넉넉히 기다림 */
async function run(args: string[], timeout = 90000): Promise<HelperResult> {
  installHelper();
  const out = join(SUPPORT_DIR, `cal-${process.pid}-${Date.now()}-${seq++}.json`);
  try {
    const r = await exec("open", ["-g", "-W", "-n", CAL_APP, "--args", args[0], out, ...args.slice(1)], { timeout });
    if (!existsSync(out)) throw new Error(r.ok ? "캘린더 도우미가 답하지 않았어요" : `캘린더 도우미를 열지 못했어요: ${r.err.trim()}`);
    const res = JSON.parse(readFileSync(out, "utf8")) as HelperResult;
    if (!res.ok) throw new Error(res.error || "캘린더 오류");
    return res;
  } finally {
    try {
      unlinkSync(out);
    } catch {
      /* 없음 */
    }
  }
}

export interface CalInfo {
  id: string;
  title: string;
  writable: boolean;
  default: boolean;
  source: string;
}

/** 권한 확인 (처음이면 허용 창이 뜸) */
export async function calAuth(): Promise<string> {
  return String((await run(["auth"])).status);
}

export async function calCalendars(): Promise<CalInfo[]> {
  return (await run(["calendars"])).calendars as CalInfo[];
}

export interface CalCache {
  at: string;
  from: string;
  to: string;
  events: CalEvent[];
}

/** from~to (날짜 포함) 일정을 읽고 calendar.json 에 저장 */
export async function calList(from: string, to: string): Promise<CalEvent[]> {
  const events = (await run(["list", from, to])).events as CalEvent[];
  mkdirSync(SUPPORT_DIR, { recursive: true });
  writeFileSync(CAL_CACHE, JSON.stringify({ at: new Date().toISOString(), from, to, events } satisfies CalCache, null, 1));
  return events;
}

export function readCalCache(): CalCache | null {
  try {
    return JSON.parse(readFileSync(CAL_CACHE, "utf8")) as CalCache;
  } catch {
    return null;
  }
}

/** 일정 넣기. start/end: "YYYY-MM-DDTHH:MM" (하루 종일이면 "YYYY-MM-DD"). 만든 일정 id */
export async function calAdd(o: { title: string; start: string; end: string; calendarId?: string; alarmMin?: number }): Promise<string> {
  const r = await run(["add", o.title, o.start, o.end, o.calendarId || "-", o.alarmMin === undefined ? "-" : String(o.alarmMin)]);
  return String(r.id);
}

export async function calRemove(id: string): Promise<void> {
  await run(["remove", id]);
}
