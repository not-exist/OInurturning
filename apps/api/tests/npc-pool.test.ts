import { describe, expect, it } from 'vitest';
import { getStageConfig, importConfigs } from '../src/config/loader.js';
import { generateNpcPool } from '../src/modules/contest/npc.js';

describe('contest NPC pool', () => {
  it('generates the configured number of stable, bounded snapshots', async () => {
    await importConfigs();
    const stage = getStageConfig('cspj:1');
    expect(stage).toBeDefined();
    if (stage === undefined) return;

    const first = generateNpcPool(stage, 1234);
    const second = generateNpcPool(stage, 1234);

    expect(first).toEqual(second);
    expect(first).toHaveLength(stage.npc_pool.size);
    expect(first.every((participant) => participant.side === 'NPC')).toBe(true);
    expect(first.every((participant) => participant.traits.length === 0)).toBe(true);
    for (const participant of first) {
      expect(
        Object.values(participant.abilities).every((value) => value >= 1 && value <= 100),
      ).toBe(true);
      expect(participant.mindset).toBeGreaterThanOrEqual(-5);
      expect(participant.mindset).toBeLessThanOrEqual(10);
      expect(participant.focusCap).toBeGreaterThanOrEqual(5);
      expect(participant.focusCap).toBeLessThanOrEqual(60);
      expect(participant.energyMax).toBeGreaterThanOrEqual(40);
      expect(participant.energyMax).toBeLessThanOrEqual(100);
    }
  });
});
