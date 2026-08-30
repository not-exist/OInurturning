import { z } from 'zod';
import { CONFIG_RARITIES } from './talents.js';

/**
 * items.yaml 对应的 zod schema（docs/data/items.yaml 为唯一事实源）。
 * 顶层允许文件级 meta 区块（合成配方表等，集成裁定 #13）。
 */
export const ITEM_CATEGORIES = ['nurture', 'book', 'functional', 'contest', 'quest', 'material'] as const;
export type ItemCategoryKey = (typeof ITEM_CATEGORIES)[number];

/** effect.kind 使用语义枚举（items.yaml 头部清单 + 集成新增 + 数据实有值） */
export const ITEM_EFFECT_KINDS = [
  'rename',
  'talent_advance',
  'talent_reroll',
  'talent_reroll_lock',
  'mentality_add',
  'energy_restore',
  'energy_cap_add',
  'stamina_restore',
  'focus_cap_add',
  'attr_boost',
  'training_buff',
  'event_defuse',
  'contest_buff',
  'adventure_buff',
  'adventure_insurance',
  'info_preview',
  'recruit_guarantee',
  'recruit_quality_buff',
  'account_aura',
  'unlock_tag',
  'unlock_passive',
  'passive_income_source',
  'pvp_entry',
  'grant_box',
  'choose_grant',
  'compose_input',
  'vendor_sell',
  'display',
] as const;
export type ItemEffectKind = (typeof ITEM_EFFECT_KINDS)[number];

/**
 * effect 为异构结构：kind/desc 为公共必填，其余子键按道具类型携带，
 * 逐类型的字段建模在对应玩法里程碑收口，此处 passthrough 放行。
 */
export const itemEffectSchema = z
  .object({
    desc: z.string(),
    kind: z.enum(ITEM_EFFECT_KINDS),
  })
  .passthrough();
export type ItemEffect = z.infer<typeof itemEffectSchema>;

export const itemDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id 须为 kebab-case'),
    name: z.string().min(1),
    category: z.enum(ITEM_CATEGORIES),
    rarity: z.enum(CONFIG_RARITIES),
    effect: itemEffectSchema.optional(),
    price: z.number().int().nonnegative().nullable(),
    sources: z.array(z.string()),
    stack: z.number().int().positive(),
    description: z.string(),
  })
  .strict();
export type ItemDef = z.infer<typeof itemDefSchema>;

export const itemsFileSchema = z
  .object({
    meta: z.record(z.unknown()).optional(),
    items: z.array(itemDefSchema).min(1),
  })
  .strict();
export type ItemsFile = z.infer<typeof itemsFileSchema>;
