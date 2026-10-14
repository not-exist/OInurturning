import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  lectureConfigSchema,
  type LectureGrowthConfig,
  type LectureGrowthStat,
  type LectureTier,
} from '@oinur/shared';
import {
  computeLectureGrowth,
  matchFactor,
  thinkingReqOf,
  type LectureGrowthInput,
} from '../src/modules/academy/lecture-growth.js';

/**
 * 讲课成长纯函数单测（issue #56；DB-free，故挂在 vitest.config.unit.ts）。
 * 数值取自事实源 docs/data/economy.yaml → lecture.growth，断言同时锁住「配置契约」与「数学口径」：
 * 改数值必须同时改本文与 docs/systems/gameplay.md §4.2，防止静默漂移。
 */

const dataPath = (file: string): string =>
  path.resolve(import.meta.dirname, '../../../docs/data', file);

const economyRaw = parseYaml(readFileSync(dataPath('economy.yaml'), 'utf8')) as {
  lecture?: unknown;
};
const lecture = lectureConfigSchema.parse(economyRaw.lecture);
const configuredGrowth = lecture.growth;
if (configuredGrowth === undefined) throw new Error('docs/data/economy.yaml 缺少 lecture.growth');
/** 显式标注类型：模块级 const 的窄化不会带进下面的闭包 */
const growth: LectureGrowthConfig = configuredGrowth;

const tierOf = (id: string): LectureTier => {
  const tier = lecture.audience_tiers.find((candidate) => candidate.id === id);
  if (tier === undefined) throw new Error(`未知讲课档位 ${id}`);
  return tier;
};

/** 固定 rng 序列（消费完即抛错，便于验证「消费几次」这一契约） */
function rngOf(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error('rng 消费次数超出预期');
    index += 1;
    return value;
  };
}

function run(overrides: Partial<LectureGrowthInput> & Pick<LectureGrowthInput, 'rng'>) {
  return computeLectureGrowth({
    growth,
    tier: tierOf('senior'), // 门槛 45 / 思维要求 45
    student: { setting: 20, thinking: 45 },
    meta: {},
    forced: false,
    success: true,
    ...overrides,
  });
}

const amountOf = (gains: { stat: LectureGrowthStat; amount: number }[], stat: string): number =>
  gains.find((entry) => entry.stat === stat)?.amount ?? 0;

describe('讲课成长配置契约（docs/data/economy.yaml → lecture.growth）', () => {
  it('五档思维要求与 V 门槛同值且严格递增', () => {
    expect(lecture.audience_tiers.map((tier) => thinkingReqOf(tier))).toEqual([15, 30, 45, 62, 80]);
    expect(lecture.audience_tiers.map((tier) => tier.threshold)).toEqual([15, 30, 45, 62, 80]);
  });

  it('成长量级弱于训练（student.md §4 base 1.6/2.0/3.2）', () => {
    expect(growth.base_gain).toBeLessThan(1.6);
    expect(growth.base_gain).toBe(0.75);
    expect(growth.forced_success_mult).toBe(0.6);
    expect(growth.forced_deficit_loss.thinking).toBeGreaterThan(0);
    expect(growth.forced_deficit_loss.setting).toBeGreaterThan(0);
  });
});

describe('matchFactor：思维 vs 该档思维要求', () => {
  it('刚好达标 → 1；超出 match_span 点 → 0', () => {
    expect(matchFactor(0, growth)).toBe(1);
    expect(matchFactor(growth.match_span, growth)).toBe(0);
    expect(matchFactor(growth.match_span + 30, growth)).toBe(0);
  });

  it('超出侧单调递减且比线性更快（power>1）', () => {
    const at = (d: number): number => matchFactor(d, growth);
    expect(at(5)).toBeLessThan(at(0));
    expect(at(10)).toBeLessThan(at(5));
    expect(at(10)).toBeLessThan(0.5); // 线性会给 0.5，指数 1.5 → 0.3536
  });

  it('不足侧线性下探但守住 deficit_floor', () => {
    expect(matchFactor(-5, growth)).toBeCloseTo(0.75, 10);
    expect(matchFactor(-8, growth)).toBeCloseTo(0.6, 10);
    expect(matchFactor(-100, growth)).toBe(growth.deficit_floor);
  });
});

describe('讲课成长：达标成功', () => {
  it('思维刚好等于要求 → 全额成长，落点由 setting_weight 抽取', () => {
    // rng 0 < 0.55 → 主成长落 setting；0.9 ≥ secondary_prob → 无附带成长
    const settingSide = run({ rng: rngOf(0, 0.9) });
    expect(settingSide.gains).toEqual([{ stat: 'setting', amount: expect.closeTo(0.48, 10) }]);
    expect(settingSide.patch.setting).toBeCloseTo(20.48, 10);
    expect(settingSide.patch.thinking).toBeUndefined();
    expect(settingSide.matchFactor).toBe(1);
    expect(settingSide.deficit).toBe(false);

    // rng 0.99 ≥ 0.55 → 主成长落 thinking
    const thinkingSide = run({ rng: rngOf(0.99, 0.9), student: { setting: 20, thinking: 45 } });
    expect(thinkingSide.gains.map((entry) => entry.stat)).toEqual(['thinking']);
    expect(amountOf(thinkingSide.gains, 'thinking')).toBeCloseTo(
      0.75 * (1 - 45 / 100) ** 2,
      10,
    );
  });

  it('附带成长：另一项按 secondary_share 打折，rng 顺序固定为「落点 → 附带」', () => {
    const result = run({ rng: rngOf(0, 0.1) });
    expect(result.gains.map((entry) => entry.stat)).toEqual(['setting', 'thinking']);
    expect(amountOf(result.gains, 'setting')).toBeCloseTo(0.48, 10);
    expect(amountOf(result.gains, 'thinking')).toBeCloseTo(
      0.75 * growth.secondary_share * (1 - 45 / 100) ** 2,
      10,
    );
  });

  it('思维明显超出要求 → 几乎不增加（issue #56 明确要求）', () => {
    const overflowed = run({ student: { setting: 20, thinking: 70 }, rng: rngOf(0, 0.9) });
    expect(overflowed.matchFactor).toBe(0);
    expect(overflowed.gains).toEqual([]);
    expect(overflowed.patch).toEqual({});

    const slight = run({ student: { setting: 20, thinking: 50 }, rng: rngOf(0, 0.9) });
    expect(amountOf(slight.gains, 'setting')).toBeLessThan(0.48);
    expect(amountOf(slight.gains, 'setting')).toBeGreaterThan(0);
  });

  it('成长只触及 setting/thinking，且受 cap=100 与 (1−cur/100)^2 阻尼约束', () => {
    const capped = run({ student: { setting: 100, thinking: 45 }, rng: rngOf(0, 0.9) });
    expect(capped.gains).toEqual([]);

    const highCur = run({ student: { setting: 80, thinking: 45 }, rng: rngOf(0, 0.9) });
    expect(amountOf(highCur.gains, 'setting')).toBeCloseTo(0.75 * 0.04, 10);
    expect(Object.keys(highCur.patch).every((key) => key === 'setting' || key === 'thinking')).toBe(
      true,
    );
  });

  it('lecture_growth 天赋按百分比放大成长', () => {
    const boosted = run({ meta: { lecture_growth: 30 }, rng: rngOf(0, 0.9) });
    expect(amountOf(boosted.gains, 'setting')).toBeCloseTo(0.48 * 1.3, 10);
  });

  it('同 rng 序列结果确定（同 seed 必复现）', () => {
    const a = run({ rng: rngOf(0.3, 0.05) });
    const b = run({ rng: rngOf(0.3, 0.05) });
    expect(a).toEqual(b);
  });
});

describe('讲课成长：思维不足', () => {
  const deficitStudent = { setting: 20, thinking: 40 }; // R=45 → 思维不足 5 点

  it('强接讲砸 → 出题与思维按配置回落（负增量）', () => {
    const result = run({ student: deficitStudent, forced: true, success: false, rng: rngOf() });
    expect(result.deficit).toBe(true);
    expect(result.matchFactor).toBe(0);
    expect(result.gains).toEqual([
      { stat: 'thinking', amount: expect.closeTo(-0.8, 10) },
      { stat: 'setting', amount: expect.closeTo(-0.5, 10) },
    ]);
    expect(result.patch).toEqual({ thinking: expect.closeTo(39.2, 10), setting: expect.closeTo(19.5, 10) });
  });

  it('回落 clamp 下限 0，不会把属性打成负数', () => {
    const result = run({
      student: { setting: 0.2, thinking: 0.3 },
      forced: true,
      success: false,
      rng: rngOf(),
    });
    expect(result.patch).toEqual({ thinking: 0, setting: 0 });
    expect(amountOf(result.gains, 'thinking')).toBeCloseTo(-0.3, 10);
    expect(amountOf(result.gains, 'setting')).toBeCloseTo(-0.2, 10);
  });

  it('强接但勉强过关 → 仍成长，量低于达标场（deficit 匹配 × forced_success_mult）', () => {
    const survived = run({ student: deficitStudent, forced: true, success: true, rng: rngOf(0, 0.9) });
    expect(amountOf(survived.gains, 'setting')).toBeCloseTo(0.75 * 0.75 * 0.6 * 0.64, 10);
    expect(amountOf(survived.gains, 'setting')).toBeLessThan(0.48);
    expect(survived.patch.thinking).toBeUndefined();
  });

  it('思维达标但 V 不足而讲砸 → 不回落（回落只由思维不足触发）', () => {
    const result = run({
      student: { setting: 20, thinking: 60 },
      forced: true,
      success: false,
      rng: rngOf(),
    });
    expect(result.deficit).toBe(false);
    expect(result.gains).toEqual([]);
    expect(result.patch).toEqual({});
  });

  it('思维不足但达标直讲（非强接）→ 无失败分支，照常成长', () => {
    const result = run({ student: deficitStudent, forced: false, success: true, rng: rngOf(0, 0.9) });
    expect(amountOf(result.gains, 'setting')).toBeCloseTo(0.75 * 0.75 * 0.64, 10);
  });
});

describe('讲课成长：档位思维要求', () => {
  it('thinking_req 缺省回退到该档门槛', () => {
    expect(thinkingReqOf({ id: 'x', threshold: 33, base_money: 1, base_reputation: 1 })).toBe(33);
    expect(
      thinkingReqOf({ id: 'x', threshold: 33, base_money: 1, base_reputation: 1, thinking_req: 30 }),
    ).toBe(30);
  });

  it('同一学员在低档位讲课几乎不成长（讲低于自己水平的课）', () => {
    const national = run({
      tier: tierOf('national'), // R=80
      student: { setting: 20, thinking: 80 },
      rng: rngOf(0, 0.9),
    });
    const beginner = run({
      tier: tierOf('beginner'), // R=15 → 超出 65 点
      student: { setting: 20, thinking: 80 },
      rng: rngOf(0, 0.9),
    });
    expect(amountOf(national.gains, 'setting')).toBeCloseTo(0.48, 10);
    expect(beginner.gains).toEqual([]);
  });
});
