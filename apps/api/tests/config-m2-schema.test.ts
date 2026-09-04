import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  normalizeProblemTemplate,
  problemConfigSchema,
  stagesConfigSchema,
} from '@oinur/shared';

const dataPath = (file: string) =>
  path.resolve(import.meta.dirname, '../../../docs/data', file);

const problems = parseYaml(readFileSync(dataPath('problems.yaml'), 'utf8')) as unknown;
const stages = parseYaml(readFileSync(dataPath('stages.yaml'), 'utf8')) as unknown;

describe('M2 configuration schemas', () => {
  it('parses the complete problems.yaml shape', () => {
    const result = problemConfigSchema.safeParse(problems);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.traits).toHaveLength(15);
      expect(result.data.templates).toHaveLength(34);
      expect(result.data.templates[0]?.dim).toBe('ds');
    }
  });

  it('normalizes config dimensions only through the adapter boundary', () => {
    const config = problemConfigSchema.parse(problems);
    const template = config.templates[0]!;

    expect(template.dim).toBe('ds');
    expect(normalizeProblemTemplate(template).dim).toBe('DS');
  });

  it('parses the complete stages.yaml shape', () => {
    const result = stagesConfigSchema.safeParse(stages);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stages).toHaveLength(33);
      expect(result.data.stages[0]?.problem_slots[0]).toMatchObject({ tier: 'cspj', count: 3 });
      expect(result.data.full_clear.unlocks).toBe('ng_plus');
      expect(result.data.ng_plus.layer_cap).toBeNull();
    }
  });

  it('rejects a problems file with a missing required template field', () => {
    const config = structuredClone(problems) as Record<string, unknown>;
    const templates = config.templates as Array<Record<string, unknown>>;
    delete templates[0]!.score;

    const result = problemConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.') === 'templates.0.score')).toBe(true);
  });

  it('rejects invalid trait references at the trait_pool path', () => {
    const config = structuredClone(problems) as Record<string, unknown>;
    const templates = config.templates as Array<Record<string, unknown>>;
    templates[0]!.trait_pool = [{ trait: 'missing-trait', weight: 1 }];

    const result = problemConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'templates.0.trait_pool.0.trait')).toBe(true);
    }
  });

  it('rejects malformed stage rewards with a precise path', () => {
    const config = structuredClone(stages) as Record<string, unknown>;
    const firstClear = (config.stages as Array<Record<string, unknown>>)[0]!.first_clear as Record<string, unknown>;
    firstClear.items = { count: 1, chance: 1.5, pool: [{ rarity: 'gray', weight: 1 }] };

    const result = stagesConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.') === 'stages.0.first_clear.items.chance')).toBe(true);
  });
});
