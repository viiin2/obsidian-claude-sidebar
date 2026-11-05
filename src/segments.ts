// Claude 응답 텍스트를 "일반 글"과 "노트 제안 블록"으로 나눕니다.
//
// 제안 블록 형식 (시스템 프롬프트에서 약속):
//   <note path="폴더/노트.md" mode="replace|prepend|append|create">
//   내용
//   </note>
// 일정 블록 (바로 일정 목록에 들어감):
//   <todo date="2026-11-07" time="14:00">치과</todo>
// 루틴 블록 (바로 루틴 노트에 들어감):
//   <routine days="매일" time="07:00">영어 단어 20개</routine>

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

export interface TodoSeg {
  kind: "todo";
  /** 응답 안에서 몇 번째 일정인지 (0부터) */
  index: number;
  date: string;
  time?: string;
  text: string;
  complete: boolean;
}

export interface RoutineSeg {
  kind: "routine";
  index: number;
  /** "매일", "평일", "월수금" … */
  days: string;
  time?: string;
  text: string;
  complete: boolean;
}

export type Segment = TextSeg | NoteSeg | TodoSeg | RoutineSeg;

const OPEN = /<(note|todo|routine)\b([^>]*)>/g;
const TAGS = ["<note", "<todo", "<routine"];
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
  if (TAGS.some((t) => t.startsWith(tail) || tail.startsWith(t))) return text.slice(0, lt);
  return text;
}

/** 블록 내용 끝에 걸린 "</no" 같은 반쪽 닫는 태그를 숨깁니다. */
function hidePartialClose(body: string, close: string): string {
  for (let n = close.length - 1; n > 0; n--) {
    if (body.endsWith(close.slice(0, n))) return body.slice(0, -n);
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
  return segs.filter((s) => s.kind !== "text" || s.text.trim() !== "");
}

export function parseSegments(src: string, streaming = false): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  let index = 0;
  let todoIndex = 0;
  let routineIndex = 0;
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

    const tag = open[1];
    const attrs = readAttrs(open[2]);
    const bodyStart = open.index + open[0].length;
    const closeTag = `</${tag}>`;
    const close = src.indexOf(closeTag, bodyStart);
    const done = close >= 0;
    let body = done ? src.slice(bodyStart, close) : src.slice(bodyStart);
    if (!done && streaming) body = hidePartialClose(body, closeTag);

    if (tag === "routine") {
      out.push({
        kind: "routine",
        index: routineIndex++,
        days: (attrs.days ?? "").trim(),
        time: (attrs.time ?? "").trim() || undefined,
        text: body.replace(/\s+/g, " ").trim(),
        complete: done,
      });
    } else if (tag === "todo") {
      out.push({
        kind: "todo",
        index: todoIndex++,
        date: (attrs.date ?? "").trim(),
        time: (attrs.time ?? "").trim() || undefined,
        text: body.replace(/\s+/g, " ").trim(),
        complete: done,
      });
    } else {
      out.push({ kind: "note", index: index++, path: (attrs.path ?? "").trim(), mode: toMode(attrs.mode), content: trimBody(body), complete: done });
    }
    if (!done) break;
    pos = close + closeTag.length;
  }

  return stripWrappingFences(out);
}

export function noteBlocks(src: string): NoteSeg[] {
  return parseSegments(src).filter((s): s is NoteSeg => s.kind === "note");
}

export function todoBlocks(src: string): TodoSeg[] {
  return parseSegments(src).filter((s): s is TodoSeg => s.kind === "todo");
}

export function routineBlocks(src: string): RoutineSeg[] {
  return parseSegments(src).filter((s): s is RoutineSeg => s.kind === "routine");
}
