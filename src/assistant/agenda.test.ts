import { test } from "node:test";
import { strict as assert } from "node:assert";
import { addAgenda, agendaLine, dropPinDuplicates, keepCheckedPins, dueReminders, insertPins, parseAgenda, parseAgendaLine, pinsFor, removeAgenda, removePin, shiftDate, shortDate, syncPins } from "./agenda";
import { planTick, slotForNow, SlotConfig } from "./slots";

test("일정 줄 읽기: 시각, 완료, Tasks 플러그인 표시", () => {
  assert.deepEqual(parseAgendaLine("- [ ] 14:00 치과 📅 2026-11-07"), { date: "2026-11-07", time: "14:00", text: "치과", done: false });
  assert.deepEqual(parseAgendaLine("- [x] 9:05 회의 ⏫ 📅 2026-11-07 ✅ 2026-11-07"), { date: "2026-11-07", time: "09:05", text: "회의", done: true });
  assert.deepEqual(parseAgendaLine("- [ ] 보고서 내기 📅 2026-11-10"), { date: "2026-11-10", time: undefined, text: "보고서 내기", done: false });
  assert.equal(parseAgendaLine("- [ ] 날짜 없는 일"), null);
  assert.equal(agendaLine({ date: "2026-11-07", time: "14:00", text: "치과", done: false }), "- [ ] 14:00 치과 📅 2026-11-07");
});

test("일정 넣기: 빈 노트엔 제목과 함께, 날짜·시각 순서대로, 같은 일은 한 번만", () => {
  let md = addAgenda("", { date: "2026-11-10", text: "보고서", done: false });
  assert.equal(md, "# 일정\n\n- [ ] 보고서 📅 2026-11-10\n");
  md = addAgenda(md, { date: "2026-11-07", time: "14:00", text: "치과", done: false });
  md = addAgenda(md, { date: "2026-11-07", text: "장보기", done: false });
  md = addAgenda(md, { date: "2026-11-12", text: "발표", done: false });
  assert.deepEqual(parseAgenda(md).map((x) => x.text), ["치과", "장보기", "보고서", "발표"]);
  assert.equal(addAgenda(md, { date: "2026-11-07", time: "14:00", text: "치과", done: false }), md);
  assert.ok(md.startsWith("# 일정\n\n"));
  const back = removeAgenda(md, { date: "2026-11-07", text: "장보기", done: false });
  assert.deepEqual(parseAgenda(back).map((x) => x.text), ["치과", "보고서", "발표"]);
});

test("사용자가 쓴 다른 줄은 그대로", () => {
  const md = "# 일정\n메모 한 줄\n\n- [ ] 치과 📅 2026-11-07\n\n## 끝난 것\n";
  const next = addAgenda(md, { date: "2026-11-08", text: "운동", done: false });
  assert.equal(next, "# 일정\n메모 한 줄\n\n- [ ] 치과 📅 2026-11-07\n- [ ] 운동 📅 2026-11-08\n\n## 끝난 것\n");
});

const AGENDA = `# 일정

- [ ] 보고서 📅 2026-11-03
- [x] 끝난 옛일 📅 2026-11-02
- [ ] 아주 옛일 📅 2026-10-01
- [ ] 14:00 치과 📅 2026-11-05
- [ ] 09:30 회의 📅 2026-11-05
- [ ] 다음 주 발표 📅 2026-11-12
`;

test("오늘 넣을 일: 밀린 일(7일 안) 먼저, 그다음 오늘 일정 시각 순", () => {
  assert.deepEqual(pinsFor(parseAgenda(AGENDA), "2026-11-05").map((x) => x.text), ["보고서", "회의", "치과"]);
});

test("브리핑의 오늘 할 일 칸에 📌 줄 넣기 (이미 있으면 다시 안 넣음)", () => {
  const block = "> [!todo] 오늘 할 일\n> - [ ] [[a]] 로비 만들기\n\n> [!info]- 현황";
  const pins = pinsFor(parseAgenda(AGENDA), "2026-11-05");
  const once = insertPins(block, pins, "2026-11-05");
  assert.equal(
    once,
    "> [!todo] 오늘 할 일\n> - [ ] 📌 보고서 (11/3부터)\n> - [ ] 📌 09:30 회의\n> - [ ] 📌 14:00 치과\n> - [ ] [[a]] 로비 만들기\n\n> [!info]- 현황",
  );
  assert.equal(insertPins(once, pins, "2026-11-05"), once);
  assert.equal(insertPins("", pins.slice(1, 2), "2026-11-05"), "> [!todo] 오늘 할 일\n> - [ ] 📌 09:30 회의");
  assert.equal(removePin(once, pins[2]).includes("치과"), false);
});

test("체크 맞추기: 데일리에서 체크 → 일정 목록도, 목록에서 체크 → 데일리도", () => {
  const block = "> [!todo] 오늘 할 일\n> - [x] 📌 09:30 회의 ✅ 2026-11-05\n> - [ ] 📌 14:00 치과\n> - [x] 📌 보고서 (11/3부터)";
  const agenda = AGENDA.replace("- [ ] 14:00 치과", "- [x] 14:00 치과");
  const r = syncPins(block, agenda, "2026-11-05");
  assert.ok(r.block.includes("> - [x] 📌 14:00 치과"));
  const items = parseAgenda(r.agenda);
  assert.equal(items.find((x) => x.text === "회의")!.done, true);
  assert.equal(items.find((x) => x.text === "보고서")!.done, true);
  assert.equal(items.find((x) => x.text === "다음 주 발표")!.done, false);
});

test("알림: 시작 15분 전부터 시작 뒤 30분까지, 한 번만", () => {
  const items = parseAgenda(AGENDA);
  const at = (h: number, m: number) => new Date(2026, 10, 5, h, m);
  assert.deepEqual(dueReminders(items, at(13, 40), []).map((x) => x.text), []);
  assert.deepEqual(dueReminders(items, at(13, 50), []).map((x) => x.text), ["치과"]);
  assert.deepEqual(dueReminders(items, at(9, 50), []).map((x) => x.text), ["회의"]);
  assert.deepEqual(dueReminders(items, at(13, 50), ["2026-11-05 14:00 치과"]), []);
  assert.deepEqual(dueReminders(items, at(15, 0), []), []);
});

test("날짜 계산", () => {
  assert.equal(shiftDate("2026-11-01", -7), "2026-10-25");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shortDate("2026-11-07"), "11/7 (토)");
});

const CFG: SlotConfig = { time: "08:30", middayOn: true, middayTime: "13:00", eveningOn: true, eveningTime: "21:00", refreshHours: 2 };
const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
const iso = (h: number, m = 0) => at(h, m).toISOString();

test("시간대: 아침 → 새로고침 → 점심 → 저녁", () => {
  assert.equal(planTick(CFG, {}, at(7)), null);
  assert.equal(planTick(CFG, {}, at(8, 30)), "morning");
  const morningDone = { lastBriefing: "2026-11-05", lastBriefingAt: iso(8, 31), lastRefreshAt: iso(8, 31) };
  assert.equal(planTick(CFG, morningDone, at(9)), null);
  assert.equal(planTick(CFG, morningDone, at(10, 40)), "refresh");
  assert.equal(planTick(CFG, morningDone, at(13)), "midday");
  const middayDone = { ...morningDone, lastMidday: "2026-11-05", lastRefreshAt: iso(13) };
  assert.equal(planTick(CFG, middayDone, at(14)), null);
  assert.equal(planTick(CFG, middayDone, at(21)), "evening");
  assert.equal(planTick(CFG, { ...middayDone, lastEvening: "2026-11-05" }, at(23)), null);
});

test("시간대: 늦게 켜도 몰아서 하지 않음", () => {
  // 14시에 처음 켬 → 아침만, 점심은 아침 뒤 2시간이 안 지나서 건너뜀
  assert.equal(planTick(CFG, {}, at(14)), "morning");
  const lateMorning = { lastBriefing: "2026-11-05", lastBriefingAt: iso(14), lastRefreshAt: iso(14) };
  assert.equal(planTick(CFG, lateMorning, at(14, 10)), null);
  // 점심 칸(13~16시)이 지나면 점심은 그날 건너뜀
  assert.equal(planTick(CFG, lateMorning, at(16, 10)), "refresh");
  // 22시에 처음 켬 → 아침 없이 저녁 회고만
  assert.equal(planTick(CFG, {}, at(22)), "evening");
  // 실패하면 1시간 동안 다시 안 함
  assert.equal(planTick(CFG, { lastFail: { job: "morning", at: iso(8, 30) } }, at(9)), null);
  assert.equal(planTick(CFG, { lastFail: { job: "morning", at: iso(8, 30) } }, at(9, 40)), "morning");
  // 점심·저녁을 끄면
  const off = { ...CFG, middayOn: false, eveningOn: false, refreshHours: 0 };
  assert.equal(planTick(off, { lastBriefing: "2026-11-05" }, at(22)), null);
  assert.equal(planTick(off, {}, at(22)), "morning");
});

test("📅 버튼: 지금 시각에 맞는 브리핑", () => {
  assert.equal(slotForNow(CFG, {}, at(15)), "morning");
  assert.equal(slotForNow(CFG, { lastBriefing: "2026-11-05" }, at(15)), "midday");
  assert.equal(slotForNow(CFG, { lastBriefing: "2026-11-05" }, at(10)), "morning");
  assert.equal(slotForNow(CFG, {}, at(21, 30)), "evening");
});

test("Claude가 📌 일정을 할 일로 또 쓰면 뺌", () => {
  const pins = parseAgenda(AGENDA).filter((x) => x.text === "보고서" || x.text === "치과");
  const block = [
    "> [!todo] 오늘 할 일",
    "> - [ ] 보고서 — 어제가 기한이라 오전에",
    "> - [ ] 14:00 치과 — 잊지 말기",
    "> - [ ] [[a]] 보고서 양식 만들기 — 다른 일",
    "> - [ ] [[b]] 로비 만들기 — 이유",
  ].join("\n");
  assert.deepEqual(dropPinDuplicates(block, pins).split("\n"), ["> [!todo] 오늘 할 일", "> - [ ] [[a]] 보고서 양식 만들기 — 다른 일", "> - [ ] [[b]] 로비 만들기 — 이유"]);
});

test("다시 만든 브리핑에 체크해 둔 📌·🔁 줄 남기기", () => {
  const old = "> [!todo] 오늘 할 일\n> - [x] 📌 보고서 (11/3부터)\n> - [x] 🔁 영어 · 🔥2\n> - [ ] 📌 14:00 치과";
  const next = "> [!todo] 오늘 할 일\n> - [ ] 🔁 영어 · 🔥2\n> - [ ] 📌 14:00 치과\n> - [ ] [[a]] 일";
  assert.equal(keepCheckedPins(old, next), "> [!todo] 오늘 할 일\n> - [ ] 🔁 영어 · 🔥2\n> - [ ] 📌 14:00 치과\n> - [x] 📌 보고서 (11/3부터)\n> - [ ] [[a]] 일");
});
