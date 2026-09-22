/**
 * 学员域共享类型与纯函数（权威：docs/systems/student.md；字段口径：M1-R4）。
 * 命名对齐 Prisma Student 模型：字符串维列名为 str（STRING 维）。
 */

export const QUALITY_TIERS = ['COMMON', 'GOOD', 'ELITE', 'GENIUS'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export const STUDENT_STATUSES = ['ACTIVE', 'DISMISSED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/**
 * 稀疏计数器（Student.counters Json 列，M1-R4）：缺省键即 0。
 * 周期键（`*Key`）是 reset 锚点：04:00 日界 / ISO 周界由使用方在读写时按 clock 工具比对，
 * 键值不匹配即视为 0（见 apps/api/src/modules/items/effects.ts）。
 */
export interface CountersView {
  /** 心流引擎已用台数（每人 1 台） */
  focusEngineUsed?: number;
  /** 当日奶茶杯数（每日 2 杯） */
  milkTea?: number;
  milkTeaKey?: string;
  /** 当日浓咖啡杯数（每日 2 杯） */
  coffeeDaily?: number;
  coffeeDailyKey?: string;
  /** 当日体力药水瓶数（每日 1 瓶） */
  staminaPotionDaily?: number;
  staminaPotionDailyKey?: string;
  /** 本周各直用书科目增益合计（单学员 × 单属性 ≤10 点） */
  bookWeek?: Record<string, number>;
  bookWeekKey?: string;
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
