import { test } from "node:test";
import { strict as assert } from "node:assert";
import { StreamParser, ClaudeEvent } from "./stream";

const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
const se = (event: unknown) => ({ type: "stream_event", event, parent_tool_use_id: null });

function run(input: string, chunk = 7): ClaudeEvent[] {
  const ev: ClaudeEvent[] = [];
  const p = new StreamParser((e) => ev.push(e));
  for (let i = 0; i < input.length; i += chunk) p.push(input.slice(i, i + chunk));
  p.end();
  return ev;
}

test("세션, 도구, 글, 결과 순서", () => {
  const input = lines(
    { type: "system", subtype: "init", session_id: "s1", model: "m" },
    se({ type: "message_start", message: { id: "m1" } }),
    se({ type: "content_block_start", content_block: { type: "text", text: "" } }),
    se({ type: "content_block_delta", delta: { type: "text_delta", text: "찾아" } }),
    se({ type: "content_block_delta", delta: { type: "text_delta", text: "볼게요" } }),
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "찾아볼게요" }] } },
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "창업" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] } },
    se({ type: "message_start", message: { id: "m2" } }),
    se({ type: "content_block_start", content_block: { type: "text", text: "" } }),
    se({ type: "content_block_delta", delta: { type: "text_delta", text: "있어요" } }),
    { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "있어요" }] } },
    { type: "result", subtype: "success", is_error: false, result: "있어요", session_id: "s1", duration_ms: 1200 },
  );
  const ev = run(input);
  const text = ev.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
  assert.equal(text, "찾아볼게요\n\n있어요");
  assert.deepEqual(ev[0], { type: "session", id: "s1", model: "m" });
  assert.equal(ev.filter((e) => e.type === "tool").length, 1);
  const last = ev[ev.length - 1];
  assert.equal(last.type, "result");
  if (last.type === "result") assert.equal(last.ok, true);
});

test("스트리밍 조각이 없으면 완성본 글을 씀", () => {
  const ev = run(lines({ type: "assistant", message: { id: "m9", content: [{ type: "text", text: "통째로" }] } }));
  assert.deepEqual(ev, [{ type: "text", delta: "통째로" }]);
});

test("오류 결과", () => {
  const ev = run(lines({ type: "result", subtype: "success", is_error: true, result: "Not logged in" }));
  assert.deepEqual(ev[0], { type: "result", ok: false, text: "Not logged in", sessionId: undefined, durationMs: undefined });
});

test("하위 에이전트와 깨진 줄은 무시", () => {
  const input = "not json\n" + lines({ ...se({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }), parent_tool_use_id: "t" });
  assert.deepEqual(run(input), []);
});
