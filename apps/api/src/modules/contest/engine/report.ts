import {
  rankingReportSchema,
  type ContestSummary,
  type QuestionSnapshot,
  type RankingReport,
} from '@oinur/shared';
import { stableSerialize } from '../../../lib/json.js';
import { fnv1a32 } from './rng.js';

export const ENGINE_VERSION = 'ranking-v2' as const;
export const PASS_RANK_MAX = 8 as const;

export function stableHash(value: unknown): string {
  return fnv1a32(stableSerialize(value)).toString(16).padStart(8, '0');
}

export function validateRankingReport(report: RankingReport): RankingReport {
  return rankingReportSchema.parse(report);
}

export function isPassingRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= 1 && rank <= PASS_RANK_MAX;
}

export function buildContestSummary(report: RankingReport): ContestSummary {
  const playerStanding = report.standings.find((standing) => standing.teamIndex === 0);
  if (playerStanding === undefined)
    throw new Error('Ranking report is missing the player standing');

  return {
    format: 'RANKING',
    rank: playerStanding.rank,
    participantCount: report.teams.length,
    totalScore: playerStanding.totalScore,
    rewards: report.rewards.map((reward) => ({ ...reward })),
    growth: report.growth.map((delta) => ({ ...delta })),
  };
}

export function cloneQuestionSnapshot(question: QuestionSnapshot): QuestionSnapshot {
  return {
    ...question,
    traits: question.traits.map((trait) => ({
      ...trait,
      hooks: trait.hooks.map((hook) => ({ ...hook })),
    })),
  };
}
