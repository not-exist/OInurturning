import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { importConfigs } from '../src/config/loader.js';
import { registerPvp } from '../src/modules/pvp/registration.js';
import { resetUsers, unwrapOk } from './helpers.js';
import { buildFirstRound } from '../src/modules/pvp/bracket.js';
import { advancePvpTournament } from '../src/modules/pvp/scheduler.js';

const app = createApp();
const PAST = new Date('2020-01-01T00:00:00.000Z');
const OPEN = new Date('2099-01-01T00:00:00.000Z');
let sequence = 0;

async function entrant(): Promise<{ userId: number; studentId: number; token: string }> {
  sequence += 1;
  const auth = await request(app).post('/api/auth/register').send({ username: `sched-${Date.now()}-${sequence}`, password: 'pw-123456' });
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(auth);
  const student = await prisma.student.create({ data: { userId: session.me.id, name: `Entrant ${sequence}`, sex: 'MALE', qualityTier: 'ELITE', ds: 35, dp: 35, math: 35, graph: 35, greedy: 35, str: 35, code: 35, thinking: 35, setting: 35, mindset: 0, focusCap: 30, energyMax: 80, energy: 80, stamina: 5, staminaRegen: 50, lastSettledAt: PAST } });
  await prisma.userItem.create({ data: { userId: session.me.id, itemId: 'entry-ticket', quantity: 1 } });
  return { userId: session.me.id, studentId: student.id, token: session.accessToken };
}

beforeEach(async () => { await resetUsers(); await importConfigs(); });

describe('PVP scheduler', () => {
  it('builds deterministic first-round byes for odd registration counts', () => {
    const participants = [1, 2, 3, 4, 5].map((userId) => ({ userId }));
    const first = buildFirstRound(participants, 8, 42);
    const second = buildFirstRound(participants, 8, 42);
    expect(first).toEqual(second);
    expect(first.filter((match) => match.status === 'BYE')).toHaveLength(3);
    expect(first.flatMap((match) => [match.homeUserId, match.awayUserId]).filter(Boolean)).toHaveLength(5);
  });

  it('exports a tournament advancement service', () => {
    expect(typeof advancePvpTournament).toBe('function');
  });

  it('cancels underfilled tournaments and refunds tickets once', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Small', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const player = await entrant();
    await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    await advancePvpTournament(tournament.id, PAST);
    await advancePvpTournament(tournament.id, PAST);
    expect((await prisma.pvpTournament.findUniqueOrThrow({ where: { id: tournament.id } })).status).toBe('CANCELLED');
    expect((await prisma.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId: player.userId, itemId: 'entry-ticket' } } })).quantity).toBe(1);
  });

  it('advances an eight-player tournament to FINISHED without duplicate rows', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Eight', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    for (let index = 0; index < 8; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await advancePvpTournament(tournament.id, PAST);
    await advancePvpTournament(tournament.id, PAST);
    expect((await prisma.pvpTournament.findUniqueOrThrow({ where: { id: tournament.id } })).status).toBe('FINISHED');
    expect(await prisma.pvpMatch.count({ where: { tournamentId: tournament.id } })).toBe(7);
    expect(await prisma.contestRecord.count({ where: { type: 'PVP' } })).toBe(7);
  });

  it('advances a sixteen-player tournament through all four rounds', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Sixteen', size: 16, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    for (let index = 0; index < 16; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await advancePvpTournament(tournament.id, PAST);
    expect((await prisma.pvpTournament.findUniqueOrThrow({ where: { id: tournament.id } })).status).toBe('FINISHED');
    expect(await prisma.pvpMatch.count({ where: { tournamentId: tournament.id } })).toBe(15);
    expect(await prisma.pvpMatch.count({ where: { tournamentId: tournament.id, status: 'DONE' } })).toBe(15);
  });

  it('uses registration snapshots after live student and problem rows change', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Snapshots', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const players = [];
    for (let index = 0; index < 8; index += 1) {
      const player = await entrant();
      players.push(player);
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await prisma.student.update({ where: { id: players[0]!.studentId }, data: { name: 'Changed live name', ds: 99 } });
    await advancePvpTournament(tournament.id, PAST);
    const record = await prisma.contestRecord.findFirstOrThrow({ where: { type: 'PVP' }, orderBy: { createdAt: 'asc' } });
    const input = record.inputSnapshot as { home: { displayName: string; abilities: { DS: number } } };
    expect(input.home.displayName).not.toBe('Changed live name');
    expect(input.home.abilities.DS).toBe(35);
  });

  it('serializes concurrent advances without duplicate matches or records', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Concurrent', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    for (let index = 0; index < 8; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await Promise.all([advancePvpTournament(tournament.id, PAST), advancePvpTournament(tournament.id, PAST), advancePvpTournament(tournament.id, PAST)]);
    expect(await prisma.pvpMatch.count({ where: { tournamentId: tournament.id } })).toBe(7);
    expect(await prisma.contestRecord.count({ where: { type: 'PVP' } })).toBe(7);
  });
});
