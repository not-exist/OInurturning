import { z } from 'zod';

export const shopConfigSchema = z
  .object({
    reputation_gates: z
      .object({
        gray: z.number().int().nonnegative(),
        yellow: z.number().int().nonnegative(),
        green: z.number().int().nonnegative(),
        blue: z.number().int().nonnegative(),
        purple: z.number().int().nonnegative(),
        colorful: z.number().int().nonnegative(),
      })
      .passthrough(),
    functional_gates: z.record(z.string(), z.number().int().nonnegative()).optional(),
    daily_limits: z.record(z.string(), z.number().int().positive()).optional(),
    weekly_limits: z.record(z.string(), z.number().int().positive()).optional(),
    refresh: z
      .object({
        daily_at: z.string(),
        weekly_at: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ShopConfig = z.infer<typeof shopConfigSchema>;

/** 商城目录项视图 */
export interface ShopItemView {
  itemId: string;
  name: string;
  rarity: string;
  category: string;
  price: number;
  description: string;
  effectDesc: string | null;
  ownedQuantity: number;
  reputationRequired: number;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  weeklyLimit: number | null;
  weeklyRemaining: number | null;
  purchasable: boolean;
  reason: string | null;
}

export interface ShopCatalogView {
  items: ShopItemView[];
  money: number;
  reputation: number;
  todaySpent: number;
}

export interface ShopBuyResult {
  itemId: string;
  quantity: number;
  totalCost: number;
  moneyAfter: number;
  ownedQuantity: number;
}
