import { describe, expect, it } from 'vitest';
import {
  attemptResolutionSchema,
  participantAttemptSchema,
  questionAttemptSchema,
  rankingInputSchema,
  rankingReportSchema,
  type AbilityKey,
  type ContestSummary,
  type ParticipantSnapshot,
  type QuestionSnapshot,
  type RankingInput,
} from '@oinur/shared';
import { simulateRanking } from '../src/modules/contest/engine/ranking.js';
import {
  ENGINE_VERSION,
  buildContestSummary,
  serializeRankingReport,
  stableHash,
  stableSerialize,
} from '../src/modules/contest/engine/report.js';
import { RNG_VERSION } from '../src/modules/contest/engine/rng.js';

function participant(displayName = 'Replay Player', ability = 70): ParticipantSnapshot {
  const abilities = Object.fromEntries(
    (['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING', 'CODING', 'THINKING', 'PROBLEM'] as AbilityKey[]).map(
      (key) => [key, ability],
    ),
  ) as Record<AbilityKey, number>;

  return {
    side: displayName === 'Replay Player' ? 'HOME' : 'NPC',
    userId: displayName === 'Replay Player' ? 11 : null,
    studentId: displayName === 'Replay Player' ? 22 : null,
    displayName,
    abilities,
    mindset: 2,
    focusCap: 35,
    energyMax: 90,
  };
}

function replayQuestion(overrides: Partial<QuestionSnapshot> = {}): QuestionSnapshot {
  return {
    instanceId: 'csps:3:ng2#3',
    index: 3,
    dimension: 'GREEDY',
    demand: 68,
    thought: 65,
    codeVolume: 60,
    score: 100,
    timeLimitMin: 75,
    partialScores: false,
    traits: [],
    source: 'GENERATED',
    ...overrides,
  };
}

function input(): RankingInput {
  return {
    kind: 'story',
    stageRef: { chapter: 'csps', stageIndex: 3, ngPlusLayer: 2 },
    student: participant(),
    participants: [participant('Replay NPC', 55)],
    problems: [replayQuestion()],
    durationMin: 180,
    firstClearAvailable: true,
  };
}

describe('shared ranking contracts', () => {
  it('exports strict schemas for input, replay attempts, and reports', () => {
    const report = simulateRanking(input(), 0x1234abcd);
    const firstResolution = report.participants[0]?.attempts[0]?.resolution;
    const firstSubmission = firstResolution?.submissions[0];

    expect(rankingInputSchema.parse(input())).toEqual(input());
    expect(rankingReportSchema.parse(report)).toEqual(report);
    expect(participantAttemptSchema.parse(report.participants[0]?.attempts[0])).toEqual(
      report.participants[0]?.attempts[0],
    );
    expect(questionAttemptSchema.parse(firstResolution)).toEqual(firstResolution);
    expect(attemptResolutionSchema.parse(firstSubmission)).toEqual(firstSubmission);
  });

  it('rejects inconsistent indexes, ranks, totals, energy, final mindset, and pass state', () => {
    const report = simulateRanking(input(), 45);
    const duplicateIndex = structuredClone(report);
    const wrongRank = structuredClone(report);
    const wrongTotal = structuredClone(report);
    const wrongEnergy = structuredClone(report);
    const wrongMindset = structuredClone(report);
    const wrongPass = structuredClone(report);

    duplicateIndex.standings[1]!.participantIndex = 0;
    wrongRank.standings[0]!.rank = 2;
    wrongTotal.standings[0]!.totalScore += 1;
    wrongEnergy.participants[0]!.totalEnergySpent += 1;
    wrongMindset.participants[0]!.finalMindset += 1;
    wrongPass.pass = !wrongPass.pass;

    for (const invalid of [duplicateIndex, wrongRank, wrongTotal, wrongEnergy, wrongMindset, wrongPass]) {
      expect(rankingReportSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('rejects standings that swap stable participant indexes despite tied totals', () => {
    const tiedInput = input();
    tiedInput.student.energyMax = 0;
    tiedInput.participants![0]!.energyMax = 0;
    const swapped = structuredClone(simulateRanking(tiedInput, 45));
    swapped.standings[0]!.participantIndex = 1;
    swapped.standings[1]!.participantIndex = 0;

    expect(rankingReportSchema.safeParse(swapped).success).toBe(false);
  });
});

describe('ranking report determinism', () => {
  it('produces byte-equivalent validated reports for identical input and seed', () => {
    const contestInput = input();
    const first = simulateRanking(contestInput, 0x1234abcd);
    const second = simulateRanking(contestInput, 0x1234abcd);
    const firstBytes = serializeRankingReport(first);
    const secondBytes = serializeRankingReport(second);

    expect(firstBytes).toBe(secondBytes);
    expect(firstBytes).toBe(stableSerialize(first));
    expect(stableHash(first)).toBe(stableHash(second));
  });

  it('fills replay metadata from constants and the validated frozen input snapshot', () => {
    const contestInput = input();
    const report = simulateRanking(contestInput, 0xffffffff);

    expect(report).toMatchObject({
      reportVersion: 1,
      engineVersion: ENGINE_VERSION,
      rngVersion: RNG_VERSION,
      seed: 0xffffffff,
      snapshotHash: stableHash(rankingInputSchema.parse(contestInput)),
      stageRef: contestInput.stageRef,
    });
    expect(report.createdAt).toBe('1970-02-19T17:02:47.295Z');
    expect(report.questions).not.toBe(contestInput.problems);
    expect(report.participants[0]?.participant).not.toBe(contestInput.student);
  });

  it('pins one nontrivial report serialization and hash with a penalized non-AC path', () => {
    const goldenInput: RankingInput = {
      kind: 'custom',
      student: participant(),
      participants: [],
      problems: [
        replayQuestion({
          instanceId: 'golden#0',
          index: 0,
          demand: 70,
          thought: 70,
          codeVolume: 50,
          timeLimitMin: 30,
          partialScores: true,
          traits: [
            {
              traitId: 'golden-failure',
              severity: 'black',
              hooks: [{ ac_prob_add: -1, wa_penalty_add: 5 }],
            },
          ],
        }),
      ],
      durationMin: 100,
    };
    const report = simulateRanking(goldenInput, 123);
    const serialized = serializeRankingReport(report);

    expect(report.participants[0]?.attempts[0]?.resolution.submissions.some((entry) => entry.verdict !== 'AC')).toBe(
      true,
    );
    expect(report.participants[0]?.attempts[0]?.resolution.penaltyMin).toBeGreaterThan(0);
    expect(stableHash(report)).toBe('3c6aee2c');
    expect(serialized).toBe(
      '{"createdAt":"1970-01-01T00:00:00.123Z","engineVersion":"ranking-v1","format":"RANKING","growth":[],"participants":[{"attempts":[{"energyCost":14,"focusGain":6,"mindsetDelta":-12,"minutesUsed":100,"penaltyMin":55.31720358486209,"questionIndex":0,"resolution":{"energyAfter":76,"energyCost":14,"energyRequired":2,"estimatedTimeMin":19.55192508628933,"focusAfter":6,"focusBefore":0,"mindsetAfter":-10,"mindsetDelta":-12,"notes":["WA","WA","WA"],"penaltyMin":55.31720358486209,"questionIndex":0,"scoreAwarded":30,"submissionCount":3,"submissions":[{"attemptNumber":1,"clockExhausted":false,"extraEnergyCost":4,"mindsetDelta":-4,"penaltyMin":25,"submissionTimeMin":18.006145652292588,"timeSpentMin":43.00614565229259,"verdict":"WA"},{"attemptNumber":2,"clockExhausted":false,"extraEnergyCost":4,"mindsetDelta":-4,"penaltyMin":25,"submissionTimeMin":11.843373965624004,"timeSpentMin":36.843373965624004,"verdict":"WA"},{"attemptNumber":3,"clockExhausted":true,"extraEnergyCost":4,"mindsetDelta":-4,"penaltyMin":5.317203584862094,"submissionTimeMin":14.833276797221307,"timeSpentMin":20.1504803820834,"verdict":"WA"}],"timeSpentMin":100,"tleJudgeCount":0,"verdict":"UNFINISHED","waCount":3},"verdict":"UNFINISHED"}],"finalMindset":-10,"participant":{"abilities":{"CODING":70,"DP":70,"DS":70,"GRAPH":70,"GREEDY":70,"MATH":70,"PROBLEM":70,"STRING":70,"THINKING":70},"displayName":"Replay Player","energyMax":90,"focusCap":35,"mindset":2,"side":"HOME","studentId":22,"userId":11},"totalEnergySpent":14}],"pass":true,"questions":[{"codeVolume":50,"demand":70,"dimension":"GREEDY","index":0,"instanceId":"golden#0","partialScores":true,"score":100,"source":"GENERATED","thought":70,"timeLimitMin":30,"traits":[{"hooks":[{"ac_prob_add":-1,"wa_penalty_add":5}],"severity":"black","traitId":"golden-failure"}]}],"reportVersion":1,"rewards":[],"rngVersion":"mulberry32-v1","seed":123,"snapshotHash":"0c93f3a7","standings":[{"participantIndex":0,"rank":1,"totalScore":30}]}',
    );
  });

  it('changes the snapshot hash when replay input changes', () => {
    const original = input();
    const changed = { ...input(), durationMin: input().durationMin + 1 };

    expect(simulateRanking(original, 44).snapshotHash).not.toBe(simulateRanking(changed, 44).snapshotHash);
  });

  it('builds the discriminated compact summary and preserves settlement lines', () => {
    const report = simulateRanking(input(), 72);
    report.rewards.push({ type: 'rank_bonus_money', rank: 1, amount: 300 });
    report.growth.push({ attr: 'greedy', delta: 1, sourceProblem: 'csps:3#3' });

    const summary = buildContestSummary(report);
    const expected: ContestSummary = {
      format: 'RANKING',
      rank: report.standings.find((standing) => standing.participantIndex === 0)?.rank ?? 0,
      participantCount: 2,
      totalScore: report.standings.find((standing) => standing.participantIndex === 0)?.totalScore ?? 0,
      rewards: report.rewards,
      growth: report.growth,
    };

    expect(summary).toEqual(expected);
    expect(summary.rewards).not.toBe(report.rewards);
    expect(summary.growth).not.toBe(report.growth);
  });
});

describe('canonical serializer rejection', () => {
  it('rejects every unsupported root or member instead of colliding with valid JSON', () => {
    const sparse: unknown[] = [];
    sparse[1] = 1;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const unsupported: unknown[] = [
      sparse,
      [undefined],
      { value: undefined },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      1n,
      cyclic,
      () => 1,
      Symbol('root'),
      { value: () => 1 },
      { value: Symbol('member') },
    ];

    for (const value of unsupported) expect(() => stableSerialize(value)).toThrow();
  });
});
