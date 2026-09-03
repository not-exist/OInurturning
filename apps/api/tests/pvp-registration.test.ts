import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { getRegistration, registerPvp } from '../src/modules/pvp/registration.js';
import { resetUsers, unwrapOk } from './helpers.js';

const app = createApp();
const REGISTER_END = new Date('2099-01-02T00:00:00.000Z');
const AUTO_START = new Date('2099-01-03T00:00:00.000Z');
const NOW = new Date('2026-09-03T12:00:00.000Z');
let sequence = 0;

async function createUser(money = 0): Promise<number> {
  sequence += 1;
  const user = await prisma.user.create({
    data: { username: `pvp-${sequence}-${Date.now().toString(36)}`, money },
  });
  return user.id;
}

async function createStudent(userId: number): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '报名学员',
      sex: 'MALE',
      qualityTier: 'ELITE',
      ds: 35,
      dp: 36,
      math: 37,
      graph: 38,
      greedy: 39,
      str: 40,
      code: 45,
      thinking: 45,
      setting: 30,
      mindset: 2,
      focusCap: 50,
      energyMax: 80,
      energy: 80,
      stamina: 5,
      staminaRegen: 50,
      lastSettledAt: NOW,
    },
  });
  return student.id;
}

async function createTournament(): Promise<number> {
  const adminId = await createUser();
  const tournament = await prisma.pvpTournament.create({
    data: {
      name: `PVP ${sequence}`,
      size: 8,
      registerEndsAt: REGISTER_END,
      autoStartAt: AUTO_START,
      prizes: {},
      config: {},
      createdBy: adminId,
    },
  });
  return tournament.id;
}

describe('M4.2 PVP registration', () => {
  beforeEach(async () => {
    await resetUsers();
    await importConfigs();
  });

  it('locks participant and problem snapshots and consumes one entry ticket', async () => {
    const userId = await createUser();
    const studentId = await createStudent(userId);
    const problem = await prisma.problemLibraryEntry.create({
      data: { userId, authorStudentId: studentId, name: '锁定题', dominantDim: 'DS', rarity: 'green', quality: 60 },
    });
    await prisma.userItem.create({ data: { userId, itemId: 'entry-ticket', quantity: 2 } });
    const tournamentId = await createTournament();

    const first = await registerPvp(userId, tournamentId, studentId, [problem.id], NOW);
    expect(first.replayed).toBe(false);
    expect(first.roster[0]?.displayName).toBe('报名学员');
    expect(first.problemSnapshots).toMatchObject([{ id: problem.id, name: '锁定题', quality: 60 }]);
    expect((await prisma.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId, itemId: 'entry-ticket' } } })).quantity).toBe(1);

    await prisma.problemLibraryEntry.update({ where: { id: problem.id }, data: { name: '改名题', quality: 99 } });
    const replay = await registerPvp(userId, tournamentId, studentId, [problem.id], NOW);
    expect(replay.replayed).toBe(true);
    expect(replay.problemSnapshots[0]?.name).toBe('锁定题');
    expect((await prisma.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId, itemId: 'entry-ticket' } } })).quantity).toBe(1);
    expect(await getRegistration(userId, tournamentId)).toMatchObject({ problemEntryIds: [problem.id] });
  });

  it('enforces ownership, quality, ticket, uniqueness and cutoff rules', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const studentId = await createStudent(userId);
    const otherStudentId = await createStudent(otherUserId);
    const low = await prisma.problemLibraryEntry.create({
      data: { userId, authorStudentId: studentId, name: '低质量题', dominantDim: 'DS', rarity: 'gray', quality: 39 },
    });
    const tournamentId = await createTournament();

    await expect(registerPvp(userId, tournamentId, studentId, [], NOW)).rejects.toMatchObject({ code: 'INSUFFICIENT_RESOURCE' });
    await prisma.userItem.create({ data: { userId, itemId: 'entry-ticket', quantity: 3 } });
    await expect(registerPvp(otherUserId, tournamentId, studentId, [], NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(registerPvp(userId, tournamentId, studentId, [low.id], NOW)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(registerPvp(userId, tournamentId, studentId, [low.id, low.id], NOW)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(registerPvp(otherUserId, tournamentId, otherStudentId, [], new Date('2099-01-03T00:00:00.000Z'))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('rejects registrations after the declared tournament capacity is reached', async () => {
    const tournamentId = await createTournament();
    const firstUser = await createUser();
    const secondUser = await createUser();
    const firstStudent = await createStudent(firstUser);
    const secondStudent = await createStudent(secondUser);
    await prisma.userItem.create({ data: { userId: firstUser, itemId: 'entry-ticket', quantity: 1 } });
    await prisma.userItem.create({ data: { userId: secondUser, itemId: 'entry-ticket', quantity: 1 } });
    await prisma.pvpTournament.update({ where: { id: tournamentId }, data: { size: 1 } });

    await registerPvp(firstUser, tournamentId, firstStudent, [], NOW);
    await expect(registerPvp(secondUser, tournamentId, secondStudent, [], NOW)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('exposes tournaments and registration over authenticated HTTP routes', async () => {
    const tournamentId = await createTournament();
    const registration = await request(app)
      .post('/api/auth/register')
      .send({ username: `pvp-route-${sequence}-${Date.now().toString(36)}`, password: 'pw-123456' });
    const session = unwrapOk<{ accessToken: string; me: { id: number } }>(registration);
    await prisma.user.update({ where: { id: session.me.id }, data: { money: 0 } });
    const routeStudent = await createStudent(session.me.id);
    await prisma.userItem.create({ data: { userId: session.me.id, itemId: 'entry-ticket', quantity: 1 } });
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const tournaments = await request(app).get('/api/pvp/tournaments').set(headers);
    expect(tournaments.status).toBe(200);
    expect(unwrapOk<{ id: number }[]>(tournaments).map((entry) => entry.id)).toContain(tournamentId);
    const registered = await request(app)
      .post(`/api/pvp/tournaments/${tournamentId}/register`)
      .set(headers)
      .send({ studentId: routeStudent, problemEntryIds: [] });
    expect(registered.status).toBe(200);
    expect((await request(app).get(`/api/pvp/tournaments/${tournamentId}/registration`).set(headers)).status).toBe(200);
  });
});
