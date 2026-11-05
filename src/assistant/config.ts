// 비서 설정과 상태 파일. 옵시디언이 꺼져 있어도 아침 작업이 읽을 수 있도록
// 볼트 밖(~/Library/Application Support)에 둡니다. 옵시디언 설정 화면이 이 파일을 씁니다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HOME, IS_WIN } from "../exec";
import type { SlotState } from "./slots";

export interface AssistantConfig {
  vault: string;
  enabled: boolean;
  /** 아침 브리핑 시각 "HH:MM" */
  time: string;
  /** 점심 점검: 오전에 한 것을 보고 오후 할 일을 다시 고름 */
  middayOn: boolean;
  middayTime: string;
  /** 저녁 회고: 오늘 한 것 정리, 내일 이어갈 것 */
  eveningOn: boolean;
  eveningTime: string;
  /** 몇 시간마다 현황표·진행도 새로고침 (Claude 안 씀, 0이면 끔) */
  refreshHours: number;
  /** 일정 시각 15분 전에 알림 */
  remind: boolean;
  /** 일정 목록 노트 (볼트 기준) */
  agendaFile: string;
  /** 루틴 노트 (볼트 기준) */
  routineFile: string;
  /** 애플 캘린더 연동 (맥): 일정을 할 일에 붙이고, 시각이 있는 일정은 캘린더에 넣음 */
  calendarOn: boolean;
  /** 말한 일정을 넣을 캘린더 id (비면 기본 캘린더) */
  calendarId: string;
  /** 넣은 일정의 알림: 몇 분 전 */
  calendarAlarm: number;
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

/** 테스트할 때는 CLAUDE_ASSISTANT_HOME 으로 다른 폴더를 쓰게 할 수 있음 (진짜 설정을 건드리지 않게) */
const TEST_HOME = process.env.CLAUDE_ASSISTANT_HOME;
export const SUPPORT_DIR = TEST_HOME
  ? TEST_HOME
  : IS_WIN
  ? join(process.env.APPDATA ?? join(HOME, "AppData", "Roaming"), "obsidian-claude-assistant")
  : join(HOME, "Library/Application Support/obsidian-claude-assistant");
export const CONFIG_PATH = join(SUPPORT_DIR, "config.json");
export const STATE_PATH = join(SUPPORT_DIR, "state.json");
export const SNAPSHOT_PATH = join(SUPPORT_DIR, "snapshot.json");
export const SCRIPT_PATH = join(SUPPORT_DIR, "assistant.js");
export const LOG_PATH = IS_WIN || TEST_HOME ? join(SUPPORT_DIR, "assistant.log") : join(HOME, "Library/Logs/obsidian-claude-assistant.log");

export const DEFAULT_CONFIG: Omit<AssistantConfig, "vault"> = {
  enabled: false,
  time: "08:30",
  middayOn: true,
  middayTime: "13:00",
  eveningOn: true,
  eveningTime: "21:00",
  refreshHours: 2,
  remind: true,
  agendaFile: "일정.md",
  routineFile: "루틴.md",
  calendarOn: false,
  calendarId: "",
  calendarAlarm: 15,
  days: 30,
  // 윈도우: 바탕화면(OneDrive로 옮겨진 경우 포함), GitHub Desktop, Visual Studio 기본 위치
  scanRoots: IS_WIN
    ? ["~/Desktop", "~/OneDrive/Desktop", "~/OneDrive/바탕 화면", "~/Documents/GitHub", "~/source/repos"]
    : ["~/Desktop"],
  projectFolder: "프로젝트",
  inboxFolder: "받은자료",
  materialsFolder: "자료",
  model: "sonnet",
  claudePath: "",
};

export function expandHome(p: string): string {
  return p.trim().replace(/^~(?=$|[\\/])/, HOME);
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

export interface AssistantState extends SlotState {
  /** 마지막 오류 (설정 화면에 보여 줌) */
  lastError?: string;
  /** 이미 알림을 보낸 일정 ("날짜 시각 할 일") */
  reminded?: string[];
  /** 실패 알림을 보낸 날·작업 (같은 실패로 여러 번 알리지 않게) */
  failNotified?: string;
}

/** 상태 파일의 일부만 바꿔 저장 (다른 작업이 쓴 값은 그대로) */
export function patchState(p: Partial<AssistantState>): AssistantState {
  const next = { ...loadState(), ...p };
  saveState(next);
  return next;
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
