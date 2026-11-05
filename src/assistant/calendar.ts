// 애플 캘린더 일정을 데일리 노트·브리핑에 쓰는 순수 함수들.
//   > - [ ] 📆 10:00–11:30 팀 회의
//   > - [ ] 📆 팀 워크숍            ← 하루 종일

import { shortDate } from "./agenda";

export interface CalEvent {
  id: string;
  title: string;
  /** "YYYY-MM-DDTHH:MM" (하루 종일이면 "YYYY-MM-DD") */
  start: string;
  /** 끝 (하루 종일이면 마지막 날 "YYYY-MM-DD") */
  end: string;
  allDay: boolean;
  calendar: string;
  location?: string;
}

const day = (s: string) => s.slice(0, 10);
const time = (s: string) => (s.length > 10 ? s.slice(11, 16) : "");

/** 그날에 걸친 일정 (여러 날짜에 걸친 것 포함), 하루 종일 먼저 그다음 시각 순 */
export function eventsOn(events: CalEvent[], ymd: string): CalEvent[] {
  return events
    .filter((e) => day(e.start) <= ymd && ymd <= day(e.end))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
}

/** "10:00–11:30 팀 회의", 하루 종일이면 "팀 회의", 전날부터 이어지면 "~11:30 팀 회의" */
export function eventLabel(e: CalEvent, ymd: string): string {
  const title = e.title.replace(/\s+/g, " ").trim() || "(제목 없음)";
  if (e.allDay) return title;
  const s = day(e.start) === ymd ? time(e.start) : "";
  const en = day(e.end) === ymd ? time(e.end) : "";
  if (!s && !en) return title;
  if (!s) return `~${en} ${title}`;
  return `${s}${en && en !== s ? `–${en}` : ""} ${title}`;
}

export function calPinRow(e: CalEvent, ymd: string): { key: string; line: string } {
  const label = eventLabel(e, ymd);
  return { key: `📆 ${label}`, line: `> - [ ] 📆 ${label}` };
}

/** 지시문용 한 줄: "11/7 (토) 10:00–11:30 팀 회의 @회의실" */
export function eventLine(e: CalEvent, withDate: boolean): string {
  const d = day(e.start);
  return `${withDate ? shortDate(d) + " " : ""}${eventLabel(e, d)}${e.location ? ` @${e.location}` : ""}`;
}

/** 시작 + 끝: 끝이 없으면 1시간 뒤 (자정 넘으면 23:59) */
export function eventSpan(date: string, start: string, end?: string): { start: string; end: string } {
  const [h, m] = start.split(":").map(Number);
  let e = end;
  if (!e || e <= start) {
    const t = Math.min(h * 60 + m + 60, 23 * 60 + 59);
    e = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }
  return { start: `${date}T${start}`, end: `${date}T${e}` };
}

/** 지금 이후 오늘 남은 일정 */
export function eventsLeft(events: CalEvent[], ymd: string, hhmm: string): CalEvent[] {
  return eventsOn(events, ymd).filter((e) => e.allDay || day(e.end) > ymd || time(e.end) >= hhmm);
}
