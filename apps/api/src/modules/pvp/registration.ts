import { Prisma, type PvpRegistration, type PvpTournament, type Student } from '@prisma/client';
import { TEAM_SIZE_MAX, TEAM_SIZE_MIN, type ParticipantSnapshot } from '@oinur/shared';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

/** 出战队伍人数即契约的队伍规模域（shared TEAM_SIZE_MIN~MAX），不是可调数值。 */
export type PvpRosterSize = typeof TEAM_SIZE_MIN | typeof TEAM_SIZE_MAX;
export const DEFAULT_PVP_ROSTER_SIZE: PvpRosterSize = TEAM_SIZE_MIN;

export function pvpRosterSize(config: unknown): PvpRosterSize {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return DEFAULT_PVP_ROSTER_SIZE;
  const value = (config as Record<string, unknown>).rosterSize;
  if (value === undefined) return DEFAULT_PVP_ROSTER_SIZE;
  if (value === TEAM_SIZE_MIN || value === TEAM_SIZE_MAX) return value;
  throw new ApiError('STATE_CONFLICT', { resource: 'tournament', reason: 'invalid rosterSize' });
}

export interface PvpTournamentView {
  id: number;
  name: string;
  status: PvpTournament['status'];
  size: number;
  rosterSize: PvpRosterSize;
  registerEndsAt: string;
  autoStartAt: string;
  registered: boolean;
}

export interface PvpProblemSnapshot {
  id: number;
  name: string;
  dominantDim: string;
  rarity: string;
  quality: number;
  traitId: string | null;
}

export interface PvpRegistrationView {
  id: number;
  tournamentId: number;
  userId: number;
  rosterSize: PvpRosterSize;
  roster: ParticipantSnapshot[];
  problemEntryIds: number[];
  problemSnapshots: PvpProblemSnapshot[];
  createdAt: string;
  replayed: boolean;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function participantSnapshot(student: Student & { talents: { talentId: string }[] }): ParticipantSnapshot {
  return {
    side: 'HOME',
    userId: student.userId,
    studentId: student.id,
    displayName: student.name,
    abilities: {
      DS: student.ds,
      DP: student.dp,
      MATH: student.math,
      GRAPH: student.graph,
      GREEDY: student.greedy,
      STRING: student.str,
      CODING: student.code,
      THINKING: student.thinking,
      PROBLEM: student.setting,
    },
    traits: student.talents.map((talent) => ({ traitId: talent.talentId })),
    mindset: student.mindset,
    focusCap: student.focusCap,
    energy: student.energy,
    energyMax: student.energyMax,
  };
}

function tournamentView(row: PvpTournament & { registrations: { id: number }[] }): PvpTournamentView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    size: row.size,
    rosterSize: pvpRosterSize(row.config),
    registerEndsAt: row.registerEndsAt.toISOString(),
    autoStartAt: row.autoStartAt.toISOString(),
    registered: row.registrations.length > 0,
  };
}

function registrationView(row: PvpRegistration, replayed: boolean, rosterSize: PvpRosterSize): PvpRegistrationView {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    userId: row.userId,
    rosterSize,
    roster: row.roster as unknown as ParticipantSnapshot[],
    problemEntryIds: row.problemEntryIds as unknown as number[],
    problemSnapshots: row.problemSnapshots as unknown as PvpProblemSnapshot[],
    createdAt: row.createdAt.toISOString(),
    replayed,
  };
}

export async function listPvpTournaments(userId: number): Promise<PvpTournamentView[]> {
  const rows = await prisma.pvpTournament.findMany({
    orderBy: { createdAt: 'desc' },
    include: { registrations: { where: { userId }, select: { id: true } } },
  });
  return rows.map(tournamentView);
}

export async function getRegistration(
  userId: number,
  tournamentId: number,
): Promise<PvpRegistrationView | null> {
  const row = await prisma.pvpRegistration.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
    include: { tournament: { select: { config: true } } },
  });
  if (row === null) return null;
  return registrationView(row, false, pvpRosterSize(row.tournament.config));
}

export async function registerPvp(
  userId: number,
  tournamentId: number,
  studentIds: number[],
  problemEntryIds: readonly number[],
  now: Date = new Date(),
): Promise<PvpRegistrationView> {
  if (new Set(problemEntryIds).size !== problemEntryIds.length) {
    throw new ApiError('VALIDATION_FAILED', { field: 'problemEntryIds', reason: 'duplicate problems' });
  }
  return prisma.$transaction(async (tx) => {
    // PVP lock ordering is Tournament -> User -> Student, matching scheduler/refund paths.
    await tx.$queryRaw`SELECT id FROM PvpTournament WHERE id = ${tournamentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const tournament = await tx.pvpTournament.findUnique({ where: { id: tournamentId } });
    if (tournament === null) throw new ApiError('NOT_FOUND', { resource: 'tournament', id: tournamentId });
    const rosterSize = pvpRosterSize(tournament.config);
    if (
      !Array.isArray(studentIds) ||
      studentIds.length !== rosterSize ||
      new Set(studentIds).size !== rosterSize ||
      studentIds.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new ApiError('VALIDATION_FAILED', {
        field: 'studentIds',
        reason: `exactly ${rosterSize} distinct active students are required`,
      });
    }
    // 每名队员至多携带一道自己的预制题（progression.md §2.3）
    if (problemEntryIds.length > rosterSize) {
      throw new ApiError('VALIDATION_FAILED', {
        field: 'problemEntryIds',
        reason: `at most ${rosterSize} problems, one per member`,
      });
    }
    const existing = await tx.pvpRegistration.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (existing !== null) return registrationView(existing, true, rosterSize);
    if (tournament.status !== 'REGISTERING' || now >= tournament.registerEndsAt) {
      throw new ApiError('STATE_CONFLICT', { resource: 'tournament', id: tournamentId, reason: 'registration closed' });
    }
    const registrations = await tx.pvpRegistration.count({ where: { tournamentId } });
    if (registrations >= tournament.size) {
      throw new ApiError('STATE_CONFLICT', { resource: 'tournament', id: tournamentId, reason: 'tournament is full' });
    }
    // 整支队伍一次性上锁：按 id 升序，避免并发报名互相等锁。
    const lockedIds = [...new Set(studentIds)].sort((left, right) => left - right);
    await tx.$queryRaw`SELECT id FROM Student WHERE id IN (${Prisma.join(lockedIds)}) FOR UPDATE`;
    const studentRows = await tx.student.findMany({
      where: { id: { in: lockedIds } },
      include: { talents: true },
    });
    const rowById = new Map(studentRows.map((row) => [row.id, row]));
    const roster = studentIds.map((studentId) => {
      const student = rowById.get(studentId);
      if (student === undefined || student.status !== 'ACTIVE')
        throw new ApiError('NOT_FOUND', { resource: 'student', id: studentId });
      if (student.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: studentId });
      return participantSnapshot(student);
    });
    const problems = problemEntryIds.length === 0
      ? []
      : await tx.problemLibraryEntry.findMany({ where: { id: { in: [...problemEntryIds] } } });
    if (problems.length !== problemEntryIds.length) {
      const foreign = await tx.problemLibraryEntry.findFirst({ where: { id: { in: [...problemEntryIds] }, userId: { not: userId } } });
      if (foreign !== null) throw new ApiError('FORBIDDEN', { resource: 'problem', id: foreign.id });
      throw new ApiError('NOT_FOUND', { resource: 'problem' });
    }
    for (const problem of problems) {
      if (problem.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'problem', id: problem.id });
      if (problem.consumedAt !== null || problem.quality < 40) {
        throw new ApiError('STATE_CONFLICT', { resource: 'problem', id: problem.id, reason: 'problem is not eligible for PVP' });
      }
    }
    const ticket = await tx.userItem.updateMany({
      where: { userId, itemId: 'entry-ticket', quantity: { gte: 1 } },
      data: { quantity: { decrement: 1 } },
    });
    if (ticket.count !== 1) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'entry-ticket', need: 1 });
    await tx.userItem.deleteMany({ where: { userId, itemId: 'entry-ticket', quantity: { lte: 0 } } });
    const problemsById = new Map(problems.map((problem) => [problem.id, problem]));
    const snapshots: PvpProblemSnapshot[] = problemEntryIds.map((problemId) => {
      const problem = problemsById.get(problemId)!;
      return {
        id: problem.id,
        name: problem.name,
        dominantDim: problem.dominantDim,
        rarity: problem.rarity,
        quality: problem.quality,
        traitId: problem.traitId,
      };
    });
    const row = await tx.pvpRegistration.create({
      data: {
        tournamentId,
        userId,
        roster: json(roster),
        problemEntryIds: json([...problemEntryIds]),
        problemSnapshots: json(snapshots),
        createdAt: now,
      },
    });
    return registrationView(row, false, rosterSize);
  });
}
