import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseSegments, noteBlocks } from "./segments";

test("일반 글만 있으면 글 하나", () => {
  assert.deepEqual(parseSegments("안녕"), [{ kind: "text", text: "안녕" }]);
});

test("블록 하나와 앞뒤 글", () => {
  const s = parseSegments('정리했어요.\n<note path="a/b.md" mode="replace">\n# 제목\n내용\n</note>\n끝');
  assert.equal(s.length, 3);
  assert.deepEqual(s[1], { kind: "note", index: 0, path: "a/b.md", mode: "replace", content: "# 제목\n내용", complete: true });
  assert.equal((s[2] as { text: string }).text, "\n끝");
});

test("모드가 없거나 이상하면 replace", () => {
  assert.equal(noteBlocks('<note path="x.md">a</note>')[0].mode, "replace");
  assert.equal(noteBlocks('<note path="x.md" mode="zzz">a</note>')[0].mode, "replace");
  assert.equal(noteBlocks("<note path='x.md' mode='prepend'>a</note>")[0].mode, "prepend");
});

test("여러 블록에 순서 번호", () => {
  const b = noteBlocks('<note path="1.md" mode="create">a</note> 그리고 <note path="2.md" mode="append">b</note>');
  assert.deepEqual(b.map((x) => [x.index, x.path, x.content]), [[0, "1.md", "a"], [1, "2.md", "b"]]);
});

test("스트리밍 중: 닫히지 않은 블록은 미완성", () => {
  const s = parseSegments('좋아요\n<note path="x.md" mode="replace">\n줄1\n줄2\n</no', true);
  const n = s[1];
  assert.equal(n.kind, "note");
  if (n.kind === "note") {
    assert.equal(n.complete, false);
    assert.equal(n.content, "줄1\n줄2");
  }
});

test("스트리밍 중: 반쪽 여는 태그는 숨김", () => {
  assert.deepEqual(parseSegments("요약할게요\n<no", true), [{ kind: "text", text: "요약할게요\n" }]);
  assert.deepEqual(parseSegments('요약할게요\n<note path="x', true), [{ kind: "text", text: "요약할게요\n" }]);
  assert.deepEqual(parseSegments("a < b", true), [{ kind: "text", text: "a < b" }]);
});

test("블록을 감싼 코드펜스는 지움", () => {
  const s = parseSegments('바꿨어요\n```markdown\n<note path="x.md" mode="replace">\n내용\n</note>\n```\n');
  assert.equal(s.length, 2);
  assert.equal((s[0] as { text: string }).text.includes("```"), false);
});

test("블록 안 코드블록은 그대로", () => {
  const b = noteBlocks('<note path="x.md">\n```js\nlet a = 1\n```\n</note>');
  assert.equal(b[0].content, "```js\nlet a = 1\n```");
});
