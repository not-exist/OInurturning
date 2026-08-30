import type { Student } from '@prisma/client';
import { computeV, type StudentView, type Rarity } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';
import { applyItemEffect } from './effects.js';

/**
 * 背包服务（M1 Task 5）：
 * - GET 列表：读 UserItem 行，join 内存 CONFIG.items 补名称/稀有度/类别/描述/价格（纯读，不落库）；
 * - POST use：单事务内 锁学员行 → settle → 校验限制 → 应用效果 → 扣道具（quantity−1，0 删行）。
 *   道具扣减与属性变动全部走「条件 UPDATE + 事务」（TECH-DESIGN §5）。
 */

function requireConfig() {
  const config = getConfig();
  if (!config) throw new Error('[items] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  return config;
}

/** 背包行视图：库存 + 配置名称/稀有度/类别/描述（join CONFIG.items；已软弃用/缺失不会出现在列表） */
export interface ItemView {
  itemId: string;
  quantity: number;
  name: string;
  rarity: Rarity;
  category: string;
  description: string;
  price: number | null;
  effectDesc: string | null;
}

export async function listItems(userId: number): Promise<ItemView[]> {
  const config = requireConfig();
  const rows = await prisma.userItem.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  const views: ItemView[] = [];
  for (const row of rows) {
    const def = config.items[row.itemId];
    if (!def) continue; // 已软弃用的历史持有不展示
    views.push({
      itemId: row.itemId,
      quantity: row.quantity,
      name: def.name,
      rarity: def.rarity as Rarity,
      category: def.category,
      description: def.description,
      price: def.price,
      effectDesc: def.effect?.desc ?? null,
    });
  }
  return views;
}

/** 校验存在/归属/在册（物品使用需锁定一名在册学员） */
async function loadOwnedActive(userId: number, id: number): Promise<Student> {
  const s = await prisma.student.findUnique({ where: { id } });
  if (!s || s.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id });
  if (s.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id });
  return s;
}

function toStudentView(s: Student, talentIds: string[]): StudentView {
  return {
    id: s.id,
    name: s.name,
    sex: s.sex,
    qualityTier: s.qualityTier,
    status: s.status,
    ds: s.ds, dp: s.dp, math: s.math, graph: s.graph, greedy: s.greedy, str: s.str,
    code: s.code, thinking: s.thinking, setting: s.setting,
    mindset: s.mindset,
    focusCap: s.focusCap,
    energyMax: s.energyMax,
    energy: s.energy,
    stamina: s.stamina,
    staminaRegen: s.staminaRegen,
    counters: (s.counters ?? {}) as StudentView['counters'],
    talents: talentIds,
    v: computeV(s),
    recruitedAt: s.recruitedAt.toISOString(),
    dismissedAt: s.dismissedAt ? s.dismissedAt.toISOString() : null,
  };
}

export interface UseItemInput {
  itemId: string;
  studentId?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/**
 * POST 使用道具：锁学员行 → 读取（含天赋）并 settle 投影 → effects 分派 → 更新学员（乐观并发）
 * → 扣道具（quantity≥1 条件 UPDATE，扣到 0 删行）。全部在一个事务内，失败整体回滚。
 */
export async function useItem(userId: number, input: UseItemInput, now: Date = new Date()): Promise<StudentView> {
  requireConfig();
  if (!input.itemId) throw new ApiError('VALIDATION_FAILED', { resource: 'item', reason: 'itemId 必填' });
  if (input.studentId == null) throw new ApiError('VALIDATION_FAILED', { resource: 'student', reason: 'studentId 必填' });
  const id = input.studentId;

  // 提交事务前先校验归属/在册（快失败、避免无谓开销）
  await loadOwnedActive(userId, id);

  return prisma.$transaction(async (tx) => {
    // 1. 锁学员行（写事务内串行化并发使用）
    await tx.$queryRaw`SELECT id FROM Student WHERE id = ${id} FOR UPDATE`;
    const student = await tx.student.findUniqueOrThrow({ where: { id }, include: { talents: true } });
    if (student.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id });
    if (student.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id });

    // 2. 道具存在性 + 归属校验
    const config = requireConfig();
    if (!config.items[input.itemId]) {
      throw new ApiError('NOT_FOUND', { resource: 'item', itemId: input.itemId });
    }
    const held = await tx.userItem.findUnique({
      where: { userId_itemId: { userId, itemId: input.itemId } },
    });
    if (!held || held.quantity < 1) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: input.itemId, need: 1 });
    }

    // 3. 结算投影（懒结算：体力/精力/心态随现实时间恢复，锚点推进）
    const meta = aggregateMeta(student.talents.map((t) => t.talentId));
    const settled = settle(student, meta, now);

    // 4. 效果分派（zod 收口；限制校验与属性变动在此完成）
    const { patch, counters } = applyItemEffect({
      itemId: input.itemId,
      student: settled,
      meta,
      now,
    });

    // 5. 写回学员（乐观并发：仅当行未被并发改写）
    const updated = await tx.student.updateMany({
      where: { id, updatedAt: student.updatedAt },
      data: {
        ...patch,
        counters: counters as unknown as object,
        lastSettledAt: now,
      },
    });
    if (updated.count === 0) throw new ApiError('STATE_CONFLICT', { studentId: id });

    // 6. 扣道具（条件 UPDATE，杜绝超卖）；扣到 0 删行
    const consumed = await tx.userItem.updateMany({
      where: { userId, itemId: input.itemId, quantity: { gte: 1 } },
      data: { quantity: { decrement: 1 } },
    });
    if (consumed.count === 0) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: input.itemId, need: 1 });
    await tx.userItem.deleteMany({ where: { userId, itemId: input.itemId, quantity: { lte: 0 } } });

    const fresh = await tx.student.findUniqueOrThrow({ where: { id }, include: { talents: true } });
    return toStudentView(fresh, fresh.talents.map((t) => t.talentId));
  });
}
