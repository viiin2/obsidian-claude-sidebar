import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CalEvent, calPinRow, eventLabel, eventLine, eventSpan, eventsLeft, eventsOn } from "./calendar";
import { dropPinDuplicates, insertPinRows } from "./agenda";

const ev = (title: string, start: string, end: string, allDay = false, location?: string): CalEvent => ({ id: title, title, start, end, allDay, calendar: "집", location });
const EVENTS = [
  ev("치과", "2026-11-05T15:00", "2026-11-05T16:00"),
  ev("워크숍", "2026-11-05", "2026-11-06", true),
  ev("팀 회의", "2026-11-05T10:00", "2026-11-05T11:30", false, "3층"),
  ev("밤샘 작업", "2026-11-04T22:00", "2026-11-05T02:00"),
  ev("해커톤", "2026-11-09T10:00", "2026-11-09T18:00"),
];

test("그날 일정: 하루 종일 먼저, 그다음 시각 순, 전날부터 이어진 것 포함", () => {
  assert.deepEqual(eventsOn(EVENTS, "2026-11-05").map((e) => e.title), ["워크숍", "밤샘 작업", "팀 회의", "치과"]);
  assert.deepEqual(eventsOn(EVENTS, "2026-11-06").map((e) => e.title), ["워크숍"]);
});

test("일정 이름표", () => {
  assert.equal(eventLabel(EVENTS[2], "2026-11-05"), "10:00–11:30 팀 회의");
  assert.equal(eventLabel(EVENTS[1], "2026-11-05"), "워크숍");
  assert.equal(eventLabel(EVENTS[3], "2026-11-05"), "~02:00 밤샘 작업");
  assert.equal(eventLabel(EVENTS[3], "2026-11-04"), "22:00 밤샘 작업");
  assert.equal(eventLine(EVENTS[2], true), "11/5 (목) 10:00–11:30 팀 회의 @3층");
});

test("📆 줄 넣기 (이미 있으면 그대로), Claude가 같은 일을 또 쓰면 뺌", () => {
  const block = "> [!todo] 오늘 할 일\n> - [ ] 🔁 영어\n> - [ ] 15:00 치과 — 오후\n> - [ ] [[a]] 일";
  const rows = eventsOn(EVENTS, "2026-11-05").slice(2).map((e) => calPinRow(e, "2026-11-05"));
  const once = insertPinRows(dropPinDuplicates(block, [{ text: "치과" }]), rows);
  assert.equal(once, "> [!todo] 오늘 할 일\n> - [ ] 🔁 영어\n> - [ ] 📆 10:00–11:30 팀 회의\n> - [ ] 📆 15:00–16:00 치과\n> - [ ] [[a]] 일");
  assert.equal(insertPinRows(once.replace("[ ] 📆 15:00", "[x] 📆 15:00"), rows), once.replace("[ ] 📆 15:00", "[x] 📆 15:00"));
});

test("넣을 일정의 시작·끝 (끝이 없으면 1시간)", () => {
  assert.deepEqual(eventSpan("2026-11-07", "15:00"), { start: "2026-11-07T15:00", end: "2026-11-07T16:00" });
  assert.deepEqual(eventSpan("2026-11-07", "15:00", "17:30"), { start: "2026-11-07T15:00", end: "2026-11-07T17:30" });
  assert.deepEqual(eventSpan("2026-11-07", "23:30"), { start: "2026-11-07T23:30", end: "2026-11-07T23:59" });
});

test("오늘 남은 일정", () => {
  assert.deepEqual(eventsLeft(EVENTS, "2026-11-05", "12:00").map((e) => e.title), ["워크숍", "치과"]);
});
