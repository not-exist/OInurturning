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
    /**
     * 讲课成长的「思维要求」R（issue #56）：可成长性与主讲学员的思维能力比对，
     * 与 V 门槛解耦（student.md §1 规定奖励结算不得直接引用 V）。
     * 缺省 = 该档 threshold（均衡学员 thinking≈V，两者同源）。
     */
    thinking_req: z.number().int().nonnegative().optional(),
  })
  .strict();
export type LectureTier = z.infer<typeof lectureTierSchema>;

/**
 * 讲课成长参数（issue #56：讲课能够提升学生水平）。
 * 权威文档 docs/systems/gameplay.md §4.2「讲课成长」；数值事实源 docs/data/economy.yaml。
 * 与训练同构的部分（(1−cur/100)^2 浮点阻尼、cap=100）复用 student.md §4.1 口径，此处不重复声明。
 */
export const lectureGrowthSchema = z
  .object({
    /** 单场基准成长量（未阻尼、未匹配折减前）；量级刻意小于训练 base（1.6/2.0/3.2） */
    base_gain: z.number().nonnegative(),
    /** 主成长落点抽中 setting（出题）的概率；其余落 thinking（思维） */
    setting_weight: z.number().min(0).max(1),
    /** 另一项附带成长的触发概率 */
    secondary_prob: z.number().min(0).max(1),
    /** 附带成长相对 base_gain 的份额 */
    secondary_share: z.number().nonnegative(),
    /** 强接「勉强过关」时的成长折减（与报酬 ×0.6 同源） */
    forced_success_mult: z.number().min(0).max(1),
    /** 思维超出要求多少点后成长衰减到 0 */
    match_span: z.number().positive(),
    /** 超出侧衰减曲线指数：g(d) = max(0, 1 − d/match_span)^match_power */
    match_power: z.number().positive(),
    /** 思维不足侧的匹配系数下限：g(d<0) = clamp(1 + d/match_span, deficit_floor, 1) */
    deficit_floor: z.number().min(0).max(1),
    /** 强接且思维不足时讲砸的属性回落量（负向，clamp 下限 0） */
    forced_deficit_loss: z
      .object({
        thinking: z.number().nonnegative(),
        setting: z.number().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();
export type LectureGrowthConfig = z.infer<typeof lectureGrowthSchema>;

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
    /** 缺省即「讲课不带来成长」（历史配置/精简 fixture 兼容）；docs/data 必须提供 */
    growth: lectureGrowthSchema.optional(),
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
        rarity_mix: z.record(z.string(), z.number().nonnegative()).refine((mix) => Object.values(mix).some((weight) => weight > 0)),
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

/**
 * 新用户开局包（economy.yaml `onboarding` 分区，注册/回填的唯一数值源）。
 * students 为固定品质序列（按序发放）；items 引用 items.yaml 的道具 id。
 * 结构上 optional（兼容历史局部解析），但语义校验要求生产/测试配置必须 present。
 */
export const onboardingStudentSchema = z
  .object({ quality: z.enum(ECONOMY_QUALITY_TIERS) })
  .strict();
export type OnboardingStudent = z.infer<typeof onboardingStudentSchema>;

export const onboardingItemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    count: z.number().int().positive(),
  })
  .strict();
export type OnboardingItem = z.infer<typeof onboardingItemSchema>;

export const onboardingConfigSchema = z
  .object({
    money: z.number().int().nonnegative(),
    reputation: z.number().int().nonnegative(),
    students: z.array(onboardingStudentSchema).min(1).max(5),
    items: z.array(onboardingItemSchema).max(10),
  })
  .strict();
export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;

export const economyConfigSchema = z
  .object({
    training: economyTrainingSchema,
    recruitment: economyRecruitmentSchema,
    // M1 fixtures may carry a partial passthrough lecture block; M3 lecture
    // paths parse the complete shape before using it.
    lecture: z.union([lectureConfigSchema, z.record(z.string(), z.unknown())]).optional(),
    simulation: simulationConfigSchema.optional(),
    onboarding: onboardingConfigSchema.optional(),
  })
  .passthrough();
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
