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
      sex: 'FEMALE',
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
