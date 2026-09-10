import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { registerPvp } from '../src/modules/pvp/registration.js';
import { advancePvpTournament } from '../src/modules/pvp/scheduler.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * PVP 覆盖补强（registration/scheduler 覆盖 service 层报名/推进/退款/奖池默认桶）：
 * 奖励/认领/bracket/detail 的 HTTP 面、自定义奖池钱与声誉、认领幂等与鉴权、
 * 战报共享读、admin 一键开赛真实路径。需 entry-ticket 等生产道具 → docs/data。
 */
const app: Express = createApp();
const DOCS = path.resolve(import.meta.dirname, '../../../docs/data');
const PAST = new Date('2020-01-01T00:00:00.000Z');
const OPEN = new Date('2099-01-01T00:00:00.000Z');
let seq = 0;

beforeAll(async () => {
  await importConfigs({ configDir: DOCS });
});
beforeEach(async () => {
  await prisma.pvpTournament.deleteMany({});
  await resetUsers();
});

interface Player {
  userId: number;
  studentId: number;
  token: string;
}

async function register(username?: string): Promise<{ token: string; userId: number }> {
  seq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: username ?? `pvpcov-${Date.now().toString(36)}-${seq}`, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id };
}

async function makePlayer(): Promise<Player> {
  const { token, userId } = await register();
  const student = await prisma.student.create({
    data: {
      userId, name: `PVP 选手 ${seq}`, sex: 'MALE', qualityTier: 'ELITE',
      ds: 60, dp: 60, math: 60, graph: 60, greedy: 60, str: 60, code: 60, thinking: 60, setting: 60,
      focusCap: 40, energyMax: 80, energy: 80, staminaRegen: 50,
    },
  });
  await prisma.userItem.create({ data: { userId, itemId: 'entry-ticket', quantity: 1 } });
  return { userId, studentId: student.id, token };
}

async function makeTournament(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
  seq += 1;
  const row = await prisma.pvpTournament.create({
    data: { name: `覆盖杯 ${seq}`, size: 8, registerEndsAt: OPEN, autoStartAt: OPEN, prizes: {}, config: {}, ...overrides },
  });
  return { id: row.id };
}

/** 推进直到 FINISHED（单次 advance 通常跑完全程，循环仅防赛制分支）。 */
async function finishTournament(tournamentId: number): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    const detail = await advancePvpTournament(tournamentId, PAST);
    if (detail.status === 'FINISHED') return;
  }
  throw new Error(`tournament ${tournamentId} not finished after advances`);
}

interface RewardGrant {
  userId: number;
  rank: number;
  rewards: Array<{ type: string; itemId?: string; count?: number; amount?: number }>;
  claimedAt: string | null;
  claimable: boolean;
}

describe('pvp coverage：报名 HTTP', () => {
  it('报名成功快照 + 重复报名 replayed 同一记录', async () => {
    const tournament = await makeTournament();
    const player = await makePlayer();
    const first = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/register`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ studentId: player.studentId, problemEntryIds: [] });
    expect(first.status).toBe(200);
    const created = unwrapOk<{ id: number; replayed: boolean; roster: Array<{ studentId: number }> }>(first);
    expect(created.replayed).toBe(false);
    expect(created.roster[0]?.studentId).toBe(player.studentId);

    const again = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/register`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ studentId: player.studentId, problemEntryIds: [] });
    expect(again.status).toBe(200);
    const replayed = unwrapOk<{ id: number; replayed: boolean }>(again);
    expect(replayed).toMatchObject({ id: created.id, replayed: true });
  });

  it('报名校验：超 2 题/重复题/截止/满员', async () => {
    const tournament = await makeTournament();
    const player = await makePlayer();
    const auth = { Authorization: `Bearer ${player.token}` };
    const problems = await Promise.all([1, 2, 3].map(() => prisma.problemLibraryEntry.create({
      data: { userId: player.userId, authorStudentId: player.studentId, name: 'PVP 题', dominantDim: 'DS', rarity: 'green', quality: 60 },
    })));
    const tooMany = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/register`).set(auth)
      .send({ studentId: player.studentId, problemEntryIds: problems.map((p) => p.id) });
    expect(tooMany.status).toBe(400);
    const dup = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/register`).set(auth)
      .send({ studentId: player.studentId, problemEntryIds: [problems[0]!.id, problems[0]!.id] });
    expect(dup.status).toBe(400);

    const closed = await makeTournament({ registerEndsAt: PAST });
    const closedRes = await request(app)
      .post(`/api/pvp/tournaments/${closed.id}/register`).set(auth)
      .send({ studentId: player.studentId, problemEntryIds: [] });
    expect(closedRes.status).toBe(409);
    expect(unwrapErr(closedRes).code).toBe('STATE_CONFLICT');

    for (let i = 0; i < 8; i += 1) {
      const entrant = await makePlayer();
      const res = await request(app)
        .post(`/api/pvp/tournaments/${tournament.id}/register`)
        .set('Authorization', `Bearer ${entrant.token}`)
        .send({ studentId: entrant.studentId, problemEntryIds: [] });
      expect(res.status).toBe(200);
    }
    const full = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/register`).set(auth)
      .send({ studentId: player.studentId, problemEntryIds: [] });
    expect(full.status).toBe(409);
  });
});

describe('pvp coverage：奖励与认领 HTTP', () => {
  it('完赛后列表可见、冠军 tag-card 独占、认领幂等不重发', async () => {
    const tournament = await makeTournament();
    const players: Player[] = [];
    for (let i = 0; i < 8; i += 1) {
      const player = await makePlayer();
      players.push(player);
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await finishTournament(tournament.id);

    const champion = players[0]!;
    const list = unwrapOk<RewardGrant[]>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}/rewards`).set('Authorization', `Bearer ${champion.token}`),
    );
    expect(list).toHaveLength(8);
    const winner = list.find((g) => g.rank === 1)!;
    expect(winner.rewards).toContainEqual({ type: 'item', itemId: 'tag-card', count: 1 });
    expect(list.filter((g) => g.rank > 1).every((g) => !g.rewards.some((r) => r.itemId === 'tag-card'))).toBe(true);

    const winnerPlayer = players.find((p) => p.userId === winner.userId)!;
    const claim = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`)
      .set('Authorization', `Bearer ${winnerPlayer.token}`);
    expect(claim.status).toBe(200);
    const claimed = unwrapOk<RewardGrant>(claim);
    expect(claimed.claimedAt).toEqual(expect.any(String));
    expect(claimed.claimable).toBe(false);
    const holdings = async () => prisma.userItem.findMany({ where: { userId: winner.userId } });
    const afterFirst = await holdings();
    const qty = (itemId: string) => afterFirst.find((h) => h.itemId === itemId)?.quantity ?? 0;
    // DEFAULT_PRIZES 冠军桶：tag-card×1 + advance-stone×2 + trophy-champion×1
    expect(qty('tag-card')).toBe(1);
    expect(qty('advance-stone')).toBe(2);
    expect(qty('trophy-champion')).toBe(1);

    const again = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`)
      .set('Authorization', `Bearer ${winnerPlayer.token}`);
    expect(again.status).toBe(200);
    expect(unwrapOk<RewardGrant>(again).claimedAt).toBe(claimed.claimedAt);
    const afterSecond = await holdings();
    expect(afterSecond).toEqual(afterFirst);
  });

  it('自定义奖池：钱/声誉/道具到账并写 ReputationLog', async () => {
    const tournament = await makeTournament({
      prizes: { champion: { money: 500, reputation: 10, items: [{ itemId: 'milk-tea', count: 2 }] } },
    });
    const players: Player[] = [];
    for (let i = 0; i < 8; i += 1) {
      const player = await makePlayer();
      players.push(player);
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await finishTournament(tournament.id);

    const list = unwrapOk<RewardGrant[]>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}/rewards`).set('Authorization', `Bearer ${players[0]!.token}`),
    );
    const winner = list.find((g) => g.rank === 1)!;
    expect(winner.rewards).toContainEqual({ type: 'money', amount: 500 });
    expect(winner.rewards).toContainEqual({ type: 'reputation', amount: 10 });
    expect(winner.rewards).toContainEqual({ type: 'item', itemId: 'milk-tea', count: 2 });

    const winnerPlayer = players.find((p) => p.userId === winner.userId)!;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: winner.userId } });
    const claim = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`)
      .set('Authorization', `Bearer ${winnerPlayer.token}`);
    expect(claim.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: winner.userId } });
    expect(after.money - before.money).toBe(500);
    expect(after.reputation - before.reputation).toBe(10);
    const tea = await prisma.userItem.findUnique({ where: { userId_itemId: { userId: winner.userId, itemId: 'milk-tea' } } });
    expect(tea?.quantity).toBe(2);
    const log = await prisma.reputationLog.findFirstOrThrow({ where: { userId: winner.userId, reason: { startsWith: `PVP_PRIZE:${tournament.id}:` } } });
    expect(log.delta).toBe(10);
  });

  it('未完赛/非参赛认领 → NOT_FOUND；局外人可看奖励榜', async () => {
    const tournament = await makeTournament();
    const player = await makePlayer();
    await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    const early = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(early.status).toBe(404);

    const outsider = await makePlayer();
    const view = await request(app)
      .get(`/api/pvp/tournaments/${tournament.id}/rewards`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(view.status).toBe(200);
    expect(unwrapOk<RewardGrant[]>(view)).toEqual([]);
    const foreign = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(foreign.status).toBe(404);
  });
});

describe('pvp coverage：战报共享与对阵 HTTP', () => {
  it('主客双方可读对局战报，局外人 → NOT_FOUND', async () => {
    const tournament = await makeTournament();
    const players: Player[] = [];
    for (let i = 0; i < 8; i += 1) {
      const player = await makePlayer();
      players.push(player);
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    await finishTournament(tournament.id);

    const match = await prisma.pvpMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 1 } });
    expect(match.homeUserId).not.toBeNull();
    expect(match.awayUserId).not.toBeNull();
    expect(match.contestRecordId).not.toBeNull();
    const home = players.find((p) => p.userId === match.homeUserId)!;
    const away = players.find((p) => p.userId === match.awayUserId)!;
    const outsider = await makePlayer();

    for (const party of [home, away]) {
      const res = await request(app).get(`/api/records/${match.contestRecordId}`).set('Authorization', `Bearer ${party.token}`);
      expect(res.status).toBe(200);
      expect(unwrapOk<{ summary: { format: string } }>(res).summary.format).toBe('DUEL');
    }
    const denied = await request(app).get(`/api/records/${match.contestRecordId}`).set('Authorization', `Bearer ${outsider.token}`);
    expect(denied.status).toBe(404);
  });

  it('detail/bracket：开赛前后状态与场次数', async () => {
    const tournament = await makeTournament();
    const players: Player[] = [];
    for (let i = 0; i < 8; i += 1) {
      const player = await makePlayer();
      players.push(player);
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    const before = unwrapOk<{ status: string; registeredCount: number; myRegistration: number | null }>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}`).set('Authorization', `Bearer ${players[0]!.token}`),
    );
    expect(before).toMatchObject({ status: 'REGISTERING', registeredCount: 8 });
    expect(before.myRegistration).toEqual(expect.any(Number));

    await finishTournament(tournament.id);
    const after = unwrapOk<{ status: string }>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}`).set('Authorization', `Bearer ${players[0]!.token}`),
    );
    expect(after.status).toBe('FINISHED');
    const bracket = unwrapOk<Array<{ status: string; winnerUserId: number | null }>>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}/bracket`).set('Authorization', `Bearer ${players[0]!.token}`),
    );
    expect(bracket).toHaveLength(7);
    expect(bracket.every((m) => m.status === 'DONE' && m.winnerUserId !== null)).toBe(true);
  });
});

describe('pvp coverage：admin 一键开赛真实路径', () => {
  it('人数不足 → CANCELLED + 退票 + 审计', async () => {
    const admin = await register();
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
    const tournament = await makeTournament({ autoStartAt: PAST });
    const player = await makePlayer();
    await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    expect(await prisma.userItem.findUnique({ where: { userId_itemId: { userId: player.userId, itemId: 'entry-ticket' } } })).toBeNull();

    const res = await request(app)
      .post(`/api/admin/pvp-tournaments/${tournament.id}/actions/start`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(unwrapOk<{ status: string }>(res).status).toBe('CANCELLED');
    const refunded = await prisma.userItem.findUnique({ where: { userId_itemId: { userId: player.userId, itemId: 'entry-ticket' } } });
    expect(refunded?.quantity).toBe(1);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'PVP_TOURNAMENT_START', targetId: String(tournament.id) } });
    expect(audit.payload as object).toMatchObject({ status: 'CANCELLED' });
  });

  it('满 8 人 → FINISHED + 7 场 + 审计', async () => {
    const admin = await register();
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
    const tournament = await makeTournament({ autoStartAt: PAST });
    for (let i = 0; i < 8; i += 1) {
      const player = await makePlayer();
      await registerPvp(player.userId, tournament.id, player.studentId, [], PAST);
    }
    const res = await request(app)
      .post(`/api/admin/pvp-tournaments/${tournament.id}/actions/start`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(unwrapOk<{ status: string }>(res).status).toBe('FINISHED');
    expect(await prisma.pvpMatch.count({ where: { tournamentId: tournament.id } })).toBe(7);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'PVP_TOURNAMENT_START', targetId: String(tournament.id) } });
    expect(audit.adminId).toBe(admin.userId);
  });
});
