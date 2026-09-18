import { describe, expect, it } from 'vitest';
import type { StageConfig } from '@oinur/shared';
import { generateNpcTeams } from '../src/modules/contest/npc.js';

/** 纯引擎测试：只用 npc_pool，构造最小合法 StageConfig，不依赖配置导入或数据库。 */
function stage(overrides: Partial<StageConfig['npc_pool']> = {}): StageConfig {
  return {
    chapter: 'cspj',
    stage_index: 1,
    name: '热身赛',
    recommended_level: 10,
    duration_min: 180,
    problem_slots: [{ tier: 'cspj', count: 3 }],
    npc_pool: { size: 10, mean_level: 8, spread: 5, ...overrides },
    first_clear: {
      money: 500,
      items: { count: 1, chance: 0.6, pool: [{ rarity: 'gray', weight: 1 }] },
      milestone: null,
    },
  };
}

describe('contest NPC teams', () => {
  it('generates stable teams with the configured count and roster size', () => {
    const config = stage();
    const rosterSize = 3;
    const first = generateNpcTeams(config, rosterSize, 1234);
    const second = generateNpcTeams(config, rosterSize, 1234);

    expect(first).toEqual(second);
    expect(first).toHaveLength(config.npc_pool.size);
    expect(first.map((team) => team.teamId)).toEqual(
      Array.from({ length: config.npc_pool.size }, (_, index) => `npc:${index}`),
    );
    for (const [teamIndex, team] of first.entries()) {
      expect(team.side).toBe('NPC');
      expect(team.userId).toBeNull();
      expect(team.members).toHaveLength(rosterSize);
      expect(team.members.map((member) => member.displayName)).toEqual(
        Array.from(
          { length: rosterSize },
          (_, memberIndex) => `NPC ${teamIndex + 1}-${memberIndex + 1}`,
        ),
      );
      expect(team.members.every((member) => member.side === 'NPC')).toBe(true);
      expect(team.members.every((member) => member.userId === null)).toBe(true);
      expect(team.members.every((member) => member.studentId === null)).toBe(true);
      expect(team.members.every((member) => member.traits.length === 0)).toBe(true);
      for (const member of team.members) {
        expect(Object.values(member.abilities).every((value) => value >= 1 && value <= 100)).toBe(
          true,
        );
        expect(member.mindset).toBeGreaterThanOrEqual(-5);
        expect(member.mindset).toBeLessThanOrEqual(10);
        expect(member.focusCap).toBeGreaterThanOrEqual(5);
        expect(member.focusCap).toBeLessThanOrEqual(60);
        expect(member.energyMax).toBeGreaterThanOrEqual(40);
        expect(member.energyMax).toBeLessThanOrEqual(100);
      }
    }
  });

  it('keeps team and member streams isolated', () => {
    const config = stage();
    const rosterSize = 3;
    const base = generateNpcTeams(config, rosterSize, 1234);
    const largerRoster = generateNpcTeams(config, rosterSize + 1, 1234);
    const fewerTeams = generateNpcTeams(stage({ size: config.npc_pool.size - 1 }), rosterSize, 1234);

    expect(largerRoster.map((team) => team.members.slice(0, rosterSize))).toEqual(
      base.map((team) => team.members),
    );
    expect(base.slice(0, -1)).toEqual(fewerTeams);
  });
});
