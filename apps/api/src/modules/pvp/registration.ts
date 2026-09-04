import { Prisma, type PvpRegistration, type PvpTournament, type Student } from '@prisma/client';
import type { ParticipantSnapshot } from '@oinur/shared';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export interface PvpTournamentView {
  id: number;
  name: string;
  status: PvpTournament['status'];
  size: number;
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
    registerEndsAt: row.registerEndsAt.toISOString(),
    autoStartAt: row.autoStartAt.toISOString(),
    registered: row.registrations.length > 0,
  };
}

function registrationView(row: PvpRegistration, replayed: boolean): PvpRegistrationView {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    userId: row.userId,
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
  });
  return row === null ? null : registrationView(row, false);
}

export async function registerPvp(
  userId: number,
  tournamentId: number,
  studentId: number,
  problemEntryIds: readonly number[],
  now: Date = new Date(),
): Promise<PvpRegistrationView> {
  if (problemEntryIds.length > 2 || new Set(problemEntryIds).size !== problemEntryIds.length) {
    throw new ApiError('VALIDATION_FAILED', { field: 'problemEntryIds', reason: 'at most two unique problems' });
  }
  return prisma.$transaction(async (tx) => {
    // PVP lock ordering is Tournament -> User -> Student, matching scheduler/refund paths.
    await tx.$queryRaw`SELECT id FROM PvpTournament WHERE id = ${tournamentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const tournament = await tx.pvpTournament.findUnique({ where: { id: tournamentId } });
    if (tournament === null) throw new ApiError('NOT_FOUND', { resource: 'tournament', id: tournamentId });
    const existing = await tx.pvpRegistration.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (existing !== null) return registrationView(existing, true);
    if (tournament.status !== 'REGISTERING' || now >= tournament.registerEndsAt) {
      throw new ApiError('STATE_CONFLICT', { resource: 'tournament', id: tournamentId, reason: 'registration closed' });
    }
    const registrations = await tx.pvpRegistration.count({ where: { tournamentId } });
    if (registrations >= tournament.size) {
      throw new ApiError('STATE_CONFLICT', { resource: 'tournament', id: tournamentId, reason: 'tournament is full' });
    }
    await tx.$queryRaw`SELECT id FROM Student WHERE id = ${studentId} FOR UPDATE`;
    const student = await tx.student.findUnique({ where: { id: studentId }, include: { talents: true } });
    if (student === null || student.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', { resource: 'student', id: studentId });
    if (student.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: studentId });
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
    const roster = [participantSnapshot(student)];
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
    return registrationView(row, false);
  });
}
