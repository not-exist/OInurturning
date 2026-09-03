import { createRandomStream, deriveStreamSeed } from '../contest/engine/rng.js';

export interface BracketParticipant {
  userId: number;
}

export interface FirstRoundSlot {
  slot: number;
  homeUserId: number | null;
  awayUserId: number | null;
  status: 'PENDING' | 'BYE';
  winnerUserId: number | null;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = createRandomStream(seed, 'shuffle');
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

/** 生成确定性首轮 slot；空位作为 BYE，不把玩家快照重新排序到数据库自然顺序。 */
export function buildFirstRound(
  participants: readonly BracketParticipant[],
  declaredSize: number,
  seed: number,
): FirstRoundSlot[] {
  if (participants.length < 1 || participants.length > declaredSize) {
    throw new Error('participant count must fit declared tournament size');
  }
  const bracketSize = Math.min(declaredSize, nextPowerOfTwo(participants.length));
  const positions = shuffle(
    Array.from({ length: bracketSize }, (_, index) => index),
    deriveStreamSeed(seed, 'positions'),
  );
  const byPosition = new Array<number | null>(bracketSize).fill(null);
  participants.forEach((participant, index) => {
    byPosition[positions[index]!] = participant.userId;
  });
  const rounds: FirstRoundSlot[] = [];
  for (let index = 0; index < bracketSize; index += 2) {
    const homeUserId = byPosition[index] ?? null;
    const awayUserId = byPosition[index + 1] ?? null;
    const status = homeUserId === null || awayUserId === null ? 'BYE' : 'PENDING';
    rounds.push({
      slot: rounds.length,
      homeUserId,
      awayUserId,
      status,
      winnerUserId: homeUserId ?? awayUserId,
    });
  }
  return rounds;
}

export function buildNextRound(
  winners: readonly (number | null)[],
): FirstRoundSlot[] {
  const matches: FirstRoundSlot[] = [];
  for (let index = 0; index < winners.length; index += 2) {
    const homeUserId = winners[index] ?? null;
    const awayUserId = winners[index + 1] ?? null;
    const status = homeUserId === null || awayUserId === null ? 'BYE' : 'PENDING';
    matches.push({
      slot: matches.length,
      homeUserId,
      awayUserId,
      status,
      winnerUserId: homeUserId ?? awayUserId,
    });
  }
  return matches;
}
