// 옵시디언 기본 "데일리 노트" 설정(폴더, 날짜 형식)을 그대로 따릅니다.

import { App, TFile, moment, normalizePath } from "obsidian";

interface DailyOptions {
  folder: string;
  format: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function dailyPlugin(app: App): any {
  return (app as any).internalPlugins?.getPluginById?.("daily-notes");
}

export function dailyOptions(app: App): DailyOptions {
  const opts = dailyPlugin(app)?.instance?.options ?? {};
  return {
    folder: normalizePath((opts.folder ?? "").trim() || "/").replace(/^\/$/, ""),
    format: (opts.format ?? "").trim() || "YYYY-MM-DD",
  };
}

export function todayPath(app: App): string {
  const { folder, format } = dailyOptions(app);
  const name = moment().format(format);
  return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
}

function dateOf(file: TFile, o: DailyOptions): moment.Moment | null {
  if (o.folder && !file.path.startsWith(o.folder + "/")) return null;
  const rel = (o.folder ? file.path.slice(o.folder.length + 1) : file.path).replace(/\.md$/, "");
  const d = moment(rel, o.format, true);
  return d.isValid() ? d : null;
}

/** 오늘 이전의 데일리 노트를 최신순으로 */
export function recentDailies(app: App, count: number): TFile[] {
  const o = dailyOptions(app);
  const today = moment().startOf("day");
  return app.vault
    .getMarkdownFiles()
    .map((f) => ({ f, d: dateOf(f, o) }))
    .filter((x): x is { f: TFile; d: moment.Moment } => !!x.d && x.d.isBefore(today))
    .sort((a, b) => b.d.valueOf() - a.d.valueOf())
    .slice(0, count)
    .map((x) => x.f);
}

/** 오늘 노트를 열고(없으면 템플릿까지 적용해 새로 만들고) 파일을 돌려줍니다. */
export async function openToday(app: App): Promise<TFile> {
  const path = todayPath(app);
  const plugin = dailyPlugin(app);
  if (plugin?.enabled) {
    await (app as any).commands.executeCommandById("daily-notes");
    for (let i = 0; i < 20; i++) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
      await sleep(100);
    }
  }
  let f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
    f = await app.vault.create(path, "");
  }
  await app.workspace.getLeaf(false).openFile(f as TFile);
  return f as TFile;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
