import { rankingSeedSchema, type ParticipantSnapshot, type StageConfig } from '@oinur/shared';
import { createRandomStream, deriveStreamSeed } from './engine/rng.js';
import type { RandomSource } from './engine/models.js';

const NPC_DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;
export type DuelOpponentKind =
  | 'random_common'
  | 'random_skilled'
  | 'random_elite'
  | 'platform_reviewer'
  | 'legendary_ghost';

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function normal(random: RandomSource, mean: number, standardDeviation: number): number {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  const unit = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return mean + standardDeviation * unit;
}

function npcParticipant(
  random: RandomSource,
  index: number,
  stage: StageConfig,
): ParticipantSnapshot {
  const { mean_level: meanLevel, spread } = stage.npc_pool;
  const level = clamp(Math.round(normal(random, meanLevel, spread)), 1, 100);
  const dominant = Math.floor(random() * NPC_DIMENSIONS.length);
  const abilities = Object.fromEntries(
    NPC_DIMENSIONS.map((dimension, dimensionIndex) => [
      dimension,
      clamp(Math.round(normal(random, level + (dimensionIndex === dominant ? 5 : 0), 3)), 1, 100),
    ]),
  ) as Record<(typeof NPC_DIMENSIONS)[number], number>;

  const energyMax = clamp(Math.round(normal(random, 70, 8)), 40, 100);

  return {
    side: 'NPC',
    userId: null,
    studentId: null,
    displayName: `NPC ${index + 1}`,
    abilities: {
      ...abilities,
      CODING: clamp(Math.round(normal(random, level, 3)), 1, 100),
      THINKING: clamp(Math.round(normal(random, level, 3)), 1, 100),
      PROBLEM: level,
    },
    traits: [],
    mindset: clamp(Math.round(normal(random, 1, 3)), -5, 10),
    focusCap: clamp(Math.round(normal(random, 20 + 0.15 * level, 5)), 5, 60),
    energy: energyMax,
    energyMax,
  };
}

export function generateNpcPool(stage: StageConfig, seed: number): ParticipantSnapshot[] {
  const validatedSeed = rankingSeedSchema.parse(seed);
  return Array.from({ length: stage.npc_pool.size }, (_, index) => {
    const npcSeed = deriveStreamSeed(validatedSeed, `npc:${index}`);
    return npcParticipant(createRandomStream(npcSeed, 'misc'), index, stage);
  });
}

const DUEL_OPPONENTS: Record<DuelOpponentKind, { level: number; spread: number; energy: number }> = {
  random_common: { level: 8, spread: 3, energy: 55 },
  random_skilled: { level: 24, spread: 5, energy: 65 },
  random_elite: { level: 45, spread: 6, energy: 75 },
  platform_reviewer: { level: 38, spread: 5, energy: 70 },
  legendary_ghost: { level: 75, spread: 5, energy: 90 },
};

/** 生成事件遭遇战的 AWAY 侧；所有数值由事件对手档位和 seed 定格。 */
export function generateDuelOpponent(
  kind: DuelOpponentKind,
  seed: number,
  powerMultiplier = 1,
): ParticipantSnapshot {
  const params = DUEL_OPPONENTS[kind];
  const random = createRandomStream(seed, 'duel-opponent');
  const level = clamp(Math.round(normal(random, params.level * powerMultiplier, params.spread)), 1, 100);
  const dominant = Math.floor(random() * NPC_DIMENSIONS.length);
  const abilities = Object.fromEntries(
    NPC_DIMENSIONS.map((dimension, index) => [
      dimension,
      clamp(Math.round(normal(random, level + (index === dominant ? 5 : 0), 3)), 1, 100),
    ]),
  ) as Record<(typeof NPC_DIMENSIONS)[number], number>;
  const energyMax = clamp(Math.round(normal(random, params.energy * powerMultiplier, 5)), 20, 100);
  return {
    side: 'AWAY',
    userId: null,
    studentId: null,
    displayName: `事件对手·${kind}`,
    abilities: {
      ...abilities,
      CODING: clamp(Math.round(normal(random, level, 3)), 1, 100),
      THINKING: clamp(Math.round(normal(random, level, 3)), 1, 100),
      PROBLEM: clamp(Math.round(normal(random, level, 3)), 1, 100),
    },
    traits: [],
    mindset: clamp(Math.round(normal(random, 1, 3)), -5, 10),
    focusCap: 0,
    energy: energyMax,
    energyMax,
  };
}
