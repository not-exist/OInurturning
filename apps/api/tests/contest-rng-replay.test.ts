import { describe, expect, it } from 'vitest';
import type {
  AbilityKey,
  ParticipantSnapshot,
  QuestionSnapshot,
  RankingInput,
} from '@oinur/shared';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';
import { createRandomStream, deriveStreamSeed } from '../src/modules/contest/engine/rng.js';
import { solveQuestion } from '../src/modules/contest/engine/solve.js';

function participant(displayName: string, side: ParticipantSnapshot['side']): ParticipantSnapshot {
  const keys: AbilityKey[] = [
    'DS',
    'DP',
    'MATH',
    'GRAPH',
    'GREEDY',
    'STRING',
    'CODING',
    'THINKING',
    'PROBLEM',
  ];
  return {
    side,
    userId: side === 'HOME' ? 1 : null,
    studentId: side === 'HOME' ? 2 : null,
    displayName,
    abilities: Object.fromEntries(keys.map((key) => [key, 60])) as Record<AbilityKey, number>,
    traits: [],
    mindset: 0,
    focusCap: 30,
    energyMax: 100,
  };
}

const question: QuestionSnapshot = {
  instanceId: 'rng-stage#0',
  index: 0,
  dimension: 'DP',
  demand: 58,
  thought: 56,
  codeVolume: 45,
  score: 100,
  timeLimitMin: 60,
  partialScores: false,
  traits: [],
  source: 'GENERATED',
};

describe('ranking RNG replay labels', () => {
  it('uses direct noise/judge streams for the player and npc:i hierarchy for NPCs', () => {
    const player = participant('Player', 'HOME');
    const npc = participant('NPC 0', 'NPC');
    const input: RankingInput = {
      kind: 'custom',
      student: player,
      participants: [npc],
      problems: [question],
      durationMin: 180,
    };
    const seed = 77;
    const report = simulateRanking(input, seed);
    const expectedPlayer = solveQuestion(
      {
        participant: player,
        question,
        availableEnergy: player.energyMax,
        remainingClockMin: input.durationMin,
        focus: 0,
        mindset: player.mindset,
        partialScores: question.partialScores,
        hooks: [],
        hookContext: { isFirstProblem: true, isAntiAk: true },
      },
      {
        noise: createRandomStream(seed, 'noise'),
        judge: createRandomStream(seed, 'judge'),
      },
    );
    const npcSeed = deriveStreamSeed(seed, 'npc:0');
    const expectedNpc = solveQuestion(
      {
        participant: npc,
        question,
        availableEnergy: npc.energyMax,
        remainingClockMin: input.durationMin,
        focus: 0,
        mindset: npc.mindset,
        partialScores: question.partialScores,
        hooks: [],
        hookContext: { isFirstProblem: true, isAntiAk: true },
      },
      {
        noise: createRandomStream(npcSeed, 'noise'),
        judge: createRandomStream(npcSeed, 'judge'),
      },
    );

    expect(report.participants[0]?.attempts[0]?.resolution).toEqual(expectedPlayer);
    expect(report.participants[1]?.attempts[0]?.resolution).toEqual(expectedNpc);
  });
});
