import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

/**
 * API 全链路旅程（e2e 类别，跑在 e2e Action；test Action 用 --exclude 跳过本文件）：
 * 注册→注资→招募→基础/定向训练→剧情首关→出题→专项→药水→讲课→历练→改名→
 * PVP 八人赛→改密→注销。与 tests/e2e/specs/full-journey.spec.ts（浏览器版）互补，
 * 此处做精确数值断言（体力/金币/增益/到账）。
 *
 * 真配置（docs/data，等价生产）+ 跑后恢复 fixtures，避免污染相邻文件。
 * 体力账（初始 5）：基础 1 → 定向 1 → 剧情 1 → 出题 1 → 专项 1 → 药水 +3 →
 * 讲课 2 → 历练 1，正好归零。
 */
const app: Express = createApp();
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/config');
let seq = 0;

beforeAll(async () => {
  await importConfigs();
});
beforeEach(resetUsers);
afterAll(async () => {
  await importConfigs({ configDir: FIXTURES });
});

async function register(prefix: string): Promise<{ token: string; userId: number; username: string }> {
  seq += 1;
  const username = `${prefix}-${Date.now().toString(36)}-${seq}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pw-12345678' });
  expect(res.status).toBe(200);
  const session = unwrapOk<{ accessToken: string; me: { id: number } }>(res);
  return { token: session.accessToken, userId: session.me.id, username };
}

async function fund(userId: number, money: number, items: Record<string, number>): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { money } });
  for (const [itemId, quantity] of Object.entries(items)) {
    await prisma.userItem.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { userId, itemId, quantity },
      update: { quantity },
    });
  }
}

interface Candidate {
  tempId: string;
  price: number;
}
interface StudentView {
  id: number;
  name: string;
  v: number;
  stamina: number;
  mindset: number;
}
interface TrainResult {
  dim: string;
  delta: number;
  cost: number;
  staminaAfter: number;
}
interface AdventureChoice {
  index: number;
  available: boolean;
}
interface AdventureView {
  id: number;
  preview: boolean;
  choices: AdventureChoice[] | null;
}
interface RewardGrant {
  userId: number;
  rank: number;
  claimedAt: string | null;
}

describe('journey full (api)', () => {
  it('完整玩家全流程：培养→剧情→历练→PVP→改密→注销', { timeout: 120_000 }, async () => {
    // —— 注册（0 金开局） ——
    const player = await register('journey');
    const auth = { Authorization: `Bearer ${player.token}` };
    const me0 = unwrapOk<{ money: number }>(await request(app).get('/api/users/me').set(auth));
    expect(me0.money).toBe(0);

    // —— 注资（等价运营拨款；见 e2e-seed.ts 背景） ——
    await fund(player.userId, 200000, {
      'milk-tea': 3,
      'stamina-potion': 2,
      'rename-card': 1,
      'entry-ticket': 1,
      'book-ds-green': 2,
      'spare-cable': 2,
      'direction-charm': 2,
      firewall: 2,
    });

    // —— 招募：直到出现 V≥7 学员（讲课强接窗口内） ——
    const poolOf = async () =>
      unwrapOk<{ candidates: Candidate[] }>(await request(app).get('/api/academy/pool').set(auth));
    let pool = await poolOf();
    expect(pool.candidates).toHaveLength(5);
    const students: StudentView[] = [];
    for (let round = 0; round < 8 && !students.some((s) => s.v >= 7); round += 1) {
      if (round > 0) {
        const refreshed = await request(app).post('/api/academy/refresh').set(auth);
        expect(refreshed.status).toBe(200);
        pool = unwrapOk<{ candidates: Candidate[] }>(refreshed);
      }
      const recruited = unwrapOk<StudentView>(
        await request(app)
          .post('/api/academy/recruit')
          .set(auth)
          .send({ tempId: pool.candidates[0]!.tempId }),
      );
      students.push(recruited);
    }
    const best = [...students].sort((a, b) => b.v - a.v)[0]!;
    expect(best.v).toBeGreaterThanOrEqual(7);

    // —— 基础训练：增益>0、扣 1 体力 ——
    const basic = unwrapOk<TrainResult>(
      await request(app).post('/api/training/basic').set(auth).send({ studentId: best.id }),
    );
    expect(basic.delta).toBeGreaterThan(0);
    expect(basic.cost).toBeGreaterThan(0);
    expect(basic.staminaAfter).toBeCloseTo(4, 2); // 体力连续再生，容忍浮点漂移

    // —— 定向训练（DS+绿书）：耗书、再扣 1 体力 ——
    const directed = unwrapOk<TrainResult>(
      await request(app)
        .post('/api/training/directed')
        .set(auth)
        .send({ studentId: best.id, dim: 'DS', bookItemId: 'book-ds-green' }),
    );
    expect(directed.dim).toBe('DS');
    expect(directed.delta).toBeGreaterThan(0);
    expect(directed.staminaAfter).toBeCloseTo(3, 2);
    const booksAfter = unwrapOk<{ itemId: string; quantity: number }[]>(
      await request(app).get('/api/items').set(auth),
    );
    expect(booksAfter.find((i) => i.itemId === 'book-ds-green')?.quantity).toBe(1);

    // —— 剧情首关：进关→战报结构完整 ——
    const entered = unwrapOk<{ record: { id: number } }>(
      await request(app)
        .post('/api/story/stages/cspj:1/enter')
        .set(auth)
        .send({ roster: [best.id], ngLevel: 0, idempotencyKey: randomUUID() }),
    );
    const report = unwrapOk<{
      report: { format: string; engineVersion: string; standings: unknown[]; pass: boolean };
    }>(await request(app).get(`/api/records/${entered.record.id}`).set(auth));
    expect(report.report.format).toBe('RANKING');
    expect(report.report.engineVersion).toBeTruthy();
    expect(report.report.standings.length).toBeGreaterThan(0);

    // —— 出题 ——
    const problem = unwrapOk<{ id: number; quality: number }>(
      await request(app)
        .post('/api/problem-library')
        .set(auth)
        .send({ studentId: best.id, dimension: 'DS' }),
    );
    expect(problem.quality).toBeGreaterThanOrEqual(0);
    const library = unwrapOk<unknown[]>(
      await request(app).get('/api/problem-library').set(auth),
    );
    expect(library).toHaveLength(1);

    // —— 专项训练：耗题 ——
    const specialized = unwrapOk<TrainResult>(
      await request(app)
        .post('/api/training/specialized')
        .set(auth)
        .send({ studentId: best.id, problemId: problem.id }),
    );
    expect(specialized.delta).toBeGreaterThan(0);
    expect(specialized.staminaAfter).toBeCloseTo(0, 2);
    const libraryAfter = unwrapOk<{ id: number; consumedAt: string | null }[]>(
      await request(app).get('/api/problem-library').set(auth),
    );
    expect(libraryAfter.find((p) => p.id === problem.id)?.consumedAt).not.toBeNull();

    // —— 体力药水：0→3 ——
    const used = await request(app)
      .post('/api/items/use')
      .set(auth)
      .send({ itemId: 'stamina-potion', studentId: best.id });
    expect(used.status).toBe(200);
    const afterPotion = unwrapOk<StudentView>(
      await request(app).get(`/api/students/${best.id}`).set(auth),
    );
    expect(afterPotion.stamina).toBeCloseTo(3, 2);

    // —— 讲课（V≥15 直讲必成功；[7,15) 强接，成功或讲砸皆合法） ——
    const forced = best.v < 15;
    const lecture = unwrapOk<{ success: boolean }>(
      await request(app)
        .post('/api/academy/lectures')
        .set(auth)
        .send({ studentId: best.id, tier: 'beginner', force: forced }),
    );
    if (!forced) expect(lecture.success).toBe(true);
    const lectureLogs = unwrapOk<unknown[]>(
      await request(app).get('/api/academy/lectures').set(auth),
    );
    expect(lectureLogs).toHaveLength(1);

    // —— 历练：preview→接受→分支（逐个试可用分支直到结算） ——
    const drawn = unwrapOk<AdventureView>(
      await request(app)
        .post('/api/adventures/draw')
        .set(auth)
        .send({ studentId: best.id, tier: 1 }),
    );
    expect(drawn.preview).toBe(true);
    const accepted = unwrapOk<{ completed: boolean; adventure: AdventureView }>(
      await request(app)
        .post(`/api/adventures/${drawn.id}/choice`)
        .set(auth)
        .send({ action: 'accept' }),
    );
    expect(accepted.completed).toBe(false);
    expect(accepted.adventure.choices?.length).toBeGreaterThan(0);
    let completed = false;
    for (const choice of accepted.adventure.choices ?? []) {
      if (!choice.available) continue;
      const resolved = await request(app)
        .post(`/api/adventures/${drawn.id}/choice`)
        .set(auth)
        .send({ optionIndex: choice.index });
      if (resolved.status === 200 && unwrapOk<{ completed: boolean }>(resolved).completed) {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
    const adventureLogs = unwrapOk<unknown[]>(
      await request(app).get('/api/adventures/logs').set(auth),
    );
    expect(adventureLogs).toHaveLength(1);

    // —— 奶茶：心态 +2 ——
    const beforeTea = unwrapOk<StudentView>(
      await request(app).get(`/api/students/${best.id}`).set(auth),
    );
    const tea = await request(app)
      .post('/api/items/use')
      .set(auth)
      .send({ itemId: 'milk-tea', studentId: best.id });
    expect(tea.status).toBe(200);
    const afterTea = unwrapOk<StudentView>(
      await request(app).get(`/api/students/${best.id}`).set(auth),
    );
    // 心态钳制在 [-10,10]：赛后心态若已近顶，+2 会被部分钳制，按分支断言
    expect(afterTea.mindset).toBeLessThanOrEqual(10);
    expect(afterTea.mindset).toBeGreaterThanOrEqual(beforeTea.mindset);
    if (beforeTea.mindset <= 8) {
      expect(afterTea.mindset - beforeTea.mindset).toBeCloseTo(2, 5);
    } else {
      expect(afterTea.mindset).toBe(10);
    }

    // —— 改名：耗 1 张改名卡 ——
    const renamed = unwrapOk<StudentView>(
      await request(app)
        .post(`/api/students/${best.id}/rename`)
        .set(auth)
        .send({ name: '旅程之星' }),
    );
    expect(renamed.name).toBe('旅程之星');

    // —— PVP 八人赛 ——
    const admin = await register('journey-admin');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const tournament = unwrapOk<{ id: number }>(
      await request(app).post('/api/admin/tournaments').set(adminAuth).send({
        name: `journey-cup-${Date.now().toString(36)}`,
        size: 8,
        registerEndsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        autoStartAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
        prizes: { champion: { money: 1000 } },
        config: {},
      }),
    );
    const contenders = [{ token: player.token, userId: player.userId, studentId: best.id }];
    const mainReg = await request(app)
      .post(`/api/pvp/tournaments/${tournament.id}/register`)
      .set(auth)
      .send({ studentId: best.id, problemEntryIds: [] });
    expect(mainReg.status).toBe(200);
    for (let i = 0; i < 7; i += 1) {
      const rival = await register('journey-rival');
      await fund(rival.userId, 50000, { 'entry-ticket': 1 });
      const rivalAuth = { Authorization: `Bearer ${rival.token}` };
      const rivalPool = unwrapOk<{ candidates: Candidate[] }>(
        await request(app).get('/api/academy/pool').set(rivalAuth),
      );
      const rivalStudent = unwrapOk<StudentView>(
        await request(app)
          .post('/api/academy/recruit')
          .set(rivalAuth)
          .send({ tempId: rivalPool.candidates[0]!.tempId }),
      );
      const reg = await request(app)
        .post(`/api/pvp/tournaments/${tournament.id}/register`)
        .set(rivalAuth)
        .send({ studentId: rivalStudent.id, problemEntryIds: [] });
      expect(reg.status).toBe(200);
      contenders.push({ token: rival.token, userId: rival.userId, studentId: rivalStudent.id });
    }
    await prisma.pvpTournament.update({
      where: { id: tournament.id },
      data: { registerEndsAt: new Date(Date.now() - 60000), autoStartAt: new Date(Date.now() - 60000) },
    });
    const started = await request(app)
      .post(`/api/admin/pvp-tournaments/${tournament.id}/actions/start`)
      .set(adminAuth);
    expect(started.status).toBe(200);
    const bracket = unwrapOk<unknown[]>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}/bracket`).set(auth),
    );
    expect(bracket).toHaveLength(7);
    const grants = unwrapOk<RewardGrant[]>(
      await request(app).get(`/api/pvp/tournaments/${tournament.id}/rewards`).set(auth),
    );
    const champion = grants.find((g) => g.rank === 1);
    expect(champion).toBeDefined();
    const championAccount = contenders.find((c) => c.userId === champion!.userId);
    expect(championAccount).toBeDefined();
    const moneyBefore = (await prisma.user.findUniqueOrThrow({ where: { id: champion!.userId } })).money;
    const claimed = unwrapOk<RewardGrant>(
      await request(app)
        .post(`/api/pvp/tournaments/${tournament.id}/rewards/claim`)
        .set({ Authorization: `Bearer ${championAccount!.token}` }),
    );
    expect(claimed.claimedAt).not.toBeNull();
    const moneyAfter = (await prisma.user.findUniqueOrThrow({ where: { id: champion!.userId } })).money;
    expect(moneyAfter - moneyBefore).toBe(1000);

    // —— 改密：新旧交替 ——
    const changed = await request(app)
      .put('/api/auth/password')
      .set(auth)
      .send({ oldPassword: 'pw-12345678', newPassword: 'pw-new-12345678' });
    expect(changed.status).toBe(200);
    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ username: player.username, password: 'pw-12345678' });
    expect(loginOld.status).toBe(401);
    expect(unwrapErr(loginOld)).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ username: player.username, password: 'pw-new-12345678' });
    expect(loginNew.status).toBe(200);
    const newToken = unwrapOk<{ accessToken: string }>(loginNew).accessToken;

    // —— 注销：账号彻底失效 ——
    const gone = await request(app)
      .post('/api/auth/deactivate')
      .set({ Authorization: `Bearer ${newToken}` })
      .send({ password: 'pw-new-12345678' });
    expect(gone.status).toBe(200);
    const loginGone = await request(app)
      .post('/api/auth/login')
      .send({ username: player.username, password: 'pw-new-12345678' });
    expect(loginGone.status).toBe(401);
  });
});
