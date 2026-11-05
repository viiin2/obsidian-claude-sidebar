import { test } from "node:test";
import { strict as assert } from "node:assert";
import { insertPinRows } from "./agenda";
import {
  addRoutine,
  daysLabel,
  parseDays,
  parseRoutineLine,
  parseRoutines,
  removeRoutine,
  removeRoutinePin,
  routineChecks,
  routinePinLine,
  routineStats,
  routineSummary,
  routinesOn,
} from "./routines";

test("요일 읽기·쓰기", () => {
  assert.deepEqual(parseDays("매일"), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseDays("평일"), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays("월 수 금"), [1, 3, 5]);
  assert.deepEqual(parseDays("화요일, 목요일"), [2, 4]);
  assert.equal(parseDays("아무때나"), null);
  assert.equal(daysLabel([1, 3, 5]), "월수금");
  assert.equal(daysLabel([0, 6]), "주말");
  assert.equal(daysLabel([0, 1]), "월일");
});

test("루틴 줄 읽기·넣기·빼기", () => {
  assert.deepEqual(parseRoutineLine("- 7:00 영어 단어 20개 🔁 매일"), { time: "07:00", text: "영어 단어 20개", days: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(parseRoutineLine("- [ ] 헬스 🔁 월수금"), { time: undefined, text: "헬스", days: [1, 3, 5] });
  assert.equal(parseRoutineLine("- 그냥 메모"), null);
  let md = addRoutine("", { time: "07:00", text: "영어 단어", days: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(md, "# 루틴\n\n- 07:00 영어 단어 🔁 매일\n");
  md = addRoutine(md, { text: "헬스", days: [1, 3, 5] });
  assert.equal(md, "# 루틴\n\n- 07:00 영어 단어 🔁 매일\n- 헬스 🔁 월수금\n");
  assert.equal(addRoutine(md, { text: "헬스", days: [1, 3, 5] }), md);
  assert.equal(addRoutine(md, { text: "헬스", days: [2, 4] }), "# 루틴\n\n- 07:00 영어 단어 🔁 매일\n- 헬스 🔁 화목\n");
  assert.deepEqual(parseRoutines(removeRoutine(md, { text: "헬스", days: [] })).map((r) => r.text), ["영어 단어"]);
});

const RS = parseRoutines("- 07:00 영어 단어 🔁 매일\n- 헬스 🔁 월수금\n- 청소 🔁 주말");

test("그 요일에 할 루틴 (시각 순)", () => {
  // 2026-11-05는 목요일
  assert.deepEqual(routinesOn(RS, "2026-11-05").map((r) => r.text), ["영어 단어"]);
  assert.deepEqual(routinesOn(RS, "2026-11-06").map((r) => r.text), ["영어 단어", "헬스"]);
  assert.deepEqual(routinesOn(RS, "2026-11-08").map((r) => r.text), ["영어 단어", "청소"]);
});

test("🔁 줄: 오늘 할 일 칸에 넣기, 체크 읽기 (Tasks 완료일·연속 표시 무시)", () => {
  const block = "> [!todo] 오늘 할 일\n> - [ ] 📌 14:00 치과\n> - [ ] [[a]] 일";
  const rows = routinesOn(RS, "2026-11-06").map((r) => ({ key: `🔁 ${r.time ? r.time + " " : ""}${r.text}`, line: routinePinLine(r, r.text === "헬스" ? 3 : 1) }));
  const once = insertPinRows(block, rows);
  assert.equal(once, "> [!todo] 오늘 할 일\n> - [ ] 📌 14:00 치과\n> - [ ] 🔁 07:00 영어 단어\n> - [ ] 🔁 헬스 · 🔥3\n> - [ ] [[a]] 일");
  assert.equal(insertPinRows(once, rows), once);
  const checked = once.replace("> - [ ] 🔁 헬스 · 🔥3", "> - [x] 🔁 헬스 · 🔥3 ✅ 2026-11-06");
  assert.deepEqual([...routineChecks(checked)], [["07:00 영어 단어", false], ["헬스", true]]);
  assert.equal(insertPinRows(checked, rows), checked);
  assert.ok(!removeRoutinePin(once, RS[0]).includes("영어"));
  assert.ok(removeRoutinePin(checked, RS[1]).includes("헬스"), "체크한 줄은 기록이라 남김");
});

test("연속 기록과 이번 주 (월요일부터)", () => {
  // 11/2(월)~11/5(목). 영어: 11/1(일)부터 매일, 11/3만 빠짐 → 어제까지 연속 1 (11/4). 헬스: 월(11/2) 함
  const log: Record<string, [string, boolean][]> = {
    "2026-11-01": [["07:00 영어 단어", true]],
    "2026-11-02": [["07:00 영어 단어", true], ["헬스", true]],
    "2026-11-03": [["07:00 영어 단어", false]],
    "2026-11-04": [["07:00 영어 단어", true], ["헬스", false]],
    "2026-11-05": [["07:00 영어 단어", true]],
  };
  const checks = (d: string) => (log[d] ? new Map(log[d]) : null);
  const [en, gym, clean] = routineStats(RS, "2026-11-05", checks);
  assert.deepEqual([en.before, en.streak, en.today, en.weekDone, en.weekTotal], [1, 2, true, 3, 4]);
  assert.deepEqual([gym.before, gym.streak, gym.today, gym.weekDone, gym.weekTotal], [0, 0, null, 1, 2]);
  assert.deepEqual([clean.weekTotal, clean.today], [0, null]);
  assert.equal(routineSummary([en, gym, clean]), "> - 🔁 루틴 1/1 · 영어 단어 🔥2일째");
  assert.equal(routineSummary([gym, clean]), null);
});
