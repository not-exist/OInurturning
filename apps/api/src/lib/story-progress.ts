import type { ContestSummary, GrowthDelta, RewardLine, StoryProgressView } from '@oinur/shared';
import type { StoryProgress as StoryProgressRow } from '../generated/prisma/client.js';
import { jsonValue } from './json.js';

/**
 * StoryProgress 行 → StoryProgressView 的统一映射，story/service 与 contest/repository 共用
 * （替代两处已漂移的私有副本）。lastSummary 仅判 '=== null'：生成客户端的行类型为非可选的
 * 'JsonValue | null'（undefined 不可达，story 副本旧的 '=== undefined' 分支是死代码），
 * null 即在视图中省略该键；写入侧（jsonWrite + stableSerialize）在 lib/json.ts（T5 收口）。
 */
export function toProgressView(row: StoryProgressRow): StoryProgressView {
  return {
    stageKey: row.stageKey,
    ngLevel: row.ngLevel,
    firstClearAt: row.firstClearAt?.toISOString() ?? null,
    bestRank: row.bestRank,
    clearCount: row.clearCount,
    rewards: jsonValue<RewardLine[]>(row.rewards),
    growth: jsonValue<GrowthDelta[]>(row.growth),
    ...(row.lastRecordId === null ? {} : { lastReportId: row.lastRecordId }),
    ...(row.lastSummary === null
      ? {}
      : { lastSummary: jsonValue<ContestSummary>(row.lastSummary) }),
  };
}
