import type { Student } from '@prisma/client';
import { crossedDayBoundaries } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { aggregateMeta, type MetaAggregate } from './meta.js';

const HOUR_MS = 3_600_000;

/** 体力上限恒定 5（economy）；心态取值域（student.md §5.1） */
export const STAMINA_CAP = 5;
export const MINDSET_MIN = -10;
export const MINDSET_MAX = 10;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 懒结算纯投影（权威：docs/systems/student.md §5/§7）：
 * 1. stamina：单点间隔 45×50/staminaRegen 分钟（即 (4/3)×(regen/50) 点/小时），clamp [0,5]
 *    —— §7.1 速率行写作 (2/3)×(regen/50) 与其「等价间隔」行及全部示例（50→45min/点）
 *    相差 2 倍，属文档笔误；本实现按间隔公式/示例/gameplay「满体力约 4 小时」的自洽口径（已报协调者裁定）
 * 2. energy：+ 10×(1+meta.energy_regen/100) 点/小时，clamp [0,energyMax]
 * 3. mindset：每跨过一个 04:00 日界，向 B=clamp(1+meta.mindset_flat,−10,+10) 移 1 点，不越过 B
 * 4. 锚点 lastSettledAt 推进到 now（now ≤ 锚点时为幂等投影，锚点不倒退）
 * 返回更新后的新对象；调用方负责持久化（写路径内 UPDATE … WHERE updatedAt=旧值 乐观并发）。
 */
export function settle(s: Student, meta: MetaAggregate, now: Date): Student {
  const elapsedMs = now.getTime() - s.lastSettledAt.getTime();
  if (elapsedMs <= 0) return { ...s };
  const hours = elapsedMs / HOUR_MS;

  const staminaRate = (4 / 3) * (s.staminaRegen / 50); // = 60 / (45×50/regen)：45min/点 @ regen=50
  const stamina = clamp(s.stamina + staminaRate * hours, 0, STAMINA_CAP);

  const energyRate = 10 * (1 + (meta.energy_regen ?? 0) / 100);
  const energy = clamp(s.energy + energyRate * hours, 0, s.energyMax);

  const baseline = clamp(1 + (meta.mindset_flat ?? 0), MINDSET_MIN, MINDSET_MAX);
  const crossings = crossedDayBoundaries(s.lastSettledAt, now);
  const gap = baseline - s.mindset;
  const mindset = s.mindset + Math.sign(gap) * Math.min(crossings, Math.abs(gap));

  return { ...s, stamina, energy, mindset, lastSettledAt: now };
}

/**
 * 乐观并发持久化（TECH-DESIGN §5 并发三件套）：
 * 仅当行的 updatedAt 仍等于读取时快照才写入；返回是否写入成功，失败时调用方应重读后重试。
 */
export async function persistSettlement(prev: Student, next: Student): Promise<boolean> {
  const res = await prisma.student.updateMany({
    where: { id: prev.id, updatedAt: prev.updatedAt },
    data: {
      stamina: next.stamina,
      energy: next.energy,
      mindset: next.mindset,
      lastSettledAt: next.lastSettledAt,
    },
  });
  return res.count === 1;
}

/**
 * 写路径行内结算：读取（含天赋）→ 聚合 meta → settle → 乐观锁写入；
 * 快照过期则重读重试一次（结算以最新锚点投影，幂等不叠加），仍失败抛 STATE_CONFLICT。
 */
export async function settleStudent(id: number, now: Date = new Date()): Promise<Student> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await prisma.student.findUniqueOrThrow({
      where: { id },
      include: { talents: true },
    });
    const meta = aggregateMeta(current.talents.map((t) => t.talentId));
    const next = settle(current, meta, now);
    if (await persistSettlement(current, next)) {
      return prisma.student.findUniqueOrThrow({ where: { id } });
    }
  }
  throw new ApiError('STATE_CONFLICT', { studentId: id });
}
