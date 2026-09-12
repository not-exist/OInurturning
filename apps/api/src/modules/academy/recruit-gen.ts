import {
  CONFIG_RARITIES,
  type ConfigRarity,
  type EconomyRecruitment,
  type TalentDef,
} from '@oinur/shared';
import type { QualityTier, Sex } from '@prisma/client';
import { pickName } from './name-pool.js';

/**
 * 招募候选生成（权威：docs/systems/student.md §3.2–3.6；协调者裁定 M1-R1/R2/R3）。
 * 全部函数为纯函数：rng/声誉/天赋表/经济配置一律注入，种子随机可复现（lib/rng mulberry32）。
 * 属性期望表（§3.3）、天赋数量/稀有度表（§3.4）为 student.md 权威数值，无 yaml 数据源，按惯例内嵌；
 * 一切钱数值（招募费/刷新费）从 CONFIG.economy.recruitment 读，禁止硬编码。
 */

export type GenQuality = 'common' | 'good' | 'elite' | 'genius';

export const QUALITY_TO_TIER: Record<GenQuality, QualityTier> = {
  common: 'COMMON',
  good: 'GOOD',
  elite: 'ELITE',
  genius: 'GENIUS',
};

export const TIER_TO_QUALITY: Record<QualityTier, GenQuality> = {
  COMMON: 'common',
  GOOD: 'good',
  ELITE: 'elite',
  GENIUS: 'genius',
};

/** §3.6 模糊气质提示（招募前只显示提示，防精确挑选） */
export const QUALITY_HINTS: Record<GenQuality, string> = {
  common: '气质普通',
  good: '气质普通',
  elite: '身手不凡',
  genius: '锋芒毕露',
};

// ── §3.3 基础属性期望值表（E±δ，整数均匀掷点，区间截断 [1,100]） ──

interface AttrSpec {
  e: number;
  d: number;
}

interface QualityAttrTable {
  dim: AttrSpec; // 六维各自
  code: AttrSpec;
  thinking: AttrSpec;
  setting: AttrSpec;
  focusCap: AttrSpec;
  energyMax: AttrSpec;
  staminaRegen: AttrSpec;
}

/** §3.3 基础属性期望值表（E±δ，整数均匀掷点，区间截断 [1,100]）。
 *  导出供 T5.2 数值回归（balance-regression）读取招募基线期望，保证单一事实源。 */
export const ATTR_TABLE: Record<GenQuality, QualityAttrTable> = {
  common: {
    dim: { e: 8, d: 4 },
    code: { e: 7, d: 3 },
    thinking: { e: 8, d: 4 },
    setting: { e: 3, d: 2 },
    focusCap: { e: 45, d: 5 },
    energyMax: { e: 55, d: 5 },
    staminaRegen: { e: 48, d: 3 },
  },
  good: {
    dim: { e: 14, d: 5 },
    code: { e: 13, d: 4 },
    thinking: { e: 15, d: 5 },
    setting: { e: 6, d: 3 },
    focusCap: { e: 50, d: 5 },
    energyMax: { e: 62, d: 5 },
    staminaRegen: { e: 50, d: 3 },
  },
  elite: {
    dim: { e: 22, d: 6 },
    code: { e: 20, d: 5 },
    thinking: { e: 24, d: 6 },
    setting: { e: 10, d: 4 },
    focusCap: { e: 58, d: 6 },
    energyMax: { e: 70, d: 5 },
    staminaRegen: { e: 52, d: 3 },
  },
  genius: {
    dim: { e: 32, d: 8 },
    code: { e: 28, d: 7 },
    thinking: { e: 35, d: 8 },
    setting: { e: 16, d: 5 },
    focusCap: { e: 66, d: 6 },
    energyMax: { e: 78, d: 6 },
    staminaRegen: { e: 54, d: 3 },
  },
};

// ── §3.4 天赋数量与稀有度分布（百分比权重） ──

const TALENT_COUNT_WEIGHTS: Record<GenQuality, readonly number[]> = {
  // 下标 = 天赋个数（0..3）
  common: [70, 30, 0, 0],
  good: [45, 50, 5, 0],
  elite: [25, 55, 18, 2],
  genius: [0, 40, 42, 18],
};

/** 追加槽（genius 第 1 槽以外）稀有度权重：灰/黄/绿/蓝/紫/彩 */
const RARITY_WEIGHTS: Record<GenQuality, readonly number[]> = {
  common: [55, 40, 5, 0, 0, 0],
  good: [35, 45, 18, 2, 0, 0],
  elite: [20, 35, 32, 11, 2, 0],
  genius: [25, 30, 25, 15, 4.5, 0.5],
};

/** genius 第 1 槽保底：绿 55 / 蓝 33 / 紫 10 / 彩 2（保证绿及以上） */
const GENIUS_FIRST_SLOT: Readonly<Partial<Record<ConfigRarity, number>>> = {
  green: 55,
  blue: 33,
  purple: 10,
  colorful: 2,
};

// ── 掷点基础 ──

function randint(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function clampAttr(v: number): number {
  return Math.min(100, Math.max(1, v));
}

/** 按权重表抽下标；weights 无需归一化 */
function weightedIndex(rng: () => number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

// ── §3.2 品质档 ──

/**
 * 品质档归一化权重（导出供统计脚本与单调性测试）。
 * r = min(声誉, 8000)/8000；common ×(1−0.25r) / good ×(1+0.10r) / elite ×(1+0.60r) / genius ×(1+1.20r)。
 */
export function qualityWeights(reputation: number): Record<GenQuality, number> {
  const r = Math.min(Math.max(reputation, 0), 8000) / 8000;
  const raw: Record<GenQuality, number> = {
    common: 55 * (1 - 0.25 * r),
    good: 30 * (1 + 0.1 * r),
    elite: 12 * (1 + 0.6 * r),
    genius: 3 * (1 + 1.2 * r),
  };
  const total = raw.common + raw.good + raw.elite + raw.genius;
  return {
    common: raw.common / total,
    good: raw.good / total,
    elite: raw.elite / total,
    genius: raw.genius / total,
  };
}

export function rollQuality(rng: () => number, reputation: number): GenQuality {
  const w = qualityWeights(reputation);
  const i = weightedIndex(rng, [w.common, w.good, w.elite, w.genius]);
  return (['common', 'good', 'elite', 'genius'] as const)[i]!;
}

// ── §3.5 声誉属性加成 ──

/** E' = round(E × (1 + 0.15×min(声誉,6000)/6000))，仅作用于六维/code/thinking/setting */
export function repAdjustedE(e: number, reputation: number): number {
  const mult = 1 + (0.15 * Math.min(Math.max(reputation, 0), 6000)) / 6000;
  return Math.round(e * mult);
}

function rollAttr(rng: () => number, spec: AttrSpec, e: number): number {
  return clampAttr(randint(rng, e - spec.d, e + spec.d));
}

// ── §3.4 天赋抽取 ──

export interface TalentBuckets {
  byRarity: Readonly<Record<ConfigRarity, readonly TalentDef[]>>;
}

export function bucketTalents(talents: Record<string, TalentDef>): TalentBuckets {
  const byRarity = Object.fromEntries(CONFIG_RARITIES.map((r) => [r, [] as TalentDef[]])) as Record<
    ConfigRarity,
    TalentDef[]
  >;
  for (const t of Object.values(talents)) byRarity[t.rarity].push(t);
  for (const r of CONFIG_RARITIES) byRarity[r].sort((a, b) => a.id.localeCompare(b.id));
  return { byRarity };
}

/**
 * 按权重抽稀有度并均匀抽一条天赋。
 * 权重为 0 或该档无条目的稀有度被剔除后对剩余权重归一化（生产配置六档齐全时即为原表）；
 * 全部候选档皆空（如最小测试 fixtures）返回 null。
 */
function drawTalent(
  rng: () => number,
  weights: Readonly<Partial<Record<ConfigRarity, number>>>,
  buckets: TalentBuckets,
  exclude: ReadonlySet<string>,
): TalentDef | null {
  const entries = CONFIG_RARITIES.flatMap((r) => {
    const w = weights[r] ?? 0;
    const pool = buckets.byRarity[r].filter((t) => !exclude.has(t.id));
    return w > 0 && pool.length > 0 ? [{ rarity: r, w, pool }] : [];
  });
  if (entries.length === 0) return null;
  const i = weightedIndex(
    rng,
    entries.map((e) => e.w),
  );
  const pool = entries[i]!.pool;
  return pool[Math.floor(rng() * pool.length)]!;
}

/** 掷天赋并返回 id 列表（同一学员不重复；genius 第 1 槽绿+保底） */
export function rollTalentIds(
  rng: () => number,
  quality: GenQuality,
  buckets: TalentBuckets,
): string[] {
  const count = weightedIndex(rng, TALENT_COUNT_WEIGHTS[quality]);
  const ids: string[] = [];
  const held = new Set<string>();
  for (let slot = 0; slot < count; slot++) {
    const weights: Readonly<Partial<Record<ConfigRarity, number>>> =
      quality === 'genius' && slot === 0
        ? GENIUS_FIRST_SLOT
        : Object.fromEntries(CONFIG_RARITIES.map((r, i) => [r, RARITY_WEIGHTS[quality][i]!]));
    const t = drawTalent(rng, weights, buckets, held);
    if (!t) break;
    held.add(t.id);
    ids.push(t.id);
  }
  return ids;
}

// ── 招募费（economy.yaml 权威；数值一律从注入的 recruitment 配置读） ──

/** round(recruit_base × recruit_growth^N) × quality_mult，结果取整（Money 为整数） */
export function recruitPrice(
  recruitment: Pick<EconomyRecruitment, 'recruit_base' | 'recruit_growth' | 'quality_mult'>,
  ownedStudents: number,
  quality: GenQuality,
): number {
  const base = Math.round(recruitment.recruit_base * recruitment.recruit_growth ** ownedStudents);
  return Math.round(base * recruitment.quality_mult[quality]);
}

/** 当日第 k 次手动刷新（k 从 0 计）：round(refresh_base × refresh_growth^k)，封顶 daily_price_cap */
export function refreshPrice(
  manualRefresh: Pick<
    EconomyRecruitment['manual_refresh'],
    'refresh_base' | 'refresh_growth' | 'daily_price_cap'
  >,
  refreshesDoneToday: number,
): number {
  const raw = Math.round(
    manualRefresh.refresh_base * manualRefresh.refresh_growth ** refreshesDoneToday,
  );
  return Math.min(raw, manualRefresh.daily_price_cap);
}

// ── 候选生成 ──

export interface CandidateAttrs {
  ds: number;
  dp: number;
  math: number;
  graph: number;
  greedy: number;
  str: number;
  code: number;
  thinking: number;
  setting: number;
  focusCap: number;
  energyMax: number;
  staminaRegen: number;
}

/** RecruitPool.candidates Json 元素（price 为生成时快照，招募时按当时在册数重算） */
export interface CandidatePayload {
  tempId: string;
  name: string;
  sex: Sex;
  qualityTier: QualityTier;
  hint: string;
  attrs: CandidateAttrs;
  talents: { talentId: string }[];
  price: number;
}

export interface GenerateContext {
  reputation: number;
  /** 生成时的在册学员数（price 快照用） */
  ownedStudents: number;
  buckets: TalentBuckets;
  recruitment: Pick<EconomyRecruitment, 'recruit_base' | 'recruit_growth' | 'quality_mult'>;
}

export function generateCandidate(
  rng: () => number,
  tempId: string,
  ctx: GenerateContext,
): CandidatePayload {
  return generateCandidateWithQuality(rng, tempId, rollQuality(rng, ctx.reputation), ctx);
}

/**
 * 固定品质候选生成（开局包发放用：品质由 economy.onboarding.students 指定，
 * 属性/天赋/姓名仍走同一掷点表，与招募池同源，保证数值口径一致）。
 */
export function generateCandidateWithQuality(
  rng: () => number,
  tempId: string,
  quality: GenQuality,
  ctx: GenerateContext,
): CandidatePayload {
  const table = ATTR_TABLE[quality];

  // §3.5：声誉加成先行（仅六维/code/thinking/setting），随后在 [E'−δ, E'+δ] 掷点
  const dimE = repAdjustedE(table.dim.e, ctx.reputation);
  const attrs: CandidateAttrs = {
    ds: rollAttr(rng, table.dim, dimE),
    dp: rollAttr(rng, table.dim, dimE),
    math: rollAttr(rng, table.dim, dimE),
    graph: rollAttr(rng, table.dim, dimE),
    greedy: rollAttr(rng, table.dim, dimE),
    str: rollAttr(rng, table.dim, dimE),
    code: rollAttr(rng, table.code, repAdjustedE(table.code.e, ctx.reputation)),
    thinking: rollAttr(rng, table.thinking, repAdjustedE(table.thinking.e, ctx.reputation)),
    setting: rollAttr(rng, table.setting, repAdjustedE(table.setting.e, ctx.reputation)),
    focusCap: rollAttr(rng, table.focusCap, table.focusCap.e),
    energyMax: rollAttr(rng, table.energyMax, table.energyMax.e),
    staminaRegen: rollAttr(rng, table.staminaRegen, table.staminaRegen.e),
  };

  const talentIds = rollTalentIds(rng, quality, ctx.buckets);
  const sex: Sex = rng() < 0.5 ? 'MALE' : 'FEMALE';
  const name = pickName(rng);

  return {
    tempId,
    name,
    sex,
    qualityTier: QUALITY_TO_TIER[quality],
    hint: QUALITY_HINTS[quality],
    attrs,
    talents: talentIds.map((talentId) => ({ talentId })),
    price: recruitPrice(ctx.recruitment, ctx.ownedStudents, quality),
  };
}

/** 生成整池候选（M1-R1：容量 5） */
export function generatePool(
  rng: () => number,
  ctx: GenerateContext,
  count = 5,
): CandidatePayload[] {
  return Array.from({ length: count }, (_, i) => generateCandidate(rng, `c${i}`, ctx));
}
