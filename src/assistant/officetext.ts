// 워드(docx), 파워포인트(pptx), 한글(hwpx) 문서에서 글자만 뽑습니다.
// 셋 다 zip 안에 XML이 든 형식이라 외부 프로그램 없이 맥·윈도우 모두에서 됩니다.

import { inflateRawSync } from "zlib";

/** zip에서 원하는 항목만 꺼냅니다. */
export function unzip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip 형식이 아니에요");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const size = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (want(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) out.set(name, data);
      else if (method === 8) out.set(name, inflateRawSync(data));
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** 문단 끝 태그마다 줄을 바꾸고, 글자 태그 안의 글만 모읍니다. */
function xmlText(xml: string, textTag: string, paraTag: string): string {
  const re = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>|</${paraTag}>|<w:tab/>|<w:br/>`, "g");
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += decode(m[1]);
    else if (m[0] === "<w:tab/>") out += "\t";
    else out += "\n";
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const num = (s: string) => Number(s.match(/(\d+)\.xml$/)?.[1] ?? 0);

export function officeText(buf: Buffer, ext: string): string | null {
  const e = ext.toLowerCase();
  if (e === ".docx") {
    const doc = unzip(buf, (n) => n === "word/document.xml").get("word/document.xml");
    return doc ? xmlText(doc.toString("utf8"), "w:t", "w:p") : null;
  }
  if (e === ".pptx") {
    const slides = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const names = [...slides.keys()].sort((a, b) => num(a) - num(b));
    if (!names.length) return null;
    return names.map((n) => `## 슬라이드 ${num(n)}\n${xmlText(slides.get(n)!.toString("utf8"), "a:t", "a:p")}`).join("\n\n");
  }
  if (e === ".hwpx") {
    const secs = unzip(buf, (n) => /^Contents\/section\d+\.xml$/i.test(n));
    const names = [...secs.keys()].sort((a, b) => num(a) - num(b));
    if (!names.length) return null;
    return names.map((n) => xmlText(secs.get(n)!.toString("utf8"), "hp:t", "hp:p")).join("\n\n");
  }
  return null;
}

/**
 * HTML에서 글자만, 구조(제목·목록·표·문단)는 마크다운 비슷하게 살려서 뽑습니다.
 * 웹폰트·스크립트를 불러오지 않으므로 인터넷 없이 바로 끝납니다.
 */
export function htmlText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  let body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<\/tr>/gi, " |\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|aside|blockquote|figure|figcaption|dt|dd|table|ul|ol|details|summary)>/gi, "\n")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2** ")
    // 짧은 꾸밈 태그 경계에 띄어쓰기 (붙어 버리는 것 방지; 겹친 공백은 아래에서 하나로)
    .replace(/<\/(span|em|i|a|small|code|label|mark|time|abbr|cite|sup|sub)>/gi, " ")
    .replace(/<[^>]+>/g, "");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").replace(/\*\* ([,.·)])/g, "**$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title && !text.startsWith(`# ${title}`) ? `# ${decode(title)}\n\n${text}` : text;
}
