import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTR_TABLE } from '../src/modules/academy/recruit-gen.js';
import {
  compositeV,
  daysForSessions,
  expectedStep,
  sessionsNeeded,
  sessionsToV,
  type StudentStats,
} from '../src/modules/economy/progression.js';
import { run } from '../src/scripts/balance-regression.js';

function geniusBaseline(): StudentStats {
  const spec = ATTR_TABLE.genius;
  return {
    ds: spec.dim.e,
    dp: spec.dim.e,
    math: spec.dim.e,
    graph: spec.dim.e,
    greedy: spec.dim.e,
    string: spec.dim.e,
    code: spec.code.e,
    thinking: spec.thinking.e,
  };
}

/** 与 balance-regression.ts 相同的 mid 画像配比（不重复 YAML 加载） */
const MID_MIX = { basic: 5, directed: 4, specialized: 2 };
const MID_OPTS = { bookMult: 1.5, qualityMult: 1.2 };

async function captureRun(
  argv: string[],
  options?: Parameters<typeof run>[1],
): Promise<{ status: number; stdout: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  const status = await run(argv, options);
  spy.mockRestore();
  return { status, stdout: lines.join('\n') };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('progression math', () => {
  it('composites V exactly like student.md §1', () => {
    const stats: StudentStats = {
      ds: 90,
      dp: 90,
      math: 90,
      graph: 90,
      greedy: 90,
      string: 90,
      code: 90,
      thinking: 90,
    };
    expect(compositeV(stats)).toBe(90);
    const maxed: StudentStats = {
      ds: 100,
      dp: 100,
      math: 100,
      graph: 100,
      greedy: 100,
      string: 100,
      code: 100,
      thinking: 100,
    };
    expect(compositeV(maxed)).toBe(100);
    // floor 语义：96.9/97.1/98.0 → (96.9+97.1+floor(98.0))/3=97.33 → 97
    const frac: StudentStats = {
      ds: 98,
      dp: 98,
      math: 98,
      graph: 98,
      greedy: 98,
      string: 98,
      code: 96.9,
      thinking: 97.1,
    };
    expect(compositeV(frac)).toBe(97);
  });

  it('sessionsNeeded matches the closed form and guards the cap', () => {
    // s = (100/base)·(1/(1−to/100) − 1/(1−from/100))
    expect(sessionsNeeded(0, 50, 1)).toBeCloseTo(100, 10);
    expect(sessionsNeeded(50, 75, 1)).toBeCloseTo(200, 10);
    expect(sessionsNeeded(90, 97, 1.6)).toBeCloseTo(1458.33, 1);
    expect(sessionsNeeded(0, 100, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(sessionsNeeded(80, 50, 1)).toBe(0);
    expect(sessionsNeeded(10, 90, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('expectedStep is pure and never mutates its input', () => {
    const start = geniusBaseline();
    const snapshot = { ...start };
    const next = expectedStep(start, 'directed', MID_OPTS);
    expect(next).not.toBe(start);
    expect(start).toEqual(snapshot);
    expect(next.ds).toBeGreaterThan(start.ds); // balance 策略先练 ds（全维同值取首）
  });

  it('sessionsToV is deterministic and monotonic in the target', () => {
    const baseline = geniusBaseline();
    const low = sessionsToV(baseline, MID_MIX, 38, MID_OPTS);
    const high = sessionsToV(baseline, MID_MIX, 97, MID_OPTS);
    const lowAgain = sessionsToV(baseline, MID_MIX, 38, MID_OPTS);
    expect(low.reached).toBe(true);
    expect(high.reached).toBe(true);
    expect(low.sessions).toBe(lowAgain.sessions);
    expect(low.sessions).toBeGreaterThan(0);
    expect(high.sessions).toBeGreaterThan(low.sessions);
    // 解析锚点：genius 基线 V=31，V38 应远快于 V97（渐近段）
    expect(low.sessions).toBeLessThan(500);
    expect(high.sessions).toBeGreaterThan(5000);
  });

  it('daysForSessions converts with a zero guard', () => {
    expect(daysForSessions(70, 70)).toBe(7);
    expect(daysForSessions(10, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('balance-regression CLI (DB-free)', () => {
  it('reports the 8 chapter finals in ascending recommended_level', async () => {
    const { status, stdout } = await captureRun(['--json'], { skipGrowth: true });
    expect(status).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.targets).toHaveLength(8);
    expect(report.targets.map((t: { chapter: string }) => t.chapter)).toEqual([
      'cspj',
      'csps',
      'noip',
      'province',
      'noi',
      'ctt',
      'cts',
      'ioi',
    ]);
    expect(report.targets.map((t: { recommendedLevel: number }) => t.recommendedLevel)).toEqual([
      19, 38, 58, 74, 87, 91, 94, 97,
    ]);
  });

  it('stone ledger matches GAME-DESIGN §7.3 (10 + 3×5 = 25)', async () => {
    const { status, stdout } = await captureRun(['--json'], { skipGrowth: true });
    expect(status).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.ledger.storyLayer0.total).toBe(10);
    expect(report.ledger.ngPlus.perLayer).toBe(5);
    expect(report.ledger.canonical.totalAfterThreeLayers).toBe(25);
    expect(report.gates.canonicalStones.pass).toBe(true);
    // IOI 传说道具盒内的 4 颗计入 layer0
    const ioi = report.ledger.storyLayer0.detail.find(
      (d: { stageKey: string }) => d.stageKey === 'ioi:4',
    );
    expect(ioi.stonesContributed).toBe(4);
  });

  it('demand side is driven by items.yaml costs and talents.yaml chains', async () => {
    const { stdout } = await captureRun(['--json'], { skipGrowth: true });
    const report = JSON.parse(stdout);
    expect(report.demand.costByTargetRarity).toEqual([
      { rarity: 'yellow', cost: 1 },
      { rarity: 'green', cost: 2 },
      { rarity: 'blue', cost: 3 },
      { rarity: 'purple', cost: 5 },
      { rarity: 'colorful', cost: 8 },
    ]);
    expect(report.demand.singleUpgradePurpleToColorful).toBe(8);
    expect(report.demand.grayChainTotal).toBe(19);
    expect(report.demand.chains).toEqual([
      { family: 'guess', baseRarity: 'green', stonesToColorful: 16 },
      { family: 'memo', baseRarity: 'green', stonesToColorful: 16 },
    ]);
    expect(report.demand.colorfulWithoutChain).toContain('turing-colorful');
  });

  it('server-limited colorful event is priced as 3 triggers × 0.35 = 1.05 stones/week', async () => {
    const { stdout } = await captureRun(['--json'], { skipGrowth: true });
    const report = JSON.parse(stdout);
    const c2 = report.ledger.events.find((e: { code: string }) => e.code === 'C2');
    expect(c2).toBeDefined();
    expect(c2.expectedStonePerTrigger).toBeCloseTo(0.35, 10);
    expect(c2.expectedStonesPerServerWeek).toBeCloseTo(1.05, 10);
    expect(c2.serverWeeklyLimit).toBe(3);
  });

  it('full growth matrix is deterministic across all tiers/blends/finals', async () => {
    const first = await captureRun(['--json']);
    const second = await captureRun(['--json']);
    expect(first.status).toBe(0);
    const report = JSON.parse(first.stdout);
    const report2 = JSON.parse(second.stdout);
    expect(report.growth).toHaveLength(4 * 8 * 2);
    expect(report2.growth).toEqual(report.growth);
    // 最优口径：genius × mid-profile-mix × ioi:4 必须可达且落在一个合理区间
    const ioi = report.growth.find(
      (r: { tier: string; blend: string; stageKey: string }) =>
        r.tier === 'genius' && r.blend === 'mid-profile-mix' && r.stageKey === 'ioi:4',
    );
    expect(ioi.reached).toBe(true);
    expect(ioi.sessions).toBeGreaterThan(5_000);
    expect(ioi.sessions).toBeLessThan(40_000);
    expect(ioi.daysFocused).toBeGreaterThan(0);
    // 单调性：同一 (tier, blend) 下 recommended_level 越高会话越多
    const geniusMix = report.growth.filter(
      (r: { tier: string; blend: string }) => r.tier === 'genius' && r.blend === 'mid-profile-mix',
    );
    const sessions = geniusMix.map(
      (r: { recommendedLevel: number; sessions: number }) =>
        [r.recommendedLevel, r.sessions] as const,
    );
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i]![1]).toBeGreaterThanOrEqual(sessions[i - 1]![1]);
    }
  });

  it('text renderer prints ledger conclusions', async () => {
    const { status, stdout } = await captureRun([], { skipGrowth: true });
    expect(status).toBe(0);
    expect(stdout).toContain('==== T5.2 数值平衡回归报告 ====');
    expect(stdout).toContain('一周目正赛里程碑（含 IOI 传说礼盒内含）: 10 颗');
    expect(stdout).toContain('家族 memo');
    expect(stdout).toContain('[ok]');
  });
});
