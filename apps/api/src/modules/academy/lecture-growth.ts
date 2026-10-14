import type { Student } from '@prisma/client';
import type {
  LectureGrowthConfig,
  LectureGrowthEntry,
  LectureGrowthStat,
  LectureTier,
} from '@oinur/shared';
import type { MetaAggregate } from '../students/meta.js';

/**
 * 讲课成长纯计算（issue #56，权威：docs/systems/gameplay.md §4.2「讲课成长」）。
 * 本模块不落库、不持有 DB 句柄，随机性一律经注入的 rng()（服务层给密码学派生流），
 * 与 training/gains.ts 同一风格：可单测、可复现、数值全部来自 economy.yaml 的 lecture.growth。
 *
 * 设计要点（与需求 #56 逐条对应）：
 * 1. 只提升 setting（出题）与 thinking（思维）——讲课是把已有理解讲清楚，不是学新知识；
 * 2. 主成长落点随机（setting_weight 抽 setting，否则 thinking），另一项低概率附带成长；
 * 3. 匹配判定读**思维能力本身**而非 V（student.md §1：奖励结算不得直接引用 V）：
 *    思维明显超出该档要求 → 匹配系数衰减到 0（讲低于自己水平的课学不到东西）；
 * 4. 思维不足 + 强接 + 讲砸 → 属性回落（被听众问倒），回落量小且 clamp 下限 0；
 * 5. 与训练共用 (1 − cur/100)^2 浮点阻尼与 cap=100（student.md §4.1）。
 */

/** 成长可触及的学员列（与 shared.LECTURE_GROWTH_STATS 同集合） */
export type LectureGrowthColumn = 'setting' | 'thinking';

export interface LectureGrowthInput {
  growth: LectureGrowthConfig;
  tier: LectureTier;
  /** settle 之后的学员投影：只读两项现值（浮点累积原值） */
  student: Pick<Student, LectureGrowthColumn>;
  meta: MetaAggregate;
  /** 是否强接（V 低于门槛，落在强接窗内） */
  forced: boolean;
  /** 本场是否讲成（强接才有失败分支；达标必成功） */
  success: boolean;
  rng: () => number;
}

export interface LectureGrowthResult {
  /** 本场比对的思维要求 R（tier.thinking_req，缺省=门槛） */
  thinkingReq: number;
  /** 思维不足（thinking < R）：前端告警与讲砸回落的共同前置条件 */
  deficit: boolean;
  /** 匹配系数 g（讲砸分支恒为 0，便于战报/日志复核） */
  matchFactor: number;
  /** 落库与展示用的成长清单（amount 可为负=回落；仅列非零项） */
  gains: LectureGrowthEntry[];
  /** 需写回学员的列增补（已 clamp 到 [0,100]） */
  patch: Partial<Record<LectureGrowthColumn, number>>;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 该档的思维要求 R：economy.yaml 可逐档覆盖，缺省与 V 门槛同值 */
export function thinkingReqOf(tier: LectureTier): number {
  return tier.thinking_req ?? tier.threshold;
}

/**
 * 匹配系数 g(d)，d = 学员思维 − R：
 * - d ≥ 0（超出侧）：`max(0, 1 − d/match_span)^match_power` → 超出 match_span 点即 0；
 * - d < 0（不足侧）：`clamp(1 + d/match_span, deficit_floor, 1)` → 线性下探但保留下限。
 */
export function matchFactor(d: number, growth: LectureGrowthConfig): number {
  const { match_span, match_power, deficit_floor } = growth;
  if (d < 0) return clamp(1 + d / match_span, deficit_floor, 1);
  return Math.max(0, 1 - d / match_span) ** match_power;
}

/** 收益递减阻尼（student.md §4.1：cap=100、k=2）；已到上限即 0 */
function damping(cur: number): number {
  if (cur >= 100) return 0;
  return (1 - cur / 100) ** 2;
}

/**
 * 单场讲课的成长结算（纯函数）。
 * rng 消费顺序固定：① 主成长落点 → ② 附带成长判定（讲砸分支不消费 rng）。
 */
export function computeLectureGrowth(input: LectureGrowthInput): LectureGrowthResult {
  const { growth, tier, student, meta, forced, success, rng } = input;
  const thinkingReq = thinkingReqOf(tier);
  const deficit = student.thinking < thinkingReq;

  // 讲砸：不成长；强接且思维不足时额外付出属性代价（issue #56 的「有概率减少属性」，
  // 概率闸即讲课既有的 40% 讲砸判定，此处不再叠一层随机）。
  if (!success) {
    if (!deficit) return { thinkingReq, deficit, matchFactor: 0, gains: [], patch: {} };
    const patch: Partial<Record<LectureGrowthColumn, number>> = {};
    const gains: LectureGrowthEntry[] = [];
    for (const stat of ['thinking', 'setting'] as const) {
      const loss = growth.forced_deficit_loss[stat];
      if (loss <= 0) continue;
      const cur = student[stat];
      const next = Math.max(0, cur - loss);
      if (next === cur) continue;
      patch[stat] = next;
      gains.push({ stat, amount: next - cur });
    }
    return { thinkingReq, deficit, matchFactor: 0, gains, patch };
  }

  const g = matchFactor(student.thinking - thinkingReq, growth);
  const base =
    growth.base_gain *
    g *
    (forced ? growth.forced_success_mult : 1) *
    (1 + (meta.lecture_growth ?? 0) / 100);

  const patch: Partial<Record<LectureGrowthColumn, number>> = {};
  const gains: LectureGrowthEntry[] = [];
  const apply = (stat: LectureGrowthStat, amount: number): void => {
    if (amount <= 0) return;
    const cur = student[stat];
    const next = clamp(cur + amount * damping(cur), 0, 100);
    if (next <= cur) return;
    patch[stat] = next;
    gains.push({ stat, amount: next - cur });
  };

  // ① 主成长落点：setting_weight 概率落 setting，否则 thinking
  const primary: LectureGrowthStat = rng() < growth.setting_weight ? 'setting' : 'thinking';
  apply(primary, base);

  // ② 另一项的附带成长（低概率、按 secondary_share 打折）
  const secondary: LectureGrowthStat = primary === 'setting' ? 'thinking' : 'setting';
  if (rng() < growth.secondary_prob) apply(secondary, base * growth.secondary_share);

  return { thinkingReq, deficit, matchFactor: g, gains, patch };
}
