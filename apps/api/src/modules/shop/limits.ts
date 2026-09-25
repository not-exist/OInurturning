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

/** 单日限购：精确命中优先，其次回落到书籍稀有度聚合键 `book-<rarity>` */
export function dailyLimitForItem(itemId: string, cfg: ShopConfig): number | null {
  const limits = cfg.daily_limits;
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

/** 单周限购：口径与 {@link dailyLimitForItem} 一致，读 `weekly_limits` */
export function weeklyLimitForItem(itemId: string, cfg: ShopConfig): number | null {
  const limits = cfg.weekly_limits;
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

/**
 * 声誉门槛：功能门槛（functional_gates）优先于稀有度档（reputation_gates）；
 * 书籍未直接命中稀有度档时按 `book-<rarity>` 后缀归类；未登记的道具返回 9999（视为不可购买）。
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
  const gates = cfg.reputation_gates as Record<string, number>;
  const rarity = def.rarity.toLowerCase();
  const byRarity = gates[rarity];
  if (byRarity !== undefined) return byRarity;
  const suffix = bookRaritySuffix(itemId);
  if (suffix) {
    const bySuffix = gates[suffix];
    if (bySuffix !== undefined) return bySuffix;
  }
  return 0;
}
