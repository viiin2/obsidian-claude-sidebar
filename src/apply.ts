// Claude가 제안한 노트 블록을 볼트에 적용하고, 되돌릴 수 있게 이전 내용을 기억합니다.

import { App, TFile, normalizePath } from "obsidian";
import type { NoteSeg } from "./segments";

export interface Applied {
  path: string;
  file: TFile;
  undo: () => Promise<void>;
}

/** 볼트 밖이나 설정 폴더를 가리키는 경로는 거부합니다. */
export function cleanPath(raw: string): string | null {
  let p = raw.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").replace(/^\.?\/+/, "");
  if (!p) return null;
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "")) return null;
  if (parts[0].startsWith(".")) return null;
  // 파일 이름에 못 쓰는 글자 정리
  parts[parts.length - 1] = parts[parts.length - 1].replace(/[\\:*?"<>|]/g, "").trim();
  if (!parts[parts.length - 1]) return null;
  p = parts.join("/");
  if (!/\.(md|canvas)$/i.test(p)) p += ".md";
  return normalizePath(p);
}

export function splitFrontmatter(s: string): { fm: string; body: string } {
  if (!s.startsWith("---\n")) return { fm: "", body: s };
  const end = s.indexOf("\n---", 3);
  if (end < 0) return { fm: "", body: s };
  const after = s.indexOf("\n", end + 4);
  const cut = after < 0 ? s.length : after + 1;
  return { fm: s.slice(0, cut), body: s.slice(cut) };
}

export function getFile(app: App, path: string): TFile | null {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? f : null;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = path.split("/").slice(0, -1);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}

function uniquePath(app: App, path: string): string {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const dot = path.lastIndexOf(".");
  const stem = path.slice(0, dot);
  const ext = path.slice(dot);
  for (let n = 2; ; n++) {
    const p = `${stem} ${n}${ext}`;
    if (!app.vault.getAbstractFileByPath(p)) return p;
  }
}

async function create(app: App, path: string, content: string): Promise<Applied> {
  const p = uniquePath(app, path);
  await ensureFolder(app, p);
  const file = await app.vault.create(p, content.endsWith("\n") ? content : content + "\n");
  return {
    path: p,
    file,
    undo: async () => {
      const f = getFile(app, p);
      if (f) await app.fileManager.trashFile(f);
    },
  };
}

export async function applyNote(app: App, block: NoteSeg): Promise<Applied> {
  const path = cleanPath(block.path);
  if (!path) throw new Error(`쓸 수 없는 경로예요: ${block.path}`);
  const file = getFile(app, path);

  if (block.mode === "create" || !file) return create(app, path, block.content);

  const old = await app.vault.read(file);
  let next: string;
  if (block.mode === "replace") {
    next = block.content;
    if (old.endsWith("\n") && !next.endsWith("\n")) next += "\n";
  } else if (block.mode === "prepend") {
    const { fm, body } = splitFrontmatter(old);
    const rest = body.replace(/^\n+/, "");
    next = fm + block.content.trimEnd() + (rest.trim() ? "\n\n" + rest : "\n");
  } else {
    const head = old.replace(/\s+$/, "");
    next = (head ? head + "\n\n" : "") + block.content.trimEnd() + "\n";
  }

  await app.vault.modify(file, next);
  return {
    path,
    file,
    undo: async () => {
      const f = getFile(app, path);
      if (f) await app.vault.modify(f, old);
    },
  };
}
