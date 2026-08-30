/**
 * 服务器日界/周界工具（M1-R2/M1-R3：全服统一 04:00 日界，服务器本地时区）。
 * 所有「每日/每周」口径（招募刷新重置、心态日回归、奶茶日限、书籍周限）一律经此模块判定。
 */

export const SERVER_DAY_OFFSET_HOUR = 4;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = SERVER_DAY_OFFSET_HOUR * HOUR_MS;

/** 将时刻平移到「日界纪元」：04:00 即新一天的 00:00 */
function shifted(d: Date): Date {
  return new Date(d.getTime() - OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 04:00 为界的日期键 YYYY-MM-DD */
export function dayKey(d: Date): string {
  const s = shifted(d);
  return `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`;
}

/** 04:00 为界日期所属的 ISO 8601 周键 YYYY-Www（周一为一周之始） */
export function weekKey(d: Date): string {
  const s = shifted(d);
  // 以 UTC 计算避免本地时区 DST 干扰；输入已按日界平移
  const date = new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()));
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${thursday.getUTCFullYear()}-W${pad2(week)}`;
}

/** 04:00 为界的日序号：平移后本地午夜的时间戳取整到天（Math.round 吸收 DST 偏移） */
function dayNumber(d: Date): number {
  const s = shifted(d);
  const midnight = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  return Math.round(midnight.getTime() / DAY_MS);
}

/** (from, to] 间跨过的 04:00 日界数量；to ≤ from 恒为 0 */
export function crossedDayBoundaries(from: Date, to: Date): number {
  return Math.max(0, dayNumber(to) - dayNumber(from));
}
