import type { ProblemSeverity } from '../config/problems.js';
import type { AbilityKey, DimensionKey } from '../enums.js';

export type ContestFormat = 'RANKING' | 'DUEL';
export type ContestSide = 'HOME' | 'AWAY' | 'NPC';
export type ContestVerdict = 'AC' | 'WA' | 'TLE' | 'SKIP';
export type DuelWinnerSide = 'HOME' | 'AWAY' | 'DRAW';
export type TiebreakMode = 'SUDDEN_DEATH' | 'ENERGY' | 'QUALITY' | 'FRIENDLY';

export interface ContestStageRef {
  chapter: string;
  stageIndex: number;
  ngPlusLayer: number;
}

export interface QuestionTraitSnapshot {
  traitId: string;
  severity: ProblemSeverity;
}

/** Immutable question values used by the simulator and embedded in reports. */
export interface QuestionSnapshot {
  index: number;
  dimension: DimensionKey;
  demand: number;
  thought: number;
  codeVolume: number;
  score: number;
  timeLimitMin: number;
  trait?: QuestionTraitSnapshot;
  source: 'GENERATED' | 'PREMADE';
  premadeEntryId?: number;
}

/** Immutable participant values captured at contest entry. */
export interface ParticipantSnapshot {
  side: ContestSide;
  userId: number | null;
  studentId: number | null;
  displayName: string;
  abilities: Record<AbilityKey, number>;
  mindset: number;
  focusCap: number;
  energyMax: number;
}

export interface ParticipantAttempt {
  questionIndex: number;
  verdict: ContestVerdict;
  minutesUsed: number;
  penaltyMin?: number;
  focusGain: number;
  energyCost: number;
  mindsetDelta: number;
}

export interface ParticipantTimeline {
  participant: ParticipantSnapshot;
  attempts: ParticipantAttempt[];
  totalEnergySpent: number;
  finalMindset: number;
}

export interface RankingStanding {
  participantIndex: number;
  totalScore: number;
  rank: number;
}

export interface ReportHeader {
  reportVersion: 1;
  seed: number;
  createdAt: string;
  stageRef?: ContestStageRef;
  rewards: RewardLine[];
  growth: GrowthDelta[];
}

export interface RankingReport extends ReportHeader {
  format: 'RANKING';
  questions: QuestionSnapshot[];
  participants: ParticipantTimeline[];
  standings: RankingStanding[];
}

export interface DuelRoundReport {
  roundNo: number;
  setterSide: 'HOME' | 'AWAY';
  question: QuestionSnapshot;
  answerer: ParticipantSnapshot;
  solved: boolean;
  scoreAwarded: number;
  reason: Exclude<ContestVerdict, 'SKIP'>;
}

export interface DuelReport extends ReportHeader {
  format: 'DUEL';
  rounds: DuelRoundReport[];
  scores: { home: number; away: number };
  tiebreak?: TiebreakMode;
  qualityRuleOn: boolean;
  winnerSide: DuelWinnerSide;
}

export type ContestReport = RankingReport | DuelReport;

export type RewardLine =
  | { type: 'first_clear_money'; amount: number }
  | { type: 'first_clear_item'; itemId: string; count: number }
  | { type: 'milestone_item'; itemId: string; count: number }
  | { type: 'rank_bonus_money'; rank: number; amount: number };

export interface GrowthDelta {
  attr:
    | 'ds'
    | 'dp'
    | 'math'
    | 'graph'
    | 'greedy'
    | 'string'
    | 'thinking'
    | 'code'
    | 'focus_cap'
    | 'stamina_regen';
  delta: 1;
  sourceProblem?: string;
}

export interface RankingSummary {
  format: 'RANKING';
  rank: number;
  participantCount: number;
  totalScore: number;
  rewards: RewardLine[];
  growth: GrowthDelta[];
}

export interface DuelSummary {
  format: 'DUEL';
  winnerSide: DuelWinnerSide;
  homeScore: number;
  awayScore: number;
  rewards: RewardLine[];
  growth: GrowthDelta[];
}

export type ContestSummary = RankingSummary | DuelSummary;

export interface RankingInput {
  kind?: 'story' | 'custom';
  stageRef?: ContestStageRef;
  student: ParticipantSnapshot;
  participants?: ParticipantSnapshot[];
  problems: QuestionSnapshot[];
  durationMin: number;
  npcPoolParam?: { size: number; meanLevel: number; spread: number };
  firstClearAvailable?: boolean;
}

export interface DuelInput {
  home: ParticipantSnapshot;
  away: ParticipantSnapshot;
  questions: QuestionSnapshot[];
  qualityRuleOn: boolean;
  tiebreak?: TiebreakMode;
}

export type ContestReportView = ContestReport;
