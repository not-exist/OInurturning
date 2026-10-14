import {
  BOOK_MULT,
  QUALITY_MULT,
  SECONDARY_PROB,
  TRAINING_BASE,
  type TrainingKind,
} from '../training/gains.js';

/**
 * T5.2 数值平衡回归：训练成长路径估算（纯函数，权威：docs/systems/student.md §1/§4）。
 *
 * 目标：把「从某品质档招募基线（§3.3 期望值）练到剧情各章正赛 recommended_level
 * 所对应的综合评定值 V」所需的训练次数算出来（docs/data/stages.yaml 的
 * recommended_level 即 GAME-DESIGN §6.2「通关所需综合属性」锚点的逐关落地，
 * 与 student.md §1 的综合评定值 V 同刻度）。
 *
 * 模型口径（全部为 student.md §4 的确定性期望，非蒙特卡洛）：
 * - 每次训练按「期望增量」推进：基础训练主收益均匀落在六个维度之一 ⇒ 每维 +1/6×Δ；
 *   定向/专项自选目标维（策略 balance：始终练当前最低的一维，收敛于均衡培养）；
 *   code/thinking 无专门训练，只按附带成长概率 p×Δ（base=1、同款递减阻尼）累积；
 * - 增益公式 Δ = base × BookMult/QualityMult × (1 − cur/100)²，浮点累积，cur≥100 截断；
 * - 不含天赋 meta（training_星号通配 / training_all 乘区）、不含直用书（book-code/-thinking 每周顶格）、
 *   不含赛事实战成长（0.15/题）与事件 buff —— 本工具输出的是**无天赋纯训练基线**，
 *   报告中作为下界口径（天赋/道具只会更快）。
 *
 * 本模块不落库、不读随机源、不持有任何玩法数值字面量（成长 base/倍率/概率一律来自
 * training/gains.ts 单点事实源）。
 */

export const DIM_KEYS = ['ds', 'dp', 'math', 'graph', 'greedy', 'string'] as const;
export type DimKey = (typeof DIM_KEYS)[number];
export type StatKey = DimKey | 'code' | 'thinking';

/** 学员可成长属性（真实存储值，允许浮点；显示层才 floor） */
export type StudentStats = Record<StatKey, number>;

export const STAT_CAP = 100;

/** student.md §1 综合评定值：V = floor((code + thinking + floor(avg6)) / 3) */
export function compositeV(s: StudentStats): number {
  const dims = DIM_KEYS.map((key) => s[key]);
  const avg6 = dims.reduce((sum, value) => sum + value, 0) / DIM_KEYS.length;
  return Math.floor((s.code + s.thinking + Math.floor(avg6)) / 3);
}

/** 单属性从 from 练到 to（to<100）所需会话数解析解：Σ Δ = base×mult×(1−cur/100)² */
export function sessionsNeeded(from: number, to: number, perSessionBase: number): number {
  if (to <= from) return 0;
  if (to >= STAT_CAP || perSessionBase <= 0) return Number.POSITIVE_INFINITY;
  const xFrom = 1 - from / STAT_CAP;
  const xTo = 1 - to / STAT_CAP;
  return (STAT_CAP / perSessionBase) * (1 / xTo - 1 / xFrom);
}

export type SessionKind = TrainingKind;

/** 训练混合：三类训练各自的会话配比（非负，总和须 >0；用于构造确定性轮转序列） */
export interface TrainingMix {
  basic: number;
  directed: number;
  specialized: number;
}

/** 定向书倍率 / 专项题倍率（student.md §4.2；由调用方按稀有度传入） */
export interface GrowthOptions {
  bookMult: number;
  qualityMult: number;
}

export const MAX_GROWTH_SESSIONS = 2_000_000;

/** 均衡策略下每类训练的每会话期望增量方向与幅度常量推导（供 step 与宏步共用） */
interface IncrementPlan {
  dims: Record<DimKey, number>;
  code: number;
  thinking: number;
  /** 定向/专项本步实际命中维（balance：全局最低维） */
  targetDim?: DimKey;
}

function damped(base: number, cur: number): number {
  if (cur >= STAT_CAP) return 0;
  return base * (1 - cur / STAT_CAP) ** 2;
}

function lowestDim(s: StudentStats): DimKey {
  let best = DIM_KEYS[0] as DimKey;
  for (const key of DIM_KEYS) if (s[key] < s[best]) best = key;
  return best;
}

function planForKind(kind: TrainingKind, s: StudentStats, opts: GrowthOptions): IncrementPlan {
  const plan: IncrementPlan = {
    dims: { ds: 0, dp: 0, math: 0, graph: 0, greedy: 0, string: 0 },
    code: 0,
    thinking: 0,
  };
  if (kind === 'basic') {
    for (const key of DIM_KEYS)
      plan.dims[key] = (1 / DIM_KEYS.length) * damped(TRAINING_BASE.basic, s[key]);
  } else if (kind === 'directed') {
    const target = lowestDim(s);
    plan.targetDim = target;
    plan.dims[target] = damped(TRAINING_BASE.directed * opts.bookMult, s[target]);
  } else {
    const target = lowestDim(s);
    plan.targetDim = target;
    plan.dims[target] = damped(TRAINING_BASE.specialized * opts.qualityMult, s[target]);
  }
  plan.code = SECONDARY_PROB.code[kind] * damped(1, s.code);
  plan.thinking = SECONDARY_PROB.thinking[kind] * damped(1, s.thinking);
  return plan;
}

function applyPlan(s: StudentStats, plan: IncrementPlan): StudentStats {
  const next: StudentStats = { ...s };
  for (const key of DIM_KEYS) next[key] = Math.min(STAT_CAP, s[key] + plan.dims[key]);
  next.code = Math.min(STAT_CAP, s.code + plan.code);
  next.thinking = Math.min(STAT_CAP, s.thinking + plan.thinking);
  return next;
}

/** 单次训练（期望推进）——供单测与精确小步路径使用 */
export function expectedStep(
  s: StudentStats,
  kind: TrainingKind,
  opts: GrowthOptions,
): StudentStats {
  return applyPlan(s, planForKind(kind, s, opts));
}

/** 把配比展开为确定性轮转序列（pattern），长度即一轮会话数 */
function buildPattern(mix: TrainingMix): SessionKind[] {
  const pattern: SessionKind[] = [];
  for (let i = 0; i < Math.round(mix.basic); i++) pattern.push('basic');
  for (let i = 0; i < Math.round(mix.directed); i++) pattern.push('directed');
  for (let i = 0; i < Math.round(mix.specialized); i++) pattern.push('specialized');
  if (pattern.length === 0) throw new Error('TrainingMix must have a positive session count');
  return pattern;
}

export interface GrowthOutcome {
  reached: boolean;
  sessions: number;
  stats: StudentStats;
  v: number;
}

/**
 * 从招募基线练到 V ≥ targetV 的会话数（确定性期望 + 宏步加速）。
 *
 * 宏步：按当前状态的每会话期望增量推算推进 M 个 pattern（M 受「单属性单步增量 ≤
 * maxStatStep」约束），再重算增量 —— 对平滑递减曲线误差可忽略（宏步误差 ≤ maxStatStep×S/P，
 * 对 1e5+ 会话总量 <0.1%），同时避免对超长后期（逼近 100 渐近线）做逐会话循环。
 */
export function sessionsToV(
  start: StudentStats,
  mix: TrainingMix,
  targetV: number,
  opts: GrowthOptions,
  maxSessions = MAX_GROWTH_SESSIONS,
): GrowthOutcome {
  const pattern = buildPattern(mix);
  const perKindCount: Record<TrainingKind, number> = { basic: 0, directed: 0, specialized: 0 };
  for (const kind of pattern) perKindCount[kind] += 1;

  let s: StudentStats = { ...start };
  let sessions = 0;
  const maxStatStep = 0.05; // 宏步内单属性推进上限（点）

  while (sessions < maxSessions) {
    if (compositeV(s) >= targetV) return { reached: true, sessions, stats: s, v: compositeV(s) };

    // 一整轮 pattern 的期望增量（targetDim 每轮重算，均衡策略随状态切换）
    const dims: Record<DimKey, number> = { ds: 0, dp: 0, math: 0, graph: 0, greedy: 0, string: 0 };
    let code = 0;
    let thinking = 0;
    for (const kind of pattern) {
      const plan = planForKind(kind, s, opts);
      for (const key of DIM_KEYS) dims[key] += plan.dims[key];
      code += plan.code;
      thinking += plan.thinking;
    }

    const stepByStat: number[] = [...DIM_KEYS.map((k) => dims[k]), code, thinking].filter(
      (v) => v > 0,
    );
    const maxPerPattern = stepByStat.length > 0 ? Math.max(...stepByStat) : 0;
    if (maxPerPattern <= 0) break; // 全部触顶，纯训练路径停滞
    const patterns = Math.max(1, Math.floor(maxStatStep / maxPerPattern));
    const remainingPatterns = Math.floor((maxSessions - sessions) / pattern.length);
    const take = remainingPatterns <= 0 ? 0 : Math.min(patterns, remainingPatterns);
    if (take === 0) break;

    const advanced: StudentStats = { ...s };
    for (const key of DIM_KEYS) advanced[key] = Math.min(STAT_CAP, s[key] + dims[key] * take);
    advanced.code = Math.min(STAT_CAP, s.code + code * take);
    advanced.thinking = Math.min(STAT_CAP, s.thinking + thinking * take);
    s = advanced;
    sessions += take * pattern.length;
  }

  return { reached: compositeV(s) >= targetV, sessions, stats: s, v: compositeV(s) };
}

/** 会话数 → 日历天数（每周训练次数口径由调用方给出） */
export function daysForSessions(sessions: number, sessionsPerWeek: number): number {
  if (sessionsPerWeek <= 0) return Number.POSITIVE_INFINITY;
  return (sessions * 7) / sessionsPerWeek;
}

export { BOOK_MULT, QUALITY_MULT, TRAINING_BASE };
