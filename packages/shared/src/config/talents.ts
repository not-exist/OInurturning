import { z } from 'zod';

/**
 * talents.yaml 对应的 zod schema（docs/data/talents.yaml 为唯一事实源）。
 * 稀有度序列为 yaml 内的小写六档：gray < yellow < green < blue < purple < colorful。
 */
export const CONFIG_RARITIES = ['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'] as const;
export type ConfigRarity = (typeof CONFIG_RARITIES)[number];

/** 属性键：六维 / 全局能力 / 辅助属性（talents.yaml 头部规则 §效果字段） */
export const TALENT_ATTRIBUTE_STATS = [
  'ds',
  'dp',
  'math',
  'graph',
  'greedy',
  'string',
  'code',
  'thinking',
  'setting',
  'mindset',
  'focus_cap',
  'energy_max',
  'stamina_regen',
] as const;

/** meta 键：talents.yaml 头部自定义声明的非属性效果键全集 */
export const TALENT_META_STATS = [
  'training_all',
  'training_ds',
  'training_dp',
  'training_math',
  'training_graph',
  'training_greedy',
  'training_string',
  'training_code',
  'training_thinking',
  'book_effect',
  'duel_posing',
  'duel_solve',
  'lecture_income',
  'focus_gain',
  'energy_cost_reduce',
  'energy_regen',
  'wa_penalty_reduce',
  'mindset_loss_reduce',
  'event_luck',
  'setting_quality',
] as const;

export const TALENT_EFFECT_STATS = [...TALENT_ATTRIBUTE_STATS, ...TALENT_META_STATS] as const;
export type TalentEffectStat = (typeof TALENT_EFFECT_STATS)[number];

export const talentEffectSchema = z
  .object({
    stat: z.enum(TALENT_EFFECT_STATS),
    mode: z.enum(['percent', 'flat']),
    value: z.number(),
  })
  .strict();
export type TalentEffect = z.infer<typeof talentEffectSchema>;

export const talentDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id 须为 kebab-case'),
    name: z.string().min(1),
    rarity: z.enum(CONFIG_RARITIES),
    kind: z.enum(['positive', 'negative']),
    family: z.string().min(1).nullable(),
    effects: z.array(talentEffectSchema).min(1),
    description: z.string(),
    upgrade_to: z.string().nullable(),
  })
  .strict();
export type TalentDef = z.infer<typeof talentDefSchema>;

export const talentsFileSchema = z
  .object({
    version: z.number().int(),
    talents: z.array(talentDefSchema).min(1),
  })
  .strict();
export type TalentsFile = z.infer<typeof talentsFileSchema>;
