import { describe, expect, it } from 'vitest';
import type {
  ContestSummary,
  GrowthDelta,
  RankingReport,
  RewardLine,
  StoryProgressView,
} from '@oinur/shared';

const rewards: RewardLine[] = [{ type: 'first_clear_money', amount: 100 }];
const growth: GrowthDelta[] = [{ attr: 'ds', delta: 1, sourceProblem: 'stage-1#0' }];

const rankingSummary = {
  format: 'RANKING',
  rank: 1,
  participantCount: 8,
  totalScore: 300,
  rewards,
  growth,
} satisfies ContestSummary;

type RankingSummary = Extract<ContestSummary, { format: 'RANKING' }>;
type DuelSummary = Extract<ContestSummary, { format: 'DUEL' }>;
const rankingHasNoDuelFields: false = false as 'winnerSide' extends keyof RankingSummary ? true : false;
const duelHasNoRankingFields: false = false as 'rank' extends keyof DuelSummary ? true : false;

const rankingReport = {
  reportVersion: 1,
  seed: 42,
  createdAt: '2026-08-31T00:00:00.000Z',
  stageRef: { chapter: 'chapter-1', stageIndex: 1, ngPlusLayer: 2 },
  rewards,
  growth,
  format: 'RANKING',
  questions: [],
  participants: [],
  standings: [],
} satisfies RankingReport;

const progress = {
  stageKey: 'chapter-1:1',
  ngLevel: 2,
  firstClearAt: null,
  bestRank: 1,
  clearCount: 1,
  rewards,
  growth,
  lastSummary: rankingSummary,
} satisfies StoryProgressView;

describe('contest result contracts', () => {
  it('carry report metadata, rewards, and growth through result views', () => {
    expect(rankingReport.stageRef.ngPlusLayer).toBe(2);
    expect(rankingReport.rewards).toEqual(rewards);
    expect(rankingSummary.growth).toEqual(growth);
    expect(progress.rewards).toEqual(rewards);
    expect(rankingHasNoDuelFields).toBe(false);
    expect(duelHasNoRankingFields).toBe(false);
  });
});
