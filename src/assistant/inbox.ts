// 받은자료 정리: 볼트의 "받은자료" 폴더에 들어온 파일·글·링크를 Claude가 읽고
// 요약 노트로 만들어 "자료/<분류>/" 에 저장합니다. 원본 파일은 첨부파일 폴더로 옮겨 노트에 넣습니다.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "fs";
import { promises as fsp } from "fs";
import { basename, dirname, extname, join, relative, sep } from "path";
import { RunHandle, runClaude } from "../claude";
import { IS_MAC, exec, findBin } from "../exec";
import { noteBlocks } from "../segments";
import { AssistantConfig, SUPPORT_DIR } from "./config";
import { formatDate, ymd } from "./datefmt";
import { htmlText, officeText } from "./officetext";

export interface InboxHooks {
  step?(icon: string, label: string): void;
  log?(msg: string): void;
  onClaude?(h: RunHandle | null): void;
  isAborted?(): boolean;
}

export interface FiledNote {
  /** 받은자료 안의 원래 파일 */
  source: string;
  /** 만든 노트 (볼트 기준 경로) */
  note?: string;
  category?: string;
  error?: string;
}

const TEXT_EXT = new Set([".md", ".txt", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".log", ".srt", ".vtt"]);
/** 글자만 뽑아서 읽게 하는 문서 (워드, 파워포인트, 한글 hwpx, 웹페이지). 맥은 textutil로 doc·rtf·odt도 */
const OFFICE_EXT = new Set([".docx", ".pptx", ".hwpx"]);
const HTML_EXT = new Set([".html", ".htm"]);
const MAC_CONVERT_EXT = new Set([".doc", ".rtf", ".odt", ".webarchive"]);
const READABLE_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const SYSTEM = `너는 사용자의 자료 정리 비서야. 작업 폴더는 사용자의 옵시디언 볼트야.
한국어로. 요청한 형식의 블록만 출력해.
검색할 땐 Grep에 glob "*.md"를 붙이고, .obsidian 폴더와 첨부파일 폴더는 보지 마.`;

function attachmentFolder(vault: string): string {
  try {
    const a = JSON.parse(readFileSync(join(vault, ".obsidian/app.json"), "utf8")).attachmentFolderPath ?? "";
    return String(a).replace(/^\.?\/+|\/+$/g, "") || "Attached File";
  } catch {
    return "Attached File";
  }
}

function uniquePath(abs: string): string {
  if (!existsSync(abs)) return abs;
  const ext = extname(abs);
  const stem = abs.slice(0, -ext.length || undefined);
  for (let n = 2; ; n++) {
    const p = `${stem} ${n}${ext}`;
    if (!existsSync(p)) return p;
  }
}

const safeSeg = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();

/** 받은자료 폴더의 처리할 파일 목록 (숨김 파일, 폴더 제외) */
export function listInbox(cfg: AssistantConfig): string[] {
  const dir = join(cfg.vault, cfg.inboxFolder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && !f.endsWith(".icloud"))
    .filter((f) => {
      try {
        return statSync(join(dir, f)).isFile();
      } catch {
        return false;
      }
    })
    .map((f) => `${cfg.inboxFolder}/${f}`);
}

/** 사이드바에 붙여 넣은 글·링크를 받은자료에 파일로 넣습니다. */
export function saveTextToInbox(cfg: AssistantConfig, text: string, now = new Date()): string {
  const isUrl = /^https?:\/\/\S+$/.test(text.trim());
  const name = `${isUrl ? "링크" : "메모"} ${formatDate(now, "YYYY-MM-DD HHmm")}.md`;
  const abs = uniquePath(join(cfg.vault, cfg.inboxFolder, name));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text.trim() + "\n");
  return `${cfg.inboxFolder}/${basename(abs)}`;
}

function categories(cfg: AssistantConfig): string[] {
  const dir = join(cfg.vault, cfg.materialsFolder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isDirectory());
}

function projectNames(cfg: AssistantConfig): string[] {
  const dir = join(cfg.vault, cfg.projectFolder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "현황.md")
    .map((f) => f.replace(/\.md$/, ""));
}

/** iCloud·OneDrive에서 아직 안 받은 파일이면 받을 때까지 기다립니다 (최대 60초). */
async function materialize(abs: string): Promise<boolean> {
  if (IS_MAC) await exec("brctl", ["download", abs], { timeout: 10000 });
  const read = fsp.readFile(abs).then(() => true, () => false);
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 60000));
  return Promise.race([read, timeout]);
}

function prompt(o: {
  sourceRel: string;
  readPath: string;
  kind: "text" | "file" | "unreadable";
  hasUrl: boolean;
  cats: string[];
  projects: string[];
  materials: string;
  today: string;
}): string {
  const how =
    o.kind === "unreadable"
      ? `이 파일은 형식 때문에 내용을 읽을 수 없어. 파일 이름으로만 판단해서 짧게 정리해.`
      : `먼저 Read로 ${o.readPath} 를 읽어.${o.hasUrl ? " 안에 링크가 있으면 WebFetch로 그 페이지를 읽어서 내용을 정리해." : ""}`;
  return `[할 일: 받은 자료 정리]
받은 파일: ${o.sourceRel}
오늘: ${o.today}
${how}

볼트에서 이 자료와 관련된 노트를 Grep으로 찾아봐 (핵심 낱말 두세 개로).
프로젝트 노트: ${o.projects.length ? o.projects.map((p) => `[[${p}]]`).join(", ") : "(없음)"}
지금 있는 분류: ${o.cats.length ? o.cats.join(", ") : "(아직 없음)"}

정리해서 아래 블록 하나로만 출력해. 블록 밖에는 아무것도 쓰지 마.
<note path="${o.materials}/분류/제목.md" mode="create">
---
분류: 분류
태그: [태그1, 태그2]
출처: 링크나 원본 파일 이름
받은날: ${o.today}
---
# 제목
> 한 줄 요약

## 핵심
- 3~7개

## 내용
(자료의 내용을 빠짐없이, 읽기 좋게 정리. 원문이 짧으면 거의 그대로)

## 관련
- [[관련 노트나 프로젝트]] — 왜 관련 있는지 짧게
</note>

규칙:
- 분류는 지금 있는 분류에 맞는 게 있으면 그걸 그대로 쓰고, 없을 때만 새로 만들어. 한두 낱말의 넓은 주제로 (예: 창업, 개발, 영어, 여행, 건강, 돈, 학교).
- 제목은 내용을 담은 짧은 말. 파일 이름에 / \\ : * ? " < > | # 는 쓰지 마.
- 관련 노트가 없으면 "## 관련" 부분을 통째로 빼.
- 없는 내용을 지어내지 마.`;
}

async function fileOne(cfg: AssistantConfig, sourceRel: string, hooks: InboxHooks, cats: string[], projects: string[]): Promise<FiledNote> {
  const vault = cfg.vault;
  const abs = join(vault, sourceRel);
  const ext = extname(abs).toLowerCase();
  const name = basename(abs);
  hooks.step?.("inbox", name);

  if (!(await materialize(abs))) return { source: sourceRel, error: "클라우드에서 파일을 받지 못했어요" };

  let readPath = sourceRel;
  let kind: "text" | "file" | "unreadable" = TEXT_EXT.has(ext) ? "text" : READABLE_EXT.has(ext) ? "file" : "unreadable";
  let textContent = "";
  const addDirs: string[] = [];
  if (kind === "text") textContent = readFileSync(abs, "utf8");
  // 문서는 글자만 뽑아 임시 파일로 만들고 그걸 읽게 함
  let extracted: string | null = null;
  try {
    if (OFFICE_EXT.has(ext)) extracted = officeText(readFileSync(abs), ext);
    else if (HTML_EXT.has(ext)) extracted = htmlText(readFileSync(abs, "utf8"));
  } catch {
    extracted = null;
  }
  const tmpDir = join(SUPPORT_DIR, "convert");
  if (extracted?.trim()) {
    mkdirSync(tmpDir, { recursive: true });
    readPath = join(tmpDir, `${Date.now()}.txt`);
    writeFileSync(readPath, extracted);
    kind = "file";
    addDirs.push(tmpDir);
  } else if (HTML_EXT.has(ext)) {
    readPath = sourceRel;
    kind = "file";
  } else if (IS_MAC && MAC_CONVERT_EXT.has(ext)) {
    mkdirSync(tmpDir, { recursive: true });
    const out = join(tmpDir, `${Date.now()}.txt`);
    const r = await exec("textutil", ["-convert", "txt", "-output", out, abs], { timeout: 30000 });
    if (r.ok) {
      readPath = out;
      kind = "file";
      addDirs.push(tmpDir);
    }
  }
  const hasUrl = /https?:\/\/\S+/.test(textContent);

  const claudePath = findBin("claude", cfg.claudePath);
  if (!claudePath) return { source: sourceRel, error: "Claude Code를 찾지 못했어요" };
  let out = "";
  let ok = false;
  let fail = "";
  const h = runClaude({
    claudePath,
    cwd: vault,
    prompt: prompt({ sourceRel, readPath, kind, hasUrl, cats, projects, materials: cfg.materialsFolder, today: ymd(new Date()) }),
    systemPrompt: SYSTEM,
    model: cfg.model || undefined,
    effort: "low",
    addDirs,
    allowWeb: hasUrl,
    onEvent: (e) => {
      if (e.type === "text") out += e.delta;
      else if (e.type === "result") {
        ok = e.ok;
        if (!e.ok) fail = e.text;
      }
    },
  });
  hooks.onClaude?.(h);
  await h.done;
  hooks.onClaude?.(null);
  if (!ok) return { source: sourceRel, error: fail || "Claude가 답하지 못했어요" };

  const block = noteBlocks(out).find((b) => b.complete);
  if (!block) return { source: sourceRel, error: "정리 결과 형식이 이상해요" };

  // 경로 검증: 반드시 자료/<분류>/<제목>.md
  const parts = block.path.replace(/^\/+/, "").split("/").map(safeSeg).filter(Boolean);
  const category = parts.length >= 3 && parts[0] === cfg.materialsFolder ? parts[1] : "기타";
  const title = (parts[parts.length - 1] ?? "").replace(/\.md$/i, "") || name.replace(/\.[^.]+$/, "");
  const noteAbs = uniquePath(join(vault, cfg.materialsFolder, category, `${title}.md`));
  mkdirSync(dirname(noteAbs), { recursive: true });

  let body = block.content.trimEnd() + "\n";
  if (kind === "text") {
    // 원문은 접힌 인용으로 아래에 남겨 둠 (정보 손실 없음)
    const quoted = textContent.trim().split("\n").map((l) => `> ${l}`).join("\n");
    body += `\n> [!quote]- 원문\n${quoted}\n`;
    await moveToTrash(vault, abs);
  } else {
    const attDir = join(vault, attachmentFolder(vault));
    mkdirSync(attDir, { recursive: true });
    const dest = uniquePath(join(attDir, name));
    renameSync(abs, dest);
    body += `\n![[${basename(dest)}]]\n`;
  }
  writeFileSync(noteAbs, body);
  const note = relative(vault, noteAbs).split(sep).join("/");
  hooks.log?.(`정리 ${sourceRel} → ${note}`);
  return { source: sourceRel, note, category };
}

/** 옵시디언의 휴지통(.trash)으로 옮김 */
async function moveToTrash(vault: string, abs: string): Promise<void> {
  const trash = join(vault, ".trash");
  mkdirSync(trash, { recursive: true });
  renameSync(abs, uniquePath(join(trash, basename(abs))));
}

/** 받은자료를 하나씩 정리합니다 (분류가 겹치지 않게 차례로). */
export async function processInbox(cfg: AssistantConfig, hooks: InboxHooks = {}, only?: string[]): Promise<FiledNote[]> {
  const items = only ?? listInbox(cfg);
  const results: FiledNote[] = [];
  const projects = projectNames(cfg);
  for (const rel of items) {
    if (hooks.isAborted?.()) break;
    if (!existsSync(join(cfg.vault, rel))) continue;
    try {
      // 앞에서 새로 만든 분류도 다음 자료가 쓸 수 있게 매번 다시 읽음
      results.push(await fileOne(cfg, rel, hooks, categories(cfg), projects));
    } catch (e) {
      results.push({ source: rel, error: (e as Error).message });
    }
  }
  return results;
}
