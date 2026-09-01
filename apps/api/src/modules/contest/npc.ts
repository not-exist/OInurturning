import { rankingSeedSchema, type ParticipantSnapshot, type StageConfig } from '@oinur/shared';
import { createRandomStream, deriveStreamSeed } from './engine/rng.js';
import type { RandomSource } from './engine/models.js';

const NPC_DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;

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
