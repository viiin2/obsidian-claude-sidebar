import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checklistProgress, readFm, setFm, upsertBriefing, getBriefing, carryChecks, escapeNumberTags, BRIEF_START, BRIEF_END, renderDashboard, progressBar } from "./projects";
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

test("점심 칸은 아침 칸 바로 아래, 저녁 칸은 맨 끝, 다시 하면 그 자리만 교체", () => {
  let md = upsertBriefing("오늘 메모\n", "아침");
  md = upsertBriefing(md, "점심", "midday");
  md = upsertBriefing(md, "저녁", "evening");
  assert.equal(md, `${BRIEF_START}\n아침\n${BRIEF_END}\n\n%% 비서 점심 %%\n점심\n%% 비서 점심 끝 %%\n\n오늘 메모\n\n%% 비서 저녁 %%\n저녁\n%% 비서 저녁 끝 %%\n`);
  const again = upsertBriefing(md, "점심 2", "midday");
  assert.equal(getBriefing(again, "midday"), "점심 2");
  assert.equal(getBriefing(again, "morning"), "아침");
  assert.equal(getBriefing(again, "evening"), "저녁");
  assert.equal(upsertBriefing("", "저녁", "evening"), "%% 비서 저녁 %%\n저녁\n%% 비서 저녁 끝 %%\n");
});

test("다시 만든 브리핑에 체크 이어 붙이기", () => {
  const old = "> [!todo] 오늘 할 일\n> - [x] [[a]] 로비 만들기 — 이유 ✅ 2026-11-05\n> - [ ] 📌 14:00 치과";
  const fresh = "> [!todo] 오늘 할 일\n> - [ ] [[a]] 로비 만들기 — 이유\n> - [ ] [[b]] 새 일";
  assert.equal(carryChecks(old, fresh), "> [!todo] 오늘 할 일\n> - [x] [[a]] 로비 만들기 — 이유\n> - [ ] [[b]] 새 일");
});

test("숫자 태그 막기: PR #2와 → \\#2와 (코드 안, 숫자만, 이미 막은 것은 그대로)", () => {
  assert.equal(escapeNumberTags("> - PR #2와 함께, 이슈 #15 (#3번)"), "> - PR \\#2와 함께, 이슈 #15 (\\#3번)");
  assert.equal(escapeNumberTags("#태그 그대로, \\#2와 그대로"), "#태그 그대로, \\#2와 그대로");
  assert.equal(escapeNumberTags("색은 `#1e1e1e` 와\n```\n#2와\n```\n#2와"), "색은 `#1e1e1e` 와\n```\n#2와\n```\n\\#2와");
});
