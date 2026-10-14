import { describe, expect, it } from 'vitest';
import { getProblemTemplate, getStageConfig, importConfigs } from '../src/config/loader.js';

describe('M2 configuration import', () => {
  it('loads all problem templates and story stages into the frozen bundle', async () => {
    const bundle = await importConfigs();

    expect(Object.keys(bundle.problems)).toHaveLength(34);
    expect(Object.keys(bundle.stages)).toHaveLength(33);
    expect(getProblemTemplate('cspj-simulation')).toBeDefined();
    expect(getStageConfig('cspj:1')).toMatchObject({
      chapter: 'cspj',
      stage_index: 1,
      duration_min: 180,
    });
    expect(Object.isFrozen(bundle.problems)).toBe(true);
    expect(Object.isFrozen(bundle.stages)).toBe(true);
  });

  it('keeps the five-file source hash idempotent while restoring active rows', async () => {
    const first = await importConfigs();
    const second = await importConfigs();

    expect(second.sourceHash).toBe(first.sourceHash);
  });
});
