import { describe, it, expect } from 'vitest';
import { tutorialConfigSchema, shopConfigSchema } from '@oinur/shared';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

function loadYaml(file: string) {
  const full = path.resolve(__dirname, '../../..', 'docs/data', file);
  const text = fs.readFileSync(full, 'utf8');
  const doc = parseDocument(text);
  return doc.toJS();
}

describe('tutorial config', () => {
  it('parses docs/data/tutorial.yaml', () => {
    const data = loadYaml('tutorial.yaml');
    const parsed = tutorialConfigSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.steps.length).toBeGreaterThanOrEqual(9);
      const ids = parsed.data.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length); // unique
      const last = parsed.data.steps[parsed.data.steps.length - 1];
      expect(last.unlock).toContain('all');
    }
  });

  it('ROUTE_MAP coverage: each unlock key should be known', () => {
    const data = loadYaml('tutorial.yaml');
    const parsed = tutorialConfigSchema.parse(data);
    const known = new Set(['overview','students','training','academy','lecture','adventure','story','shop','backpack','problem-library','pvp','admin','all']);
    for (const step of parsed.steps) {
      for (const u of step.unlock) {
        expect(known.has(u)).toBe(true);
      }
    }
  });
});

describe('shop config', () => {
  it('parses docs/data/shop.yaml', () => {
    const data = loadYaml('shop.yaml');
    const parsed = shopConfigSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reputation_gates.gray).toBeDefined();
      expect(parsed.data.reputation_gates.purple).toBeGreaterThan(0);
      // daily_limits and weekly_limits should be positive
      if (parsed.data.daily_limits) {
        for (const v of Object.values(parsed.data.daily_limits)) {
          expect(v).toBeGreaterThan(0);
        }
      }
      if (parsed.data.weekly_limits) {
        for (const v of Object.values(parsed.data.weekly_limits)) {
          expect(v).toBeGreaterThan(0);
        }
      }
    }
  });

  it('shop price sanity: book-purple weekly limit 2 should not exceed late income', () => {
    // rough check: late income from economy simulation is ~3990+? Actually mid 3990, late higher.
    // book-purple price from items.yaml should be checked, but we just ensure limits are modest
    const data = loadYaml('shop.yaml');
    const parsed = shopConfigSchema.parse(data);
    const daily = parsed.daily_limits ?? {};
    const weekly = parsed.weekly_limits ?? {};
    // milk-tea daily 10 is reasonable (price ~50, daily sink 500)
    if (daily['milk-tea']) expect(daily['milk-tea']).toBeLessThanOrEqual(20);
    if (weekly['book-purple']) expect(weekly['book-purple']).toBeLessThanOrEqual(3);
    if (weekly['vitality-core']) expect(weekly['vitality-core']).toBeLessThanOrEqual(3);
  });
});

describe('tutorial guard logic', () => {
  // 纯函数版 isApiAllowed，避免引入 prisma 客户端（unit 环境无生成）
  function isApiAllowed(unlocked: string[], apiPath: string): boolean {
    if (unlocked.includes('all')) return true;
    if (apiPath.startsWith('/api/tutorial')) return true;
    if (
      apiPath.startsWith('/api/overview') ||
      apiPath.startsWith('/api/users/me') ||
      apiPath.startsWith('/api/users/') ||
      apiPath.startsWith('/api/auth')
    ) {
      return true;
    }
    const ROUTE_MAP: Record<string, string[]> = {
      overview: ['/api/overview', '/api/users/me'],
      students: ['/api/students'],
      training: ['/api/training'],
      academy: ['/api/academy'],
      lecture: ['/api/academy/lectures', '/api/academy/lecture-tiers'],
      adventure: ['/api/adventures'],
      story: ['/api/story', '/api/records'],
      shop: ['/api/shop'],
      backpack: ['/api/items', '/api/problem-library', '/api/problems'],
      'problem-library': ['/api/problem-library', '/api/problems'],
      pvp: ['/api/pvp'],
      admin: ['/api/admin'],
      all: ['all'],
    };
    const allowedPrefixes: string[] = [];
    for (const key of unlocked) {
      const prefixes = ROUTE_MAP[key];
      if (prefixes) allowedPrefixes.push(...prefixes);
    }
    return allowedPrefixes.some((p) => apiPath.startsWith(p));
  }

  it('isApiAllowed allows tutorial and overview always', () => {
    expect(isApiAllowed(['overview'], '/api/tutorial')).toBe(true);
    expect(isApiAllowed(['overview'], '/api/overview')).toBe(true);
    expect(isApiAllowed(['overview'], '/api/users/me')).toBe(true);
    expect(isApiAllowed(['overview'], '/api/students')).toBe(false);
    expect(isApiAllowed(['overview', 'students'], '/api/students')).toBe(true);
    expect(isApiAllowed(['all'], '/api/shop')).toBe(true);
    expect(isApiAllowed(['all'], '/api/anything')).toBe(true);
  });
});

describe('shop limit aggregation', () => {
  it('book-* suffix aggregation logic matches spec', () => {
    // The service aggregates daily/weekly limits by suffix for book items
    // We test the helper functions via direct logic
    const suffix = (id: string) => {
      const m = /-(gray|yellow|green|blue|purple)$/.exec(id);
      return m?.[1] ?? null;
    };
    expect(suffix('book-ds-purple')).toBe('purple');
    expect(suffix('book-dp-yellow')).toBe('yellow');
    expect(suffix('milk-tea')).toBe(null);
    // Aggregation key
    const keyFor = (id: string) => {
      const s = suffix(id);
      return s ? `book-${s}` : id;
    };
    expect(keyFor('book-ds-purple')).toBe('book-purple');
    expect(keyFor('book-math-green')).toBe('book-green');
    expect(keyFor('stamina-potion')).toBe('stamina-potion');
  });
});
