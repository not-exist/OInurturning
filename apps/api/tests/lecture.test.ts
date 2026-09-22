import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { getLectureTiers, listLectureLogs, teachLecture } from '../src/modules/academy/lecture.js';
import { resetUsers, unwrapOk } from './helpers.js';
import { importConfigs } from '../src/config/loader.js';

const app = createApp();
const NOW = new Date('2026-09-02T12:00:00.000Z');
let sequence = 0;

async function createUser(reputation = 0, money = 0): Promise<number> {
  sequence += 1;
  const user = await prisma.user.create({
    data: { username: `lecture-${sequence}-${Date.now().toString(36)}`, reputation, money },
  });
  return user.id;
}

async function createStudent(userId: number, value: number, stamina = 5): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '讲课学员',
            qualityTier: 'GOOD',
      ds: value,
      dp: value,
      math: value,
      graph: value,
      greedy: value,
      str: value,
      code: value,
      thinking: value,
      setting: value,
      mindset: 2,
      focusCap: 45,
      energyMax: 60,
      energy: 30,
      stamina,
      staminaRegen: 50,
      lastSettledAt: NOW,
    },
  });
  return student.id;
}

describe('M3 lecture flow', () => {
  beforeEach(async () => {
    await resetUsers();
    await importConfigs();
  });

  it('returns five configured audience tiers with per-user availability', async () => {
    const userId = await createUser();
    await createStudent(userId, 15);
    const tiers = await getLectureTiers(userId);

    expect(tiers).toHaveLength(5);
    expect(tiers.map((tier) => tier.id)).toEqual([
      'beginner',
      'junior',
      'senior',
      'provincial',
      'national',
    ]);
    expect(tiers.map((tier) => tier.available)).toEqual([true, false, false, false, false]);
  });

  it('accepts the exact threshold and applies reputation pay multiplier, reputation, and stamina cost', async () => {
    const userId = await createUser(100);
    const studentId = await createStudent(userId, 45);
    const result = await teachLecture(userId, studentId, 'senior', false, NOW);

    expect(result).toMatchObject({
      tier: 'senior',
      teachingValue: 45,
      threshold: 45,
      forced: false,
      success: true,
      money: 360,
      reputation: 4,
      staminaCost: 2,
      staminaAfter: 3,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).money).toBe(360);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).reputation).toBe(104);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).stamina).toBe(3);
    expect(await listLectureLogs(userId)).toHaveLength(1);
  });

  /** 成长增量按属性汇总（未出现的属性记 0），用于逐列核对写回结果 */
  function gainedOf(
    gains: { stat: string; amount: number }[],
    stat: 'setting' | 'thinking',
  ): number {
    return gains.filter((gain) => gain.stat === stat).reduce((sum, gain) => sum + gain.amount, 0);
  }

  it('settles lecture growth into setting/thinking without touching pay (issue #56)', async () => {
    const userId = await createUser(100);
    const studentId = await createStudent(userId, 45);
    const result = await teachLecture(userId, studentId, 'senior', false, NOW);

    expect(result).toMatchObject({ money: 360, reputation: 4, thinkingReq: 45, thinkingDeficit: false });
    expect(result.gains.length).toBeGreaterThan(0);
    // 思维=要求 → 匹配系数 1；cur=45 → 主成长 0.75×(1−0.45)^2，附带成长为其 35%
    const full = 0.75 * (1 - 0.45) ** 2;
    for (const gain of result.gains) {
      expect(['setting', 'thinking']).toContain(gain.stat);
      const known = [full, full * 0.35].some((candidate) => Math.abs(candidate - gain.amount) < 1e-9);
      expect(known).toBe(true);
    }

    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.setting).toBeCloseTo(45 + gainedOf(result.gains, 'setting'), 10);
    expect(student.thinking).toBeCloseTo(45 + gainedOf(result.gains, 'thinking'), 10);

    const [log] = await listLectureLogs(userId);
    expect(log?.thinkingReq).toBe(45);
    expect(log?.thinkingDeficit).toBe(false);
    expect(log?.gains).toEqual(result.gains);
  });

  it('gives no growth when thinking far exceeds the tier requirement', async () => {
    const userId = await createUser();
    const studentId = await createStudent(userId, 65); // senior 要求思维 45 → 超出 match_span=20
    const result = await teachLecture(userId, studentId, 'senior', false, NOW);

    expect(result.thinkingDeficit).toBe(false);
    expect(result.gains).toEqual([]);
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.setting).toBe(65);
    expect(student.thinking).toBe(65);
  });

  it('forced lecture with a thinking deficit: discounted growth on success, stat setback on a flop', async () => {
    const userId = await createUser();
    const studentId = await createStudent(userId, 37); // V=37 落强接窗 [37,45)；思维 37 < 要求 45
    const result = await teachLecture(userId, studentId, 'senior', true, NOW);

    expect(result).toMatchObject({ forced: true, thinkingReq: 45, thinkingDeficit: true });
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.setting).toBeCloseTo(37 + gainedOf(result.gains, 'setting'), 10);
    expect(student.thinking).toBeCloseTo(37 + gainedOf(result.gains, 'thinking'), 10);

    if (result.success) {
      expect(result.gains.length).toBeGreaterThan(0);
      for (const gain of result.gains) expect(gain.amount).toBeGreaterThan(0);
    } else {
      // 讲砸且思维不足 → 出题与思维按 forced_deficit_loss 回落（0.5 / 0.8）
      expect(result.gains).toEqual([
        { stat: 'thinking', amount: expect.closeTo(-0.8, 10) },
        { stat: 'setting', amount: expect.closeTo(-0.5, 10) },
      ]);
      expect(student.thinking).toBeCloseTo(36.2, 10);
      expect(student.setting).toBeCloseTo(36.5, 10);
    }
  });

  it('never loses stats on a flop when thinking meets the requirement', async () => {
    const userId = await createUser();
    // V=40（强接窗）但思维 50 ≥ 要求 45：讲砸只扣声誉与心态，不动属性
    const student = await prisma.student.create({
      data: {
        userId,
        name: '思维型讲师',
        qualityTier: 'GOOD',
        ds: 45, dp: 45, math: 45, graph: 45, greedy: 45, str: 45,
        code: 25, thinking: 50, setting: 30,
        mindset: 2, focusCap: 45, energyMax: 60, energy: 30,
        stamina: 5, staminaRegen: 50, lastSettledAt: NOW,
      },
    });
    const result = await teachLecture(userId, student.id, 'senior', true, NOW);

    expect(result.thinkingDeficit).toBe(false);
    if (!result.success) {
      expect(result.gains).toEqual([]);
      const after = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
      expect(after.thinking).toBe(50);
      expect(after.setting).toBe(30);
    }
  });

  it('adds the configured overflow multiplier to pay and reputation', async () => {
    const userId = await createUser(100);
    const studentId = await createStudent(userId, 55);
    const result = await teachLecture(userId, studentId, 'senior', false, NOW);

    expect(result.money).toBe(504); // 300 × 1.2 × 1.4
    expect(result.reputation).toBe(6); // 4 × (1 + 2 full overflow steps × 20%)
  });

  it('requires force in the eight-point under-threshold window and rejects one point below it', async () => {
    const userId = await createUser();
    const nearId = await createStudent(userId, 37);
    await expect(teachLecture(userId, nearId, 'senior', false, NOW)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    const forced = await teachLecture(userId, nearId, 'senior', true, NOW);
    expect(forced.forced).toBe(true);
    expect(forced.money === 0 || forced.money > 0).toBe(true);

    const belowId = await createStudent(userId, 36);
    await expect(teachLecture(userId, belowId, 'senior', true, NOW)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('enforces three lectures per day and two appearances per student', async () => {
    const userId = await createUser();
    const first = await createStudent(userId, 45);
    const second = await createStudent(userId, 45);
    await teachLecture(userId, first, 'senior', false, NOW);
    await teachLecture(userId, first, 'senior', false, NOW);
    await expect(teachLecture(userId, first, 'senior', false, NOW)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    await teachLecture(userId, second, 'senior', false, NOW);
    const third = await createStudent(userId, 45);
    await expect(teachLecture(userId, third, 'senior', false, NOW)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('exposes authenticated lecture tier and history routes', async () => {
    sequence += 1;
    const registration = await request(app)
      .post('/api/auth/register')
      .send({ username: `lecture-route-${sequence}-${Date.now().toString(36)}`, password: 'pw-123456' });
    const session = unwrapOk<{ accessToken: string; me: { id: number } }>(registration);
    const studentId = await createStudent(session.me.id, 45);
    const headers = { Authorization: `Bearer ${session.accessToken}` };

    const tiers = await request(app).get('/api/academy/lecture-tiers').set(headers);
    expect(tiers.status).toBe(200);
    expect(unwrapOk<unknown[]>(tiers)).toHaveLength(5);
    const lecture = await request(app)
      .post('/api/academy/lectures')
      .set(headers)
      .send({ studentId, tier: 'senior' });
    expect(lecture.status).toBe(200);
    const history = await request(app).get('/api/academy/lectures').set(headers);
    expect(history.status).toBe(200);
    expect(unwrapOk<unknown[]>(history)).toHaveLength(1);
  });
});
