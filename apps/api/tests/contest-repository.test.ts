import { beforeEach, describe, expect, it } from 'vitest';
import type { ContestReport, ContestSummary, RewardLine } from '@oinur/shared';
import { prisma } from '../src/lib/prisma.js';
import {
  createContestRecord,
  getContestRecordForUser,
  getStoryProgress,
  upsertStoryProgress,
} from '../src/modules/contest/repository.js';

const report = {
  format: 'RANKING',
  reportVersion: 1,
  engineVersion: 'ranking-v1',
  rngVersion: 'mulberry32-v1',
  seed: 7,
  snapshotHash: '1234abcd',
  createdAt: '2026-08-31T00:00:00.000Z',
  rewards: [],
  growth: [],
  inputSnapshot: { durationMin: 10 },
  questions: [],
  participants: [],
  standings: [],
  pass: false,
} as unknown as ContestReport;

const summary: ContestSummary = {
  format: 'RANKING',
  rank: 9,
  participantCount: 9,
  totalScore: 0,
  rewards: [],
  growth: [],
};

const rewards: RewardLine[] = [{ type: 'first_clear_money', amount: 500 }];

describe('contest repository', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({});
  });

  it('stores JSON report data and scopes reads to the owner', async () => {
    const owner = await prisma.user.create({ data: { username: 'contest-owner' } });
    const other = await prisma.user.create({ data: { username: 'contest-other' } });
    const created = await createContestRecord({
      userId: owner.id,
      type: 'STORY',
      format: 'RANKING',
      stageKey: 'cspj:1',
      ngLevel: 0,
      idempotencyKey: 'entry-owner-1',
      inputSnapshot: { durationMin: 180, problems: [] },
      report,
      summary,
      rewards,
      snapshotHash: '1234abcd',
    });

    expect(created.report).toEqual(report);
    expect(created.summary).toEqual(summary);
    expect(created.inputSnapshot).toEqual({ durationMin: 180, problems: [] });
    expect(await getContestRecordForUser(owner.id, created.id)).toMatchObject({ id: created.id });
    expect(await getContestRecordForUser(other.id, created.id)).toBeNull();
  });

  it('returns the existing record for a duplicate owner idempotency key', async () => {
    const owner = await prisma.user.create({ data: { username: 'contest-idempotent' } });
    const input = {
      userId: owner.id,
      type: 'STORY' as const,
      format: 'RANKING' as const,
      idempotencyKey: 'same-entry',
      inputSnapshot: { durationMin: 180 },
      report,
      summary,
      rewards: [],
      snapshotHash: '1234abcd',
    };

    const first = await createContestRecord(input);
    const second = await createContestRecord(input);

    expect(second.id).toBe(first.id);
    expect(await prisma.contestRecord.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('upserts progress by owner, ng level, and stage key', async () => {
    const owner = await prisma.user.create({ data: { username: 'progress-owner' } });
    await upsertStoryProgress({
      userId: owner.id,
      ngLevel: 0,
      stageKey: 'cspj:1',
      firstClearAt: new Date('2026-08-31T00:00:00.000Z'),
      bestRank: 4,
      clearCount: 1,
      rewards,
      growth: [],
      lastRecordId: 'record-1',
      lastSummary: summary,
    });
    await upsertStoryProgress({
      userId: owner.id,
      ngLevel: 0,
      stageKey: 'cspj:1',
      firstClearAt: null,
      bestRank: 2,
      clearCount: 2,
      rewards: [],
      growth: [],
      lastRecordId: 'record-2',
      lastSummary: summary,
    });

    const progress = await getStoryProgress(owner.id, 0, 'cspj:1');
    expect(progress).toMatchObject({
      stageKey: 'cspj:1',
      ngLevel: 0,
      bestRank: 2,
      clearCount: 2,
      lastReportId: 'record-2',
    });
    expect(progress?.rewards).toEqual([]);
    expect(await prisma.storyProgress.count({ where: { userId: owner.id } })).toBe(1);
  });
});
