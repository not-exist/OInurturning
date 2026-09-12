import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  economyConfigSchema,
  itemsFileSchema,
  talentsFileSchema,
  type ItemDef,
  type TalentDef,
} from '@oinur/shared';
import { runSemanticChecks } from '../src/config/semantic.js';
import { FatalStartupError, getConfig, importConfigs } from '../src/config/loader.js';
import { prisma } from '../src/lib/prisma.js';
import { createApp } from '../src/index.js';
import { get, unwrapOk } from './helpers.js';

// ---------------------------------------------------------------------------
// 公共样例
// ---------------------------------------------------------------------------

const goodTalent = {
  id: 'focus-yellow',
  name: '专注',
  rarity: 'yellow',
  kind: 'positive',
  family: 'focus',
  effects: [{ stat: 'focus_gain', mode: 'percent', value: 8 }],
  description: '测试用天赋。',
  upgrade_to: 'focus-green',
};
const goodTalentUpper = {
  id: 'focus-green',
  name: '专注·进阶',
  rarity: 'green',
  kind: 'positive',
  family: 'focus',
  effects: [{ stat: 'focus_gain', mode: 'percent', value: 12 }],
  description: '测试用天赋上级。',
  upgrade_to: null,
};

const goodItem: Record<string, unknown> = {
  id: 'rename-card',
  name: '改名卡',
  category: 'nurture',
  rarity: 'green',
  effect: { desc: '改名。', kind: 'rename', target: 'single_student' },
  price: 600,
  sources: ['商城'],
  stack: 99,
  description: '测试用道具。',
};

const goodEconomy: Record<string, unknown> = {
  training: {
    cost_formula: 'round(money_base * (1 + student_coeff * (owned_students - 1)))',
    student_coeff: 0.08,
    basic: { money_base: 60, stamina_cost: 1 },
    directed: { money_base: 150, stamina_cost: 1, book_consumed: 1 },
    specialized: { money_base: 100, stamina_cost: 1, premade_problem_consumed: 1 },
  },
  recruitment: {
    recruit_cost_formula: 'round(recruit_base * recruit_growth ^ owned_students) * quality_mult',
    recruit_base: 300,
    recruit_growth: 1.35,
    quality_mult: { common: 1.0, good: 1.5, elite: 2.5, genius: 5.0 },
    manual_refresh: {
      price_formula: 'round(refresh_base * refresh_growth ^ refreshes_done_today)',
      refresh_base: 100,
      refresh_growth: 1.5,
      daily_price_cap: 800,
      free_interval_hours: 24,
    },
  },
  onboarding: {
    money: 1000,
    reputation: 10,
    students: [{ quality: 'good' }, { quality: 'common' }],
    items: [{ id: 'rename-card', count: 1 }],
  },
};

// ---------------------------------------------------------------------------
// Step 1: shared zod schema 单测
// ---------------------------------------------------------------------------

describe('config zod schemas', () => {
  it('好 talents 文件通过校验', () => {
    const r = talentsFileSchema.safeParse({ version: 1, talents: [goodTalent, goodTalentUpper] });
    expect(r.success).toBe(true);
  });

  it('坏 rarity 被拒绝', () => {
    const bad = { ...goodTalent, rarity: 'red' };
    const r = talentsFileSchema.safeParse({ version: 1, talents: [bad] });
    expect(r.success).toBe(false);
  });

  it('effect 的 meta 键不在已知集合内被拒绝', () => {
    const bad = {
      ...goodTalent,
      effects: [{ stat: 'not_a_real_stat', mode: 'percent', value: 1 }],
    };
    const r = talentsFileSchema.safeParse({ version: 1, talents: [bad] });
    expect(r.success).toBe(false);
  });

  it('未知顶层键被拒绝（strict）', () => {
    const bad = { ...goodTalent, bogus: 1 };
    const r = talentsFileSchema.safeParse({ version: 1, talents: [bad] });
    expect(r.success).toBe(false);
  });

  it('好 items 文件通过校验（含顶层 meta 区块）', () => {
    const r = itemsFileSchema.safeParse({
      meta: { version: '0.1-test', rarity_order: ['gray', 'yellow'] },
      items: [goodItem],
    });
    expect(r.success).toBe(true);
  });

  it('items 顶层缺 meta 也合法，price 可空', () => {
    const noPrice = { ...goodItem, price: null };
    const r = itemsFileSchema.safeParse({ items: [noPrice] });
    expect(r.success).toBe(true);
  });

  it('坏 category / 坏 effect.kind 被拒绝', () => {
    expect(
      itemsFileSchema.safeParse({ items: [{ ...goodItem, category: 'weapon' }] }).success,
    ).toBe(false);
    expect(
      itemsFileSchema.safeParse({
        items: [{ ...goodItem, effect: { desc: 'x', kind: 'fireball' } }],
      }).success,
    ).toBe(false);
  });

  it('好 economy 文件通过校验（多余分区 passthrough）', () => {
    const r = economyConfigSchema.safeParse({
      ...goodEconomy,
      meta: { version: '0.1-test' },
      lecture: { audience_tiers: [{ id: 'beginner', threshold: 15 }] },
      sinks_summary: { expense_total_weekly: 3804 },
    });
    expect(r.success).toBe(true);
  });

  it('economy 缺 M1 必需字段 / quality_mult 缺档被拒绝', () => {
    expect(economyConfigSchema.safeParse({ recruitment: goodEconomy.recruitment }).success).toBe(
      false,
    );
    const badMult = {
      ...(goodEconomy.recruitment as Record<string, unknown>),
      quality_mult: { common: 1.0, good: 1.5, elite: 2.5 },
    };
    expect(economyConfigSchema.safeParse({ ...goodEconomy, recruitment: badMult }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 语义检查单测
// ---------------------------------------------------------------------------

const baseTalent = talentsFileSchema.parse({ version: 1, talents: [goodTalent] }).talents[0]!;
const baseTalentUpper = talentsFileSchema.parse({ version: 1, talents: [goodTalentUpper] })
  .talents[0]!;
function makeTalent(over: Partial<TalentDef>): TalentDef {
  return { ...baseTalent, ...over };
}

const parsedItem = itemsFileSchema.parse({ items: [goodItem] }).items as ItemDef[];
const parsedEconomy = economyConfigSchema.parse(goodEconomy);

describe('runSemanticChecks', () => {
  const ok = (talents: TalentDef[], economy = parsedEconomy) =>
    runSemanticChecks({ talents, items: parsedItem, economy });

  it('合法升阶链无错误', () => {
    const talents = [makeTalent({}), makeTalent({ ...baseTalentUpper })];
    expect(ok(talents)).toEqual([]);
  });

  it('upgrade_to 引用不存在报错', () => {
    const talents = [makeTalent({ upgrade_to: 'ghost-blue' })];
    const errs = ok(talents);
    expect(errs.some((e) => e.message.includes('ghost-blue'))).toBe(true);
  });

  it('升阶链合并（两个天赋指向同一上级）报错', () => {
    const a = makeTalent({ id: 'a-yellow', upgrade_to: 'focus-green' });
    const b = makeTalent({ id: 'b-yellow', name: '乙', upgrade_to: 'focus-green' });
    const up = makeTalent({ ...baseTalentUpper });
    const errs = ok([a, b, up]);
    expect(errs.some((e) => e.message.includes('合并') || e.message.includes('merge'))).toBe(true);
  });

  it('升阶链成环报错', () => {
    const a = makeTalent({ id: 'a-yellow', upgrade_to: 'b-green' });
    const b = makeTalent({ ...baseTalentUpper, id: 'b-green', upgrade_to: 'a-yellow' });
    const errs = ok([a, b]);
    expect(errs.some((e) => e.message.includes('环') || e.message.includes('cycle'))).toBe(true);
  });

  it('升阶稀有度未单调升报错', () => {
    const a = makeTalent({ id: 'a-green', rarity: 'green', upgrade_to: 'b-yellow' });
    const b = makeTalent({ ...baseTalentUpper, id: 'b-yellow', rarity: 'yellow' });
    const errs = ok([a, b]);
    expect(errs.some((e) => e.message.includes('稀有度'))).toBe(true);
  });

  it('quality_mult 低于 1 报错', () => {
    const badEconomy = economyConfigSchema.parse({
      ...goodEconomy,
      recruitment: {
        ...(goodEconomy.recruitment as Record<string, unknown>),
        quality_mult: { common: 0.5, good: 1.5, elite: 2.5, genius: 5.0 },
      },
    });
    const errs = runSemanticChecks({
      talents: [makeTalent({})],
      items: parsedItem,
      economy: badEconomy,
    });
    expect(errs.some((e) => e.message.includes('quality_mult'))).toBe(true);
  });

  it('缺 onboarding 分区报错', () => {
    const rest = { ...goodEconomy };
    delete rest.onboarding;
    const noOnboarding = economyConfigSchema.parse(rest);
    const errs = runSemanticChecks({ talents: [makeTalent({})], items: parsedItem, economy: noOnboarding });
    expect(errs.some((e) => e.message.includes('onboarding 为必填'))).toBe(true);
  });

  it('开局包道具不存在报错', () => {
    const bad = economyConfigSchema.parse({
      ...goodEconomy,
      onboarding: {
        ...(goodEconomy.onboarding as Record<string, unknown>),
        items: [{ id: 'ghost-item', count: 1 }],
      },
    });
    const errs = runSemanticChecks({ talents: [makeTalent({})], items: parsedItem, economy: bad });
    expect(errs.some((e) => e.message.includes('ghost-item'))).toBe(true);
  });

  it('开局包道具重复报错', () => {
    const bad = economyConfigSchema.parse({
      ...goodEconomy,
      onboarding: {
        ...(goodEconomy.onboarding as Record<string, unknown>),
        items: [
          { id: 'rename-card', count: 1 },
          { id: 'rename-card', count: 2 },
        ],
      },
    });
    const errs = runSemanticChecks({ talents: [makeTalent({})], items: parsedItem, economy: bad });
    expect(errs.some((e) => e.message.includes('开局包道具重复'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 3: loader 集成测试（真实 DB）
// ---------------------------------------------------------------------------

const BASE_TALENTS = `version: 1
talents:
  - id: focus-yellow
    name: 专注
    rarity: yellow
    kind: positive
    family: focus
    effects:
      - {stat: focus_gain, mode: percent, value: 8}
    description: 测试用天赋。
    upgrade_to: focus-green
  - id: focus-green
    name: 专注·进阶
    rarity: green
    kind: positive
    family: focus
    effects:
      - {stat: focus_gain, mode: percent, value: 12}
    description: 测试用天赋上级。
    upgrade_to: null
`;

const BASE_ITEMS = `meta:
  version: "0.1-test"
items:
  - id: rename-card
    name: 改名卡
    category: nurture
    rarity: green
    effect:
      desc: 改名。
      kind: rename
    price: 600
    sources: [商城]
    stack: 99
    description: 测试用道具。
`;

const BASE_ECONOMY = `training:
  cost_formula: "round(money_base * (1 + student_coeff * (owned_students - 1)))"
  student_coeff: 0.08
  basic: {money_base: 60, stamina_cost: 1}
  directed: {money_base: 150, stamina_cost: 1, book_consumed: 1}
  specialized: {money_base: 100, stamina_cost: 1, premade_problem_consumed: 1}
recruitment:
  recruit_cost_formula: "round(recruit_base * recruit_growth ^ owned_students) * quality_mult"
  recruit_base: 300
  recruit_growth: 1.35
  quality_mult: {common: 1.0, good: 1.5, elite: 2.5, genius: 5.0}
  manual_refresh:
    price_formula: "round(refresh_base * refresh_growth ^ refreshes_done_today)"
    refresh_base: 100
    refresh_growth: 1.5
    daily_price_cap: 800
    free_interval_hours: 24
onboarding:
  money: 1000
  reputation: 10
  students:
    - {quality: good}
    - {quality: common}
  items:
    - {id: rename-card, count: 1}
lecture:
  note: 多余分区 passthrough
`;

const REDUCED_TALENTS = `version: 1
talents:
  - id: focus-yellow
    name: 专注
    rarity: yellow
    kind: positive
    family: focus
    effects:
      - {stat: focus_gain, mode: percent, value: 8}
    description: 测试用天赋。
    upgrade_to: null
`;

const MINIMAL_PROBLEMS = `version: 1
updated: '2026-08-31'
conventions:
  requirement_band_reference: test
  time_limit_semantics: test
  implicit_no_trait_weight: 30
  adhoc_dim_mapping: greedy
severity_ladder: [red]
traits:
  - id: test-trait
    name: 测试特性
    severity: red
    family: null
    effect: 测试
    hooks: {}
templates:
  - id: test-problem
    tier: cspj
    title: 测试题
    dim: ds
    requirements: {d: 1, m: 1, c: 1}
    score: 100
    time_limit_min: 10
    trait_pool: []
    partial_scores: false
`;

const MINIMAL_STAGES = `version: 1
updated: '2026-08-31'
defaults:
  engine_ref: docs/systems/contest.md
  stamina_cost_by_chapter: {cspj: 1, csps: 1, noip: 1, province: 1, noi: 2, ctt: 2, cts: 2, ioi: 2}
  pass_rank_max: 8
stages:
  - chapter: cspj
    stage_index: 1
    name: 测试关
    recommended_level: 1
    duration_min: 10
    problem_slots: [{tier: cspj, count: 1}]
    npc_pool: {size: 1, mean_level: 1, spread: 0}
    first_clear:
      money: 1
      items: {count: 1, chance: 1, pool: [{rarity: gray, weight: 1}]}
      milestone: {items: [{item: rename-card, count: 1}]}
full_clear:
  condition: test
  money: 1
  items: [{item: rename-card, count: 1}]
  unlocks: ng_plus
ng_plus:
  layer_param: k
  demand_multiplier: '1 + 0.15k'
  trait_chance_bonus: '1 + 0.10k'
  trait_pool_shift:
    weight_scale: '1 + 0.10k'
    high_severity_extra: {min_severity: blue, scale: '1 + 0.05k', cap: colorful}
  first_clear_money_multiplier: '1 + 0.5k'
  item_rarity_shift: {from_layer: 2, shift: 1, cap: colorful}
  milestone_rule: fixed
  advance_stone_per_layer_clear: 5
  layer_badge: {item_id_template: 'badge-ng{k}', count: 1}
  repeat_clear_rank_bonus: {champion: 0.3, runner_up: 0.2, third_to_eighth: 0.1, others: 0}
  layer_cap: null
`;

const MINIMAL_EVENTS = `version: 0.1.0
events:
  - id: evt-test-warmup
    code: G1
    name: 测试事件
    category: trial
    rarity: gray
    stamina_cost: 1
    repeatable: true
    cooldown_days: 0
    weight: 100
    requirements: null
    description: 测试用事件。
    choices:
      - text: 开始
        outcomes:
          - weight: 100
            type: fixed
            rewards: {}
`;

const tmpDirs: string[] = [];
function writeConfigDir(files: { talents: string; items: string; economy: string }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oinur-config-'));
  tmpDirs.push(dir);
  writeFileSync(path.join(dir, 'talents.yaml'), files.talents);
  writeFileSync(path.join(dir, 'items.yaml'), files.items);
  writeFileSync(path.join(dir, 'economy.yaml'), files.economy);
  writeFileSync(path.join(dir, 'problems.yaml'), MINIMAL_PROBLEMS);
  const itemId = /^\s*- id: ([a-z0-9-]+)/m.exec(files.items)?.[1] ?? 'rename-card';
  writeFileSync(path.join(dir, 'stages.yaml'), MINIMAL_STAGES.replaceAll('rename-card', itemId));
  writeFileSync(path.join(dir, 'events.yaml'), MINIMAL_EVENTS);
  return dir;
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('importConfigs', () => {
  it('导入合法配置：写库 + 内存缓存 + 导入记录', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const bundle = await importConfigs({ configDir: dir });
    expect(bundle.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(bundle.talents)).toHaveLength(2);
    expect(bundle.talents['focus-green']?.name).toBe('专注·进阶');
    expect(bundle.items['rename-card']?.price).toBe(600);
    expect(bundle.economy.recruitment.quality_mult.genius).toBe(5.0);
    expect(getConfig()).toBe(bundle);

    const rows = await prisma.configTalent.findMany({ where: { id: { startsWith: 'focus-' } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deprecated === false && r.sourceHash === bundle.sourceHash)).toBe(
      true,
    );
    const eco = await prisma.configEconomy.findUnique({ where: { id: 'active' } });
    expect(eco?.sourceHash).toBe(bundle.sourceHash);
    const rec = await prisma.configImport.count({
      where: { sourceHash: bundle.sourceHash, ok: true },
    });
    expect(rec).toBe(1);
  });

  it('同 hash 重复导入幂等跳过（不产生新导入记录）', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const first = await importConfigs({ configDir: dir });
    const second = await importConfigs({ configDir: dir });
    expect(second.sourceHash).toBe(first.sourceHash);
    const rec = await prisma.configImport.count({
      where: { sourceHash: first.sourceHash, ok: true },
    });
    expect(rec).toBe(1);
  });

  it('本批消失的条目被软弃用，内容有变的条目复活并取消弃用', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const first = await importConfigs({ configDir: dir });

    // 移除 focus-green，并将 focus-yellow 的 upgrade_to 置空 → 新 hash
    writeFileSync(path.join(dir, 'talents.yaml'), REDUCED_TALENTS);
    const second = await importConfigs({ configDir: dir });
    expect(second.sourceHash).not.toBe(first.sourceHash);
    expect(second.talents['focus-green']).toBeUndefined();

    const deprecated = await prisma.configTalent.findUnique({ where: { id: 'focus-green' } });
    expect(deprecated?.deprecated).toBe(true);

    // 恢复 focus-green 但内容有变（新 hash，走 upsert 路径）→ 复活并取消弃用
    writeFileSync(
      path.join(dir, 'talents.yaml'),
      BASE_TALENTS.replace('测试用天赋上级。', '测试用天赋上级·改。'),
    );
    const third = await importConfigs({ configDir: dir });
    expect(third.sourceHash).not.toBe(second.sourceHash);
    const revived = await prisma.configTalent.findUnique({ where: { id: 'focus-green' } });
    expect(revived?.deprecated).toBe(false);
    expect(revived?.sourceHash).toBe(third.sourceHash);
    expect(third.talents['focus-green']).toBeDefined();
  });

  it('回滚到历史 ok hash：skip 路径调和 DB——弃用条目复活、被改写 payload 回滚、无新导入记录', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const first = await importConfigs({ configDir: dir });

    // 批次 B：删除 focus-green（软弃用）并改写 focus-yellow 的 name → 新 hash
    writeFileSync(
      path.join(dir, 'talents.yaml'),
      REDUCED_TALENTS.replace('name: 专注', 'name: 专注·改'),
    );
    const second = await importConfigs({ configDir: dir });
    expect(second.sourceHash).not.toBe(first.sourceHash);
    expect(second.talents['focus-yellow']?.name).toBe('专注·改');
    expect(
      (await prisma.configTalent.findUnique({ where: { id: 'focus-green' } }))?.deprecated,
    ).toBe(true);

    // 回滚到历史 hash A：命中 ok 记录走 skip 路径，但 DB 必须先调和到与 yaml 一致
    writeFileSync(path.join(dir, 'talents.yaml'), BASE_TALENTS);
    const third = await importConfigs({ configDir: dir });
    expect(third.sourceHash).toBe(first.sourceHash);

    // 审计幂等：不新增 configImport 行
    const rec = await prisma.configImport.count({
      where: { sourceHash: first.sourceHash, ok: true },
    });
    expect(rec).toBe(1);

    // 被弃用条目复活，且 payload 回滚到历史版本
    const revived = await prisma.configTalent.findUnique({ where: { id: 'focus-green' } });
    expect(revived?.deprecated).toBe(false);
    expect((revived?.payload as { name: string }).name).toBe('专注·进阶');
    // 被改写的 payload 回滚
    const yellow = await prisma.configTalent.findUnique({ where: { id: 'focus-yellow' } });
    expect((yellow?.payload as { name: string }).name).toBe('专注');
    // CONFIG 与磁盘 yaml 一致
    expect(third.talents['focus-yellow']?.name).toBe('专注');
    expect(third.talents['focus-green']?.name).toBe('专注·进阶');
  });

  it('不同 CONFIG_DIR 交替导入后，CONFIG 必然等于本进程自身 CONFIG_DIR 的 yaml', async () => {
    // 模拟多进程共享 DB：进程 A/B fixtures 不同，交替启动时 DB 被互相改写
    const dirA = writeConfigDir({
      talents: BASE_TALENTS,
      items: BASE_ITEMS,
      economy: BASE_ECONOMY,
    });
    const dirB = writeConfigDir({
      talents: `version: 1
talents:
  - id: solo-gray
    name: 独行
    rarity: gray
    kind: positive
    family: solo
    effects:
      - {stat: focus_gain, mode: percent, value: 3}
    description: 另一进程的 fixtures。
    upgrade_to: null
`,
      items: `items:
  - id: other-item
    name: 异世界道具
    category: nurture
    rarity: gray
    effect:
      desc: 另一进程的 fixtures。
      kind: rename
    price: null
    sources: [商城]
    stack: 1
    description: 另一进程的 fixtures。
`,
      economy: BASE_ECONOMY,
    });

    await importConfigs({ configDir: dirA });
    const fromB = await importConfigs({ configDir: dirB });
    expect(fromB.talents['focus-green']).toBeUndefined();
    expect(fromB.items['rename-card']).toBeUndefined();

    // 进程 A 再次启动：hash A 已有 ok 记录 → skip 路径调和后，CONFIG 与 A 的 yaml 严格一致
    const backA = await importConfigs({ configDir: dirA });
    expect(Object.keys(backA.talents).sort()).toEqual(['focus-green', 'focus-yellow']);
    expect(Object.keys(backA.items)).toEqual(['rename-card']);
    expect(backA.talents['solo-gray']).toBeUndefined();
    expect(backA.items['other-item']).toBeUndefined();

    // 进程 B 再次启动同理
    const backB = await importConfigs({ configDir: dirB });
    expect(Object.keys(backB.talents)).toEqual(['solo-gray']);
    expect(Object.keys(backB.items)).toEqual(['other-item']);
  });

  it('CONFIG 深冻结：运行时改写嵌套结构抛错且不影响缓存', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const bundle = await importConfigs({ configDir: dir });
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.talents['focus-yellow'])).toBe(true);
    expect(Object.isFrozen(bundle.talents['focus-yellow']?.effects)).toBe(true);
    expect(Object.isFrozen(bundle.economy.recruitment.quality_mult)).toBe(true);
    expect(() => {
      (bundle.talents['focus-yellow'] as { name: string }).name = '篡改';
    }).toThrow(TypeError);
    expect(() => {
      (bundle.economy.recruitment.quality_mult as { genius: number }).genius = 99;
    }).toThrow(TypeError);
    expect(bundle.talents['focus-yellow']?.name).toBe('专注');
    expect(bundle.economy.recruitment.quality_mult.genius).toBe(5.0);
  });

  it('坏 rarity 抛 FatalStartupError，报出文件与路径', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = writeConfigDir({
      talents: BASE_TALENTS.replace('rarity: yellow', 'rarity: red'),
      items: BASE_ITEMS,
      economy: BASE_ECONOMY,
    });
    await expect(importConfigs({ configDir: dir })).rejects.toThrow(FatalStartupError);
    await expect(importConfigs({ configDir: dir })).rejects.toThrow(/talents[\s\S]*rarity/);
    spy.mockRestore();
  });

  it('坏 upgrade_to 引用抛 FatalStartupError（语义错误一次报完）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = writeConfigDir({
      talents: BASE_TALENTS.replace('upgrade_to: focus-green', 'upgrade_to: ghost-blue'),
      items: BASE_ITEMS,
      economy: BASE_ECONOMY,
    });
    await expect(importConfigs({ configDir: dir })).rejects.toThrow(/upgrade_to[\s\S]*ghost-blue/);
    spy.mockRestore();
  });

  it('YAML 语法错误抛 FatalStartupError 并报行号', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = writeConfigDir({
      talents: 'version: 1\ntalents:\n  - id: [broken\n',
      items: BASE_ITEMS,
      economy: BASE_ECONOMY,
    });
    await expect(importConfigs({ configDir: dir })).rejects.toThrow(/line \d+/);
    spy.mockRestore();
  });
});

describe('GET /api/health configVersion', () => {
  const app = createApp();

  it('data 携带 configVersion = sourceHash 前 12 位', async () => {
    const res = await get(app, '/api/health');
    expect(res.status).toBe(200);
    const data = unwrapOk<{ uptime: number; serverTime: string; configVersion: string }>(res);
    expect(data.configVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(data.configVersion).toBe(getConfig()?.sourceHash.slice(0, 12));
  });
});
