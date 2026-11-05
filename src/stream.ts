// `claude -p --output-format stream-json --include-partial-messages` 출력을 읽어
// 화면에 필요한 이벤트만 뽑아냅니다.

export type ClaudeEvent =
  | { type: "session"; id: string; model?: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { type: "result"; ok: boolean; text: string; sessionId?: string; durationMs?: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
export class StreamParser {
  private buf = "";
  private seenTools = new Set<string>();
  /** 글자 단위로 스트리밍된 메시지 (완성본이 와도 다시 내보내지 않음) */
  private streamedMsgs = new Set<string>();
  private currentMsg = "";
  private wroteText = false;
  private needGap = false;
  gotResult = false;

  constructor(private emit: (e: ClaudeEvent) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.line(line);
    }
  }

  end(): void {
    const line = this.buf.trim();
    this.buf = "";
    if (line) this.line(line);
  }

  private line(line: string): void {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    if (d.parent_tool_use_id) return; // 하위 에이전트 메시지는 무시

    switch (d.type) {
      case "system":
        if (d.subtype === "init") this.emit({ type: "session", id: d.session_id, model: d.model });
        break;
      case "stream_event":
        this.streamEvent(d.event);
        break;
      case "assistant":
        this.assistant(d.message);
        break;
      case "result":
        this.gotResult = true;
        this.emit({
          type: "result",
          ok: d.subtype === "success" && !d.is_error,
          text: typeof d.result === "string" ? d.result : Array.isArray(d.errors) ? d.errors.join("\n") : "",
          sessionId: d.session_id,
          durationMs: d.duration_ms,
        });
        break;
    }
  }

  private text(delta: string): void {
    if (!delta) return;
    if (this.needGap) {
      this.emit({ type: "text", delta: "\n\n" });
      this.needGap = false;
    }
    this.emit({ type: "text", delta });
    this.wroteText = true;
  }

  private streamEvent(e: any): void {
    if (!e) return;
    if (e.type === "message_start" && e.message?.id) {
      this.currentMsg = e.message.id;
    } else if (e.type === "content_block_start" && e.content_block?.type === "text") {
      if (this.wroteText) this.needGap = true;
    } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
      if (this.currentMsg) this.streamedMsgs.add(this.currentMsg);
      this.text(e.delta.text);
    }
  }

  private assistant(msg: any): void {
    if (!msg || !Array.isArray(msg.content)) return;
    const streamed = msg.id && this.streamedMsgs.has(msg.id);
    for (const c of msg.content) {
      if (c.type === "tool_use" && c.id && !this.seenTools.has(c.id)) {
        this.seenTools.add(c.id);
        this.emit({ type: "tool", id: c.id, name: c.name, input: c.input ?? {} });
      } else if (c.type === "text" && !streamed) {
        if (this.wroteText) this.needGap = true;
        this.text(c.text);
      }
    }
  }
}
