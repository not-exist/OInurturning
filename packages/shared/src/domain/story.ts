import type {
  ContestFormat,
  ContestReport,
  ContestSummary,
  GrowthDelta,
  RewardLine,
} from './contest.js';

export type StoryStageKey = string;

export interface StoryStageProgress {
  stageKey: StoryStageKey;
  ngLevel: number;
  name?: string;
  recommendedLevel?: number;
  durationMin?: number;
  staminaCost?: number;
  unlocked: boolean;
  cleared: boolean;
  clearCount: number;
  bestRank: number | null;
  firstClearAt: string | null;
}

export interface StoryChapterView {
  chapter: string;
  stages: StoryStageProgress[];
}

export interface StoryOverview {
  ngLevel: number;
  chapters: StoryChapterView[];
  ngPlusUnlocked: boolean;
  maxUnlockedNgLevel: number;
}

export interface StoryProgressView {
  stageKey: StoryStageKey;
  ngLevel: number;
  firstClearAt: string | null;
  bestRank: number | null;
  clearCount: number;
  rewards: RewardLine[];
  growth: GrowthDelta[];
  lastReportId?: string;
  lastSummary?: ContestSummary;
}

export type ContestRecordType = 'STORY' | 'PVP' | 'ADVENTURE';

export interface ContestRecordView {
  id: string;
  userId: number;
  type: ContestRecordType;
  format: ContestFormat;
  stageKey: StoryStageKey | null;
  ngLevel: number | null;
  idempotencyKey: string;
  inputSnapshot: unknown;
  report: ContestReport;
  summary: ContestSummary;
  rewards: RewardLine[];
  snapshotHash: string;
  createdAt: string;
}
