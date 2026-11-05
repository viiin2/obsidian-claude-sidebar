import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "fs";
import { join } from "path";
import { htmlText, officeText } from "./officetext";

test("워드(docx)에서 글자와 줄바꿈", () => {
  const t = officeText(readFileSync(join(__dirname, "../../test/fixtures/sample.docx")), ".docx");
  assert.ok(t);
  assert.ok(t!.includes("창업 메모"));
  assert.ok(t!.includes("사업화 & 정책자금 <중요>"));
  assert.ok(t!.indexOf("지원금은") > t!.indexOf("창업 메모"));
});

test("zip이 아니면 오류", () => {
  assert.throws(() => officeText(Buffer.from("not a zip at all, just text....................."), ".docx"));
});

test("HTML: 스타일·스크립트는 빼고 구조는 살림", () => {
  const html = `<!doctype html><html><head><title>지원사업</title><style>.a{color:red}</style>
  <link rel="stylesheet" href="https://fonts.googleapis.com/x"></head><body>
  <script>alert(1)</script><h2>돈의 종류</h2><p><strong>사업화</strong>안 갚음</p>
  <ul><li><span>예비창업패키지</span><span>최대 1억</span></li><li>R&amp;D</li></ul>
  <table><tr><th>이름</th><th>금액</th></tr><tr><td>A</td><td>3천</td></tr></table></body></html>`;
  const t = htmlText(html);
  assert.ok(t.startsWith("# 지원사업"));
  assert.ok(t.includes("## 돈의 종류"));
  assert.ok(t.includes("**사업화** 안 갚음"));
  assert.ok(t.includes("- 예비창업패키지 최대 1억"));
  assert.ok(t.includes("- R&D"));
  assert.ok(t.includes("| 이름 | 금액 |"));
  assert.ok(!t.includes("color:red") && !t.includes("alert"));
});
