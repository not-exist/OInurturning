import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { dayKey, weekKey } from '../../lib/clock.js';
import type { ShopItemView, ShopCatalogView, ShopBuyResult } from '@oinur/shared';
import { autoAdvanceIfNeeded } from '../tutorial/service.js';

function shopConfig() {
  const cfg = getConfig();
  if (!cfg?.shop) throw new Error('[shop] CONFIG 未加载');
  return cfg.shop;
}

function itemDefs() {
  const cfg = getConfig();
  if (!cfg?.items) throw new Error('[shop] items CONFIG 未加载');
  return cfg.items;
}

/** 判断是否可售：price != null */
function isPurchasable(item: { price: number | null }): boolean {
  return item.price !== null && item.price > 0;
}

function reputationRequiredForItem(itemId: string): number {
  const cfg = shopConfig();
  const def = itemDefs()[itemId];
  if (!def) return 9999;
  // 功能门槛优先
  if (cfg.functional_gates && cfg.functional_gates[itemId] !== undefined) {
    return cfg.functional_gates[itemId]!;
  }
  const rarity = (def.rarity as string).toLowerCase();
  const gates = cfg.reputation_gates as Record<string, number>;
  if (gates[rarity] !== undefined) return gates[rarity]!;
  // 书籍按 rarity 归类
  if (itemId.startsWith('book-')) {
    // book-xxx-gray/yellow/... 取后缀
    const m = /-(gray|yellow|green|blue|purple|colorful)$/.exec(itemId);
    const r = m?.[1];
    if (r && gates[r] !== undefined) return gates[r]!;
  }
  return 0;
}

function dailyLimitForItem(itemId: string): number | null {
  const cfg = shopConfig();
  if (!cfg.daily_limits) return null;
  if (cfg.daily_limits[itemId] !== undefined) return cfg.daily_limits[itemId]!;
  // 前缀匹配 book-*
  if (itemId.startsWith('book-')) {
    const m = /-(gray|yellow|green|blue|purple)$/.exec(itemId);
    const suffix = m?.[1];
    if (suffix) {
      const key = `book-${suffix}`;
      if (cfg.daily_limits[key] !== undefined) return cfg.daily_limits[key]!;
    }
  }
  return null;
}

function weeklyLimitForItem(itemId: string): number | null {
  const cfg = shopConfig();
  if (!cfg.weekly_limits) return null;
  if (cfg.weekly_limits[itemId] !== undefined) return cfg.weekly_limits[itemId]!;
  if (itemId.startsWith('book-')) {
    const m = /-(gray|yellow|green|blue|purple)$/.exec(itemId);
    const suffix = m?.[1];
    if (suffix) {
      const key = `book-${suffix}`;
      if (cfg.weekly_limits[key] !== undefined) return cfg.weekly_limits[key]!;
    }
  }
  return null;
}

export async function getCatalog(userId: number, now: Date = new Date()): Promise<ShopCatalogView> {
  const cfg = getConfig();
  if (!cfg) throw new Error('[shop] CONFIG 未加载');
  const items = cfg.items;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const holdings = await prisma.userItem.findMany({ where: { userId } });
  const ownedMap = new Map(holdings.map((h) => [h.itemId, h.quantity]));

  const dk = dayKey(now);
  const wk = weekKey(now);

  // 聚合当日/当周购买量
  const dailyLogs = await prisma.shopPurchaseLog.groupBy({
    by: ['itemId'],
    where: { userId, dayKey: dk },
    _sum: { quantity: true },
  });
  const weeklyLogs = await prisma.shopPurchaseLog.groupBy({
    by: ['itemId'],
    where: { userId, weekKey: wk },
    _sum: { quantity: true },
  });
  const dailyMap = new Map(dailyLogs.map((l) => [l.itemId, l._sum.quantity ?? 0]));
  const weeklyMap = new Map(weeklyLogs.map((l) => [l.itemId, l._sum.quantity ?? 0]));

  const views: ShopItemView[] = [];
  for (const [id, def] of Object.entries(items)) {
    if (!isPurchasable(def)) continue;
    const price = def.price!;
    const repReq = reputationRequiredForItem(id);
    const dLimit = dailyLimitForItem(id);
    const wLimit = weeklyLimitForItem(id);
    const dUsed = dailyMap.get(id) ?? 0;
    const wUsed = weeklyMap.get(id) ?? 0;

    // 前缀限额的聚合：例如 book-purple 限额 2，需统计所有紫书的周购买量
    let dRemaining: number | null = null;
    let wRemaining: number | null = null;
    let purchasable = true;
    let reason: string | null = null;

    if (dLimit !== null) {
      // 若是前缀限额，需要统计同类
      let used = dUsed;
      if (id.startsWith('book-')) {
        // 统计同稀有度书籍的日购买
        const m = /-(gray|yellow|green|blue|purple)$/.exec(id);
        if (m) {
          const suffix = m[1];
          // 聚合所有 book-*-suffix
          let sum = 0;
          for (const [logItemId, qty] of dailyMap.entries()) {
            if (logItemId.endsWith(`-${suffix}`) && logItemId.startsWith('book-')) sum += qty;
          }
          used = sum;
        }
      }
      dRemaining = Math.max(0, dLimit - used);
      if (dRemaining <= 0) {
        purchasable = false;
        reason = '今日已达购买上限';
      }
    }

    if (wLimit !== null) {
      let used = wUsed;
      if (id.startsWith('book-')) {
        const m = /-(gray|yellow|green|blue|purple)$/.exec(id);
        if (m) {
          const suffix = m[1];
          let sum = 0;
          for (const [logItemId, qty] of weeklyMap.entries()) {
            if (logItemId.endsWith(`-${suffix}`) && logItemId.startsWith('book-')) sum += qty;
          }
          used = sum;
        }
      }
      wRemaining = Math.max(0, wLimit - used);
      if (wRemaining <= 0) {
        purchasable = false;
        reason = '本周已达购买上限';
      }
    }

    if (user.reputation < repReq) {
      purchasable = false;
      reason = `声誉 ${repReq} 解锁`;
    }

    if (user.money < price) {
      // 金币不足也标记不可购买，但 reason 保留之前的更重要
      if (purchasable) {
        purchasable = false;
        reason = '金币不足';
      }
    }

    views.push({
      itemId: id,
      name: def.name,
      rarity: def.rarity as string,
      category: def.category as string,
      price,
      description: def.description,
      effectDesc: def.effect?.desc ?? null,
      ownedQuantity: ownedMap.get(id) ?? 0,
      reputationRequired: repReq,
      dailyLimit: dLimit,
      dailyRemaining: dRemaining,
      weeklyLimit: wLimit,
      weeklyRemaining: wRemaining,
      purchasable,
      reason,
    });
  }

  // 按稀有度+价格排序：灰<黄<绿<蓝<紫，价格升序
  const rarityOrder: Record<string, number> = { gray: 0, yellow: 1, green: 2, blue: 3, purple: 4, colorful: 5 };
  views.sort((a, b) => {
    const ra = rarityOrder[a.rarity.toLowerCase()] ?? 99;
    const rb = rarityOrder[b.rarity.toLowerCase()] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.price - b.price;
  });

  void autoAdvanceIfNeeded(userId, 'visit_shop');

  return {
    items: views,
    money: user.money,
    reputation: user.reputation,
  };
}

export async function buyItem(userId: number, itemId: string, quantity: number, now: Date = new Date()): Promise<ShopBuyResult> {
  if (!itemId) throw new ApiError('VALIDATION_FAILED', { resource: 'itemId', reason: 'itemId 必填' });
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
    throw new ApiError('VALIDATION_FAILED', { resource: 'quantity', reason: '数量必须为 1-99 的整数' });
  }
  const cfg = getConfig();
  if (!cfg) throw new Error('[shop] CONFIG 未加载');
  const def = cfg.items[itemId];
  if (!def) throw new ApiError('NOT_FOUND', { resource: 'item', itemId });
  if (!isPurchasable(def)) throw new ApiError('VALIDATION_FAILED', { resource: 'item', reason: '该道具不可购买' });

  const repReq = reputationRequiredForItem(itemId);
  const dLimit = dailyLimitForItem(itemId);
  const wLimit = weeklyLimitForItem(itemId);
  const dk = dayKey(now);
  const wk = weekKey(now);
  const totalCost = def.price! * quantity;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.reputation < repReq) {
      throw new ApiError('VALIDATION_FAILED', { resource: 'reputation', reason: `声誉不足，需 ${repReq}，当前 ${user.reputation}` });
    }
    if (user.money < totalCost) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'money', need: totalCost, have: user.money });
    }

    // 限购检查
    if (dLimit !== null) {
      let used = 0;
      if (itemId.startsWith('book-')) {
        const m = /-(gray|yellow|green|blue|purple)$/.exec(itemId);
        if (m) {
          const suffix = m[1];
          const logs = await tx.shopPurchaseLog.findMany({ where: { userId, dayKey: dk } });
          for (const l of logs) {
            if (l.itemId.endsWith(`-${suffix}`) && l.itemId.startsWith('book-')) used += l.quantity;
          }
        } else {
          const agg = await tx.shopPurchaseLog.aggregate({ where: { userId, itemId, dayKey: dk }, _sum: { quantity: true } });
          used = agg._sum.quantity ?? 0;
        }
      } else {
        const agg = await tx.shopPurchaseLog.aggregate({ where: { userId, itemId, dayKey: dk }, _sum: { quantity: true } });
        used = agg._sum.quantity ?? 0;
      }
      if (used + quantity > dLimit) {
        throw new ApiError('VALIDATION_FAILED', { resource: 'daily_limit', reason: `今日限购 ${dLimit}，已购 ${used}，本次 ${quantity} 超限` });
      }
    }

    if (wLimit !== null) {
      let used = 0;
      if (itemId.startsWith('book-')) {
        const m = /-(gray|yellow|green|blue|purple)$/.exec(itemId);
        if (m) {
          const suffix = m[1];
          const logs = await tx.shopPurchaseLog.findMany({ where: { userId, weekKey: wk } });
          for (const l of logs) {
            if (l.itemId.endsWith(`-${suffix}`) && l.itemId.startsWith('book-')) used += l.quantity;
          }
        } else {
          const agg = await tx.shopPurchaseLog.aggregate({ where: { userId, itemId, weekKey: wk }, _sum: { quantity: true } });
          used = agg._sum.quantity ?? 0;
        }
      } else {
        const agg = await tx.shopPurchaseLog.aggregate({ where: { userId, itemId, weekKey: wk }, _sum: { quantity: true } });
        used = agg._sum.quantity ?? 0;
      }
      if (used + quantity > wLimit) {
        throw new ApiError('VALIDATION_FAILED', { resource: 'weekly_limit', reason: `本周限购 ${wLimit}，已购 ${used}，本次 ${quantity} 超限` });
      }
    }

    // 扣钱
    const updated = await tx.user.updateMany({
      where: { id: userId, money: { gte: totalCost } },
      data: { money: { decrement: totalCost } },
    });
    if (updated.count === 0) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'money', need: totalCost });
    }

    // 加道具
    await tx.userItem.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { userId, itemId, quantity },
      update: { quantity: { increment: quantity } },
    });

    // 写日志
    await tx.shopPurchaseLog.create({
      data: { userId, itemId, quantity, dayKey: dk, weekKey: wk },
    });

    const freshUser = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const holding = await tx.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId, itemId } } });

    return {
      itemId,
      quantity,
      totalCost,
      moneyAfter: freshUser.money,
      ownedQuantity: holding.quantity,
    };
  });
}

export async function listLogs(userId: number, limit = 20) {
  return prisma.shopPurchaseLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });
}
