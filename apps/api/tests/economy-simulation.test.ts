import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  economyConfigSchema,
  itemsFileSchema,
  problemConfigSchema,
  stagesConfigSchema,
  talentsFileSchema,
  type EconomyConfig,
  type SimulationConfig,
  type SimulationProfile,
} from '@oinur/shared';
import { runSemanticChecks, type SemanticIssue } from '../src/config/semantic.js';
import { simulateEconomy } from '../src/modules/economy/simulation.js';
import { run } from '../src/scripts/sim-economy.js';

const dataPath = (file: string) => path.resolve(import.meta.dirname, '../../../docs/data', file);
type RankTier = SimulationProfile['story']['rank_tier'];
type EconomyFixture = EconomyConfig & {
  meta: { calibration_profile: { target_income_expense_ratio?: [number, number] } };
  contest: {
    ngplus_money_multiplier: { formula: string };
    rank_coeffs: Partial<Record<RankTier, number>>;
  };
};

const economy = economyConfigSchema.parse(parseYaml(readFileSync(dataPath('economy.yaml'), 'utf8'))) as EconomyFixture;
const items = itemsFileSchema.parse(parseYaml(readFileSync(dataPath('items.yaml'), 'utf8'))).items;
const problems = problemConfigSchema.parse(parseYaml(readFileSync(dataPath('problems.yaml'), 'utf8')));
const stages = stagesConfigSchema.parse(parseYaml(readFileSync(dataPath('stages.yaml'), 'utf8')));
const talents = talentsFileSchema.parse(parseYaml(readFileSync(dataPath('talents.yaml'), 'utf8'))).talents;

function simulationOf(config: EconomyConfig): SimulationConfig {
  if (config.simulation === undefined) throw new Error('test fixture requires economy.simulation');
  return config.simulation;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('economy simulation configuration', () => {
  it('parses the approved profiles in economy.yaml', () => {
    expect(economy.simulation?.target_profile).toBe('mid');
    expect(economy.simulation?.profiles.map((profile) => profile.id)).toEqual(['beginner', 'mid', 'late']);
  });

  it('rejects malformed profile values', () => {
    const malformed = structuredClone(economy);
    simulationOf(malformed).profiles[1]!.training.basic_sessions = -1;
    expect(() => economyConfigSchema.parse(malformed)).toThrow();
  });

  const semantic = (simulationPatch: Record<string, unknown>) => {
    const config = structuredClone(economy);
    const patched = {
      ...simulationOf(config),
      profiles: simulationOf(config).profiles.map((profile) => ({
        ...(profile as Record<string, unknown>),
        ...simulationPatch,
      })),
    };
    return runSemanticChecks({
      talents,
      items,
      economy: economyConfigSchema.parse({ ...config, simulation: patched }),
      problems,
      stages,
    });
  };

  it('rejects unknown lecture tiers, books, and stage keys', () => {
    expect(semantic({ lectures: { sessions: 1, tier: 'missing-tier' } }).some((issue: SemanticIssue) => issue.path.includes('.lectures.tier'))).toBe(true);
    expect(semantic({ training: { ...simulationOf(economy).profiles[0]!.training, directed_book_item_id: 'missing-book' } }).some((issue: SemanticIssue) => issue.path.includes('directed_book_item_id'))).toBe(true);
    expect(semantic({ story: { ...simulationOf(economy).profiles[0]!.story, stage_key: 'missing:1' } }).some((issue: SemanticIssue) => issue.path.includes('.story.stage_key'))).toBe(true);
  });

  it('reports duplicate profile IDs semantically', () => {
    const config = structuredClone(economy);
    simulationOf(config).profiles[1]!.id = simulationOf(config).profiles[0]!.id;
    const issues = runSemanticChecks({ talents, items, economy: config, stages });
    expect(issues.some((issue: SemanticIssue) => issue.path.endsWith('.id') && issue.message.includes('重复'))).toBe(true);
  });

  it('reports unverifiable lecture references when lecture config is missing or partial', () => {
    const missing = structuredClone(economy);
    delete missing.lecture;
    const missingIssues = runSemanticChecks({ talents, items, economy: missing, stages });
    expect(missingIssues.some((issue: SemanticIssue) => issue.path === 'simulation.profiles.beginner.lectures.tier')).toBe(true);

    const partial = structuredClone(economy);
    partial.lecture = { audience_tiers: [] };
    const partialIssues = runSemanticChecks({ talents, items, economy: partial, stages });
    expect(partialIssues.some((issue: SemanticIssue) => issue.path === 'simulation.profiles.mid.lectures.tier')).toBe(true);
  });

  it('rejects a zero-total rarity mix', () => {
    const config = structuredClone(economy);
    simulationOf(config).profiles[0]!.adventures.rarity_mix = { gray: 0, yellow: 0 };
    const parsed = economyConfigSchema.safeParse(config);
    expect(parsed.success).toBe(false);
  });

  it('rejects rarity mix keys without configured adventure money ranges', () => {
    const adventures = simulationOf(economy).profiles[0]!.adventures;
    const issues = semantic({ adventures: { ...adventures, rarity_mix: { gray: 1, typo: 10 } } });
    expect(issues.some((issue) => issue.path.endsWith('.adventures.rarity_mix.typo'))).toBe(true);
  });
});

describe('pure economy simulation engine', () => {
  const parsedEconomy = economy;
  const itemMap = Object.fromEntries(items.map((item) => [item.id, item]));
  const stageMap = Object.fromEntries(stages.stages.map((stage) => [`${stage.chapter}:${stage.stage_index}`, stage]));
  const report = () => simulateEconomy({ economy: parsedEconomy, items: itemMap, stages: stageMap });

  it('scales training costs by owned students', () => {
    const r = report().profiles[1]!;
    expect(r.expenses.find((line) => line.key === 'training.basic')?.amount).toBe(395);
  });
  it('charges the selected directed book price', () => {
    const r = report().profiles[1]!;
    expect(r.expenses.find((line) => line.key === 'books.directed')?.amount).toBe(1280);
  });
  it('applies recruitment quality and fractional weekly frequency', () => {
    const r = report().profiles[2]!;
    expect(r.expenses.find((line) => line.key === 'recruitment')?.amount).toBe(1508);
  });
  it('applies lecture reputation and overflow multipliers', () => {
    const r = report().profiles[1]!;
    expect(r.income.find((line) => line.key === 'lectures')?.amount).toBe(2520);
  });
  it('uses rarity-weighted adventure midpoints', () => {
    const r = report().profiles[1]!;
    expect(r.income.find((line) => line.key === 'adventures')?.amount).toBe(600);
  });
  it('applies chapter prize, rank, and NG+ multipliers', () => {
    const r = report().profiles[2]!;
    expect(r.income.find((line) => line.key === 'story')?.amount).toBe(27000);
  });
  it('calculates passive sponsor and coach income', () => {
    const r = report().profiles[2]!;
    expect(r.income.find((line) => line.key === 'passive.sponsor')?.amount).toBe(1330);
    expect(r.income.find((line) => line.key === 'passive.coach')?.amount).toBe(270);
  });
  it('sums line items and returns null ratio for zero expenses', () => {
    const r = report().profiles[0]!;
    expect(r.incomeTotal).toBe(r.income.reduce((s, l) => s + l.amount, 0));
    const zero = structuredClone(parsedEconomy);
    const beginner = simulationOf(zero).profiles[0]!;
    beginner.fixed_weekly_expense = 0;
    beginner.training.basic_sessions = 0;
    beginner.training.directed_sessions = 0;
    beginner.training.specialized_sessions = 0;
    beginner.recruitment.recruits_per_week = 0;
    beginner.recruitment.manual_refreshes_per_week = 0;
    expect(simulateEconomy({ economy: zero, items: itemMap, stages: stageMap }).profiles[0]!.ratio).toBeNull();
  });
  it('keeps real profile order and finite totals', () => {
    const actual = report();
    const rs = actual.profiles;
    expect(rs.map((p) => p.id)).toEqual(['beginner', 'mid', 'late']);
    expect(rs.every((p) => Number.isFinite(p.incomeTotal) && Number.isFinite(p.expenseTotal))).toBe(true);
    for (const profile of rs) {
      expect(profile.income.reduce((sum, line) => sum + line.amount, 0)).toBe(profile.incomeTotal);
      expect(profile.expenses.reduce((sum, line) => sum + line.amount, 0)).toBe(profile.expenseTotal);
    }
    expect(actual.target.profileId).toBe('mid');
    expect(actual.target.pass).toBe(true);
    expect(actual.target.actual).toBeGreaterThanOrEqual(actual.target.min);
    expect(actual.target.actual).toBeLessThanOrEqual(actual.target.max);
  });
  it('sorts profiles into canonical order regardless of input order', () => {
    const reordered = structuredClone(parsedEconomy);
    simulationOf(reordered).profiles.reverse();
    expect(simulateEconomy({ economy: reordered, items: itemMap, stages: stageMap }).profiles.map((p) => p.id)).toEqual(['beginner', 'mid', 'late']);
  });
  it('rejects malformed NG+ formulas and missing rank coefficients', () => {
    const malformed = structuredClone(parsedEconomy);
    malformed.contest.ngplus_money_multiplier.formula = 'broken';
    expect(() => simulateEconomy({ economy: malformed, items: itemMap, stages: stageMap })).toThrow(/contest\.ngplus_money_multiplier\.formula/);
    const missingRank = structuredClone(parsedEconomy);
    delete missingRank.contest.rank_coeffs.third_to_eighth;
    expect(() => simulateEconomy({ economy: missingRank, items: itemMap, stages: stageMap })).toThrow(/contest\.rank_coeffs\.third_to_eighth/);
  });
  it('rejects NG+ formulas with valid substrings but malformed tails', () => {
    for (const formula of ['mult(k) = 1 + 0.5 * k + typo', 'mult(k) = 1 + 0.5 * k2']) {
      const malformed = structuredClone(parsedEconomy);
      malformed.contest.ngplus_money_multiplier.formula = formula;
      expect(() => simulateEconomy({ economy: malformed, items: itemMap, stages: stageMap })).toThrow(/contest\.ngplus_money_multiplier\.formula/);
    }
  });
  it('rejects a missing target ratio range', () => {
    const malformed = structuredClone(parsedEconomy);
    delete malformed.meta.calibration_profile.target_income_expense_ratio;
    expect(() => simulateEconomy({ economy: malformed, items: itemMap, stages: stageMap })).toThrow(/meta\.calibration_profile\.target_income_expense_ratio/);
  });
  it('rejects a missing passive configuration instead of dropping stable income lines', () => {
    const malformed = structuredClone(parsedEconomy);
    delete malformed.passive;
    expect(() => simulateEconomy({ economy: malformed, items: itemMap, stages: stageMap })).toThrow(/passive/);
  });
});

describe('economy simulation CLI', () => {
  const captureOutput = () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => lines.push(message));
    vi.spyOn(console, 'error').mockImplementation((message: string) => lines.push(message));
    return lines;
  };

  it('renders all profiles and a passing target in text output', async () => {
    const lines = captureOutput();

    const exitCode = await run([]);

    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('beginner');
    expect(lines.join('\n')).toContain('mid');
    expect(lines.join('\n')).toContain('late');
    expect(lines.join('\n')).toContain('PASS');
  });

  it('renders stable JSON output', async () => {
    const lines = captureOutput();

    const exitCode = await run(['--json']);
    const json = JSON.parse(lines[0]!);

    expect(exitCode).toBe(0);
    expect(json.profiles.map((profile: { id: string }) => profile.id)).toEqual(['beginner', 'mid', 'late']);
    expect(json.target.pass).toBe(true);
  });

  it('emits parseable JSON from the silent root pnpm command', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const child = spawnSync('pnpm', ['--silent', 'sim:economy', '--', '--json'], { cwd: root, encoding: 'utf8' });

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout).target.pass).toBe(true);
  });

  it('keeps pnpm diagnostics for an unknown root script', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const child = spawnSync('pnpm', ['run', 'this-script-does-not-exist'], { cwd: root, encoding: 'utf8' });

    expect(child.status).toBe(1);
    expect(`${child.stdout}${child.stderr}`).not.toBe('');
  });

  it('reports the data path when economy simulation data is malformed', async () => {
    const lines = captureOutput();
    const malformed = structuredClone(economy);
    delete malformed.simulation;

    const exitCode = await run([], {
      loadData: (file) => file.endsWith('economy.yaml') ? malformed : parseYaml(readFileSync(file, 'utf8')),
    });

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('economy.yaml');
  });

  it('reports the economy YAML path for a missing book reference', async () => {
    const lines = captureOutput();
    const malformed = structuredClone(economy);
    simulationOf(malformed).profiles[0]!.training.directed_book_item_id = 'missing-book';
    const exitCode = await run([], { loadData: (file) => file.endsWith('economy.yaml') ? malformed : parseYaml(readFileSync(file, 'utf8')) });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('economy.yaml');
  });

  it('reports the items YAML path for a malformed items file', async () => {
    const lines = captureOutput();
    const malformedItems = { items: [] };
    const exitCode = await run([], { loadData: (file) => file.endsWith('items.yaml') ? malformedItems : parseYaml(readFileSync(file, 'utf8')) });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('items.yaml');
  });

  it('rejects a non-mid target profile with its config path', async () => {
    const lines = captureOutput();
    const malformed = structuredClone(economy);
    simulationOf(malformed).target_profile = 'late';
    const exitCode = await run([], { loadData: (file) => file.endsWith('economy.yaml') ? malformed : parseYaml(readFileSync(file, 'utf8')) });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('simulation.target_profile');
  });

  it('identifies the target ratio path when the gate fails', async () => {
    const lines = captureOutput();
    const malformed = structuredClone(economy);
    malformed.meta.calibration_profile.target_income_expense_ratio = [99, 100];
    const exitCode = await run([], { loadData: (file) => file.endsWith('economy.yaml') ? malformed : parseYaml(readFileSync(file, 'utf8')) });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('meta.calibration_profile.target_income_expense_ratio');
  });

  it('renders null rather than Infinity for zero-expense profiles', async () => {
    const lines = captureOutput();
    const zeroExpense = structuredClone(economy);
    for (const profile of simulationOf(zeroExpense).profiles) {
      profile.training.basic_sessions = 0;
      profile.training.directed_sessions = 0;
      profile.training.specialized_sessions = 0;
      profile.recruitment.recruits_per_week = 0;
      profile.recruitment.manual_refreshes_per_week = 0;
      profile.fixed_weekly_expense = 0;
    }

    const exitCode = await run(['--json'], {
      loadData: (file) => file.endsWith('economy.yaml') ? zeroExpense : parseYaml(readFileSync(file, 'utf8')),
    });
    const json = JSON.parse(lines[0]!);

    expect(exitCode).toBe(1);
    expect(json.profiles.every((profile: { ratio: number | null }) => profile.ratio === null)).toBe(true);
    expect(lines.join('\n')).not.toContain('Infinity');
  });
});
