import { Prisma, type PvpMatch, type PvpRewardGrant, type PvpTournament } from '@prisma/client';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export type PvpRewardLine =
  | { type: 'item'; itemId: string; count: number }
  | { type: 'money'; amount: number }
  | { type: 'reputation'; amount: number };

export interface PvpRewardGrantView {
  id: number;
  tournamentId: number;
  userId: number;
  rank: number;
  rewards: PvpRewardLine[];
  claimedAt: string | null;
  claimable: boolean;
}

interface PrizeBucket {
  money?: number;
  reputation?: number;
  items: { itemId: string; count: number }[];
}

interface PrizeConfig {
  champion: PrizeBucket;
  runnerUp: PrizeBucket;
  thirdToFourth: PrizeBucket;
  otherFirstRoundWinners: PrizeBucket;
}

interface Standing {
  userId: number;
  rank: number;
  firstRoundWinner: boolean;
}

const DEFAULT_PRIZES: PrizeConfig = {
  champion: { items: [{ itemId: 'advance-stone', count: 2 }, { itemId: 'trophy-champion', count: 1 }] },
  runnerUp: { items: [{ itemId: 'advance-stone', count: 1 }, { itemId: 'reroll-ticket', count: 1 }] },
  thirdToFourth: { items: [{ itemId: 'reroll-ticket', count: 1 }] },
  otherFirstRoundWinners: { items: [{ itemId: 'entry-ticket', count: 1 }] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function rawBucket(root: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(root, key)) return root[key];
  }
  return undefined;
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ApiError('VALIDATION_FAILED', { field: 'prizes', path, reason: 'must be a non-negative integer' });
  }
  return value;
}

function parseBucket(value: unknown, fallback: PrizeBucket, path: string): PrizeBucket {
  if (value === undefined) return { ...fallback, items: [...fallback.items] };
  if (!isRecord(value)) {
    throw new ApiError('VALIDATION_FAILED', { field: 'prizes', path, reason: 'must be an object' });
  }
  const root = value;
  const itemsValue = root.items;
  if (itemsValue !== undefined && !Array.isArray(itemsValue)) {
    throw new ApiError('VALIDATION_FAILED', { field: 'prizes', path: `${path}.items`, reason: 'must be an array' });
  }
  const items = (itemsValue ?? []).map((entry, index) => {
    const item = record(entry);
    if (typeof item.itemId !== 'string' || item.itemId.length === 0) {
      throw new ApiError('VALIDATION_FAILED', { field: 'prizes', path: `${path}.items.${index}.itemId` });
    }
    return { itemId: item.itemId, count: nonnegativeInteger(item.count, `${path}.items.${index}.count`) || 0 };
  }).filter((item) => item.count > 0);
  const result: PrizeBucket = { items };
  if (root.money !== undefined) result.money = nonnegativeInteger(root.money, `${path}.money`);
  if (root.reputation !== undefined) result.reputation = nonnegativeInteger(root.reputation, `${path}.reputation`);
  return result;
}

function normalizePrizes(prizes: unknown, withDefaults = true): PrizeConfig {
  if (!isRecord(prizes)) throw new ApiError('VALIDATION_FAILED', { field: 'prizes', reason: 'must be an object' });
  const root = record(prizes);
  const fallback = (bucket: PrizeBucket): PrizeBucket => withDefaults ? bucket : { items: [] };
  return {
    champion: parseBucket(rawBucket(root, ['champion']), fallback(DEFAULT_PRIZES.champion), 'champion'),
    runnerUp: parseBucket(rawBucket(root, ['runner_up', 'runnerUp']), fallback(DEFAULT_PRIZES.runnerUp), 'runner_up'),
    thirdToFourth: parseBucket(rawBucket(root, ['third_to_fourth', 'third_to_eighth', 'thirdToFourth']), fallback(DEFAULT_PRIZES.thirdToFourth), 'third_to_fourth'),
    otherFirstRoundWinners: parseBucket(rawBucket(root, ['other_first_round_winners', 'otherFirstRoundWinners', 'other']), fallback(DEFAULT_PRIZES.otherFirstRoundWinners), 'other_first_round_winners'),
  };
}

function validateItems(config: PrizeConfig): void {
  const items = getConfig()?.items;
  if (items === undefined) throw new Error('[pvp] CONFIG.items 未加载');
  for (const bucket of [config.champion, config.runnerUp, config.thirdToFourth, config.otherFirstRoundWinners]) {
    for (const item of bucket.items) {
      if (items[item.itemId] === undefined) {
        throw new ApiError('VALIDATION_FAILED', { field: 'prizes', itemId: item.itemId, reason: 'unknown item' });
      }
    }
  }
}

export function validatePvpPrizes(prizes: unknown): void {
  validateItems(normalizePrizes(prizes, false));
}

function rewardLines(bucket: PrizeBucket, champion: boolean): PvpRewardLine[] {
  const lines: PvpRewardLine[] = [];
  if (bucket.money !== undefined && bucket.money > 0) lines.push({ type: 'money', amount: bucket.money });
  if (bucket.reputation !== undefined && bucket.reputation > 0) lines.push({ type: 'reputation', amount: bucket.reputation });
  if (champion) lines.push({ type: 'item', itemId: 'tag-card', count: 1 });
  lines.push(...bucket.items.filter((item) => item.itemId !== 'tag-card').map((item) => ({ type: 'item' as const, ...item })));
  return lines;
}

function loser(match: PvpMatch): number | null {
  if (match.winnerUserId === null) return null;
  if (match.homeUserId === match.winnerUserId) return match.awayUserId;
  if (match.awayUserId === match.winnerUserId) return match.homeUserId;
  return null;
}

function standings(matches: readonly PvpMatch[], participantIds: readonly number[]): Standing[] {
  const firstRoundWinners = new Set(matches.filter((match) => match.round === 1 && match.winnerUserId !== null).map((match) => match.winnerUserId!));
  const decided = matches.filter((match) => match.status === 'DONE' && match.winnerUserId !== null);
  const finalRound = decided.reduce((max, match) => Math.max(max, match.round), 0);
  const final = decided.find((match) => match.round === finalRound);
  const ordered: number[] = [];
  const add = (userId: number | null): void => {
    if (userId !== null && !ordered.includes(userId)) ordered.push(userId);
  };
  add(final?.winnerUserId ?? null);
  add(final === undefined ? null : loser(final));
  if (finalRound > 1) {
    for (const match of matches.filter((candidate) => candidate.round === finalRound - 1 && candidate.status === 'DONE').sort((left, right) => left.slot - right.slot)) add(loser(match));
  }
  for (const userId of participantIds) add(userId);
  return ordered.map((userId, index) => ({ userId, rank: index + 1, firstRoundWinner: firstRoundWinners.has(userId) }));
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function storedRewards(value: unknown): PvpRewardLine[] {
  if (!Array.isArray(value)) throw new ApiError('STATE_CONFLICT', { resource: 'pvp-reward', reason: 'invalid reward payload' });
  return value as PvpRewardLine[];
}

function grantView(row: PvpRewardGrant, viewerUserId: number): PvpRewardGrantView {
  const rewards = storedRewards(row.rewards);
  return { id: row.id, tournamentId: row.tournamentId, userId: row.userId, rank: row.rank, rewards, claimedAt: row.claimedAt?.toISOString() ?? null, claimable: row.userId === viewerUserId && row.claimedAt === null && rewards.length > 0 };
}

export async function ensurePvpRewardGrants(tx: Prisma.TransactionClient, tournament: PvpTournament): Promise<void> {
  const [matches, registrations] = await Promise.all([
    tx.pvpMatch.findMany({ where: { tournamentId: tournament.id }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] }),
    tx.pvpRegistration.findMany({ where: { tournamentId: tournament.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { userId: true } }),
  ]);
  const config = normalizePrizes(tournament.prizes);
  validateItems(config);
  for (const standing of standings(matches, registrations.map((registration) => registration.userId))) {
    const bucket = standing.rank === 1
      ? config.champion
      : standing.rank === 2
        ? config.runnerUp
        : standing.rank <= 4
          ? config.thirdToFourth
          : standing.firstRoundWinner
            ? config.otherFirstRoundWinners
            : { items: [] };
    const rewards = rewardLines(bucket, standing.rank === 1);
    await tx.pvpRewardGrant.upsert({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: standing.userId } },
      create: { tournamentId: tournament.id, userId: standing.userId, rank: standing.rank, rewards: json(rewards) },
      update: { rank: standing.rank, rewards: json(rewards) },
    });
  }
}

export async function listPvpRewardGrants(viewerUserId: number, tournamentId: number): Promise<PvpRewardGrantView[]> {
  const rows = await prisma.pvpRewardGrant.findMany({ where: { tournamentId }, orderBy: { rank: 'asc' } });
  return rows.map((row) => grantView(row, viewerUserId));
}

export async function claimPvpReward(userId: number, tournamentId: number): Promise<PvpRewardGrantView> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM PvpTournament WHERE id = ${tournamentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const grant = await tx.pvpRewardGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } });
    if (grant === null) throw new ApiError('NOT_FOUND', { resource: 'pvp-reward', id: tournamentId });
    if (grant.claimedAt !== null) return grantView(grant, userId);
    const rewards = storedRewards(grant.rewards);
    for (const reward of rewards) {
      if (reward.type === 'money') {
        await tx.user.update({ where: { id: userId }, data: { money: { increment: reward.amount } } });
      } else if (reward.type === 'reputation') {
        await tx.user.update({ where: { id: userId }, data: { reputation: { increment: reward.amount } } });
        await tx.reputationLog.create({ data: { userId, delta: reward.amount, reason: `PVP_PRIZE:${tournamentId}:${grant.id}` } });
      } else {
        await tx.userItem.upsert({ where: { userId_itemId: { userId, itemId: reward.itemId } }, create: { userId, itemId: reward.itemId, quantity: reward.count }, update: { quantity: { increment: reward.count } } });
      }
    }
    const claimed = await tx.pvpRewardGrant.update({ where: { id: grant.id }, data: { claimedAt: new Date() } });
    return grantView(claimed, userId);
  });
}
