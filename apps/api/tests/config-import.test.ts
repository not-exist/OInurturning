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
    expect(itemsFileSchema.safeParse({ items: [{ ...goodItem, category: 'weapon' }] }).success).toBe(false);
    expect(
      itemsFileSchema.safeParse({ items: [{ ...goodItem, effect: { desc: 'x', kind: 'fireball' } }] }).success,
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
    expect(economyConfigSchema.safeParse({ recruitment: goodEconomy.recruitment }).success).toBe(false);
    const badMult = {
      ...(goodEconomy.recruitment as Record<string, unknown>),
      quality_mult: { common: 1.0, good: 1.5, elite: 2.5 },
    };
    expect(
      economyConfigSchema.safeParse({ ...goodEconomy, recruitment: badMult }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 语义检查单测
// ---------------------------------------------------------------------------

const baseTalent = talentsFileSchema.parse({ version: 1, talents: [goodTalent] }).talents[0]!;
const baseTalentUpper = talentsFileSchema.parse({ version: 1, talents: [goodTalentUpper] }).talents[0]!;
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
    const errs = runSemanticChecks({ talents: [makeTalent({})], items: parsedItem, economy: badEconomy });
    expect(errs.some((e) => e.message.includes('quality_mult'))).toBe(true);
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
lecture:
  note: 多余分区 passthrough
`;

const tmpDirs: string[] = [];
function writeConfigDir(files: { talents: string; items: string; economy: string }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oinur-config-'));
  tmpDirs.push(dir);
  writeFileSync(path.join(dir, 'talents.yaml'), files.talents);
  writeFileSync(path.join(dir, 'items.yaml'), files.items);
  writeFileSync(path.join(dir, 'economy.yaml'), files.economy);
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
    expect(rows.every((r) => r.deprecated === false && r.sourceHash === bundle.sourceHash)).toBe(true);
    const eco = await prisma.configEconomy.findUnique({ where: { id: 'active' } });
    expect(eco?.sourceHash).toBe(bundle.sourceHash);
    const rec = await prisma.configImport.count({ where: { sourceHash: bundle.sourceHash, ok: true } });
    expect(rec).toBe(1);
  });

  it('同 hash 重复导入幂等跳过（不产生新导入记录）', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const first = await importConfigs({ configDir: dir });
    const second = await importConfigs({ configDir: dir });
    expect(second.sourceHash).toBe(first.sourceHash);
    const rec = await prisma.configImport.count({ where: { sourceHash: first.sourceHash, ok: true } });
    expect(rec).toBe(1);
  });

  it('本批消失的条目被软弃用，复活条目取消弃用', async () => {
    const dir = writeConfigDir({ talents: BASE_TALENTS, items: BASE_ITEMS, economy: BASE_ECONOMY });
    const first = await importConfigs({ configDir: dir });

    // 移除 focus-green，并将 focus-yellow 的 upgrade_to 置空 → 新 hash
    const reduced = `version: 1
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
    writeFileSync(path.join(dir, 'talents.yaml'), reduced);
    const second = await importConfigs({ configDir: dir });
    expect(second.sourceHash).not.toBe(first.sourceHash);
    expect(second.talents['focus-green']).toBeUndefined();

    const deprecated = await prisma.configTalent.findUnique({ where: { id: 'focus-green' } });
    expect(deprecated?.deprecated).toBe(true);

    // 恢复 focus-green 但内容有变（新 hash，走 upsert 路径）→ 复活并取消弃用
    writeFileSync(path.join(dir, 'talents.yaml'), BASE_TALENTS.replace('测试用天赋上级。', '测试用天赋上级·改。'));
    const third = await importConfigs({ configDir: dir });
    expect(third.sourceHash).not.toBe(second.sourceHash);
    const revived = await prisma.configTalent.findUnique({ where: { id: 'focus-green' } });
    expect(revived?.deprecated).toBe(false);
    expect(revived?.sourceHash).toBe(third.sourceHash);
    expect(third.talents['focus-green']).toBeDefined();
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
