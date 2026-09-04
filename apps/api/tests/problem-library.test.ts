import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import {
  createProblem,
  deleteProblem,
  listProblemLibrary,
  type ProblemDimension,
} from '../src/modules/problems/library.js';
import { resetUsers, unwrapOk } from './helpers.js';

const app = createApp();
const NOW = new Date('2026-09-02T12:00:00.000Z');
let sequence = 0;

async function createUser(money = 100): Promise<number> {
  sequence += 1;
  const user = await prisma.user.create({
    data: { username: `problem-${sequence}-${Date.now().toString(36)}`, money },
  });
  return user.id;
}

async function createStudent(userId: number, stamina = 5): Promise<number> {
  const student = await prisma.student.create({
    data: {
      userId,
      name: '出题学员',
      sex: 'MALE',
      qualityTier: 'GOOD',
      ds: 40,
      dp: 40,
      math: 40,
      graph: 40,
      greedy: 40,
      str: 40,
      code: 40,
      thinking: 40,
      setting: 40,
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

describe('M3 problem library', () => {
  beforeEach(async () => {
    await resetUsers();
    await importConfigs();
  });

  it('creates a deterministic-quality problem, charges cost and stores the author trait', async () => {
    const userId = await createUser();
    const studentId = await createStudent(userId);
    const result = await createProblem(userId, studentId, 'DS', NOW);

    expect(result).toMatchObject({
      dominantDim: 'DS',
      cost: 20,
      staminaAfter: 4,
      consumedAt: null,
    });
    expect(result.quality).toBeGreaterThanOrEqual(32);
    expect(result.quality).toBeLessThanOrEqual(48);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).money).toBe(80);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).stamina).toBe(4);
    expect((await prisma.problemLibraryEntry.findUniqueOrThrow({ where: { id: result.id } })).authorStudentId).toBe(studentId);
  });

  it('enforces two creations per student per server day even after deleting a problem', async () => {
    const userId = await createUser(200);
    const studentId = await createStudent(userId);
    const first = await createProblem(userId, studentId, 'DS', NOW);
    await createProblem(userId, studentId, 'DP', NOW);
    await deleteProblem(userId, first.id);

    await expect(createProblem(userId, studentId, 'MATH', NOW)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(await listProblemLibrary(userId)).toHaveLength(1);
  });

  it('rejects foreign authors and supports deleting only owned available entries', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerStudent = await createStudent(owner);
    const otherStudent = await createStudent(other);
    const problem = await createProblem(owner, ownerStudent, 'STRING', NOW);

    await expect(createProblem(other, ownerStudent, 'DS', NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteProblem(other, problem.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createProblem(other, otherStudent, 'DS', NOW)).resolves.toMatchObject({ dominantDim: 'DS' });
  });

  it('exposes problem-library create/list/delete HTTP routes', async () => {
    sequence += 1;
    const registration = await request(app)
      .post('/api/auth/register')
      .send({ username: `problem-route-${sequence}-${Date.now().toString(36)}`, password: 'pw-123456' });
    const session = unwrapOk<{ accessToken: string; me: { id: number } }>(registration);
    await prisma.user.update({ where: { id: session.me.id }, data: { money: 100 } });
    const studentId = await createStudent(session.me.id);
    const headers = { Authorization: `Bearer ${session.accessToken}` };

    const created = await request(app)
      .post('/api/problem-library')
      .set(headers)
      .send({ studentId, dimension: 'GREEDY' satisfies ProblemDimension });
    expect(created.status).toBe(200);
    const problem = unwrapOk<{ id: number }>(created);
    expect((await request(app).get('/api/problem-library').set(headers)).status).toBe(200);
    const removed = await request(app).delete(`/api/problem-library/${problem.id}`).set(headers);
    expect(removed.status).toBe(200);
  });
});
