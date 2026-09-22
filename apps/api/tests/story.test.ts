import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapErr, unwrapOk } from './helpers.js';

const app: Express = createApp();
let userSeq = 0;

/** fixtures/config 的 defaults.roster_size：出战人数必须精确匹配。 */
const ROSTER_SIZE = 4;

async function createAuthedUser(): Promise<{ userId: number; token: string }> {
  userSeq += 1;
  const response = await request(app)
    .post('/api/auth/register')
    .send({ username: `story-${Date.now().toString(36)}-${userSeq}`, password: 'pw-123456' });
  const data = unwrapOk<{ accessToken: string; me: { id: number } }>(response);
  return { userId: data.me.id, token: data.accessToken };
}

async function createStudent(userId: number, index = 0): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: `Story Student ${index}`,
            qualityTier: 'ELITE',
      ds: 80,
      dp: 80,
      math: 80,
      graph: 80,
      greedy: 80,
      str: 80,
      // CODING/精力逐人拉开：同一题的精力开销与结算结果不同，便于验证「逐人回写」而非复制队长。
      code: 30 + 20 * index,
      thinking: 80,
      setting: 80,
      mindset: 2,
      focusCap: 30,
      energyMax: 100,
      energy: 100 - 10 * index,
      stamina: 5,
      staminaRegen: 50,
    },
  });
  return student.id;
}

async function createRoster(userId: number): Promise<number[]> {
  const roster: number[] = [];
  for (let index = 0; index < ROSTER_SIZE; index += 1) {
    roster.push(await createStudent(userId, index));
  }
  return roster;
}

describe('story stage API', () => {
  beforeEach(resetUsers);

  it('projects overview, enters a stage idempotently, and retrieves the stored record', async () => {
    const user = await createAuthedUser();
    const roster = await createRoster(user.userId);
    const authorization = { Authorization: `Bearer ${user.token}` };

    const overview = await request(app).get('/api/story/overview').set(authorization);
    expect(overview.status).toBe(200);
    expect(
      unwrapOk<{ chapters: Array<{ stages: Array<{ stageKey: string; unlocked: boolean }> }> }>(
        overview,
      ).chapters[0]?.stages[0],
    ).toMatchObject({
      stageKey: 'cspj:1',
      unlocked: true,
      cleared: false,
    });

    const first = await request(app)
      .post('/api/story/stages/cspj:1/enter')
      .set({ ...authorization, 'Idempotency-Key': 'story-entry-1' })
      .send({ roster });
    expect(first.status).toBe(200);
    const firstData = unwrapOk<{
      record: { id: string };
      replay: { recordId: string; format: string; events: { type: string }[] };
      replayed: boolean;
    }>(first);
    expect(firstData.replayed).toBe(false);
    expect(firstData.record.id).toBeTypeOf('string');
    expect(firstData.replay).toMatchObject({
      recordId: firstData.record.id,
      format: 'RANKING',
    });
    expect(firstData.replay.events.at(-1)?.type).toBe('BATTLE_FINISH');

    const replay = await request(app)
      .post('/api/story/stages/cspj:1/enter')
      .set({ ...authorization, 'Idempotency-Key': 'story-entry-1' })
      .send({ roster });
    expect(replay.status).toBe(200);
    const replayData = unwrapOk<{
      record: { id: string };
      replay: { recordId: string; format: string; events: { type: string }[] };
      replayed: boolean;
      firstClear: boolean;
    }>(replay);
    expect(replayData).toMatchObject({
      record: expect.objectContaining({ id: firstData.record.id }),
      replay: expect.objectContaining({ recordId: firstData.record.id, format: 'RANKING' }),
      replayed: true,
      firstClear: false,
    });
    expect(replayData.replay.events.at(-1)?.type).toBe('BATTLE_FINISH');

    const replayEndpoint = await request(app)
      .get(`/api/records/${firstData.record.id}/replay`)
      .set(authorization);
    expect(replayEndpoint.status).toBe(200);
    expect(
      unwrapOk<{ recordId: string; format: string; events: { type: string }[] }>(replayEndpoint),
    ).toMatchObject({
      recordId: firstData.record.id,
      format: 'RANKING',
    });

    const record = await request(app).get(`/api/records/${firstData.record.id}`).set(authorization);
    expect(record.status).toBe(200);
    expect(
      unwrapOk<{ report: { format: string }; summary: { format: string } }>(record),
    ).toMatchObject({
      report: { format: 'RANKING' },
      summary: { format: 'RANKING' },
    });

    const progress = await request(app).get('/api/story/progress').set(authorization);
    expect(progress.status).toBe(200);
    expect(unwrapOk<Array<{ stageKey: string; clearCount: number }>>(progress)).toEqual([
      expect.objectContaining({ stageKey: 'cspj:1', clearCount: 1 }),
    ]);
  });

  it('拒绝人数不符/重复的 roster', async () => {
    const user = await createAuthedUser();
    const roster = await createRoster(user.userId);
    const authorization = { Authorization: `Bearer ${user.token}` };
    let keySeq = 0;
    const post = (roster: number[]) =>
      request(app)
        .post('/api/story/stages/cspj:1/enter')
        .set({ ...authorization, 'Idempotency-Key': `bad-roster-${(keySeq += 1)}` })
        .send({ roster });

    const tooFew = await post(roster.slice(0, 3));
    expect(tooFew.status).toBe(400);
    expect(unwrapErr(tooFew).details).toMatchObject({ field: 'roster' });
    const duplicated = await post([...roster.slice(0, 3), roster[0]!]);
    expect(duplicated.status).toBe(400);
    expect(unwrapErr(duplicated).details).toMatchObject({ field: 'roster' });
    // 被拒请求不扣任何人的体力
    expect(
      await prisma.student.count({ where: { id: { in: roster }, stamina: 5 } }),
    ).toBe(ROSTER_SIZE);
  });

  it('队伍全员各自结算：体力/精力/心态按各自的 timeline 回写四个学员', async () => {
    const user = await createAuthedUser();
    const roster = await createRoster(user.userId);
    const authorization = { Authorization: `Bearer ${user.token}` };

    const entered = await request(app)
      .post('/api/story/stages/cspj:1/enter')
      .set({ ...authorization, 'Idempotency-Key': 'team-settle-1' })
      .send({ roster });
    expect(entered.status).toBe(200);
    const recordId = unwrapOk<{ record: { id: string } }>(entered).record.id;

    const stored = await request(app).get(`/api/records/${recordId}`).set(authorization);
    const report = unwrapOk<{
      report: {
        teams: Array<{ side: string; members: unknown[] }>;
        participants: Array<{
          attempts: Array<{ resolution: { energyAfter: number } }>;
          finalMindset: number;
        }>;
      };
    }>(stored).report;
    expect(report.teams[0]).toMatchObject({ side: 'HOME' });
    expect(report.teams[0]?.members).toHaveLength(ROSTER_SIZE);
    // participants 顺序 = teams.flatMap(members)，玩家队排在 NPC 队之前
    expect(report.participants).toHaveLength(ROSTER_SIZE * report.teams.length);

    const rows = await prisma.student.findMany({ where: { id: { in: roster } } });
    expect(rows).toHaveLength(ROSTER_SIZE);
    report.participants.slice(0, ROSTER_SIZE).forEach((timeline, index) => {
      const student = rows.find((row) => row.id === roster[index])!;
      expect(student.stamina).toBe(4);
      expect(student.energy).toBe(
        timeline.attempts.at(-1)?.resolution.energyAfter ?? undefined,
      );
      expect(student.mindset).toBe(timeline.finalMindset);
    });
    // 四人的 timeline 必须两两不同（起点精力不同），否则上面的逐人比对是空转
    expect(
      new Set(
        report.participants
          .slice(0, ROSTER_SIZE)
          .map((timeline) => timeline.attempts.at(-1)?.resolution.energyAfter),
      ).size,
    ).toBeGreaterThan(1);
  });
});
