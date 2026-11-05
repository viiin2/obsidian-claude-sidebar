// Claude 응답 텍스트를 "일반 글"과 "노트 제안 블록"으로 나눕니다.
//
// 제안 블록 형식 (시스템 프롬프트에서 약속):
//   <note path="폴더/노트.md" mode="replace|prepend|append|create">
//   내용
//   </note>

export type NoteMode = "replace" | "prepend" | "append" | "create";

export interface TextSeg {
  kind: "text";
  text: string;
}

export interface NoteSeg {
  kind: "note";
  /** 응답 안에서 몇 번째 블록인지 (0부터) */
  index: number;
  path: string;
  mode: NoteMode;
  content: string;
  /** 닫는 태그까지 도착했는지 (스트리밍 중엔 false) */
  complete: boolean;
}

export type Segment = TextSeg | NoteSeg;

const OPEN = /<note\b([^>]*)>/g;
const CLOSE = "</note>";
const MODES: NoteMode[] = ["replace", "prepend", "append", "create"];

function readAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

function toMode(v: string | undefined): NoteMode {
  const m = (v ?? "").trim().toLowerCase() as NoteMode;
  return MODES.includes(m) ? m : "replace";
}

function trimBody(s: string): string {
  return s.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

/** 스트리밍 도중 끝에 걸린 "<no", "<note path=..." 같은 반쪽 태그를 숨깁니다. */
function hidePartialOpen(text: string): string {
  const lt = text.lastIndexOf("<");
  if (lt < 0) return text;
  const tail = text.slice(lt);
  if (tail.includes(">")) return text;
  if ("<note".startsWith(tail) || tail.startsWith("<note")) return text.slice(0, lt);
  return text;
}

/** 블록 내용 끝에 걸린 "</no" 같은 반쪽 닫는 태그를 숨깁니다. */
function hidePartialClose(body: string): string {
  for (let n = CLOSE.length - 1; n > 0; n--) {
    if (body.endsWith(CLOSE.slice(0, n))) return body.slice(0, -n);
  }
  return body;
}

/** 모델이 블록을 ``` 로 감싸 버린 경우 그 펜스를 지웁니다. */
function stripWrappingFences(segs: Segment[]): Segment[] {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind !== "note") continue;
    const before = segs[i - 1];
    const after = segs[i + 1];
    if (before?.kind === "text" && /```[\w-]*\s*$/.test(before.text)) {
      if (!after || (after.kind === "text" && /^\s*```/.test(after.text))) {
        before.text = before.text.replace(/```[\w-]*\s*$/, "");
        if (after?.kind === "text") after.text = after.text.replace(/^\s*```/, "");
      }
    }
  }
  return segs.filter((s) => s.kind === "note" || s.text.trim() !== "");
}

export function parseSegments(src: string, streaming = false): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  let index = 0;
  OPEN.lastIndex = 0;

  while (true) {
    OPEN.lastIndex = pos;
    const open = OPEN.exec(src);
    if (!open) {
      const rest = src.slice(pos);
      out.push({ kind: "text", text: streaming ? hidePartialOpen(rest) : rest });
      break;
    }
    out.push({ kind: "text", text: src.slice(pos, open.index) });

    const attrs = readAttrs(open[1]);
    const bodyStart = open.index + open[0].length;
    const close = src.indexOf(CLOSE, bodyStart);
    const base = { kind: "note" as const, index: index++, path: (attrs.path ?? "").trim(), mode: toMode(attrs.mode) };

    if (close < 0) {
      const body = src.slice(bodyStart);
      out.push({ ...base, content: trimBody(streaming ? hidePartialClose(body) : body), complete: false });
      break;
    }
    out.push({ ...base, content: trimBody(src.slice(bodyStart, close)), complete: true });
    pos = close + CLOSE.length;
  }

  return stripWrappingFences(out);
}

export function noteBlocks(src: string): NoteSeg[] {
  return parseSegments(src).filter((s): s is NoteSeg => s.kind === "note");
}
