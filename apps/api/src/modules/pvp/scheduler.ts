import { Prisma, type PvpMatch, type PvpRegistration, type PvpTournament } from '@prisma/client';
import type { DuelInput, ParticipantSnapshot, QuestionSnapshot } from '@oinur/shared';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { deriveSeed } from '../contest/engine/rng.js';
import { simulateDuel } from '../contest/engine/duel.js';
import { stableHash } from '../contest/engine/report.js';
import { createContestRecord } from '../contest/repository.js';
import { buildFirstRound, buildNextRound } from './bracket.js';

type Db = typeof prisma | Prisma.TransactionClient;
type Registration = PvpRegistration;

function qualityScoringEnabled(config: unknown): boolean {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return false;
  const root = config as Record<string, unknown>;
  const rules = root.rules;
  if (typeof rules === 'object' && rules !== null && !Array.isArray(rules)) {
    const ruleConfig = rules as Record<string, unknown>;
    if (ruleConfig.qualityScoring === true || ruleConfig.quality_scoring === true) return true;
  }
  return root.qualityScoring === true || root.quality_scoring === true;
}

export interface PvpMatchView {
  id: number;
  round: number;
  slot: number;
  homeUserId: number | null;
  awayUserId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerUserId: number | null;
  status: PvpMatch['status'];
  contestRecordId: string | null;
  reportUrl: string | null;
}

export interface PvpTournamentDetail {
  id: number;
  name: string;
  status: PvpTournament['status'];
  size: number;
  registerEndsAt: string;
  autoStartAt: string;
  prizes: unknown;
  config: unknown;
  registeredCount: number;
  myRegistration: number | null;
}

function participant(row: Registration, side: 'HOME' | 'AWAY'): ParticipantSnapshot {
  const roster = row.roster as unknown as ParticipantSnapshot[];
  const source = roster[0];
  if (source === undefined) throw new ApiError('STATE_CONFLICT', { resource: 'registration', id: row.id });
  return { ...source, side, userId: row.userId, studentId: source.studentId };
}

function questionFor(
  snapshot: { id: number; name: string; dominantDim: string; quality: number; traitId: string | null },
  tournamentId: number,
  round: number,
  slot: number,
  snapshotKey: string,
  index: number,
): QuestionSnapshot {
  const dimensions = new Set(['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING']);
  const dimension = dimensions.has(snapshot.dominantDim.toUpperCase())
    ? snapshot.dominantDim.toUpperCase()
    : 'DS';
  return {
    instanceId: `pvp:${tournamentId}:${round}:${slot}:${snapshotKey}:${snapshot.id}:${index}`,
    index,
    templateId: snapshot.name,
    dimension: dimension as QuestionSnapshot['dimension'],
    demand: Math.max(1, snapshot.quality),
    thought: Math.max(1, snapshot.quality),
    codeVolume: Math.max(1, snapshot.quality / 2),
    score: Math.max(1, snapshot.quality),
    quality: snapshot.quality,
    timeLimitMin: 30,
    partialScores: false,
    traits: snapshot.traitId === null ? [] : [],
    source: 'PREMADE',
    premadeEntryId: snapshot.id,
  };
}

function generatedQuestion(tournamentId: number, round: number, slot: number, snapshotKey: string, index: number, side: 'HOME' | 'AWAY'): QuestionSnapshot {
  return {
    instanceId: `pvp:${tournamentId}:${round}:${slot}:${snapshotKey}:generated:${side}:${index}`,
    index,
    dimension: index % 2 === 0 ? 'DS' : 'DP',
    demand: 40,
    thought: 40,
    codeVolume: 20,
    score: 40,
    quality: 40,
    timeLimitMin: 30,
    partialScores: false,
    traits: [],
    source: 'GENERATED',
  };
}

function inputFor(match: PvpMatch, home: Registration, away: Registration, qualityRuleOn: boolean): DuelInput {
  const homeProblems = (home.problemSnapshots as unknown as { id: number; name: string; dominantDim: string; quality: number; traitId: string | null }[]);
  const awayProblems = (away.problemSnapshots as unknown as { id: number; name: string; dominantDim: string; quality: number; traitId: string | null }[]);
  const snapshotKey = stableHash({ home: home.roster, away: away.roster, homeProblems, awayProblems });
  const questions = [0, 1, 2, 3].map((index) => {
    const source = index % 2 === 0 ? homeProblems[index / 2] : awayProblems[(index - 1) / 2];
    return source === undefined ? generatedQuestion(match.tournamentId, match.round, match.slot, snapshotKey, index, index % 2 === 0 ? 'HOME' : 'AWAY') : questionFor(source, match.tournamentId, match.round, match.slot, snapshotKey, index);
  });
  return {
    home: participant(home, 'HOME'),
    away: participant(away, 'AWAY'),
    questions,
    qualityRuleOn,
    tiebreak: 'SUDDEN_DEATH',
  };
}

function matchView(row: PvpMatch, viewerUserId: number): PvpMatchView {
  const canRead = viewerUserId === row.homeUserId || viewerUserId === row.awayUserId;
  return {
    id: row.id,
    round: row.round,
    slot: row.slot,
    homeUserId: row.homeUserId,
    awayUserId: row.awayUserId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    winnerUserId: row.winnerUserId,
    status: row.status,
    contestRecordId: canRead ? row.contestRecordId : null,
    reportUrl: canRead && row.contestRecordId !== null ? `/api/records/${row.contestRecordId}` : null,
  };
}

async function ensureRound(tx: Prisma.TransactionClient, tournament: PvpTournament, round: number, winners?: number[]): Promise<void> {
  const existing = await tx.pvpMatch.count({ where: { tournamentId: tournament.id, round } });
  if (existing > 0) return;
  const regs = await tx.pvpRegistration.findMany({ where: { tournamentId: tournament.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const participants = winners === undefined ? regs.map((row) => ({ userId: row.userId })) : winners.map((userId) => ({ userId }));
  const slots = winners === undefined ? buildFirstRound(participants, tournament.size, tournament.id) : buildNextRound(winners);
  for (const slot of slots) {
    await tx.pvpMatch.create({
      data: {
        tournamentId: tournament.id,
        round,
        slot: slot.slot,
        homeUserId: slot.homeUserId,
        awayUserId: slot.awayUserId,
        winnerUserId: slot.winnerUserId,
        status: slot.status,
        playedAt: slot.status === 'BYE' ? new Date() : null,
      },
    });
  }
}

async function cancelAndRefund(tx: Prisma.TransactionClient, tournamentId: number): Promise<void> {
  const registrations = await tx.pvpRegistration.findMany({ where: { tournamentId } });
  for (const registration of registrations) {
    await tx.userItem.upsert({
      where: { userId_itemId: { userId: registration.userId, itemId: 'entry-ticket' } },
      create: { userId: registration.userId, itemId: 'entry-ticket', quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
  }
  await tx.pvpTournament.update({ where: { id: tournamentId }, data: { status: 'CANCELLED' } });
}

async function playPending(tx: Prisma.TransactionClient, tournament: PvpTournament, round: number): Promise<void> {
  const pending = await tx.pvpMatch.findMany({ where: { tournamentId: tournament.id, round, status: 'PENDING' }, orderBy: { slot: 'asc' } });
  const qualityRuleOn = qualityScoringEnabled(tournament.config);
  for (const match of pending) {
    if (match.homeUserId === null || match.awayUserId === null) continue;
    const registrations = await tx.pvpRegistration.findMany({ where: { tournamentId: tournament.id, userId: { in: [match.homeUserId, match.awayUserId] } } });
    const home = registrations.find((row) => row.userId === match.homeUserId);
    const away = registrations.find((row) => row.userId === match.awayUserId);
    if (home === undefined || away === undefined) throw new ApiError('STATE_CONFLICT', { resource: 'registration' });
    const input = inputFor(match, home, away, qualityRuleOn);
    const seed = deriveSeed(tournament.id, round, match.slot, stableHash(input));
    const report = simulateDuel(input, seed);
    const winnerUserId = report.winnerSide === 'AWAY' ? match.awayUserId : match.homeUserId;
    const summary = { format: 'DUEL' as const, winnerSide: report.winnerSide, homeScore: report.scores.home, awayScore: report.scores.away, rewards: [], growth: [] };
    const record = await createContestRecord({ userId: match.homeUserId, type: 'PVP', format: 'DUEL', idempotencyKey: `pvp:${tournament.id}:${round}:${match.slot}`, inputSnapshot: report.inputSnapshot, report, summary, rewards: [], snapshotHash: report.snapshotHash }, tx);
    await tx.pvpMatch.update({ where: { id: match.id }, data: { homeScore: report.scores.home, awayScore: report.scores.away, winnerUserId, status: 'DONE', contestRecordId: record.id, playedAt: new Date() } });
  }
}

export async function advancePvpTournament(tournamentId: number, now?: Date, actorAdminId?: number): Promise<PvpTournamentDetail> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM PvpTournament WHERE id = ${tournamentId} FOR UPDATE`;
    const tournament = await tx.pvpTournament.findUnique({ where: { id: tournamentId } });
    if (tournament === null) throw new ApiError('NOT_FOUND', { resource: 'tournament', id: tournamentId });
    const auditStart = async (status: string): Promise<void> => {
      if (actorAdminId === undefined) return;
      const admin = await tx.user.findUniqueOrThrow({ where: { id: actorAdminId }, select: { username: true } });
      await tx.adminAuditLog.create({ data: { adminId: actorAdminId, adminNameSnapshot: admin.username, action: 'PVP_TOURNAMENT_START', targetType: 'PVP_TOURNAMENT', targetId: String(tournamentId), payload: { status } } });
    };
    const effectiveNow = now ?? new Date();
    if ((tournament.status === 'REGISTERING' && effectiveNow < tournament.autoStartAt) || tournament.status === 'FINISHED' || tournament.status === 'CANCELLED') { await auditStart(tournament.status); return detailInTx(tx, tournament, null); }
    const count = await tx.pvpRegistration.count({ where: { tournamentId } });
    if (count < 4) {
      await cancelAndRefund(tx, tournamentId);
      const cancelled = await tx.pvpTournament.findUniqueOrThrow({ where: { id: tournamentId } });
      await auditStart(cancelled.status);
      return detailInTx(tx, cancelled, null);
    }
    const running = await tx.pvpTournament.update({ where: { id: tournamentId }, data: { status: 'RUNNING' } });
    const registrationRows = await tx.pvpRegistration.findMany({ where: { tournamentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    await ensureRound(tx, running, 1);
    for (let round = 1; round <= 6; round += 1) {
      await playPending(tx, running, round);
      const matches = await tx.pvpMatch.findMany({ where: { tournamentId, round }, orderBy: { slot: 'asc' } });
      if (matches.length === 0 || matches.some((match) => match.status === 'PENDING')) break;
      const winners = matches.map((match) => match.winnerUserId).filter((id): id is number => id !== null);
      if (winners.length <= 1) {
        await tx.pvpTournament.update({ where: { id: tournamentId }, data: { status: 'FINISHED' } });
        break;
      }
      await ensureRound(tx, running, round + 1, winners);
    }
    const final = await tx.pvpTournament.findUniqueOrThrow({ where: { id: tournamentId } });
    await auditStart(final.status);
    return detailInTx(tx, final, null, registrationRows);
  });
}

async function detailInTx(tx: Db, tournament: PvpTournament, userId: number | null, registrations?: Registration[]): Promise<PvpTournamentDetail> {
  const rows = registrations ?? await tx.pvpRegistration.findMany({ where: { tournamentId: tournament.id } });
  return { id: tournament.id, name: tournament.name, status: tournament.status, size: tournament.size, registerEndsAt: tournament.registerEndsAt.toISOString(), autoStartAt: tournament.autoStartAt.toISOString(), prizes: tournament.prizes, config: tournament.config, registeredCount: rows.length, myRegistration: userId === null ? null : rows.find((row) => row.userId === userId)?.id ?? null };
}

export async function getPvpTournamentDetail(userId: number, tournamentId: number, now?: Date): Promise<PvpTournamentDetail> {
  const detail = await advancePvpTournament(tournamentId, now);
  const registration = await prisma.pvpRegistration.findUnique({ where: { tournamentId_userId: { tournamentId, userId } }, select: { id: true } });
  return { ...detail, myRegistration: registration?.id ?? null };
}

export async function getPvpBracket(userId: number, tournamentId: number, now?: Date): Promise<PvpMatchView[]> {
  await getPvpTournamentDetail(userId, tournamentId, now);
  const rows = await prisma.pvpMatch.findMany({ where: { tournamentId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] });
  return rows.map((row) => matchView(row, userId));
}

export async function startPvpTournament(adminId: number, tournamentId: number, now?: Date): Promise<PvpTournamentDetail> {
  return advancePvpTournament(tournamentId, now, adminId);
}
