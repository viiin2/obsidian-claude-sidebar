import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checklistProgress, readFm, setFm, upsertBriefing, BRIEF_START, BRIEF_END, renderDashboard, progressBar } from "./projects";
import { formatDate, relDay } from "./datefmt";

const NOTE = `---
저장소: viiin2/x
---
# x

## 할 일
- [x] 로비 만들기
- [ ] 결과창 다듬기
  - [ ] 하위 항목
- [X] 저장 기능

## 메모
- [ ] 이건 세지 않음
`;

test("할 일 제목 아래 체크박스만 셈", () => {
  const p = checklistProgress(NOTE);
  assert.deepEqual([p.done, p.total], [2, 4]);
  assert.deepEqual(p.open, ["결과창 다듬기", "하위 항목"]);
});

test("할 일 제목이 없으면 전체를 셈", () => {
  assert.deepEqual(checklistProgress("- [x] a\n- [ ] b").total, 2);
});

test("프로퍼티 읽기·바꾸기·더하기 (다른 줄은 그대로)", () => {
  const next = setFm(NOTE, { 저장소: "viiin2/y", 진행도: "2/4", 폴더: undefined });
  assert.equal(readFm(next)["저장소"], "viiin2/y");
  assert.equal(readFm(next)["진행도"], "2/4");
  assert.ok(next.includes("## 메모"));
  assert.equal(next.split("---").length, NOTE.split("---").length);
});

test("프로퍼티가 없던 노트에 새로 만듦", () => {
  assert.equal(setFm("# 제목\n본문", { 상태: "진행중" }), "---\n상태: 진행중\n---\n# 제목\n본문");
});

test("공백이나 특수문자 값은 따옴표", () => {
  assert.ok(setFm("", { 폴더: "/Users/a/LLM PJ/x" }).includes("폴더: /Users/a/LLM PJ/x"));
  assert.ok(setFm("", { 메모: "a: b" }).includes('메모: "a: b"'));
});

test("브리핑: 처음엔 맨 위(프로퍼티 다음)에, 다시 하면 그 자리를 교체", () => {
  const md = "---\na: 1\n---\n오늘 메모";
  const once = upsertBriefing(md, "할 일 1");
  assert.equal(once, `---\na: 1\n---\n${BRIEF_START}\n할 일 1\n${BRIEF_END}\n\n오늘 메모`);
  const twice = upsertBriefing(once, "할 일 2");
  assert.equal(twice, `---\na: 1\n---\n${BRIEF_START}\n할 일 2\n${BRIEF_END}\n\n오늘 메모`);
  assert.equal(upsertBriefing("", "x"), `${BRIEF_START}\nx\n${BRIEF_END}\n`);
});

test("현황표와 진행 막대", () => {
  assert.equal(progressBar(3, 6, 4), "▰▰▱▱");
  const t = renderDashboard([{ id: "a", done: 1, total: 2, last: "2026-11-04", week: 3, status: "진행중", unpushed: 2 }], "2026-11-05", "x");
  assert.ok(t.includes("| 🔥 | [[a]] ⬆2 | ▰▰▰▰▱▱▱▱ 1/2 | 어제 | 3 |"));
});

test("날짜 형식", () => {
  const d = new Date(2026, 10, 5, 8, 3);
  assert.equal(formatDate(d, "YYYY-MM-DD (ddd) HH:mm"), "2026-11-05 (목) 08:03");
  assert.equal(formatDate(d, "[Daily]/YYYY/M/D"), "Daily/2026/11/5");
  assert.equal(relDay("2026-11-02", "2026-11-05"), "3일 전");
});
