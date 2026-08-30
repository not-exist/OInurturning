import type { DimensionKey, Rarity } from '@oinur/shared';
import type { ConfigRarity } from '@oinur/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * 预制题服务（M1 Task 7 补充，权威：docs/systems/student.md §4 专项训练）：
 * - 仅列出当前用户「未消耗」的预制题（ProblemLibraryEntry where userId=me, consumedAt null）；
 * - 纯读，不落库；rare 六档由 config 小写归一化为共享 Rarity 大写枚举（packages/shared）。
 */

/** config 小写六档 → 共享大写六档（仅为展示/前端消费，实际数值档案仍走 QUALITY_MULT 小写键） */
function toRarity(r: string): Rarity {
  return r.toUpperCase().replace('COLORFUL', 'RAINBOW') as Rarity;
}

/** 学前列表视图 */
export interface ProblemView {
  id: number;
  name: string;
  dim: DimensionKey;
  rarity: Rarity;
  quality: number;
  consumedAt: string | null;
}

export async function listProblems(userId: number): Promise<ProblemView[]> {
  const rows = await prisma.problemLibraryEntry.findMany({
    where: { userId, consumedAt: null },
    orderBy: [{ createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    dim: r.dominantDim as DimensionKey,
    rarity: toRarity(r.rarity as ConfigRarity),
    quality: r.quality,
    consumedAt: r.consumedAt ? r.consumedAt.toISOString() : null,
  }));
}
