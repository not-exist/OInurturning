/**
 * 学员域共享类型与纯函数（权威：docs/systems/student.md；字段口径：M1-R4）。
 * 命名对齐 Prisma Student 模型：字符串维列名为 str（STRING 维）。
 */

export const SEXES = ['MALE', 'FEMALE'] as const;
export type Sex = (typeof SEXES)[number];

export const QUALITY_TIERS = ['COMMON', 'GOOD', 'ELITE', 'GENIUS'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export const STUDENT_STATUSES = ['ACTIVE', 'DISMISSED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/**
 * 稀疏计数器（Student.counters Json 列，M1-R4）：缺省键即 0。
 * milkTea 为当日键（每日限 2 杯，04:00 日界重置）、bookWeek 为本周直用书增益合计（≤10，周界重置），
 * 周期锚点由使用方在读写时按 clock 工具比对并重置。
 */
export interface CountersView {
  reroll?: number; // 洗练保底计数（≥20 触发保底后清零）
  vigorUsed?: number; // 精力药剂已用次数（每人最多 3 次）
  focusEngineUsed?: number; // 心流引擎已用次数（每人最多 2 次）
  milkTea?: number; // 当日奶茶杯数（每日限 2）
  bookWeek?: number; // 本周书籍增益合计（每周 ≤ 10 点）
}

/** V 值计算输入：六维 + code/thinking（student.md §1） */
export interface VStats {
  ds: number;
  dp: number;
  math: number;
  graph: number;
  greedy: number;
  str: number;
  code: number;
  thinking: number;
}

/**
 * 综合评定值 V = floor((code + thinking + floor(六维均值)) / 3)。
 * 纯展示与门槛判定用（讲课受众门槛/招募建议/列表排序），任何奖励结算不得直接引用。
 */
export function computeV(s: VStats): number {
  const dimAvg = Math.floor((s.ds + s.dp + s.math + s.graph + s.greedy + s.str) / 6);
  return Math.floor((s.code + s.thinking + dimAvg) / 3);
}

/** 学员 API 视图：能力值为浮点累积原值（展示层 floor），v 为导出时的计算结果 */
export interface StudentView {
  id: number;
  name: string;
  sex: Sex;
  qualityTier: QualityTier;
  status: StudentStatus;
  ds: number;
  dp: number;
  math: number;
  graph: number;
  greedy: number;
  str: number;
  code: number;
  thinking: number;
  setting: number;
  mindset: number;
  focusCap: number;
  energyMax: number;
  energy: number;
  stamina: number;
  staminaRegen: number;
  counters: CountersView;
  talents: string[]; // 持有天赋 id 列表
  v: number;
  recruitedAt: string; // ISO 8601
  dismissedAt: string | null;
}
