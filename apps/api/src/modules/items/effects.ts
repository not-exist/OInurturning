import { z } from 'zod';
import { ITEM_USE_LIMITS, USABLE_ITEM_ID_SET } from '@oinur/shared';
import type { Student } from '@prisma/client';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { dayKey, weekKey } from '../../lib/clock.js';
import { MINDSET_MIN, MINDSET_MAX, STAMINA_CAP } from '../students/settle.js';
import type { MetaAggregate } from '../students/meta.js';

/**
 * 道具效果分派（M1 Task 5 修订，效果权威：docs/systems/student.md §8 / docs/data/items.yaml，
 * 集成裁定 M1-R9 已按 items.yaml 对齐）。
 *
 * F-4 义务：items.yaml 的 effect 为异构 passthrough，本模块消费其子键（amount/attribute 等）
 * 时一律用 zod 严格收口——好数据通过、坏数据（字段写错/类型错）抛 VALIDATION_FAILED，绝不产生 NaN。
 *
 * M1 可用道具：calm-pill / milk-tea / stamina-potion / drumstick-bento / coffee / focus-engine /
 *         直用书 book-thinking|book-coding|book-setting × 五档。
 * M1 不可用（VALIDATION_FAILED「该道具暂不可用」）：vigor-drink（energy_restore 20 需比赛场景，M1 无比赛）、
 *         升阶/洗练/礼盒/徽章/六维书/tag 类/advance-stone 等。
 */

// ---------------------------------------------------------------------------
// F-4：消费子键的 zod 收口
// ---------------------------------------------------------------------------

/** amount 必须为有限数值（NaN/Infinity 拒绝）；异构子键 passthrough 放行（F-4 收口要点） */
const amountField = z.object({ amount: z.number().finite() });
/** 咖啡类：amount 有限数值 + mentality_change 必须为有限数值（心态副作用）；其余子键 passthrough 放行（F-4） */
const staminaMindsetField = z
  .object({ amount: z.number().finite(), mentality_change: z.number().finite() })
  .passthrough();
/** 直用书：attribute 必须为合法科目键、amount 为有限数值 */
const bookField = z.object({ attribute: z.string().min(1), amount: z.number().finite() });

/** 从 effect（部分）抽取有限数值子键；字段缺失/类型错 → VALIDATION_FAILED（F-4） */
function numericField(eff: unknown, field: string, itemId: string): number {
  if (typeof eff !== 'object' || eff === null) {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, field, reason: `${field} 缺失或非数值` });
  }
  const r = amountField.safeParse(eff);
  if (r.success) return r.data.amount;
  throw new ApiError('VALIDATION_FAILED', { resource: itemId, field, reason: `${field} 缺失或非数值` });
}

/** 从 effect 抽取 amount + mentality_change（咖啡）；缺失/类型错 → VALIDATION_FAILED（F-4） */
function coffeeField(eff: unknown, itemId: string): { amount: number; mentalityChange: number } {
  if (typeof eff !== 'object' || eff === null) {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: 'amount/mentality_change 缺失或非数值' });
  }
  const r = staminaMindsetField.safeParse(eff);
  if (r.success) return { amount: r.data.amount, mentalityChange: r.data.mentality_change };
  throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: 'amount/mentality_change 缺失或非数值' });
}

/** 从 effect（部分）抽取直用书字段（attribute + amount）；缺失/类型错 → VALIDATION_FAILED（F-4） */
function bookFields(eff: unknown, itemId: string): { attribute: string; amount: number } {
  if (typeof eff !== 'object' || eff === null) {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: '属性/增益字段缺失或非数值' });
  }
  const r = bookField.safeParse(eff);
  if (r.success) return r.data;
  throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: '属性/增益字段缺失或非数值' });
}

// ---------------------------------------------------------------------------
// 道具限额与白名单：唯一真源在 @oinur/shared（前端经子路径共用同一常量，
// 杜绝前端自维护白名单的历史缺陷）。
// ---------------------------------------------------------------------------

export const FOCUS_CAP_MAX = 100;

/** 直用书科目键 → Student 列名（items.yaml 的 coding→code 列，string 维记作 str） */
const BOOK_ATTR_COLUMNS: Record<string, keyof Student> = {
  thinking: 'thinking',
  coding: 'code',
  setting: 'setting',
};

// ---------------------------------------------------------------------------
// 计数器读写（稀疏 Json，04:00 日界 / ISO 周界由 clock 比对重置）
// ---------------------------------------------------------------------------

interface Counters {
  milkTea?: number;
  milkTeaKey?: string;
  coffeeDaily?: number;
  coffeeDailyKey?: string;
  staminaPotionDaily?: number;
  staminaPotionDailyKey?: string;
  bookWeek?: Record<string, number>;
  bookWeekKey?: string;
  focusEngineUsed?: number;
  [k: string]: unknown;
}

function countersOf(s: Student): Counters {
  return (s.counters ?? {}) as Counters;
}

function num(c: Counters, key: string): number {
  const v = c[key];
  return typeof v === 'number' ? v : 0;
}

function recordOf(c: Counters, key: string): Record<string, number> {
  const v = c[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
}

// ---------------------------------------------------------------------------
// 效果应用结果
// ---------------------------------------------------------------------------

export interface EffectApplyResult {
  /** 需写回的学员字段增量（含 lastSettledAt 锚点推进，由调用方合并） */
  patch: Partial<Student>;
  /** 写回的计数器（稀疏 Json；含周期键以便下次比对重置） */
  counters: Counters;
}

export interface EffectApplyInput {
  itemId: string;
  student: Student;
  meta: MetaAggregate;
  now: Date;
}

/** 按 itemId 向效果层分派；白名单外/非法 → ApiError VALIDATION_FAILED */
export function applyItemEffect(input: EffectApplyInput): EffectApplyResult {
  const { itemId, student, meta, now } = input;
  const def = getConfig()?.items[itemId];
  if (!def) throw new ApiError('NOT_FOUND', { resource: 'item', itemId });

  // 改名卡走改名端点消耗，不经 use
  if (itemId === 'rename-card') {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: '改名卡需通过改名接口使用' });
  }

  // 可用性唯一真源：@oinur/shared USABLE_ITEM_IDS（81 件中 21 件，与前端共用）。
  // 不在表内一律「暂不可用」——典型：vigor-drink（energy_restore 属比赛场景，M1 无赛事）、
  // 升阶石/洗练券/礼盒/徽章/tag 类道具/六维书（定向训练耗材）。
  if (!USABLE_ITEM_ID_SET.has(itemId)) {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: '该道具暂不可用' });
  }

  switch (itemId) {
    case 'calm-pill':
      return mentalityAdd(numericField(def.effect, 'amount', itemId), student);
    case 'milk-tea':
      return milkTea(numericField(def.effect, 'amount', itemId), student, now);
    case 'stamina-potion':
      return staminaPotion(numericField(def.effect, 'amount', itemId), student, now);
    case 'drumstick-bento':
      return drumstickBento(numericField(def.effect, 'amount', itemId), student);
    case 'coffee':
      return coffee(coffeeField(def.effect, itemId), student, now);
    case 'focus-engine':
      return focusEngine(numericField(def.effect, 'amount', itemId), student);
  }

  // 白名单剩余项即直用书（book-thinking/coding/setting × 五档）；科目合法性由 directBook 内部收口
  return directBook(itemId, def.effect, student, meta, now);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 通用「每日限额」判定：跨 04:00 日界即归零（items.yaml 未给机器可读限额时兜底） */
function dailyUsed(c: Counters, countKey: string, dayKeyField: string, key: string): number {
  return c[dayKeyField] === key ? num(c, countKey) : 0;
}

// --- 各效果 ---

/** 心态加：clamp [−10, +10]；不落日限（calm-pill） */
function mentalityAdd(amount: number, s: Student): EffectApplyResult {
  const mindset = clamp(s.mindset + amount, MINDSET_MIN, MINDSET_MAX);
  return {
    patch: { mindset },
    counters: countersOf(s),
  };
}

/** 奶茶：心态 +2，每日限 2 杯（04:00 日界重置，counters.milkTea/milkTeaKey） */
function milkTea(amount: number, s: Student, now: Date): EffectApplyResult {
  const c = countersOf(s);
  const key = dayKey(now);
  const used = dailyUsed(c, 'milkTea', 'milkTeaKey', key);
  if (used >= ITEM_USE_LIMITS.milkTeaDaily) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'milk-tea',
      reason: `每日限 ${ITEM_USE_LIMITS.milkTeaDaily} 杯，今日已用 ${used} 杯`,
    });
  }
  const mindset = clamp(s.mindset + amount, MINDSET_MIN, MINDSET_MAX);
  return {
    patch: { mindset },
    counters: { ...c, milkTea: used + 1, milkTeaKey: key },
  };
}

/** 体力药水：体力恢复 clamp [0, 5]，每日限 1 瓶（counters.staminaPotionDaily/staminaPotionDailyKey） */
function staminaPotion(amount: number, s: Student, now: Date): EffectApplyResult {
  const c = countersOf(s);
  const key = dayKey(now);
  const used = dailyUsed(c, 'staminaPotionDaily', 'staminaPotionDailyKey', key);
  if (used >= ITEM_USE_LIMITS.staminaPotionDaily) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'stamina-potion',
      reason: `每日限 ${ITEM_USE_LIMITS.staminaPotionDaily} 瓶，今日已用 ${used} 瓶`,
    });
  }
  const stamina = clamp(s.stamina + amount, 0, STAMINA_CAP);
  return {
    patch: { stamina },
    counters: { ...c, staminaPotionDaily: used + 1, staminaPotionDailyKey: key },
  };
}

/**
 * 鸡腿便当：体力恢复 clamp [0, 5]（+5 即回满）。
 * 不设每日限额——供给仅来自剧情关卡首通（每层每关 ×1，stages.yaml defaults），天然限量。
 */
function drumstickBento(amount: number, s: Student): EffectApplyResult {
  const stamina = clamp(s.stamina + amount, 0, STAMINA_CAP);
  return {
    patch: { stamina },
    counters: countersOf(s),
  };
}

/** 浓咖啡：体力恢复 clamp [0, 5] + 心态副作用 mentalityChange clamp [−10, +10]；每日限 2 杯（coffeeDaily 键） */
function coffee(
  eff: { amount: number; mentalityChange: number },
  s: Student,
  now: Date,
): EffectApplyResult {
  const c = countersOf(s);
  const key = dayKey(now);
  const used = dailyUsed(c, 'coffeeDaily', 'coffeeDailyKey', key);
  if (used >= ITEM_USE_LIMITS.coffeeDaily) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'coffee',
      reason: `每日限 ${ITEM_USE_LIMITS.coffeeDaily} 杯，今日已用 ${used} 杯`,
    });
  }
  const stamina = clamp(s.stamina + eff.amount, 0, STAMINA_CAP);
  const mindset = clamp(s.mindset + eff.mentalityChange, MINDSET_MIN, MINDSET_MAX);
  return {
    patch: { stamina, mindset },
    counters: { ...c, coffeeDaily: used + 1, coffeeDailyKey: key },
  };
}

/** 心流引擎：focus_cap 永久 +amount（clamp 100），每人限 1 台（counters.focusEngineUsed） */
function focusEngine(amount: number, s: Student): EffectApplyResult {
  const c = countersOf(s);
  const used = num(c, 'focusEngineUsed');
  if (used >= ITEM_USE_LIMITS.focusEngineMaxUses) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'focus-engine',
      reason: `心流引擎每人限 ${ITEM_USE_LIMITS.focusEngineMaxUses} 台，已用 ${used} 台`,
    });
  }
  if (s.focusCap >= FOCUS_CAP_MAX) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'focus-engine',
      reason: `专注力上限已达 ${FOCUS_CAP_MAX}，无需再使用心流引擎`,
    });
  }
  const focusCap = Math.min(FOCUS_CAP_MAX, s.focusCap + amount);
  return {
    patch: { focusCap },
    counters: { ...c, focusEngineUsed: used + 1 },
  };
}

/**
 * 直用书：固定增益（不走递减曲线）× (1 + meta.book_effect/100)；
 * 同学员同属性每周 ≤ 10 点（counters.bookWeek <周键, 属性>；ISO 周界由 weekKey 比对重置），受属性上限 100 约束。
 * book_effect 从天赋 meta 聚合（percent 加算后除以 100）。
 */
function directBook(itemId: string, eff: unknown, s: Student, meta: MetaAggregate, now: Date): EffectApplyResult {
  const { attribute, amount } = bookFields(eff, itemId);
  const column = BOOK_ATTR_COLUMNS[attribute];
  if (!column) {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, attribute, reason: '该科目书籍本期不可用' });
  }

  const c = countersOf(s);
  const key = weekKey(now);
  const bookWeek = c.bookWeekKey === key ? recordOf(c, 'bookWeek') : {};

  const effectMult = 1 + (meta.book_effect ?? 0) / 100;
  const rawGain = amount * effectMult;

  // 周限：同学员同属性合计 ≤ 10 点
  const weeklyUsed = bookWeek[attribute] ?? 0;
  const weeklyHeadroom = ITEM_USE_LIMITS.bookWeekCap - weeklyUsed;
  if (weeklyHeadroom <= 0) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: itemId,
      attribute,
      reason: `该属性本周书籍增益已达上限 ${ITEM_USE_LIMITS.bookWeekCap} 点`,
    });
  }

  const cur = s[column] as number;
  const applied = clamp(cur + Math.min(rawGain, weeklyHeadroom), 0, 100);
  const actual = applied - cur;
  if (actual <= 0) {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, attribute, reason: '该属性已达上限 100' });
  }

  const nextBookWeek = { ...bookWeek, [attribute]: weeklyUsed + actual };
  return {
    patch: { [column]: applied },
    counters: { ...c, bookWeek: nextBookWeek, bookWeekKey: key },
  };
}
