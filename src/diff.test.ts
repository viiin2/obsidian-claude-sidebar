import { test } from "node:test";
import { strict as assert } from "node:assert";
import { diffLines, diffStats, hunks } from "./diff";

test("같으면 바뀐 줄 없음", () => {
  const d = diffLines("a\nb", "a\nb")!;
  assert.deepEqual(diffStats(d), { add: 0, del: 0 });
});

test("한 줄 고침", () => {
  const d = diffLines("a\nb\nc", "a\nB\nc")!;
  assert.deepEqual(diffStats(d), { add: 1, del: 1 });
  assert.deepEqual(d.map((l) => l.t + l.s), [" a", "-b", "+B", " c"]);
});

test("앞에 추가", () => {
  const d = diffLines("x\ny", "new\n\nx\ny")!;
  assert.deepEqual(diffStats(d), { add: 2, del: 0 });
});

test("주변만 남기고 접기", () => {
  const before = Array.from({ length: 20 }, (_, i) => `줄${i}`).join("\n");
  const after = before.replace("줄10", "줄열");
  const h = hunks(diffLines(before, after)!, 1);
  assert.deepEqual(h.map((l) => l.t + l.s), ["…9", " 줄9", "-줄10", "+줄열", " 줄11", "…8"]);
});

test("너무 크면 null", () => {
  const big = (k: string) => Array.from({ length: 3000 }, (_, i) => k + i).join("\n");
  assert.equal(diffLines(big("a"), big("b")), null);
});
