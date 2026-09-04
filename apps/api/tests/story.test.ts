import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/index.js';
import { prisma } from '../src/lib/prisma.js';
import { resetUsers, unwrapOk } from './helpers.js';

const app: Express = createApp();
let userSeq = 0;

async function createAuthedUser(): Promise<{ userId: number; token: string }> {
  userSeq += 1;
  const response = await request(app)
    .post('/api/auth/register')
    .send({ username: `story-${Date.now().toString(36)}-${userSeq}`, password: 'pw-123456' });
  const data = unwrapOk<{ accessToken: string; me: { id: number } }>(response);
  return { userId: data.me.id, token: data.accessToken };
}

async function createStudent(userId: number): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: 'Story Student',
      sex: 'MALE',
      qualityTier: 'ELITE',
      ds: 80,
      dp: 80,
      math: 80,
      graph: 80,
      greedy: 80,
      str: 80,
      code: 80,
      thinking: 80,
      setting: 80,
      mindset: 2,
      focusCap: 30,
      energyMax: 100,
      energy: 100,
      stamina: 5,
      staminaRegen: 50,
    },
  });
  return student.id;
}

describe('story stage API', () => {
  beforeEach(resetUsers);

  it('projects overview, enters a stage idempotently, and retrieves the stored record', async () => {
    const user = await createAuthedUser();
    const studentId = await createStudent(user.userId);
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
      .send({ roster: [studentId] });
    expect(first.status).toBe(200);
    const firstData = unwrapOk<{ record: { id: string }; replayed: boolean }>(first);
    expect(firstData.replayed).toBe(false);
    expect(firstData.record.id).toBeTypeOf('string');

    const replay = await request(app)
      .post('/api/story/stages/cspj:1/enter')
      .set({ ...authorization, 'Idempotency-Key': 'story-entry-1' })
      .send({ roster: [studentId] });
    expect(replay.status).toBe(200);
    const replayData = unwrapOk<{ record: { id: string }; replayed: boolean; firstClear: boolean }>(
      replay,
    );
    expect(replayData).toEqual({
      record: expect.objectContaining({ id: firstData.record.id }),
      replayed: true,
      firstClear: false,
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
});
