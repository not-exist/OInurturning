import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { itemsFileSchema, shopConfigSchema, type ItemDef } from '@oinur/shared';
import {
  bookRaritySuffix,
  dailyLimitForItem,
  reputationRequiredForItem,
  weeklyLimitForItem,
} from '../src/modules/shop/limits.js';

/**
 * 店铺限额/门槛纯函数单测：直读 docs/data 的真实配置。
 * limits.ts 不 import prisma / loader，故可在 unit 项目（无 DB、无 globalSetup）运行。
 */
const dataPath = (file: string) => path.resolve(import.meta.dirname, '../../../docs/data', file);

const shop = shopConfigSchema.parse(parseYaml(readFileSync(dataPath('shop.yaml'), 'utf8')) as unknown);
const itemsFile = itemsFileSchema.parse(parseYaml(readFileSync(dataPath('items.yaml'), 'utf8')) as unknown);
const items: Record<string, ItemDef> = Object.fromEntries(itemsFile.items.map((def) => [def.id, def]));

describe('bookRaritySuffix', () => {
  it('提取书籍稀有度后缀', () => {
    expect(bookRaritySuffix('book-ds-purple')).toBe('purple');
    expect(bookRaritySuffix('book-math-yellow')).toBe('yellow');
  });

  it('非书籍或白名单外后缀返回 null', () => {
    expect(bookRaritySuffix('milk-tea')).toBeNull();
    expect(bookRaritySuffix('book-ds')).toBeNull();
    // items.yaml 未定义 book-*-colorful；且 shop.yaml 的 reputation_gates.colorful=9999
    // 会先以声誉门槛拦住，限购聚合不需要 colorful 档位
    expect(bookRaritySuffix('book-ds-colorful')).toBeNull();
  });
});

describe('weeklyLimitForItem', () => {
  it('同稀有度书籍聚合到 book-<rarity> 键', () => {
    expect(weeklyLimitForItem('book-ds-purple', shop)).toBe(2);
    expect(weeklyLimitForItem('book-math-purple', shop)).toBe(2);
    expect(shop.weekly_limits?.['book-purple']).toBe(2);
  });

  it('未配置的稀有度与未登记道具返回 null', () => {
    expect(weeklyLimitForItem('book-ds-yellow', shop)).toBeNull();
    expect(weeklyLimitForItem('book-ds-colorful', shop)).toBeNull();
    expect(weeklyLimitForItem('milk-tea', shop)).toBeNull();
  });
});

describe('dailyLimitForItem', () => {
  it('非书籍道具精确命中 daily_limits', () => {
    expect(dailyLimitForItem('milk-tea', shop)).toBe(10);
  });

  it('书籍无日限时返回 null（daily_limits 未登记 book-* 聚合键）', () => {
    expect(dailyLimitForItem('book-ds-purple', shop)).toBeNull();
  });
});

describe('reputationRequiredForItem', () => {
  it('functional_gates 优先于稀有度档', () => {
    // vitality-core：functional 门槛 200，而 items.yaml rarity=purple（稀有度档 350）
    expect(shop.functional_gates?.['vitality-core']).toBe(200);
    expect(shop.reputation_gates.purple).toBe(350);
    expect(reputationRequiredForItem('vitality-core', shop, items)).toBe(200);
  });

  it('无 functional 登记时回落到 items.yaml 的 rarity 档', () => {
    expect(reputationRequiredForItem('book-ds-purple', shop, items)).toBe(350);
  });

  it('未登记 id 返回 9999', () => {
    expect(reputationRequiredForItem('not-a-real-item', shop, items)).toBe(9999);
  });
});
