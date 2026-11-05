// 매일 아침 자동 실행. 옵시디언이 꺼져 있어도 돌아갑니다.
//   macOS   → launchd (정한 시각, 잠자고 있었으면 깨어날 때, 로그인할 때)
//   Windows → 작업 스케줄러 (정한 시각, 놓쳤으면 켜지자마자, 로그인할 때)
// 하루에 여러 번 불려도 cli.ts가 "오늘 이미 했으면 건너뜀"으로 한 번만 돌게 합니다.

import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { HOME, IS_MAC, IS_WIN, exec, findBin } from "../exec";
import { LOG_PATH, SCRIPT_PATH, SUPPORT_DIR } from "./config";
import { ymd } from "./datefmt";

export const LABEL = "local.obsidian-claude-assistant";
const PLIST_PATH = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const WIN_TASK = "ObsidianClaudeAssistant";
const WIN_XML = join(SUPPORT_DIR, "task.xml");
const WIN_VBS = join(SUPPORT_DIR, "run-hidden.vbs");

/** 예약을 확인할 수 있는 파일 (맥: plist, 윈도우: 작업 정의) */
export const SCHEDULE_FILE = IS_WIN ? WIN_XML : PLIST_PATH;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad = (n: number) => String(n).padStart(2, "0");

export function parseTime(t: string): { h: number; m: number } | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? { h, m: mi } : null;
}

export function scheduleSupported(): boolean {
  return IS_MAC || IS_WIN;
}

/** 실행 파일을 볼트 밖으로 복사합니다 (클라우드 동기화가 파일을 내려 버려도 안전하게). */
export function copyScript(source: string): void {
  if (!existsSync(source)) throw new Error(`비서 실행 파일이 없어요: ${source}`);
  mkdirSync(SUPPORT_DIR, { recursive: true });
  const same = existsSync(SCRIPT_PATH) && readFileSync(SCRIPT_PATH).equals(readFileSync(source));
  if (!same) copyFileSync(source, SCRIPT_PATH);
}

// ── macOS ──

function plist(node: string, t: { h: number; m: number }): string {
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
    <key>Hour</key><integer>${t.h}</integer>
    <key>Minute</key><integer>${t.m}</integer>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>${esc(LOG_PATH)}</string>
</dict>
</plist>
`;
}

const macDomain = () => `gui/${process.getuid?.() ?? 501}`;

async function installMac(node: string, t: { h: number; m: number }): Promise<void> {
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(PLIST_PATH, plist(node, t));
  await exec("launchctl", ["bootout", `${macDomain()}/${LABEL}`]);
  const r = await exec("launchctl", ["bootstrap", macDomain(), PLIST_PATH]);
  if (!r.ok) throw new Error(`launchctl: ${r.err.trim()}`);
}

// ── Windows ──

/** 검은 명령 창이 뜨지 않게 wscript로 node를 숨겨서 실행 */
function vbs(node: string): string {
  const q = (s: string) => s.replace(/"/g, '""');
  return `CreateObject("WScript.Shell").Run """${q(node)}"" ""${q(SCRIPT_PATH)}"" morning", 0, False\r\n`;
}

function taskXml(t: { h: number; m: number }): string {
  const user = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Obsidian Claude Sidebar 아침 브리핑</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${ymd(new Date())}T${pad(t.h)}:${pad(t.m)}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${esc(user)}</UserId>
      <Delay>PT1M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${esc(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${esc(WIN_VBS)}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/** 작업 스케줄러와 wscript는 UTF-16(BOM)이어야 한글 경로·설명이 깨지지 않음 */
const utf16 = (s: string) => Buffer.from("﻿" + s.replace(/\r?\n/g, "\r\n"), "utf16le");

async function installWin(node: string, t: { h: number; m: number }): Promise<void> {
  mkdirSync(SUPPORT_DIR, { recursive: true });
  writeFileSync(WIN_VBS, utf16(vbs(node)));
  writeFileSync(WIN_XML, utf16(taskXml(t)));
  const r = await exec("schtasks", ["/Create", "/TN", WIN_TASK, "/XML", WIN_XML, "/F"]);
  if (!r.ok) {
    unlinkSync(WIN_XML);
    throw new Error(`작업 스케줄러: ${r.err.trim() || r.out.trim()}`);
  }
  // 맥의 RunAtLoad처럼 켜자마자 한 번 (오늘 시각이 지났고 아직 안 했으면 바로 브리핑)
  await exec("schtasks", ["/Run", "/TN", WIN_TASK]);
}

// ── 공통 ──

export async function installSchedule(time: string, scriptSource: string): Promise<void> {
  if (!scheduleSupported()) throw new Error("자동 실행은 macOS와 Windows에서만 돼요");
  const t = parseTime(time);
  if (!t) throw new Error(`시각 형식이 이상해요: ${time} (예: 08:30)`);
  const node = findBin("node");
  if (!node) throw new Error("Node.js를 찾지 못했어요 (https://nodejs.org 에서 설치)");
  copyScript(scriptSource);
  if (IS_WIN) await installWin(node, t);
  else await installMac(node, t);
}

export async function uninstallSchedule(): Promise<void> {
  if (IS_WIN) {
    await exec("schtasks", ["/Delete", "/TN", WIN_TASK, "/F"]);
    if (existsSync(WIN_XML)) unlinkSync(WIN_XML);
    return;
  }
  await exec("launchctl", ["bootout", `${macDomain()}/${LABEL}`]);
  if (existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
}

export function scheduleInstalled(): boolean {
  return existsSync(SCHEDULE_FILE);
}
