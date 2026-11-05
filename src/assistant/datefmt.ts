// 데일리 노트 파일 이름용 날짜 형식 (moment 형식의 자주 쓰는 부분만).

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(d: Date, fmt: string): string {
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|dddd|ddd|HH|mm/g, (tok, lit) => {
    if (lit !== undefined) return lit;
    switch (tok) {
      case "YYYY": return String(d.getFullYear());
      case "YY": return String(d.getFullYear()).slice(-2);
      case "MM": return pad(d.getMonth() + 1);
      case "M": return String(d.getMonth() + 1);
      case "DD": return pad(d.getDate());
      case "D": return String(d.getDate());
      case "dddd": return DAYS[d.getDay()] + "요일";
      case "ddd": return DAYS[d.getDay()];
      case "HH": return pad(d.getHours());
      case "mm": return pad(d.getMinutes());
      default: return tok;
    }
  });
}

export const ymd = (d: Date) => formatDate(d, "YYYY-MM-DD");

export function daysAgo(n: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

/** "2026-11-04" → 오늘 / 어제 / 3일 전 */
export function relDay(date: string, today: string): string {
  if (!date) return "-";
  const diff = Math.round((Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000);
  if (diff <= 0) return "오늘";
  if (diff === 1) return "어제";
  return `${diff}일 전`;
}
