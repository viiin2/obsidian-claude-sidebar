// 10분마다 깨어날 때 지금 무엇을 할지 고릅니다 (순수 함수).
//   아침 브리핑 → 점심 점검 → 저녁 회고, 그 사이엔 몇 시간마다 현황표 새로고침.
// 컴퓨터가 늦게 켜져도 몰아서 다 하지 않게: 저녁 시각이 지났으면 아침은 건너뛰고,
// 점심 점검은 정한 시각부터 3시간 안에만, 아침 브리핑 뒤 2시간이 지난 다음에만 합니다.

export type Slot = "morning" | "midday" | "evening";
export type Job = Slot | "refresh";

export interface SlotConfig {
  time: string;
  middayOn: boolean;
  middayTime: string;
  eveningOn: boolean;
  eveningTime: string;
  /** 0이면 새로고침 안 함 */
  refreshHours: number;
}

export interface SlotState {
  lastBriefing?: string;
  /** ISO 시각 */
  lastBriefingAt?: string;
  lastMidday?: string;
  lastEvening?: string;
  lastRefreshAt?: string;
  /** 마지막 실패 (계속 실패할 때 10분마다 다시 하지 않게) */
  lastFail?: { job: Job; at: string };
}

export const SLOT_LABEL: Record<Slot, string> = { morning: "아침 브리핑", midday: "점심 점검", evening: "저녁 회고" };
export const SLOT_ICON: Record<Slot, string> = { morning: "calendar-check", midday: "sun", evening: "moon" };

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const normHm = (t: string) => t.trim().padStart(5, "0");

function addHours(t: string, h: number): string {
  const [a, b] = normHm(t).split(":").map(Number);
  const m = Math.min(a * 60 + b + h * 60, 23 * 60 + 59);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function hoursSince(iso: string | undefined, now: Date): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Infinity : (now.getTime() - t) / 3600000;
}

const RETRY_HOURS = 1;

export function planTick(cfg: SlotConfig, st: SlotState, now: Date): Job | null {
  const hm = hhmm(now);
  const today = ymd(now);
  const failed = (job: Job) => st.lastFail?.job === job && hoursSince(st.lastFail.at, now) < RETRY_HOURS;
  const morningAt = normHm(cfg.time);
  const eveningAt = normHm(cfg.eveningTime);
  const middayAt = normHm(cfg.middayTime);

  if (cfg.eveningOn && hm >= eveningAt) {
    if (st.lastEvening !== today && !failed("evening")) return "evening";
    return null;
  }
  if (hm < morningAt) return null;
  if (st.lastBriefing !== today) return failed("morning") ? null : "morning";
  if (
    cfg.middayOn &&
    st.lastMidday !== today &&
    hm >= middayAt &&
    hm < addHours(middayAt, 3) &&
    hoursSince(st.lastBriefingAt, now) >= 2 &&
    !failed("midday")
  )
    return "midday";
  if (cfg.refreshHours > 0 && hoursSince(st.lastRefreshAt, now) >= cfg.refreshHours && !failed("refresh")) return "refresh";
  return null;
}

/** 📅 버튼을 눌렀을 때: 지금 시각에 맞는 브리핑 */
export function slotForNow(cfg: SlotConfig, st: SlotState, now: Date): Slot {
  const hm = hhmm(now);
  if (cfg.eveningOn && hm >= normHm(cfg.eveningTime)) return "evening";
  if (st.lastBriefing !== ymd(now)) return "morning";
  if (cfg.middayOn && hm >= normHm(cfg.middayTime)) return "midday";
  return "morning";
}
