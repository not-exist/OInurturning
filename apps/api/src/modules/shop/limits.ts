import type { ItemDef, ShopConfig } from '@oinur/shared';

/**
 * 书籍稀有度后缀匹配：`book-<subject>-<rarity>`（如 book-ds-purple → purple）。
 *
 * 白名单只含 gray/yellow/green/blue/purple，**不含 colorful**：
 * - `docs/data/items.yaml` 未定义任何 `book-*-colorful`（彩色书籍不在数据层枚举）；
 * - 即便将来新增，`shop.yaml` 的 `reputation_gates.colorful = 9999` 会先以声誉门槛拦住，
 *   限购聚合不需要为它预留档位。
 */
const BOOK_RARITY_SUFFIX_RE = /-(gray|yellow|green|blue|purple)$/;

/** 非书籍或后缀不在白名单时返回 null */
export function bookRaritySuffix(itemId: string): string | null {
  if (!itemId.startsWith('book-')) return null;
  return itemId.match(BOOK_RARITY_SUFFIX_RE)?.[1] ?? null;
}

/** 限购查档：精确命中优先，其次回落到书籍稀有度聚合键 `book-<rarity>` */
function limitForItem(limits: Record<string, number> | undefined, itemId: string): number | null {
  if (!limits) return null;
  const exact = limits[itemId];
  if (exact !== undefined) return exact;
  const suffix = bookRaritySuffix(itemId);
  if (suffix) {
    const aggregated = limits[`book-${suffix}`];
    if (aggregated !== undefined) return aggregated;
  }
  return null;
}

/** 单日限购：读 `daily_limits` */
export function dailyLimitForItem(itemId: string, cfg: ShopConfig): number | null {
  return limitForItem(cfg.daily_limits, itemId);
}

/** 单周限购：读 `weekly_limits` */
export function weeklyLimitForItem(itemId: string, cfg: ShopConfig): number | null {
  return limitForItem(cfg.weekly_limits, itemId);
}

/**
 * 声誉门槛：功能门槛（functional_gates）优先于稀有度档（reputation_gates）；
 * 未登记的道具返回 9999（视为不可购买）。
 * reputation_gates schema 要求六档稀有度齐全，ItemDef.rarity 为同一封闭枚举，
 * 按稀有度直取必然命中，无需回落分支。
 */
export function reputationRequiredForItem(
  itemId: string,
  cfg: ShopConfig,
  items: Record<string, ItemDef>,
): number {
  const def = items[itemId];
  if (!def) return 9999;
  const functional = cfg.functional_gates?.[itemId];
  if (functional !== undefined) return functional;
  return cfg.reputation_gates[def.rarity];
}
