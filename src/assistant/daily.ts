// 데일리 노트 위치 찾기와 새로 만들기.
// 옵시디언 "데일리 노트" 설정(.obsidian/daily-notes.json)을 따르고,
// 설정이 없는데 노트를 Daily/ 같은 폴더로 옮겨 쓰고 있으면 그 폴더를 따라갑니다.

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { daysAgo, formatDate } from "./datefmt";

export interface DailyOpts {
  folder: string;
  format: string;
  template: string;
}

export function dailyOpts(vault: string): DailyOpts {
  try {
    const o = JSON.parse(readFileSync(join(vault, ".obsidian/daily-notes.json"), "utf8"));
    return { folder: (o.folder ?? "").replace(/^\/+|\/+$/g, ""), format: o.format || "YYYY-MM-DD", template: o.template ?? "" };
  } catch {
    return { folder: "", format: "YYYY-MM-DD", template: "" };
  }
}

function configured(o: DailyOpts, d: Date): string {
  const name = `${formatDate(d, o.format)}.md`;
  return o.folder ? `${o.folder}/${name}` : name;
}

/** 볼트 안 .md 파일 이름 → 경로 (점 폴더는 건너뜀, 깊이 4까지, 파일은 열지 않음) */
function mdIndex(vault: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(join(vault, rel));
    } catch {
      return;
    }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const r = rel ? `${rel}/${n}` : n;
      if (n.endsWith(".md")) {
        if (!out.has(n)) out.set(n, r);
      } else if (depth < 4 && !n.includes(".")) walk(r, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

/** 그날 데일리 노트의 볼트 기준 경로 (없으면 만들 자리) */
export function dailyRel(vault: string, d: Date, o: DailyOpts = dailyOpts(vault), index?: () => Map<string, string>): string {
  const want = configured(o, d);
  if (existsSync(join(vault, want))) return want;
  // 날짜 형식에 폴더가 들어 있으면 (예: YYYY/MM/DD) 설정 그대로
  if (want.slice(o.folder ? o.folder.length + 1 : 0).includes("/")) return want;
  const idx = index ? index() : mdIndex(vault);
  const found = idx.get(`${formatDate(d, o.format)}.md`);
  if (found) return found;
  if (o.folder) return want;
  // 설정 폴더가 없으면, 최근 데일리 노트가 있는 폴더를 따라감
  for (let i = 1; i <= 30; i++) {
    const p = idx.get(`${formatDate(daysAgo(i, d), o.format)}.md`);
    if (p) return p.includes("/") ? `${p.slice(0, p.lastIndexOf("/"))}/${formatDate(d, o.format)}.md` : want;
  }
  return want;
}

/** 여러 날짜를 찾을 때: 볼트 목록을 한 번만 읽음 */
export function dailyResolver(vault: string): (d: Date) => string {
  const o = dailyOpts(vault);
  let idx: Map<string, string> | null = null;
  return (d) => dailyRel(vault, d, o, () => (idx ??= mdIndex(vault)));
}

/** 아직 없는 데일리 노트를 데일리 노트 템플릿으로 시작 */
export function newDailyText(vault: string, d: Date, o: DailyOpts = dailyOpts(vault)): string {
  if (!o.template) return "";
  try {
    const t = readFileSync(join(vault, o.template.endsWith(".md") ? o.template : `${o.template}.md`), "utf8");
    return t
      .replace(/{{\s*date\s*}}/g, formatDate(d, "YYYY-MM-DD"))
      .replace(/{{\s*title\s*}}/g, formatDate(d, o.format))
      .replace(/{{\s*time\s*}}/g, formatDate(d, "HH:mm"));
  } catch {
    return "";
  }
}
