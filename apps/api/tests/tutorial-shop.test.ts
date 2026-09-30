import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { TUTORIAL_ROUTE_KEYS, shopConfigSchema, tutorialConfigSchema } from '@oinur/shared';
import type { TutorialStepDef } from '@oinur/shared';
import {
  ALWAYS_ALLOWED_PREFIXES,
  ROUTE_MAP,
  isApiAllowed,
  resolveProgress,
  unlockedForStep,
} from '../src/modules/tutorial/routing.js';

/**
 * 引导锁与商城配置的纯单元校验（unit 项目无 DB）。
 * - 只 import 纯逻辑 routing.js；绝不能 import service.js（会经 prisma 拖入数据库依赖）。
 * - 直接读 docs/data/*.yaml 真身做断言，不保留任何逻辑副本（副本改坏生产代码也不会红）。
 */

function loadYaml(file: string): unknown {
  const full = path.resolve(import.meta.dirname, '../../..', 'docs/data', file);
  return parseDocument(fs.readFileSync(full, 'utf8')).toJS();
}

const tutorialSteps: TutorialStepDef[] = tutorialConfigSchema.parse(loadYaml('tutorial.yaml')).steps;

describe('tutorial config（docs/data/tutorial.yaml 真身）', () => {
  it('可被 zod 解析、步骤 id 唯一、末步全解锁', () => {
    expect(tutorialSteps.length).toBeGreaterThanOrEqual(9);
    const ids = tutorialSteps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tutorialSteps[tutorialSteps.length - 1]!.unlock).toContain('all');
  });

  it('每个 unlock 键都落在 TUTORIAL_ROUTE_KEYS 词表内（或用 all）', () => {
    const vocab = new Set<string>([...TUTORIAL_ROUTE_KEYS, 'all']);
    for (const step of tutorialSteps) {
      for (const key of step.unlock) {
        expect(vocab.has(key), `${step.id} 的 unlock 键 ${key} 不在词表内`).toBe(true);
      }
    }
  });

  it('docs/data/tutorial.yaml 与测试 fixture 逐字节一致（防漂移）', () => {
    const doc = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../..', 'docs/data/tutorial.yaml'),
      'utf8',
    );
    const fixture = fs.readFileSync(
      path.resolve(import.meta.dirname, 'fixtures/config/tutorial.yaml'),
      'utf8',
    );
    expect(fixture).toBe(doc);
  });
});

describe('shop config（docs/data/shop.yaml 真身）', () => {
  it('限购全为正数，且书籍按稀有度聚合键存在', () => {
    const shop = shopConfigSchema.parse(loadYaml('shop.yaml'));
    expect(shop.reputation_gates.gray).toBe(0);
    expect(shop.reputation_gates.purple).toBeGreaterThan(0);

    const daily = shop.daily_limits;
    const weekly = shop.weekly_limits;
    expect(daily, 'shop.yaml 必须定义 daily_limits').toBeDefined();
    expect(weekly, 'shop.yaml 必须定义 weekly_limits').toBeDefined();
    expect(Object.keys(daily ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(weekly ?? {}).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(daily ?? {})) {
      expect(value, `daily_limits.${key}`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(weekly ?? {})) {
      expect(value, `weekly_limits.${key}`).toBeGreaterThan(0);
    }

    // shop/service.ts 用 book-<rarity> 聚合键收敛 book-* 限购，键必须存在
    expect(weekly?.['book-purple']).toBeGreaterThan(0);
    expect(weekly?.['book-purple']).toBeLessThanOrEqual(3);
    expect(weekly?.['book-blue']).toBeGreaterThan(0);
    expect(weekly?.['vitality-core']).toBeGreaterThan(0);
    // 奶茶单价 20（docs/data/items.yaml），日上限 10 → 日消耗上限 200
    expect(daily?.['milk-tea']).toBeLessThanOrEqual(20);
  });
});

describe('tutorial routing：段边界与前缀匹配', () => {
  it('放行自身与子路径，不放行同前缀的无关路径', () => {
    expect(isApiAllowed(['shop'], '/api/shop')).toBe(true);
    expect(isApiAllowed(['shop'], '/api/shop/catalog')).toBe(true);
    expect(isApiAllowed(['shop'], '/api/shopxxx')).toBe(false);
    expect(isApiAllowed(['training'], '/api/problem-library')).toBe(true);
    expect(isApiAllowed(['training'], '/api/problem-library/entry/1')).toBe(true);
    expect(isApiAllowed(['problem-library'], '/api/problems')).toBe(true);
    expect(isApiAllowed(['problem-library'], '/api/problems-archive')).toBe(false);
  });

  it('全解锁 → 任意路径放行', () => {
    expect(isApiAllowed(['all'], '/api/anything')).toBe(true);
  });

  it('恒放行白名单：引导自身、登录态上下文、静态天赋目录', () => {
    for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
      expect(isApiAllowed([], prefix), `always-allowed ${prefix}`).toBe(true);
    }
    expect(isApiAllowed(['overview'], '/api/tutorial')).toBe(true);
    expect(isApiAllowed(['overview'], '/api/tutorial/advance')).toBe(true);
    expect(isApiAllowed(['overview'], '/api/users/me')).toBe(true);
    expect(isApiAllowed(['overview'], '/api/auth/refresh')).toBe(true);
    // step0 的 OverviewPage / StudentsPage / StudentDetailPage 都会打 /api/talents
    expect(isApiAllowed(['overview'], '/api/talents')).toBe(true);
    // /api/users/** 不再整段放行
    expect(isApiAllowed(['overview'], '/api/users/1/dismiss')).toBe(false);
  });

  it('overview 阶段只放行概览与白名单，业务模块保持锁定', () => {
    expect(isApiAllowed(['overview'], '/api/students')).toBe(false);
    expect(isApiAllowed(['overview'], '/api/shop/catalog')).toBe(false);
    expect(isApiAllowed(['overview'], '/api/overview')).toBe(true);
    expect(isApiAllowed(['overview', 'students'], '/api/students')).toBe(true);
  });

  it('ROUTE_MAP 键集 ⊆ TUTORIAL_ROUTE_KEYS，且无死配置', () => {
    const keys = Object.keys(ROUTE_MAP);
    for (const key of keys) expect(TUTORIAL_ROUTE_KEYS as readonly string[]).toContain(key);
    // lecture 已被 academy 前缀完全覆盖，保留该键只会误导（词表仍保留 lecture 供 yaml 使用）
    expect(keys).not.toContain('lecture');

    const unlockKeys = new Set(tutorialSteps.flatMap((s) => s.unlock));
    for (const [key, prefixes] of Object.entries(ROUTE_MAP)) {
      expect(prefixes.length, `${key} 的前缀列表为空`).toBeGreaterThan(0);
      const usedByStep = unlockKeys.has(key);
      // isApiAllowed(其它键, p) === true 当且仅当 p 已被其它键或 always-allowed 覆盖
      const others = keys.filter((k) => k !== key);
      const fullyShadowed = prefixes.every((p) => isApiAllowed(others, p));
      expect(usedByStep || !fullyShadowed, `${key} 是死配置：无人 unlock 且前缀被完全覆盖`).toBe(true);
    }
  });

  it('unlockedForStep：未完成取当前步 unlock，完成取 all', () => {
    expect(unlockedForStep(0, false, tutorialSteps)).toEqual(['overview']);
    expect(unlockedForStep(tutorialSteps.length - 1, false, tutorialSteps)).toEqual(['all']);
    expect(unlockedForStep(0, true, tutorialSteps)).toEqual(['all']);
  });
});

describe('tutorial routing：resolveProgress 归一化', () => {
  it('越界 step 钳到末位，current 不为 undefined（修「9/5」显示）', () => {
    const progress = resolveProgress({ tutorialStep: 99, tutorialCompleted: false }, tutorialSteps);
    expect(progress.step).toBe(tutorialSteps.length - 1);
    expect(progress.current).toBe(tutorialSteps[tutorialSteps.length - 1]);
    expect(progress.completed).toBe(false);
  });

  it('负数 step 钳到 0', () => {
    const progress = resolveProgress({ tutorialStep: -3, tutorialCompleted: false }, tutorialSteps);
    expect(progress.step).toBe(0);
    expect(progress.current).toBe(tutorialSteps[0]);
  });

  it('已完成 → 末位且 current 为 null', () => {
    const progress = resolveProgress({ tutorialStep: 3, tutorialCompleted: true }, tutorialSteps);
    expect(progress.completed).toBe(true);
    expect(progress.step).toBe(tutorialSteps.length - 1);
    expect(progress.current).toBeNull();
  });
});
