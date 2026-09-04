import { z } from 'zod';

/**
 * economy.yaml 对应的 zod schema（docs/data/economy.yaml 为唯一事实源）。
 * 公式串仅作展示/文档，代码一律读结构化数值字段，绝不在运行时求值。
 * M1 所需字段 required；其余分区（lecture/contest/story/pvp/…）passthrough 放行，
 * 对应里程碑消费时再逐分区收紧。
 */
const money = z.number();

export const economyTrainingSchema = z
  .object({
    cost_formula: z.string(),
    student_coeff: z.number(),
    basic: z
      .object({ money_base: money, stamina_cost: z.number().int().positive() })
      .passthrough(),
    directed: z
      .object({ money_base: money, stamina_cost: z.number().int().positive(), book_consumed: z.number().int().positive() })
      .passthrough(),
    specialized: z
      .object({
        money_base: money,
        stamina_cost: z.number().int().positive(),
        premade_problem_consumed: z.number().int().positive(),
      })
      .passthrough(),
  })
  .passthrough();
export type EconomyTraining = z.infer<typeof economyTrainingSchema>;

export const ECONOMY_QUALITY_TIERS = ['common', 'good', 'elite', 'genius'] as const;
export type EconomyQualityTier = (typeof ECONOMY_QUALITY_TIERS)[number];

export const economyRecruitmentSchema = z
  .object({
    recruit_cost_formula: z.string(),
    recruit_base: money,
    recruit_growth: z.number(),
    quality_mult: z.object({
      common: z.number(),
      good: z.number(),
      elite: z.number(),
      genius: z.number(),
    }),
    manual_refresh: z
      .object({
        price_formula: z.string(),
        refresh_base: money,
        refresh_growth: z.number(),
        daily_price_cap: money,
        free_interval_hours: z.number(),
      })
      .passthrough(),
  })
  .passthrough();
export type EconomyRecruitment = z.infer<typeof economyRecruitmentSchema>;

export const lectureTierSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    threshold: z.number().int().nonnegative(),
    base_money: z.number().int().nonnegative(),
    base_reputation: z.number().int().nonnegative(),
  })
  .strict();
export type LectureTier = z.infer<typeof lectureTierSchema>;

export const lectureConfigSchema = z
  .object({
    audience_tiers: z.array(lectureTierSchema).length(5),
    reputation_pay_curve: z.object({
      rep_divisor: z.number().positive(),
      min_mult: z.number().nonnegative(),
      max_mult: z.number().nonnegative(),
    }).passthrough(),
    overflow_bonus: z.object({
      overflow_step: z.number().positive(),
      overflow_pct: z.number().nonnegative(),
      overflow_cap_pct: z.number().nonnegative(),
    }).passthrough(),
  })
  .passthrough();
export type LectureConfig = z.infer<typeof lectureConfigSchema>;

export const economyConfigSchema = z
  .object({
    training: economyTrainingSchema,
    recruitment: economyRecruitmentSchema,
    // M1 fixtures may carry a partial passthrough lecture block; M3 lecture
    // paths parse the complete shape before using it.
    lecture: z.union([lectureConfigSchema, z.record(z.unknown())]).optional(),
  })
  .passthrough();
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
