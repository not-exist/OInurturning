import { TALENT_META_STATS, type TalentDef } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';

/**
 * 天赋 meta 聚合结果（Record<键, 加算总值>）：
 * - meta 键（talents.yaml 头部声明的非属性键，如 training_all/energy_regen）以裸名累加；
 * - 属性键以 `stat_mode` 键累加（如 mindset_flat / dp_percent / focus_cap_flat），
 *   避免与 meta 裸键混淆——settle 消费的 mindset_flat 即来源于此。
 * percent 值在本层一律加算；student.md §4.3 的乘算展开发生在各消费管线。
 */
export type MetaAggregate = Record<string, number>;

const META_KEYS: ReadonlySet<string> = new Set(TALENT_META_STATS);

/**
 * 从给定天赋表聚合（纯函数，测试与自定义来源用）。
 * 未知天赋 id（如已软弃用的历史持有）静默跳过。
 */
export function aggregateFromTalents(
  talentIds: string[],
  talents: Record<string, TalentDef>,
): MetaAggregate {
  const meta: MetaAggregate = {};
  for (const id of talentIds) {
    const def = talents[id];
    if (!def) continue;
    for (const eff of def.effects) {
      const key = META_KEYS.has(eff.stat) ? eff.stat : `${eff.stat}_${eff.mode}`;
      meta[key] = (meta[key] ?? 0) + eff.value;
    }
  }
  return meta;
}

/** 从内存 CONFIG.talents 聚合（生产路径；配置在启动时由 importConfigs 冻结进内存） */
export function aggregateMeta(talentIds: string[]): MetaAggregate {
  const config = getConfig();
  if (!config) {
    throw new Error('[meta] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  }
  return aggregateFromTalents(talentIds, config.talents);
}
