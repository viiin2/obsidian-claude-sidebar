// 매일 아침 자동 실행 (macOS launchd). 옵시디언이 꺼져 있어도 돌아갑니다.
// - 정한 시각에 실행, 그 시각에 맥이 잠자고 있었으면 깨어날 때 실행
// - 로그인할 때도 한 번 확인 (이미 했거나 시각 전이면 건너뜀)

import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { HOME, exec, findBin } from "../exec";
import { LOG_PATH, SCRIPT_PATH, SUPPORT_DIR } from "./config";

export const LABEL = "local.obsidian-claude-assistant";
export const PLIST_PATH = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function parseTime(t: string): { h: number; m: number } | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? { h, m: mi } : null;
}

function plist(node: string, time: { h: number; m: number }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(node)}</string>
    <string>${esc(SCRIPT_PATH)}</string>
    <string>morning</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${time.h}</integer>
    <key>Minute</key><integer>${time.m}</integer>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${esc(LOG_PATH)}</string>
  <key>StandardErrorPath</key><string>${esc(LOG_PATH)}</string>
</dict>
</plist>
`;
}

const domain = () => `gui/${process.getuid?.() ?? 501}`;

/** 실행 파일을 볼트 밖으로 복사합니다 (iCloud가 파일을 내려 버려도 안전하게). */
export function copyScript(source: string): void {
  if (!existsSync(source)) throw new Error(`비서 실행 파일이 없어요: ${source}`);
  mkdirSync(SUPPORT_DIR, { recursive: true });
  const same = existsSync(SCRIPT_PATH) && readFileSync(SCRIPT_PATH).equals(readFileSync(source));
  if (!same) copyFileSync(source, SCRIPT_PATH);
}

export async function installSchedule(time: string, scriptSource: string): Promise<void> {
  const t = parseTime(time);
  if (!t) throw new Error(`시각 형식이 이상해요: ${time} (예: 08:30)`);
  const node = findBin("node");
  if (!node) throw new Error("Node.js를 찾지 못했어요");
  copyScript(scriptSource);
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(PLIST_PATH, plist(node, t));
  await exec("launchctl", ["bootout", `${domain()}/${LABEL}`]);
  const r = await exec("launchctl", ["bootstrap", domain(), PLIST_PATH]);
  if (!r.ok) throw new Error(`launchctl: ${r.err.trim()}`);
}

export async function uninstallSchedule(): Promise<void> {
  await exec("launchctl", ["bootout", `${domain()}/${LABEL}`]);
  if (existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
}

export function scheduleInstalled(): boolean {
  return existsSync(PLIST_PATH);
}
