import type { ConfigRarity, Rarity, TalentView } from '@oinur/shared';
import { requireConfig } from '../../config/require-config.js';

/**
 * 天赋目录服务（M1 Task 7 补充）：从内存 CONFIG.talents 全量输出，仅供展示。
 * 纯读、不落库；rare 六档由 config 小写归一化为共享 Rarity 大写枚举（packages/shared）。
 */

/** config 小写六档 → 共享大写六档（仅为展示/前端消费） */
function toRarity(r: string): Rarity {
  return r.toUpperCase().replace('COLORFUL', 'RAINBOW') as Rarity;
}

export async function listTalents(): Promise<TalentView[]> {
  const config = requireConfig('talents');
  return Object.values(config.talents).map((t) => ({
    id: t.id,
    name: t.name,
    rarity: toRarity(t.rarity as ConfigRarity),
    kind: t.kind,
    description: t.description,
    family: t.family,
    effects: t.effects,
  }));
}
