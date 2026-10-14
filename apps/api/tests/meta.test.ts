import { beforeAll, describe, expect, it } from 'vitest';
import type { TalentDef } from '@oinur/shared';
import { importConfigs } from '../src/config/loader.js';
import { aggregateFromTalents, aggregateMeta } from '../src/modules/students/meta.js';

// ---------------------------------------------------------------------------
// aggregateFromTalents：纯函数（fabricated defs 精确断言）
// ---------------------------------------------------------------------------

function talent(id: string, effects: TalentDef['effects']): TalentDef {
  return {
    id,
    name: id,
    rarity: 'yellow',
    kind: 'positive',
    family: null,
    effects,
    description: '测试',
    upgrade_to: null,
  };
}

describe('aggregateFromTalents', () => {
  it('空列表聚合为空对象', () => {
    expect(aggregateFromTalents([], {})).toEqual({});
  });

  it('同名 meta 键加算（非乘算）', () => {
    const talents = {
      a: talent('a', [{ stat: 'training_all', mode: 'percent', value: 15 }]),
      b: talent('b', [{ stat: 'training_all', mode: 'percent', value: 15 }]),
    };
    // 两条 +15% 在 meta 层加算为 30；乘算展开（×1.3225）发生在训练结算管线，不在此层
    expect(aggregateFromTalents(['a', 'b'], talents)).toEqual({ training_all: 30 });
  });

  it('meta 键用裸名；属性键带 mode 后缀（mindset_flat / dp_percent）', () => {
    const talents = {
      a: talent('a', [
        { stat: 'mindset', mode: 'flat', value: 1 },
        { stat: 'dp', mode: 'percent', value: 8 },
        { stat: 'energy_regen', mode: 'percent', value: 15 },
      ]),
    };
    expect(aggregateFromTalents(['a'], talents)).toEqual({
      mindset_flat: 1,
      dp_percent: 8,
      energy_regen: 15,
    });
  });

  it('负面效果（负值）照常累加；未知 id 静默跳过', () => {
    const talents = {
      neg: talent('neg', [{ stat: 'mindset', mode: 'flat', value: -2 }]),
      pos: talent('pos', [{ stat: 'mindset', mode: 'flat', value: 1 }]),
    };
    expect(aggregateFromTalents(['neg', 'pos', 'nonexistent'], talents)).toEqual({
      mindset_flat: -1,
    });
  });
});

// ---------------------------------------------------------------------------
// aggregateMeta：从 CONFIG.talents 聚合（真实 docs/data 集成）
// ---------------------------------------------------------------------------

describe('aggregateMeta（CONFIG 集成）', () => {
  beforeAll(async () => {
    await importConfigs();
  });

  it('空列表 → 空聚合', () => {
    expect(aggregateMeta([])).toEqual({});
  });

  it('单天赋：owl-yellow 仅 energy_regen +15', () => {
    expect(aggregateMeta(['owl-yellow'])).toEqual({ energy_regen: 15 });
  });

  it('多天赋多键：mindset flat 加算、meta 键各自独立', () => {
    // optimist-yellow: mindset flat +1；zeron-gray: mindset flat −2 + focus_gain −15；
    // steel-blue: mindset flat +1 + mindset_loss_reduce 30
    expect(aggregateMeta(['optimist-yellow', 'zeron-gray', 'steel-blue'])).toEqual({
      mindset_flat: 0,
      mindset_loss_reduce: 30,
      focus_gain: -15,
    });
  });

  it('属性 percent 键带后缀，不污染 meta 裸键', () => {
    // memo-green: dp percent +8、training_dp percent +15
    expect(aggregateMeta(['memo-green'])).toEqual({ dp_percent: 8, training_dp: 15 });
  });
});
