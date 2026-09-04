import { z } from 'zod';
import {
  CONFIG_DIMENSIONS,
  PROBLEM_TIERS,
  PROBLEM_SEVERITIES,
  type ConfigDimension,
  type ProblemTier,
} from './problems.js';

export const STAGE_CHAPTERS = PROBLEM_TIERS;
export type StageChapter = (typeof STAGE_CHAPTERS)[number];

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const stageProblemSlotSchema = z
  .object({
    tier: z.enum(PROBLEM_TIERS),
    count: positiveInt,
    chance: z.number().finite().min(0).max(1).optional(),
    dims: z.array(z.enum(CONFIG_DIMENSIONS)).min(1).optional(),
  })
  .strict();
export type StageProblemSlot = z.infer<typeof stageProblemSlotSchema>;

export const stageNpcPoolSchema = z
  .object({
    size: positiveInt,
    mean_level: nonNegativeInt,
    spread: z.number().finite().nonnegative(),
  })
  .strict();
export type StageNpcPool = z.infer<typeof stageNpcPoolSchema>;

export const stageRewardPoolEntrySchema = z
  .object({
    rarity: z.enum(['gray', 'yellow', 'green', 'blue', 'purple', 'colorful']),
    weight: z.number().finite().positive(),
  })
  .strict();
export type StageRewardPoolEntry = z.infer<typeof stageRewardPoolEntrySchema>;

export const stageItemRewardSchema = z
  .object({
    count: positiveInt,
    chance: z.number().finite().min(0).max(1),
    pool: z.array(stageRewardPoolEntrySchema).min(1),
  })
  .strict();
export type StageItemReward = z.infer<typeof stageItemRewardSchema>;

export const stageMilestoneItemSchema = z
  .object({
    item: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    count: positiveInt,
  })
  .strict();

export const stageFirstClearSchema = z
  .object({
    money: z.number().finite().nonnegative(),
    items: stageItemRewardSchema,
    milestone: z
      .object({ items: z.array(stageMilestoneItemSchema).min(1) })
      .strict()
      .nullable(),
  })
  .strict();
export type StageFirstClear = z.infer<typeof stageFirstClearSchema>;

export const stageConfigSchema = z
  .object({
    chapter: z.enum(STAGE_CHAPTERS),
    stage_index: positiveInt,
    name: z.string().min(1),
    recommended_level: nonNegativeInt,
    duration_min: z.number().finite().positive(),
    problem_slots: z.array(stageProblemSlotSchema).min(1),
    npc_pool: stageNpcPoolSchema,
    first_clear: stageFirstClearSchema,
  })
  .strict();
export type StageConfig = z.infer<typeof stageConfigSchema>;

export const stagesDefaultsSchema = z
  .object({
    engine_ref: z.string().min(1),
    stamina_cost_by_chapter: z.record(z.enum(STAGE_CHAPTERS), positiveInt),
    pass_rank_max: positiveInt,
  })
  .strict();

export const stagesFullClearSchema = z
  .object({
    condition: z.string().min(1),
    money: z.number().finite().nonnegative(),
    items: z.array(stageMilestoneItemSchema).min(1),
    unlocks: z.literal('ng_plus'),
  })
  .strict();
export type StagesFullClear = z.infer<typeof stagesFullClearSchema>;

export const stagesNgPlusSchema = z
  .object({
    layer_param: z.literal('k'),
    demand_multiplier: z.string().min(1),
    trait_chance_bonus: z.string().min(1),
    trait_pool_shift: z
      .object({
        weight_scale: z.string().min(1),
        high_severity_extra: z
          .object({
            min_severity: z.enum(PROBLEM_SEVERITIES),
            scale: z.string().min(1),
            cap: z.enum(PROBLEM_SEVERITIES),
          })
          .strict(),
      })
      .strict(),
    first_clear_money_multiplier: z.string().min(1),
    item_rarity_shift: z
      .object({
        from_layer: nonNegativeInt,
        shift: nonNegativeInt,
        cap: z.enum(['gray', 'yellow', 'green', 'blue', 'purple', 'colorful']),
      })
      .strict(),
    milestone_rule: z.string().min(1),
    advance_stone_per_layer_clear: nonNegativeInt,
    layer_badge: z
      .object({ item_id_template: z.string().min(1), count: positiveInt })
      .strict(),
    repeat_clear_rank_bonus: z
      .object({
        champion: z.number().finite().nonnegative(),
        runner_up: z.number().finite().nonnegative(),
        third_to_eighth: z.number().finite().nonnegative(),
        others: z.number().finite().nonnegative(),
      })
      .strict(),
    layer_cap: nonNegativeInt.nullable(),
  })
  .strict();
export type StagesNgPlus = z.infer<typeof stagesNgPlusSchema>;

export const stagesConfigSchema = z
  .object({
    version: z.number().int().nonnegative(),
    updated: z.string().min(1),
    defaults: stagesDefaultsSchema,
    stages: z.array(stageConfigSchema).min(1),
    full_clear: stagesFullClearSchema,
    ng_plus: stagesNgPlusSchema,
  })
  .strict();
export type StagesConfig = z.infer<typeof stagesConfigSchema>;

export type { ConfigDimension, ProblemTier };
