import type { ContestSummary, GrowthDelta, RewardLine } from './contest.js';

export type StoryStageKey = string;

export interface StoryStageProgress {
  stageKey: StoryStageKey;
  ngLevel: number;
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
