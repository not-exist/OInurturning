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
    expect(buildFirstRound(Array.from({ length: 17 }, (_, userId) => ({ userId: userId + 1 })), 32, 42)).toHaveLength(16);
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
      const problem = index === 0 ? await prisma.problemLibraryEntry.create({ data: { userId: player.userId, authorStudentId: player.studentId, name: 'Frozen problem', dominantDim: 'DS', rarity: 'green', quality: 60 } }) : null;
      await registerPvp(player.userId, tournament.id, player.studentId, problem === null ? [] : [problem.id], PAST);
    }
    await prisma.student.update({ where: { id: players[0]!.studentId }, data: { name: 'Changed live name', ds: 99 } });
    await prisma.problemLibraryEntry.updateMany({ where: { userId: players[0]!.userId }, data: { name: 'Changed live problem', quality: 99 } });
    await advancePvpTournament(tournament.id, PAST);
    const record = await prisma.contestRecord.findFirstOrThrow({ where: { type: 'PVP' }, orderBy: { createdAt: 'asc' } });
    const input = record.inputSnapshot as { home: { displayName: string; abilities: { DS: number } } };
    expect(input.home.displayName).not.toBe('Changed live name');
    expect(input.home.abilities.DS).toBe(35);
  });

  it('resolves premade problem traits into the match snapshot', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Traits', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const players = [];
    for (let index = 0; index < 8; index += 1) {
      const player = await entrant();
      players.push(player);
      const problem = index === 0
        ? await prisma.problemLibraryEntry.create({ data: { userId: player.userId, authorStudentId: player.studentId, name: 'Traited problem', dominantDim: 'DS', rarity: 'green', quality: 60, traitId: 'wide-data' } })
        : null;
      await registerPvp(player.userId, tournament.id, player.studentId, problem === null ? [] : [problem.id], PAST);
    }
    await advancePvpTournament(tournament.id, PAST);
    const record = await prisma.contestRecord.findFirstOrThrow({ where: { type: 'PVP', userId: players[0]!.userId } });
    const input = record.inputSnapshot as { questions: Array<{ premadeEntryId?: number; traits: Array<{ traitId: string; severity: string; hooks: Array<{ partial_override?: string; tle_prob_add?: number }> }> }> };
    const premade = input.questions.find((question) => question.premadeEntryId !== undefined);
    expect(premade).toBeDefined();
    expect(premade!.traits).toHaveLength(1);
    expect(premade!.traits[0]!.traitId).toBe('wide-data');
    expect(premade!.traits[0]!.severity).toBe('red');
    expect(premade!.traits[0]!.hooks).toHaveLength(1);
    expect(premade!.traits[0]!.hooks[0]!.partial_override).toBe('none');
    expect(premade!.traits[0]!.hooks[0]!.tle_prob_add).toBeCloseTo(0.05);
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

  it('serves canonical detail/bracket/registration routes and scopes admin start', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'HTTP', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const players = [];
    for (let index = 0; index < 4; index += 1) {
      const player = await entrant();
      players.push(player);
      const response = await request(app).post(`/api/pvp/tournaments/${tournament.id}/registration`).set('Authorization', `Bearer ${player.token}`).send({ studentId: player.studentId, problemEntryIds: [] });
      expect(response.status).toBe(200);
    }
    expect((await request(app).get(`/api/pvp/tournaments/${tournament.id}`)).status).toBe(401);
    const detail = await request(app).get(`/api/pvp/tournaments/${tournament.id}`).set('Authorization', `Bearer ${players[0]!.token}`);
    expect(detail.status).toBe(200);
    const bracket = await request(app).get(`/api/pvp/tournaments/${tournament.id}/bracket`).set('Authorization', `Bearer ${players[0]!.token}`);
    expect(bracket.status).toBe(200);
    const forbidden = await request(app).post(`/api/admin/pvp-tournaments/${tournament.id}/actions/start`).set('Authorization', `Bearer ${players[0]!.token}`);
    expect(forbidden.status).toBe(403);
    await prisma.user.update({ where: { id: players[0]!.userId }, data: { role: 'ADMIN' } });
    const started = await request(app).post(`/api/admin/pvp-tournaments/${tournament.id}/actions/start`).set('Authorization', `Bearer ${players[0]!.token}`);
    expect(started.status).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { action: 'PVP_TOURNAMENT_START', targetId: String(tournament.id) } })).toBe(1);
    const matches = await prisma.pvpMatch.findMany({ where: { tournamentId: tournament.id, status: 'DONE' } });
    const away = matches[0]!.awayUserId!;
    const awayRecord = await request(app).get(`/api/records/${matches[0]!.contestRecordId}`).set('Authorization', `Bearer ${players.find((player) => player.userId === away)!.token}`);
    expect(awayRecord.status).toBe(200);
    const outsider = await entrant();
    const outsiderRecord = await request(app).get(`/api/records/${matches[0]!.contestRecordId}`).set('Authorization', `Bearer ${outsider.token}`);
    expect([403, 404]).toContain(outsiderRecord.status);
    const outsiderBracket = await request(app).get(`/api/pvp/tournaments/${tournament.id}/bracket`).set('Authorization', `Bearer ${outsider.token}`);
    expect(outsiderBracket.status).toBe(200);
    expect(outsiderBracket.body.data.every((match: { contestRecordId: string | null; reportUrl: string | null }) => match.contestRecordId === null && match.reportUrl === null)).toBe(true);
  });

  it('settles concurrent registration and underfilled advance without deadlock', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Race', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const player = await entrant();
    const outcome = await Promise.race([
      Promise.allSettled([
        registerPvp(player.userId, tournament.id, player.studentId, [], PAST),
        advancePvpTournament(tournament.id, PAST),
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('registration/advance timeout')), 5_000)),
    ]);
    expect(outcome).toHaveLength(2);
    expect((await prisma.pvpTournament.findUniqueOrThrow({ where: { id: tournament.id } })).status).toBe('CANCELLED');
  });

  it('passes the tournament quality-scoring rule into every duel report', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Quality rule', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: { rules: { qualityScoring: true } } } });
    for (let index = 0; index < 4; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await advancePvpTournament(tournament.id, PAST);
    const records = await prisma.contestRecord.findMany({ where: { type: 'PVP' } });
    expect(records.length).toBe(3);
    expect(records.every((record) => (record.report as { qualityRuleOn: boolean }).qualityRuleOn)).toBe(true);
    expect(records.every((record) => (record.report as { tiebreak: string }).tiebreak === 'SUDDEN_DEATH')).toBe(true);
  });

  it('awards reputation for an unsolved carried problem once per match', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Problem reputation', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const owner = await entrant();
    const problem = await prisma.problemLibraryEntry.create({ data: { userId: owner.userId, authorStudentId: owner.studentId, name: 'Hard carried problem', dominantDim: 'DS', rarity: 'rainbow', quality: 100 } });
    await registerPvp(owner.userId, tournament.id, owner.studentId, [problem.id], PAST);
    for (let index = 0; index < 3; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }

    await advancePvpTournament(tournament.id, PAST);
    const repAfterFirstAdvance = (await prisma.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { reputation: true } })).reputation;
    const logsAfterFirstAdvance = await prisma.reputationLog.findMany({ where: { userId: owner.userId, reason: { startsWith: 'PVP_PROBLEM:' } } });
    expect(logsAfterFirstAdvance.length).toBeGreaterThanOrEqual(1);
    expect(repAfterFirstAdvance).toBe(logsAfterFirstAdvance.length * 2);
    expect(logsAfterFirstAdvance.every((log) => log.delta === 2)).toBe(true);
    expect(new Set(logsAfterFirstAdvance.map((log) => log.reason)).size).toBe(logsAfterFirstAdvance.length);

    await advancePvpTournament(tournament.id, PAST);
    const repAfterReplay = (await prisma.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { reputation: true } })).reputation;
    const logsAfterReplay = await prisma.reputationLog.findMany({ where: { userId: owner.userId, reason: { startsWith: 'PVP_PROBLEM:' } } });
    expect(repAfterReplay).toBe(repAfterFirstAdvance);
    expect(logsAfterReplay).toHaveLength(logsAfterFirstAdvance.length);
  });

  it('caps one carried problem reputation at twelve points per tournament', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Problem reputation cap', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    const owner = await entrant();
    const problem = await prisma.problemLibraryEntry.create({ data: { userId: owner.userId, authorStudentId: owner.studentId, name: 'Capped carried problem', dominantDim: 'DS', rarity: 'rainbow', quality: 100 } });
    await registerPvp(owner.userId, tournament.id, owner.studentId, [problem.id], PAST);
    for (let index = 0; index < 3; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await prisma.user.update({ where: { id: owner.userId }, data: { reputation: 10 } });
    for (let index = 0; index < 5; index += 1) {
      await prisma.reputationLog.create({ data: { userId: owner.userId, delta: 2, reason: `PVP_PROBLEM:${tournament.id}:${problem.id}:seed-${index}:1` } });
    }

    await advancePvpTournament(tournament.id, PAST);
    const logs = await prisma.reputationLog.findMany({ where: { userId: owner.userId, reason: { startsWith: `PVP_PROBLEM:${tournament.id}:${problem.id}:` } } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { reputation: true } });
    expect(logs.reduce((sum, log) => sum + log.delta, 0)).toBe(12);
    expect(user.reputation).toBe(12);
  });

  it('publishes idempotent prize grants and lets the champion claim once', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Prize grants', size: 8, registerEndsAt: OPEN, autoStartAt: PAST, prizes: { champion: { money: 1234, items: [{ itemId: 'tag-card', count: 9 }] } }, config: {} } });
    const players = [];
    for (let index = 0; index < 4; index += 1) {
      const player = await entrant();
      players.push(player);
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }

    await advancePvpTournament(tournament.id, PAST);
    const grantsResponse = await request(app).get(`/api/pvp/tournaments/${tournament.id}/rewards`).set('Authorization', `Bearer ${players[0]!.token}`);
    expect(grantsResponse.status).toBe(200);
    expect(grantsResponse.body.data).toHaveLength(4);
    const championGrant = grantsResponse.body.data.find((grant: { rank: number }) => grant.rank === 1);
    expect(championGrant.rewards).toEqual(expect.arrayContaining([{ type: 'item', itemId: 'tag-card', count: 1 }]));
    expect(championGrant.rewards.filter((reward: { itemId?: string }) => reward.itemId === 'tag-card')).toHaveLength(1);

    const final = await prisma.pvpMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, status: 'DONE' }, orderBy: { round: 'desc' } });
    const champion = players.find((player) => player.userId === final.winnerUserId)!;
    const claim = await request(app).post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`).set('Authorization', `Bearer ${champion.token}`);
    expect(claim.status).toBe(200);
    expect(claim.body.data.claimedAt).not.toBeNull();
    expect((await prisma.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId: champion.userId, itemId: 'tag-card' } } })).quantity).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: champion.userId }, select: { money: true } })).money).toBe(1234);

    const replay = await request(app).post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`).set('Authorization', `Bearer ${champion.token}`);
    expect(replay.status).toBe(200);
    expect((await prisma.userItem.findUniqueOrThrow({ where: { userId_itemId: { userId: champion.userId, itemId: 'tag-card' } } })).quantity).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: champion.userId }, select: { money: true } })).money).toBe(1234);
  });

  it('uses the default prize buckets for champion, finalist and other first-round winners', async () => {
    const tournament = await prisma.pvpTournament.create({ data: { name: 'Default prizes', size: 16, registerEndsAt: OPEN, autoStartAt: PAST, prizes: {}, config: {} } });
    for (let index = 0; index < 16; index += 1) {
      const player = await entrant();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await advancePvpTournament(tournament.id, PAST);
    const grants = await prisma.pvpRewardGrant.findMany({ where: { tournamentId: tournament.id }, orderBy: { rank: 'asc' } });
    const champion = grants.find((grant) => grant.rank === 1)!;
    const ticketGrant = grants.find((grant) => grant.rank > 4 && (grant.rewards as Array<{ itemId?: string }>).some((reward) => reward.itemId === 'entry-ticket'));
    expect(champion.rewards).toEqual(expect.arrayContaining([
      { type: 'item', itemId: 'tag-card', count: 1 },
      { type: 'item', itemId: 'advance-stone', count: 2 },
      { type: 'item', itemId: 'trophy-champion', count: 1 },
    ]));
    expect(ticketGrant).toBeDefined();
    expect(ticketGrant!.rewards).toEqual(expect.arrayContaining([{ type: 'item', itemId: 'entry-ticket', count: 1 }]));
  });
});
