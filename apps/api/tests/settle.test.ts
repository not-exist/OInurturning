import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Student } from '@prisma/client';
import {
  SERVER_DAY_OFFSET_HOUR,
  crossedDayBoundaries,
  dayKey,
  weekKey,
} from '../src/lib/clock.js';
import {
  persistSettlement,
  settle,
  settleStudent,
} from '../src/modules/students/settle.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers } from './helpers.js';

// ---------------------------------------------------------------------------
// clock：04:00 服务器日界工具
// ---------------------------------------------------------------------------

describe('clock', () => {
  it('服务器日界固定为 04:00', () => {
    expect(SERVER_DAY_OFFSET_HOUR).toBe(4);
  });

  it('dayKey：04:00 前归前一日，04:00 起归当日', () => {
    expect(dayKey(new Date(2026, 7, 30, 3, 59, 59))).toBe('2026-08-29');
    expect(dayKey(new Date(2026, 7, 30, 4, 0, 0))).toBe('2026-08-30');
    expect(dayKey(new Date(2026, 7, 30, 23, 59, 59))).toBe('2026-08-30');
    expect(dayKey(new Date(2026, 7, 31, 0, 0, 0))).toBe('2026-08-30');
  });

  it('weekKey：ISO 8601 周键，且以 04:00 日界为 Shift 基准', () => {
    // 2026-01-01 是周四，属 2026 年 ISO 第 1 周
    expect(weekKey(new Date(2026, 0, 1, 12, 0, 0))).toBe('2026-W01');
    // 周一 04:00 前仍属上一日（周日）所在的上一周
    const beforeBoundary = weekKey(new Date(2026, 7, 31, 3, 59, 59)); // 周一凌晨 → 周日
    const afterBoundary = weekKey(new Date(2026, 7, 31, 4, 0, 0)); // 周一
    expect(beforeBoundary).not.toBe(afterBoundary);
    expect(afterBoundary).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('crossedDayBoundaries：统计 (from, to] 间跨过的 04:00 日界数', () => {
    // 同日不跨界
    expect(
      crossedDayBoundaries(new Date(2026, 7, 30, 12, 0), new Date(2026, 7, 30, 18, 0)),
    ).toBe(0);
    // 跨越一个 04:00
    expect(
      crossedDayBoundaries(new Date(2026, 7, 30, 3, 59), new Date(2026, 7, 30, 4, 0)),
    ).toBe(1);
    // 48 小时整跨 2 个日界
    expect(
      crossedDayBoundaries(new Date(2026, 7, 28, 12, 0), new Date(2026, 7, 30, 12, 0)),
    ).toBe(2);
    // 04:00 后到次日 04:00 前不跨界
    expect(
      crossedDayBoundaries(new Date(2026, 7, 30, 4, 0), new Date(2026, 7, 31, 3, 59)),
    ).toBe(0);
    // to ≤ from 恒为 0
    expect(
      crossedDayBoundaries(new Date(2026, 7, 30, 12, 0), new Date(2026, 7, 30, 12, 0)),
    ).toBe(0);
    expect(
      crossedDayBoundaries(new Date(2026, 7, 30, 18, 0), new Date(2026, 7, 30, 12, 0)),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// settle：懒结算纯投影（student.md §5/§7）
// ---------------------------------------------------------------------------

let seq = 0;
function makeStudent(overrides: Partial<Student> = {}): Student {
  seq += 1;
  return {
    id: seq,
    userId: 1,
    name: '测试学员',
    sex: 'MALE',
    qualityTier: 'COMMON',
    status: 'ACTIVE',
    ds: 10,
    dp: 10,
    math: 10,
    graph: 10,
    greedy: 10,
    str: 10,
    code: 10,
    thinking: 10,
    setting: 5,
    mindset: 2,
    focusCap: 45,
    energyMax: 60,
    energy: 0,
    stamina: 0,
    staminaRegen: 50,
    counters: {},
    lastSettledAt: new Date(2026, 7, 30, 12, 0, 0),
    recruitedAt: new Date(2026, 7, 1, 12, 0, 0),
    dismissedAt: null,
    updatedAt: new Date(2026, 7, 30, 12, 0, 0),
    ...overrides,
  };
}

describe('settle：体力恢复（§7.1）', () => {
  it('公式锚点：regen=50 → 45 分钟恢复 1 点', () => {
    const s = makeStudent({ stamina: 0, staminaRegen: 50 });
    const now = new Date(s.lastSettledAt.getTime() + 45 * 60_000);
    expect(settle(s, {}, now).stamina).toBeCloseTo(1, 10);
  });

  it('公式锚点：regen=100 → 45 分钟恢复 2 点；regen=25 → 90 分钟 1 点', () => {
    const s100 = makeStudent({ stamina: 0, staminaRegen: 100 });
    const now45 = new Date(s100.lastSettledAt.getTime() + 45 * 60_000);
    expect(settle(s100, {}, now45).stamina).toBeCloseTo(2, 10);

    const s25 = makeStudent({ stamina: 0, staminaRegen: 25 });
    const now90 = new Date(s25.lastSettledAt.getTime() + 90 * 60_000);
    expect(settle(s25, {}, now90).stamina).toBeCloseTo(1, 10);
  });

  it('不超过上限 5、浮点累积不取整', () => {
    const s = makeStudent({ stamina: 4.9, staminaRegen: 100 });
    const now = new Date(s.lastSettledAt.getTime() + 24 * 3_600_000);
    expect(settle(s, {}, now).stamina).toBe(5);

    const half = makeStudent({ stamina: 0, staminaRegen: 50 });
    const now22_5 = new Date(half.lastSettledAt.getTime() + 22.5 * 60_000);
    expect(settle(half, {}, now22_5).stamina).toBeCloseTo(0.5, 10);
  });
});

describe('settle：精力恢复（§7.2）', () => {
  it('默认 10 点/小时；meta.energy_regen 百分比加算', () => {
    const s = makeStudent({ energy: 0, energyMax: 60 });
    const now1h = new Date(s.lastSettledAt.getTime() + 3_600_000);
    expect(settle(s, {}, now1h).energy).toBeCloseTo(10, 10);
    expect(settle(s, { energy_regen: 20 }, now1h).energy).toBeCloseTo(12, 10);
    expect(settle(s, { energy_regen: -50 }, now1h).energy).toBeCloseTo(5, 10);
  });

  it('不超过 energyMax、不为负', () => {
    const s = makeStudent({ energy: 55, energyMax: 60 });
    const now = new Date(s.lastSettledAt.getTime() + 10 * 3_600_000);
    expect(settle(s, {}, now).energy).toBe(60);
  });
});

describe('settle：心态日回归（§5.1）', () => {
  const anchor = new Date(2026, 7, 28, 12, 0, 0);
  const twoDaysLater = new Date(2026, 7, 30, 12, 0, 0); // 跨 2 个 04:00

  it('未跨日界心态不变', () => {
    const s = makeStudent({ mindset: 5, lastSettledAt: anchor });
    const now = new Date(2026, 7, 29, 3, 59, 59);
    expect(settle(s, {}, now).mindset).toBe(5);
  });

  it('每跨一个日界向基准线 B=1（无天赋）移 1 点', () => {
    const high = makeStudent({ mindset: 5, lastSettledAt: anchor });
    expect(settle(high, {}, twoDaysLater).mindset).toBe(3);

    const low = makeStudent({ mindset: -3, lastSettledAt: anchor });
    expect(settle(low, {}, twoDaysLater).mindset).toBe(-1);
  });

  it('回归不越过基准线 B', () => {
    const s = makeStudent({ mindset: 2, lastSettledAt: anchor });
    const fiveDaysLater = new Date(2026, 8, 2, 12, 0, 0); // 跨 5 个日界
    expect(settle(s, {}, fiveDaysLater).mindset).toBe(1);
  });

  it('meta.mindset_flat 平移基准线：B=clamp(1+flat,−10,+10)', () => {
    const s = makeStudent({ mindset: 0, lastSettledAt: anchor });
    expect(settle(s, { mindset_flat: 3 }, twoDaysLater).mindset).toBe(2); // B=4，上移
    expect(settle(s, { mindset_flat: -5 }, twoDaysLater).mindset).toBe(-2); // B=-4，下移
    // flat 超出 ±10 时 B 截断到 ±10
    const extreme = makeStudent({ mindset: 8, lastSettledAt: anchor });
    expect(settle(extreme, { mindset_flat: 99 }, twoDaysLater).mindset).toBe(10);
  });
});

describe('settle：锚点与边界', () => {
  it('lastSettledAt 推进到 now；不修改入参对象', () => {
    const s = makeStudent({ stamina: 0 });
    const now = new Date(s.lastSettledAt.getTime() + 3_600_000);
    const next = settle(s, {}, now);
    expect(next.lastSettledAt).toEqual(now);
    expect(next).not.toBe(s);
    expect(s.stamina).toBe(0);
  });

  it('now ≤ lastSettledAt 时为纯幂等投影（锚点不倒退）', () => {
    const s = makeStudent({ stamina: 1, energy: 1, mindset: 5 });
    const same = settle(s, { mindset_flat: 9 }, s.lastSettledAt);
    expect(same.lastSettledAt).toEqual(s.lastSettledAt);
    expect(same.stamina).toBe(1);
    expect(same.energy).toBe(1);
    expect(same.mindset).toBe(5);

    const past = new Date(s.lastSettledAt.getTime() - 3_600_000);
    expect(settle(s, {}, past).lastSettledAt).toEqual(s.lastSettledAt);
  });
});

// ---------------------------------------------------------------------------
// 持久化：乐观并发（TECH-DESIGN §5）
// ---------------------------------------------------------------------------

async function createStudentRow(overrides: Record<string, unknown> = {}): Promise<Student> {
  const user = await prisma.user.create({
    data: { username: `st-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`, passwordHash: 'x' },
  });
  return prisma.student.create({
    data: {
      userId: user.id,
      name: '结算学员',
      sex: 'FEMALE',
      qualityTier: 'COMMON',
      ds: 10, dp: 10, math: 10, graph: 10, greedy: 10, str: 10,
      code: 10, thinking: 10, setting: 5,
      focusCap: 45,
      energyMax: 60,
      energy: 0,
      stamina: 0,
      staminaRegen: 50,
      ...overrides,
    },
  });
}

describe('settle 持久化', () => {
  beforeAll(async () => {
    await importConfigs();
  });

  beforeEach(async () => {
    await resetUsers();
  });

  it('settleStudent：行内结算并持久化，锚点推进', async () => {
    const row = await createStudentRow({
      stamina: 0,
      lastSettledAt: new Date(2026, 7, 30, 12, 0, 0),
    });
    const now = new Date(2026, 7, 30, 12, 45, 0); // +45min → +1 体力
    const settled = await settleStudent(row.id, now);
    expect(settled.stamina).toBeCloseTo(1, 10);
    expect(settled.lastSettledAt).toEqual(now);

    const persisted = await prisma.student.findUniqueOrThrow({ where: { id: row.id } });
    expect(persisted.stamina).toBeCloseTo(1, 10);
    expect(persisted.lastSettledAt).toEqual(now);
  });

  it('乐观锁：并发双写中过期快照写入失败，重读重试后成功', async () => {
    const row = await createStudentRow({
      stamina: 0,
      lastSettledAt: new Date(2026, 7, 30, 12, 0, 0),
    });
    const now = new Date(2026, 7, 30, 13, 30, 0);

    // 两个并发事务各自读到同一快照（相同 updatedAt）
    const txA = await prisma.student.findUniqueOrThrow({ where: { id: row.id } });
    const txB = await prisma.student.findUniqueOrThrow({ where: { id: row.id } });
    expect(txA.updatedAt).toEqual(txB.updatedAt);

    // A 先写入成功
    const nextA = settle(txA, {}, now);
    await expect(persistSettlement(txA, nextA)).resolves.toBe(true);

    // B 持过期快照写入 → 乐观锁拒绝
    const nextB = settle(txB, {}, now);
    await expect(persistSettlement(txB, nextB)).resolves.toBe(false);

    // B 重读重试一次 → 成功（结算幂等：锚点已推进，结果不再叠加）
    const txB2 = await prisma.student.findUniqueOrThrow({ where: { id: row.id } });
    const nextB2 = settle(txB2, {}, now);
    await expect(persistSettlement(txB2, nextB2)).resolves.toBe(true);

    const final = await prisma.student.findUniqueOrThrow({ where: { id: row.id } });
    expect(final.stamina).toBeCloseTo(nextA.stamina, 10); // 只结算一次，不双倍恢复
    expect(final.lastSettledAt).toEqual(now);
  });
});
