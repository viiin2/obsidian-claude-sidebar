// 비서 실행 파일 (맥은 launchd, 윈도우는 작업 스케줄러가 10분마다 `tick` 으로 부릅니다).
//   node assistant.js tick                    지금 할 일을 골라서 함 (일정 알림 → 일정 맞추기 → 브리핑·새로고침)
//   node assistant.js morning|midday|evening  아침 브리핑·점심 점검·저녁 회고 바로 하기
//   node assistant.js refresh                 현황표·진행도만 새로고침 (Claude 안 씀)
//   node assistant.js inbox                   받은자료 폴더 정리
//   node assistant.js collect                 모은 프로젝트 현황을 JSON으로 출력
//   node assistant.js install|uninstall       자동 실행 등록·해제
//   node assistant.js status                  설정·상태 보기

import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { IS_WIN, exec } from "../exec";
import { dueReminders, reminderKey, shiftDate } from "./agenda";
import { BriefResult, loadAgenda, loadRoutines, refreshCalendar, routineStatus, runRefresh, runSlot, syncAgenda } from "./briefing";
import { routinesOn } from "./routines";
import { collect } from "./collect";
import { AssistantConfig, CONFIG_PATH, LOG_PATH, loadConfig, loadState, patchState } from "./config";
import { formatDate, ymd } from "./datefmt";
import { listInbox, processInbox } from "./inbox";
import { SCHEDULE_FILE, installSchedule, scheduleInstalled, uninstallSchedule } from "./schedule";
import { Job, SLOT_LABEL, Slot, planTick } from "./slots";

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
  // 테스트(CLAUDE_ASSISTANT_HOME) 중엔 진짜 알림 대신 기록만
  if (process.env.CLAUDE_ASSISTANT_HOME) return Promise.resolve(log(`[알림] ${title} · ${msg}`));
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

const NOTIFY_TITLE: Record<Slot, string> = { morning: "오늘 할 일", midday: "오후 점검", evening: "오늘 회고" };

async function runJob(cfg: AssistantConfig, job: Job): Promise<number> {
  const today = ymd(new Date());
  try {
    if (job === "refresh") {
      await runRefresh(cfg, { log: () => undefined });
      return 0;
    }
    log(`${SLOT_LABEL[job]} 시작`);
    const r: BriefResult = await runSlot(cfg, job, { step: (_, label) => log(`· ${label}`), log });
    await notify(NOTIFY_TITLE[job], r.notify || `${SLOT_LABEL[job]}을 데일리 노트에 썼어요`);
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    log(`실패 (${job}): ${msg}`);
    const key = `${today}:${job}`;
    const st = patchState({ lastError: msg, lastFail: { job, at: new Date().toISOString() } });
    // 같은 실패는 하루에 한 번만 알림 (새로고침 실패는 알리지 않음)
    if (job !== "refresh" && st.failNotified !== key) {
      patchState({ failNotified: key });
      await notify(`${SLOT_LABEL[job]}을 못 만들었어요`, msg.slice(0, 80));
    }
    return 1;
  }
}

/** 시각이 된 일정·루틴 알림 (이미 체크한 루틴은 알리지 않음) */
async function remind(cfg: AssistantConfig, now: Date): Promise<void> {
  const st = loadState();
  const sent = st.reminded ?? [];
  const today = ymd(now);
  const timed = routinesOn(loadRoutines(cfg), today).filter((r) => r.time);
  const routines = timed.length
    ? routineStatus(cfg, now, timed).map((x) => ({ date: today, time: x.r.time, text: `🔁 ${x.r.text}`, done: x.today === true }))
    : [];
  const due = dueReminders([...loadAgenda(cfg), ...routines], now, sent);
  if (!due.length) return;
  for (const it of due) {
    await notify(`⏰ ${it.time}`, it.text);
    log(`알림: ${it.time} ${it.text}`);
  }
  const yesterday = shiftDate(ymd(now), -1);
  const keep = [...sent, ...due.map(reminderKey)].filter((k) => k.slice(0, 10) >= yesterday);
  patchState({ reminded: keep });
}

async function tick(cfg: AssistantConfig): Promise<number> {
  if (!cfg.enabled) return 0;
  const now = new Date();
  if (cfg.remind) await remind(cfg, now).catch((e) => log(`알림 실패: ${(e as Error).message}`));
  await refreshCalendar(cfg, now, false, log);
  try {
    syncAgenda(cfg, now);
  } catch (e) {
    log(`일정 맞추기 실패: ${(e as Error).message}`);
  }
  const job = planTick(cfg, loadState(), now);
  return job ? runJob(cfg, job) : 0;
}

async function main(): Promise<number> {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const force = rest.includes("--force");
  const cfg = loadConfig();
  if (!cfg) {
    log(`설정이 없어요 (${CONFIG_PATH}). 옵시디언 → Claude Sidebar 설정에서 비서를 켜 주세요.`);
    return 1;
  }

  switch (cmd) {
    case "tick":
      return tick(cfg);

    case "morning":
    case "midday":
    case "evening": {
      // 예전 예약(매일 아침 `morning`)과도 맞게: --force 없으면 꺼져 있거나 이미 했으면 건너뜀
      if (!force) {
        if (!cfg.enabled) return log("비서가 꺼져 있어 건너뜀"), 0;
        const st = loadState();
        const done = { morning: st.lastBriefing, midday: st.lastMidday, evening: st.lastEvening }[cmd];
        if (done === ymd(new Date())) return log("오늘은 이미 했어요"), 0;
        const at = { morning: cfg.time, midday: cfg.middayTime, evening: cfg.eveningTime }[cmd].padStart(5, "0");
        if (formatDate(new Date(), "HH:mm") < at) return log(`${at} 전이라 건너뜀`), 0;
      }
      return runJob(cfg, cmd);
    }

    case "refresh":
      await runRefresh(cfg, { log });
      log("새로고침 끝");
      return 0;

    case "collect":
      console.log(JSON.stringify(await collect(cfg), null, 2));
      return 0;

    case "inbox": {
      log(`받은자료 ${listInbox(cfg).length}개`);
      for (const r of await processInbox(cfg, { log })) if (r.error) log(`실패 ${r.source}: ${r.error}`);
      return 0;
    }

    case "install":
      await installSchedule(__filename);
      log(`자동 실행 등록 → ${SCHEDULE_FILE}`);
      return 0;

    case "uninstall":
      await uninstallSchedule();
      log("자동 실행 해제");
      return 0;

    case "status":
      console.log(JSON.stringify({ config: cfg, state: loadState(), scheduled: scheduleInstalled(), schedule: SCHEDULE_FILE, log: LOG_PATH }, null, 2));
      return 0;
  }

  log(`모르는 명령: ${cmd}`);
  return 1;
}

main().then((code) => process.exit(code));
