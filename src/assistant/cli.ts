// 비서 실행 파일 (맥은 launchd, 윈도우는 작업 스케줄러가 매일 아침 부릅니다).
//   node assistant.js morning [--force]   아침 브리핑 (이미 했거나 시각 전이면 건너뜀)
//   node assistant.js inbox               받은자료 폴더 정리
//   node assistant.js collect             모은 프로젝트 현황을 JSON으로 출력
//   node assistant.js install|uninstall   매일 아침 자동 실행 등록·해제
//   node assistant.js status              설정·상태 보기

import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { IS_WIN, exec } from "../exec";
import { collect } from "./collect";
import { CONFIG_PATH, LOG_PATH, loadConfig, loadState, saveState } from "./config";
import { formatDate, ymd } from "./datefmt";
import { listInbox, processInbox } from "./inbox";
import { runMorning } from "./morning";
import { SCHEDULE_FILE, installSchedule, scheduleInstalled, uninstallSchedule } from "./schedule";

function log(msg: string): void {
  const line = `[${formatDate(new Date(), "YYYY-MM-DD HH:mm")}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, line + "\n");
  } catch {
    /* 기록 실패는 무시 */
  }
}

function notify(title: string, msg: string): Promise<unknown> {
  if (IS_WIN) {
    // 윈도우 알림 (PowerShell 앱 이름으로 띄움). 따옴표·한글이 깨지지 않게 인코딩해서 넘김
    const ps = (s: string) => s.replace(/'/g, "''");
    const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$x.Item(0).AppendChild($t.CreateTextNode('${ps(title)}')) > $null
$x.Item(1).AppendChild($t.CreateTextNode('${ps(msg)}')) > $null
$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($t))`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded]);
  }
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return exec("osascript", ["-e", `display notification ${q(msg)} with title ${q(title)} sound name "Glass"`]);
}

async function main(): Promise<number> {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const force = rest.includes("--force");
  const cfg = loadConfig();
  if (!cfg) {
    log(`설정이 없어요 (${CONFIG_PATH}). 옵시디언 → Claude Sidebar 설정에서 비서를 켜 주세요.`);
    return 1;
  }

  if (cmd === "collect") {
    console.log(JSON.stringify(await collect(cfg), null, 2));
    return 0;
  }

  if (cmd === "inbox") {
    const items = listInbox(cfg);
    log(`받은자료 ${items.length}개`);
    for (const r of await processInbox(cfg, { log })) if (r.error) log(`실패 ${r.source}: ${r.error}`);
    return 0;
  }

  if (cmd === "install") {
    await installSchedule(cfg.time, __filename);
    log(`매일 ${cfg.time} 실행 등록 → ${SCHEDULE_FILE}`);
    return 0;
  }

  if (cmd === "uninstall") {
    await uninstallSchedule();
    log("자동 실행 해제");
    return 0;
  }

  if (cmd === "status") {
    console.log(JSON.stringify({ config: cfg, state: loadState(), scheduled: scheduleInstalled(), schedule: SCHEDULE_FILE, log: LOG_PATH }, null, 2));
    return 0;
  }

  if (cmd === "morning") {
    const now = new Date();
    const state = loadState();
    if (!force) {
      if (!cfg.enabled) return log("비서가 꺼져 있어 건너뜀"), 0;
      if (state.lastBriefing === ymd(now)) return log("오늘은 이미 했어요"), 0;
      if (formatDate(now, "HH:mm") < cfg.time.padStart(5, "0")) return log(`${cfg.time} 전이라 건너뜀`), 0;
    }
    log("아침 브리핑 시작");
    try {
      const r = await runMorning(cfg, { step: (_, label) => log(`· ${label}`), log });
      const n = r.snapshot.projects.length;
      await notify("오늘 할 일", r.notify || `프로젝트 ${n}개를 살펴봤어요`);
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      log(`실패: ${msg}`);
      saveState({ ...state, lastError: msg });
      await notify("브리핑을 못 만들었어요", msg.slice(0, 80));
      return 1;
    }
  }

  log(`모르는 명령: ${cmd}`);
  return 1;
}

main().then((code) => process.exit(code));
