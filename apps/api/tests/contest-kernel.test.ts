import { describe, expect, it } from 'vitest';
import {
  participantAttemptSchema,
  type AbilityKey,
  type ParticipantSnapshot,
  type QuestionSnapshot,
  type RankingInput,
} from '@oinur/shared';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';

function participant(): ParticipantSnapshot {
  const keys: AbilityKey[] = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING', 'CODING', 'THINKING', 'PROBLEM'];
  return {
    side: 'HOME',
    userId: 1,
    studentId: 2,
    displayName: 'Hook Player',
    abilities: Object.fromEntries(keys.map((key) => [key, 50])) as Record<AbilityKey, number>,
    mindset: 0,
    focusCap: 40,
    energyMax: 100,
  };
}

function frozenQuestion(partialScores: boolean): QuestionSnapshot {
  return {
    instanceId: 'hook-stage#0',
    index: 0,
    dimension: 'DS',
    demand: 50,
    thought: 50,
    codeVolume: 40,
    score: 100,
    timeLimitMin: 100,
    partialScores,
    traits: [
      {
        traitId: 'not-present-in-any-api-table',
        severity: 'purple',
        hooks: [{ condition: 'first_problem', submit_time_add: 1000 }],
      },
    ],
    source: 'GENERATED',
  };
}

function input(partialScores: boolean): RankingInput {
  return {
    kind: 'custom',
    student: participant(),
    participants: [],
    problems: [frozenQuestion(partialScores)],
    durationMin: 60,
  };
}

describe('frozen ranking question behavior', () => {
  it('uses frozen hooks without trait-id lookup and preserves UNFINISHED publicly', () => {
    const report = simulateRanking(input(false), 11);
    const attempt = report.participants[0]?.attempts[0];

    expect(attempt?.verdict).toBe('UNFINISHED');
    expect(attempt?.resolution.verdict).toBe('UNFINISHED');
    expect(attempt?.resolution.timeSpentMin).toBe(60);
    expect(attempt?.resolution.submissions).toHaveLength(1);
    expect(attempt?.resolution.submissions[0]?.verdict).toBe('UNFINISHED');
  });

  it('awards partial score only when the frozen question enables it', () => {
    const withoutPartial = simulateRanking(input(false), 11);
    const withPartial = simulateRanking(input(true), 11);

    expect(withoutPartial.standings[0]?.totalScore).toBe(0);
    expect(withPartial.standings[0]?.totalScore).toBe(30);
    expect(withPartial.participants[0]?.attempts[0]?.resolution.scoreAwarded).toBe(30);
  });

  it('strictly rejects malformed nested submission replay records', () => {
    const attempt = structuredClone(simulateRanking(input(false), 11).participants[0]?.attempts[0]);
    expect(attempt).toBeDefined();
    if (attempt === undefined) return;

    const missingClockFlag = structuredClone(attempt);
    const unknownSubmissionField = structuredClone(attempt);
    delete (missingClockFlag.resolution.submissions[0] as Partial<{ clockExhausted: boolean }>).clockExhausted;
    Object.assign(unknownSubmissionField.resolution.submissions[0]!, { invented: true });

    expect(participantAttemptSchema.safeParse(missingClockFlag).success).toBe(false);
    expect(participantAttemptSchema.safeParse(unknownSubmissionField).success).toBe(false);
  });
});
