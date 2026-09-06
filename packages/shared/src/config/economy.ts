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

const simulationProfileIdSchema = z.enum(['beginner', 'mid', 'late']);

export const simulationProfileSchema = z
  .object({
    id: simulationProfileIdSchema,
    label: z.string().min(1),
    owned_students: z.number().int().nonnegative(),
    ability: z.number().finite().nonnegative(),
    reputation: z.number().int().nonnegative(),
    training: z
      .object({
        basic_sessions: z.number().nonnegative(),
        directed_sessions: z.number().nonnegative(),
        specialized_sessions: z.number().nonnegative(),
        directed_book_item_id: z.string().min(1),
      })
      .strict(),
    recruitment: z
      .object({
        recruits_per_week: z.number().nonnegative(),
        quality: z.enum(ECONOMY_QUALITY_TIERS),
        manual_refreshes_per_week: z.number().nonnegative(),
      })
      .strict(),
    lectures: z.object({ sessions: z.number().nonnegative(), tier: z.string().min(1) }).strict(),
    adventures: z
      .object({
        sessions: z.number().nonnegative(),
        rarity_mix: z.record(z.number().nonnegative()).refine((mix) => Object.values(mix).some((weight) => weight > 0)),
      })
      .strict(),
    story: z
      .object({
        sessions: z.number().nonnegative(),
        stage_key: z.string().min(1),
        rank_tier: z.enum(['champion', 'runner_up', 'third_to_eighth']),
        ng_level: z.number().int().nonnegative(),
      })
      .strict(),
    passive: z.object({ sponsor_contracts: z.number().nonnegative(), substitute_coaches: z.number().nonnegative() }).strict(),
    fixed_weekly_expense: z.number().nonnegative(),
  })
  .strict();
export type SimulationProfile = z.infer<typeof simulationProfileSchema>;

export const simulationConfigSchema = z
  .object({
    target_profile: simulationProfileIdSchema,
    profiles: z.array(simulationProfileSchema).length(3),
  })
  .strict();
export type SimulationConfig = z.infer<typeof simulationConfigSchema>;

export const economyConfigSchema = z
  .object({
    training: economyTrainingSchema,
    recruitment: economyRecruitmentSchema,
    // M1 fixtures may carry a partial passthrough lecture block; M3 lecture
    // paths parse the complete shape before using it.
    lecture: z.union([lectureConfigSchema, z.record(z.unknown())]).optional(),
    simulation: simulationConfigSchema.optional(),
  })
  .passthrough();
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
