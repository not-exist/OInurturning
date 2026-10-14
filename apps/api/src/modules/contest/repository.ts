import { Prisma } from '@prisma/client';
import type {
  ContestFormat,
  ContestRecordType,
  ContestReport,
  ContestSummary,
  GrowthDelta,
  RewardLine,
  StoryProgressView,
} from '@oinur/shared';
import type { ContestRecordView } from '@oinur/shared';
import { prisma } from '../../lib/prisma.js';

type DbClient = typeof prisma | Prisma.TransactionClient;
type ContestRecordRow = NonNullable<Awaited<ReturnType<typeof prisma.contestRecord.findFirst>>>;
type StoryProgressRow = NonNullable<Awaited<ReturnType<typeof prisma.storyProgress.findUnique>>>;

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

function jsonPayload(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonValue<T>(value: Prisma.JsonValue): T {
  return value as unknown as T;
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

function toProgressView(row: StoryProgressRow): StoryProgressView {
  return {
    stageKey: row.stageKey,
    ngLevel: row.ngLevel,
    firstClearAt: row.firstClearAt?.toISOString() ?? null,
    bestRank: row.bestRank,
    clearCount: row.clearCount,
    rewards: jsonValue<RewardLine[]>(row.rewards),
    growth: jsonValue<GrowthDelta[]>(row.growth),
    ...(row.lastRecordId === null ? {} : { lastReportId: row.lastRecordId }),
    ...(row.lastSummary === null
      ? {}
      : { lastSummary: jsonValue<ContestSummary>(row.lastSummary) }),
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
        inputSnapshot: jsonPayload(input.inputSnapshot),
        report: jsonPayload(input.report),
        summary: jsonPayload(input.summary),
        rewards: jsonPayload(input.rewards),
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

/** 总览「最近动态」用的战报摘要（瘦身：不含 report/inputSnapshot 大 JSON） */
export interface ContestRecordSummary {
  id: string;
  type: ContestRecordType;
  format: ContestFormat;
  stageKey: string | null;
  ngLevel: number | null;
  createdAt: string;
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
    take: Math.min(Math.max(limit, 1), 20),
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
    rewards: jsonPayload(input.rewards),
    growth: jsonPayload(input.growth),
    lastRecordId: input.lastRecordId,
    lastSummary: input.lastSummary === undefined ? undefined : jsonPayload(input.lastSummary),
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
