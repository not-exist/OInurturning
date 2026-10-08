import { Prisma } from '../../generated/prisma/client.js';
import type {
  ContestFormat,
  ContestRecordSummary,
  ContestRecordType,
  ContestReport,
  ContestSummary,
  GrowthDelta,
  RewardLine,
  StoryProgressView,
} from '@oinur/shared';
import { clamp, type ContestRecordView } from '@oinur/shared';
import { jsonValue, jsonWrite } from '../../lib/json.js';
import { prisma } from '../../lib/prisma.js';
import { toProgressView } from '../../lib/story-progress.js';

type DbClient = typeof prisma | Prisma.TransactionClient;
type ContestRecordRow = NonNullable<Awaited<ReturnType<typeof prisma.contestRecord.findFirst>>>;

export interface CreateContestRecordInput {
  userId: number;
  type: ContestRecordType;
  format: ContestFormat;
  stageKey?: string;
  ngLevel?: number;
  idempotencyKey: string;
  inputSnapshot: unknown;
  report: ContestReport;
  summary: ContestSummary;
  rewards: RewardLine[];
  snapshotHash: string;
  createdAt?: Date;
}

export interface UpsertStoryProgressInput {
  userId: number;
  ngLevel: number;
  stageKey: string;
  firstClearAt: Date | null;
  bestRank: number | null;
  clearCount: number;
  rewards: RewardLine[];
  growth: GrowthDelta[];
  lastRecordId?: string;
  lastSummary?: ContestSummary;
}

function toRecordView(row: ContestRecordRow): ContestRecordView {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as ContestRecordType,
    format: row.format as ContestFormat,
    stageKey: row.stageKey,
    ngLevel: row.ngLevel,
    idempotencyKey: row.idempotencyKey,
    inputSnapshot: jsonValue(row.inputSnapshot),
    report: jsonValue<ContestReport>(row.report),
    summary: jsonValue<ContestSummary>(row.summary),
    rewards: jsonValue<RewardLine[]>(row.rewards),
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createContestRecord(
  input: CreateContestRecordInput,
  db: DbClient = prisma,
): Promise<ContestRecordView> {
  try {
    const row = await db.contestRecord.create({
      data: {
        userId: input.userId,
        type: input.type,
        format: input.format,
        stageKey: input.stageKey,
        ngLevel: input.ngLevel,
        idempotencyKey: input.idempotencyKey,
        inputSnapshot: jsonWrite(input.inputSnapshot),
        report: jsonWrite(input.report),
        summary: jsonWrite(input.summary),
        rewards: jsonWrite(input.rewards),
        snapshotHash: input.snapshotHash,
        createdAt: input.createdAt,
      },
    });
    return toRecordView(row);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const existing = await db.contestRecord.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing === null) throw error;
    return toRecordView(existing);
  }
}

export async function getContestRecordForUser(
  userId: number,
  recordId: string,
  db: DbClient = prisma,
): Promise<ContestRecordView | null> {
  const row = await db.contestRecord.findFirst({ where: { id: recordId, userId } });
  return row === null ? null : toRecordView(row);
}

export async function getContestRecordByIdempotency(
  userId: number,
  idempotencyKey: string,
  db: DbClient = prisma,
): Promise<ContestRecordView | null> {
  const row = await db.contestRecord.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });
  return row === null ? null : toRecordView(row);
}

export async function getStoryProgress(
  userId: number,
  ngLevel: number,
  stageKey: string,
  db: DbClient = prisma,
): Promise<StoryProgressView | null> {
  const row = await db.storyProgress.findUnique({
    where: { userId_ngLevel_stageKey: { userId, ngLevel, stageKey } },
  });
  return row === null ? null : toProgressView(row);
}

export async function listRecentContestRecords(
  userId: number,
  limit = 5,
  db: DbClient = prisma,
): Promise<ContestRecordSummary[]> {
  const rows = await db.contestRecord.findMany({
    where: { userId },
    select: { id: true, type: true, format: true, stageKey: true, ngLevel: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: clamp(limit, 1, 20),
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type as ContestRecordType,
    format: row.format as ContestFormat,
    stageKey: row.stageKey,
    ngLevel: row.ngLevel,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function upsertStoryProgress(
  input: UpsertStoryProgressInput,
  db: DbClient = prisma,
): Promise<StoryProgressView> {
  const data = {
    firstClearAt: input.firstClearAt,
    bestRank: input.bestRank,
    clearCount: input.clearCount,
    rewards: jsonWrite(input.rewards),
    growth: jsonWrite(input.growth),
    lastRecordId: input.lastRecordId,
    lastSummary: input.lastSummary === undefined ? undefined : jsonWrite(input.lastSummary),
  };
  const row = await db.storyProgress.upsert({
    where: {
      userId_ngLevel_stageKey: {
        userId: input.userId,
        ngLevel: input.ngLevel,
        stageKey: input.stageKey,
      },
    },
    create: {
      userId: input.userId,
      ngLevel: input.ngLevel,
      stageKey: input.stageKey,
      ...data,
    },
    update: data,
  });
  return toProgressView(row);
}
