import type { Student } from '../../generated/prisma/client.js';
import { damping } from '../../lib/damping.js';
import {
  ABILITY_COLUMN,
  clamp,
  DIMENSION_CONFIG,
  type ConfigDimension,
  type DimensionColumn,
  type DimensionKey,
  type RareGain,
  type RareGainStat,
  type TrainingKind,
} from '@oinur/shared';
import type { MetaAggregate } from '../students/meta.js';

/**
 * 训练增益纯计算（M1 Task 6，权威：docs/systems/student.md §4）。
 * 本模块不落库、不持有 DB 句柄，只负责把 student.md 的收益/费用/附带成长概率表
 * 具象为可单测的纯函数；随机性一律经注入的 rng()（缺省由服务层提供密码学种子）。
 */

/** 三种训练的主收益 base（student.md §4.2；economy.yaml 只管辖钱与体力，base 归本域） */
export const TRAINING_BASE: Record<TrainingKind, number> = {
  basic: 1.6,
  directed: 2.0,
  specialized: 3.2,
};

/** 定向训练 BookMult：书稀有度→倍率（student.md §4.4，五档） */
export const BOOK_MULT: Record<string, number> = {
  gray: 1.0,
  yellow: 1.25,
  green: 1.5,
  blue: 1.75,
  purple: 2.0,
};

/** 专项训练 QualityMult：题稀有度→倍率（student.md §4.2，六档） */
export const QUALITY_MULT: Record<string, number> = {
  gray: 1.0,
  yellow: 1.1,
  green: 1.2,
  blue: 1.3,
  purple: 1.45,
  colorful: 1.6,
};

/**
 * 维度索引表：请求/题库 dominantDim 用大写键（DIMENSIONS），映射到
 * Student 列名（共享桥 ABILITY_COLUMN，string 维列名 str）、六维书 subject 键
 * （配置 wire 名，DIMENSION_CONFIG）与 meta 键后缀（student.md 字段口径 M1-R4）。
 */
export const DIM_META: Record<
  DimensionKey,
  { column: DimensionColumn; bookSubject: ConfigDimension; metaKey: string }
> = {
  DS: { column: ABILITY_COLUMN.DS, bookSubject: DIMENSION_CONFIG.DS, metaKey: 'training_ds' },
  DP: { column: ABILITY_COLUMN.DP, bookSubject: DIMENSION_CONFIG.DP, metaKey: 'training_dp' },
  MATH: {
    column: ABILITY_COLUMN.MATH,
    bookSubject: DIMENSION_CONFIG.MATH,
    metaKey: 'training_math',
  },
  GRAPH: {
    column: ABILITY_COLUMN.GRAPH,
    bookSubject: DIMENSION_CONFIG.GRAPH,
    metaKey: 'training_graph',
  },
  GREEDY: {
    column: ABILITY_COLUMN.GREEDY,
    bookSubject: DIMENSION_CONFIG.GREEDY,
    metaKey: 'training_greedy',
  },
  STRING: {
    column: ABILITY_COLUMN.STRING,
    bookSubject: DIMENSION_CONFIG.STRING,
    metaKey: 'training_string',
  },
};

/** 主收益公式 Δ（student.md §4.3）：浮点累积；cur≥100 计 0 */
export function computeDelta(o: {
  base: number;
  bookMult: number;
  qualityMult: number;
  meta: MetaAggregate;
  dimMetaKey: string;
  cur: number;
}): number {
  if (o.cur >= 100) return 0;
  const allMult = 1 + (o.meta.training_all ?? 0) / 100;
  const dimMult = 1 + (o.meta[o.dimMetaKey] ?? 0) / 100;
  return o.base * o.bookMult * o.qualityMult * allMult * dimMult * damping(o.cur);
}

/** 单次训练费用：round(money_base × (1 + coeff×(N−1)))（economy.yaml；N=在册学员数） */
export function computeCost(o: {
  moneyBase: number;
  coeff: number;
  ownedStudents: number;
}): number {
  return Math.round(o.moneyBase * (1 + o.coeff * (o.ownedStudents - 1)));
}

/** 附带成长「额外 +1」概率表（student.md §4.5）：基础/定向/专项三列 */
export const SECONDARY_PROB: Record<'code' | 'thinking', Record<TrainingKind, number>> = {
  code: { basic: 0.2, directed: 0.35, specialized: 0.3 },
  thinking: { basic: 0.2, directed: 0.35, specialized: 0.4 },
};

/** 四项极低概率成长（student.md §4.5）：概率、目标列、上限（cap 下限统一 0；心态专用下限 −10） */
const ULTRA_RARE: { stat: RareGainStat; prob: number; column: NumericGainColumn; cap: number }[] = [
  { stat: 'setting', prob: 0.02, column: 'setting', cap: 100 },
  { stat: 'mindset', prob: 0.03, column: 'mindset', cap: 10 },
  { stat: 'focus_cap', prob: 0.008, column: 'focusCap', cap: 100 },
  { stat: 'stamina_regen', prob: 0.005, column: 'staminaRegen', cap: 100 },
];

/** 附带成长可写入的数值列集合（全部为 Student 的 number 属性） */
export type NumericGainColumn =
  'code' | 'thinking' | 'setting' | 'mindset' | 'focusCap' | 'staminaRegen';

export interface SecondaryGainsResult {
  /** 需写回学员的附带成长字段增补（含超上限截断后的值） */
  patch: Partial<Record<NumericGainColumn, number>>;
  /** 实际生效的附带成长清单（仅列增量>0 者） */
  rareGains: RareGain[];
}

/**
 * 附带成长判定（student.md §4.5）：
 * - code/thinking：概率表×type，修饰 ×(1+training_* /100)，+1 经 (1−cur/100)^2 阻尼后浮点累积；
 * - 四项极低概率：不受加成、无阻尼（仅心态 clamp +10、其余 clamp 100）。
 * rng 消费顺序固定：code → thinking → setting → mindset → focus_cap → stamina_regen。
 */
export function computeSecondaryGains(o: {
  type: TrainingKind;
  student: Student;
  meta: MetaAggregate;
  rng: () => number;
}): SecondaryGainsResult {
  const { type, student: s, meta, rng } = o;
  const patch: Partial<Student> = {};
  const rareGains: RareGain[] = [];

  const codeProb = SECONDARY_PROB.code[type] * (1 + (meta.training_code ?? 0) / 100);
  if (rng() < codeProb && s.code < 100) {
    const gain = damping(s.code);
    const next = clamp(s.code + gain, 0, 100);
    const amount = next - s.code;
    if (amount > 0) {
      patch.code = next;
      rareGains.push({ stat: 'code', amount });
    }
  }

  const thinkProb = SECONDARY_PROB.thinking[type] * (1 + (meta.training_thinking ?? 0) / 100);
  if (rng() < thinkProb && s.thinking < 100) {
    const gain = damping(s.thinking);
    const next = clamp(s.thinking + gain, 0, 100);
    const amount = next - s.thinking;
    if (amount > 0) {
      patch.thinking = next;
      rareGains.push({ stat: 'thinking', amount });
    }
  }

  for (const { stat, prob, column, cap } of ULTRA_RARE) {
    const cur = s[column] as number;
    if (rng() < prob && cur < cap) {
      const next = clamp(cur + 1, stat === 'mindset' ? -10 : 0, cap);
      patch[column] = next;
      rareGains.push({ stat, amount: next - cur });
    }
  }

  return { patch, rareGains };
}
