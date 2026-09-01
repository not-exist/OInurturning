import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AbilityKey,
  DuelInput,
  ParticipantSnapshot,
  QuestionSnapshot,
  RankingInput,
} from '@oinur/shared';
import { importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { simulateDuel } from '../src/modules/contest/engine/duel.js';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';
import { stableHash, stableSerialize } from '../src/modules/contest/engine/report.js';
import { getStoryOverview } from '../src/modules/story/service.js';
import { resetUsers } from './helpers.js';

const abilityKeys: readonly AbilityKey[] = [
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

function participant(side: ParticipantSnapshot['side']): ParticipantSnapshot {
  return {
    side,
    userId: side === 'HOME' ? 1 : side === 'AWAY' ? 2 : null,
    studentId: side === 'HOME' ? 10 : side === 'AWAY' ? 20 : null,
    displayName: side,
    abilities: Object.fromEntries(abilityKeys.map((key) => [key, 70])) as Record<
      AbilityKey,
      number
    >,
    traits: [],
    mindset: 1,
    focusCap: 30,
    energy: 100,
    energyMax: 100,
  };
}

function question(instanceId: string, index: number): QuestionSnapshot {
  return {
    instanceId,
    index,
    dimension: 'DS',
    demand: 60,
    thought: 60,
    codeVolume: 50,
    score: 100,
    quality: 70,
    timeLimitMin: 60,
    partialScores: false,
    traits: [],
    source: 'GENERATED',
  };
}

const finalStageKeys = [
  'cspj:4',
  'csps:4',
  'noip:5',
  'province:5',
  'noi:5',
  'ctt:3',
  'cts:3',
  'ioi:4',
];

describe('M2 consolidated golden', () => {
  beforeAll(async () => {
    await importConfigs();
  });
  beforeEach(resetUsers);

  it('pins deterministic ranking and duel report JSON', () => {
    const rankingInput: RankingInput = {
      kind: 'custom',
      student: participant('HOME'),
      participants: [participant('NPC')],
      problems: [question('golden-ranking#0', 0)],
      durationMin: 120,
    };
    const duelInput: DuelInput = {
      home: participant('HOME'),
      away: participant('AWAY'),
      questions: [0, 1, 2, 3].map((index) => question(`golden-duel#${index}`, index)),
      qualityRuleOn: true,
      tiebreak: 'QUALITY',
    };
    const ranking = simulateRanking(rankingInput, 20260901);
    const duel = simulateDuel(duelInput, 20260901);

    expect(stableSerialize(simulateRanking(rankingInput, 20260901))).toBe(stableSerialize(ranking));
    expect(stableSerialize(simulateDuel(duelInput, 20260901))).toBe(stableSerialize(duel));
    expect(stableHash(ranking)).toBe('ec43a98d');
    expect(stableHash(duel)).toBe('909f2bf8');
  });

  it('loads the full M2 problem and stage catalog', async () => {
    const config = await importConfigs();
    expect(Object.keys(config.problems)).toHaveLength(34);
    expect(Object.keys(config.stages)).toHaveLength(33);
  });

  it('unlocks NG layers only after all eight chapter finals clear in the previous layer', async () => {
    const user = await prisma.user.create({ data: { username: 'm2-ng-golden' } });
    await prisma.storyProgress.createMany({
      data: finalStageKeys.map((stageKey) => ({
        userId: user.id,
        ngLevel: 0,
        stageKey,
        clearCount: 1,
      })),
    });
    expect((await getStoryOverview(user.id, 1)).maxUnlockedNgLevel).toBe(1);

    await prisma.storyProgress.createMany({
      data: finalStageKeys.map((stageKey) => ({
        userId: user.id,
        ngLevel: 1,
        stageKey,
        clearCount: 1,
      })),
    });
    expect((await getStoryOverview(user.id, 2)).maxUnlockedNgLevel).toBe(2);
  });
});
