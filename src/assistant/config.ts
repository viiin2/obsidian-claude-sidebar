// 비서 설정과 상태 파일. 옵시디언이 꺼져 있어도 아침 작업이 읽을 수 있도록
// 볼트 밖(~/Library/Application Support)에 둡니다. 옵시디언 설정 화면이 이 파일을 씁니다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HOME } from "../exec";

export interface AssistantConfig {
  vault: string;
  enabled: boolean;
  /** 아침 브리핑 시각 "HH:MM" */
  time: string;
  /** 최근 며칠 안에 손댄 프로젝트를 챙길지 */
  days: number;
  /** git 폴더를 찾을 곳 */
  scanRoots: string[];
  /** 볼트 안 프로젝트 노트 폴더 */
  projectFolder: string;
  /** 자료를 넣는 폴더 */
  inboxFolder: string;
  /** 정리된 자료가 분류별로 들어가는 폴더 */
  materialsFolder: string;
  model: string;
  claudePath: string;
}

export const SUPPORT_DIR = join(HOME, "Library/Application Support/obsidian-claude-assistant");
export const CONFIG_PATH = join(SUPPORT_DIR, "config.json");
export const STATE_PATH = join(SUPPORT_DIR, "state.json");
export const SNAPSHOT_PATH = join(SUPPORT_DIR, "snapshot.json");
export const SCRIPT_PATH = join(SUPPORT_DIR, "assistant.js");
export const LOG_PATH = join(HOME, "Library/Logs/obsidian-claude-assistant.log");

export const DEFAULT_CONFIG: Omit<AssistantConfig, "vault"> = {
  enabled: false,
  time: "08:30",
  days: 30,
  scanRoots: ["~/Desktop"],
  projectFolder: "프로젝트",
  inboxFolder: "받은자료",
  materialsFolder: "자료",
  model: "sonnet",
  claudePath: "",
};

export function expandHome(p: string): string {
  return p.trim().replace(/^~(?=$|\/)/, HOME);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, v: unknown): void {
  mkdirSync(SUPPORT_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2));
}

export function loadConfig(): AssistantConfig | null {
  const c = readJson<Partial<AssistantConfig>>(CONFIG_PATH);
  if (!c?.vault) return null;
  return { ...DEFAULT_CONFIG, ...c, vault: c.vault };
}

export function saveConfig(c: AssistantConfig): void {
  writeJson(CONFIG_PATH, c);
}

export interface AssistantState {
  /** 마지막으로 아침 브리핑을 끝낸 날 (YYYY-MM-DD) */
  lastBriefing?: string;
  lastError?: string;
}

export function loadState(): AssistantState {
  return readJson<AssistantState>(STATE_PATH) ?? {};
}

export function saveState(s: AssistantState): void {
  writeJson(STATE_PATH, s);
}

export function hasSupportDir(): boolean {
  return existsSync(SUPPORT_DIR);
}
