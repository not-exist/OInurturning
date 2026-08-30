import { z } from 'zod';
import type { Student } from '@prisma/client';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { dayKey, weekKey } from '../../lib/clock.js';
import { MINDSET_MIN, MINDSET_MAX, STAMINA_CAP } from '../students/settle.js';
import type { MetaAggregate } from '../students/meta.js';

/**
 * 道具效果分派（M1 Task 5，效果权威：docs/systems/student.md §8 / .superpowers M1 Task 5 简报）。
 *
 * F-4 义务：items.yaml 的 effect 为异构 passthrough，本模块消费其子键（amount/attribute 等）
 * 时一律用 zod 严格收口——好数据通过、坏数据（字段写错/类型错）抛 VALIDATION_FAILED，绝不产生 NaN。
 *
 * M1 可用道具：calm-pill / milk-tea / stamina-potion / coffee / vigor-drink / focus-engine /
 *         直用书 book-thinking|book-coding|book-setting × 五档。
 * 其余类别（升阶/洗练/礼盒/徽章/六维书等）→ VALIDATION_FAILED「该道具暂不可用」或归属对应端点。
 */

// ---------------------------------------------------------------------------
// F-4：消费子键的 zod 收口
// ---------------------------------------------------------------------------

/** amount 必须为有限数值（NaN/Infinity 拒绝）；异构子键 passthrough 放行（F-4 收口要点） */
const amountField = z.object({ amount: z.number().finite() });
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
// M1 道具数值规则（简报权威；数值由 items.yaml 的 effect 子键承载，此处不硬编码）
// ---------------------------------------------------------------------------

export const MILK_TEA_DAILY_LIMIT = 2;
export const VIGOR_MAX_USES = 3;
export const FOCUS_ENGINE_MAX_USES = 2;
export const BOOK_WEEK_CAP = 10;
export const FOCUS_CAP_MAX = 100;
export const ENERGY_MAX_CAP = 100;

/** 直用书科目键 → Student 列名（items.yaml 的 coding→code 列，string 维记作 str） */
const BOOK_ATTR_COLUMNS: Record<string, keyof Student> = {
  thinking: 'thinking',
  coding: 'code',
  setting: 'setting',
};

/** 六维书专属（定向训练耗材），非 M1 直接可用 */
const DIRECT_BOOK_ATTRS = new Set(Object.keys(BOOK_ATTR_COLUMNS));

// ---------------------------------------------------------------------------
// 计数器读写（稀疏 Json，04:00 日界 / ISO 周界由 clock 比对重置）
// ---------------------------------------------------------------------------

interface Counters {
  milkTea?: number;
  milkTeaKey?: string;
  bookWeek?: Record<string, number>;
  bookWeekKey?: string;
  vigorUsed?: number;
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

/** 按 itemId 向效果层分派（M1 范围）；不可用/非法 → ApiError VALIDATION_FAILED */
export function applyItemEffect(input: EffectApplyInput): EffectApplyResult {
  const { itemId, student, meta, now } = input;
  const def = getConfig()?.items[itemId];
  if (!def) throw new ApiError('NOT_FOUND', { resource: 'item', itemId });

  switch (itemId) {
    case 'calm-pill':
      return mentalityAdd(calmPillAmount(def.effect, itemId), student);
    case 'milk-tea':
      return milkTea(milkTeaAmount(def.effect, itemId), student, now);
    case 'stamina-potion':
      return staminaRestore(restoreAmount(def.effect, itemId), student);
    case 'coffee':
      return energyRestore(restoreAmount(def.effect, itemId), student);
    case 'vigor-drink':
      return vigorDrink(capAmount(def.effect, itemId), student);
    case 'focus-engine':
      return focusEngine(capAmount(def.effect, itemId), student);
  }

  // 直用书（book-thinking/书 coding/setting）× 五档
  if (itemId.startsWith('book-') && isDirectBook(itemId)) {
    return directBook(itemId, def.effect, student, meta, now);
  }

  // rename-card 由 rename 端点消耗，不可通过 use 直接使用
  if (itemId === 'rename-card') {
    throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: '改名卡需通过改名接口使用' });
  }

  // M1 不可用（升阶/洗练/礼盒/徽章/tag 类/六维书）——后续里程碑实现
  throw new ApiError('VALIDATION_FAILED', { resource: itemId, reason: '该道具暂不可用' });
}

function isDirectBook(itemId: string): boolean {
  // 形如 book-<subject>-<rarity>；仅 thinking/coding/setting 三个科目属 M1 直用（六维书为耗材）
  const m = /^book-(.+)-\w+$/.exec(itemId);
  return m ? DIRECT_BOOK_ATTRS.has(m[1]) : false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// --- 子键抽取（zod 收口） ---

function calmPillAmount(eff: unknown, itemId: string): number {
  return numericField(eff, 'amount', itemId);
}
function milkTeaAmount(eff: unknown, itemId: string): number {
  return numericField(eff, 'amount', itemId);
}
function restoreAmount(eff: unknown, itemId: string): number {
  return numericField(eff, 'amount', itemId);
}
function capAmount(eff: unknown, itemId: string): number {
  return numericField(eff, 'amount', itemId);
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

/** 奶茶：心态 +1，每日限 2 杯（04:00 日界重置，counters.milkTea/milkTeaKey） */
function milkTea(amount: number, s: Student, now: Date): EffectApplyResult {
  const c = countersOf(s);
  const key = dayKey(now);
  const used = c.milkTeaKey === key ? num(c, 'milkTea') : 0;
  if (used >= MILK_TEA_DAILY_LIMIT) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'milk-tea',
      reason: `每日限 ${MILK_TEA_DAILY_LIMIT} 杯，今日已用 ${used} 杯`,
    });
  }
  const mindset = clamp(s.mindset + amount, MINDSET_MIN, MINDSET_MAX);
  return {
    patch: { mindset },
    counters: { ...c, milkTea: used + 1, milkTeaKey: key },
  };
}

/** 体力恢复：clamp [0, 5] */
function staminaRestore(amount: number, s: Student): EffectApplyResult {
  const stamina = clamp(s.stamina + amount, 0, STAMINA_CAP);
  return { patch: { stamina }, counters: countersOf(s) };
}

/** 精力恢复：clamp [0, energyMax] */
function energyRestore(amount: number, s: Student): EffectApplyResult {
  const energy = clamp(s.energy + amount, 0, s.energyMax);
  return { patch: { energy }, counters: countersOf(s) };
}

/** 精力药剂：energyMax +3（clamp 100），每人最多 3 次（counters.vigorUsed） */
function vigorDrink(amount: number, s: Student): EffectApplyResult {
  const c = countersOf(s);
  const used = num(c, 'vigorUsed');
  if (used >= VIGOR_MAX_USES) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'vigor-drink',
      reason: `精力药剂每人限 ${VIGOR_MAX_USES} 次，已用 ${used} 次`,
    });
  }
  const energyMax = Math.min(ENERGY_MAX_CAP, s.energyMax + amount);
  return {
    patch: { energyMax },
    counters: { ...c, vigorUsed: used + 1 },
  };
}

/** 心流引擎：focusCap +8（clamp 100），每人最多 2 次（counters.focusEngineUsed） */
function focusEngine(amount: number, s: Student): EffectApplyResult {
  const c = countersOf(s);
  const used = num(c, 'focusEngineUsed');
  if (used >= FOCUS_ENGINE_MAX_USES) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: 'focus-engine',
      reason: `心流引擎每人限 ${FOCUS_ENGINE_MAX_USES} 次，已用 ${used} 次`,
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
  const weeklyHeadroom = BOOK_WEEK_CAP - weeklyUsed;
  if (weeklyHeadroom <= 0) {
    throw new ApiError('VALIDATION_FAILED', {
      resource: itemId,
      attribute,
      reason: `该属性本周书籍增益已达上限 ${BOOK_WEEK_CAP} 点`,
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
