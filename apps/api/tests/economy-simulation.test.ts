import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { economyConfigSchema } from '@oinur/shared';
import { runSemanticChecks, type SemanticIssue } from '../src/config/semantic.js';
import { simulateEconomy } from '../src/modules/economy/simulation.js';
import { run } from '../src/scripts/sim-economy.js';

const dataPath = (file: string) => path.resolve(import.meta.dirname, '../../../docs/data', file);
const economy = parseYaml(readFileSync(dataPath('economy.yaml'), 'utf8')) as Record<string, unknown>;
const items = parseYaml(readFileSync(dataPath('items.yaml'), 'utf8')) as { items: unknown[] };
const problems = parseYaml(readFileSync(dataPath('problems.yaml'), 'utf8')) as { templates: unknown[] };
const stages = parseYaml(readFileSync(dataPath('stages.yaml'), 'utf8')) as unknown;
const talents = parseYaml(readFileSync(dataPath('talents.yaml'), 'utf8')) as { talents: unknown[] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('economy simulation configuration', () => {
  it('parses the approved profiles in economy.yaml', () => {
    const parsed = economyConfigSchema.parse(economy);
    expect(parsed.simulation?.target_profile).toBe('mid');
    expect(parsed.simulation?.profiles.map((profile) => profile.id)).toEqual(['beginner', 'mid', 'late']);
  });

  it('rejects malformed profile values', () => {
    const malformed = structuredClone(economy);
    const profiles = (malformed.simulation as { profiles: Array<Record<string, unknown>> }).profiles;
    (profiles[1]!.training as Record<string, unknown>).basic_sessions = -1;
    expect(() => economyConfigSchema.parse(malformed)).toThrow();
  });

  const semantic = (simulationPatch: Record<string, unknown>) => {
    const config = structuredClone(economy) as Record<string, unknown>;
    config.simulation = {
      ...(config.simulation as Record<string, unknown>),
      profiles: ((config.simulation as { profiles: unknown[] }).profiles).map((profile) => ({
        ...(profile as Record<string, unknown>),
        ...simulationPatch,
      })),
    };
    return runSemanticChecks({
      talents: talents.talents as never[],
      items: items.items as never[],
      economy: config as never,
      problems: problems as never,
      stages: stages as never,
    });
  };

  it('rejects unknown lecture tiers, books, and stage keys', () => {
    expect(semantic({ lectures: { sessions: 1, tier: 'missing-tier' } }).some((issue: SemanticIssue) => issue.path.includes('.lectures.tier'))).toBe(true);
    expect(semantic({ training: { ...(economy.simulation as any).profiles[0].training, directed_book_item_id: 'missing-book' } }).some((issue: SemanticIssue) => issue.path.includes('directed_book_item_id'))).toBe(true);
    expect(semantic({ story: { ...(economy.simulation as any).profiles[0].story, stage_key: 'missing:1' } }).some((issue: SemanticIssue) => issue.path.includes('.story.stage_key'))).toBe(true);
  });

  it('reports duplicate profile IDs semantically', () => {
    const config = structuredClone(economy) as any;
    config.simulation.profiles[1].id = config.simulation.profiles[0].id;
    const issues = runSemanticChecks({ talents: talents.talents as never[], items: items.items as never[], economy: config as never, stages: stages as never });
    expect(issues.some((issue: SemanticIssue) => issue.path.endsWith('.id') && issue.message.includes('重复'))).toBe(true);
  });

  it('reports unverifiable lecture references when lecture config is missing or partial', () => {
    const missing = structuredClone(economy) as any;
    delete missing.lecture;
    const missingIssues = runSemanticChecks({ talents: talents.talents as never[], items: items.items as never[], economy: missing as never, stages: stages as never });
    expect(missingIssues.some((issue: SemanticIssue) => issue.path === 'simulation.profiles.beginner.lectures.tier')).toBe(true);

    const partial = structuredClone(economy) as any;
    partial.lecture = { audience_tiers: [] };
    const partialIssues = runSemanticChecks({ talents: talents.talents as never[], items: items.items as never[], economy: partial as never, stages: stages as never });
    expect(partialIssues.some((issue: SemanticIssue) => issue.path === 'simulation.profiles.mid.lectures.tier')).toBe(true);
  });

  it('rejects a zero-total rarity mix', () => {
    const config = structuredClone(economy) as any;
    config.simulation.profiles[0].adventures.rarity_mix = { gray: 0, yellow: 0 };
    const parsed = economyConfigSchema.safeParse(config);
    expect(parsed.success).toBe(false);
  });
});

describe('pure economy simulation engine', () => {
  const parsedEconomy = economyConfigSchema.parse(economy);
  const itemMap = Object.fromEntries(items.items.map((item: any) => [item.id, item]));
  const stageMap = Object.fromEntries((stages as any).stages.map((stage: any) => [`${stage.chapter}:${stage.stage_index}`, stage]));
  const report = () => simulateEconomy({ economy: parsedEconomy as any, items: itemMap as any, stages: stageMap as any });

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
    expect(r.income.find((line) => line.key === 'passive.sponsor')?.amount).toBe(2660);
    expect(r.income.find((line) => line.key === 'passive.coach')?.amount).toBe(270);
  });
  it('sums line items and returns null ratio for zero expenses', () => {
    const r = report().profiles[0]!;
    expect(r.incomeTotal).toBe(r.income.reduce((s, l) => s + l.amount, 0));
    const zero = structuredClone(parsedEconomy) as any;
    zero.simulation.profiles[0].fixed_weekly_expense = 0;
    zero.simulation.profiles[0].training.basic_sessions = 0;
    zero.simulation.profiles[0].training.directed_sessions = 0;
    zero.simulation.profiles[0].training.specialized_sessions = 0;
    zero.simulation.profiles[0].recruitment.recruits_per_week = 0;
    zero.simulation.profiles[0].recruitment.manual_refreshes_per_week = 0;
    expect(simulateEconomy({ economy: zero, items: itemMap as any, stages: stageMap as any }).profiles[0]!.ratio).toBeNull();
  });
  it('keeps real profile order and finite totals', () => {
    const rs = report().profiles;
    expect(rs.map((p) => p.id)).toEqual(['beginner', 'mid', 'late']);
    expect(rs.every((p) => Number.isFinite(p.incomeTotal) && Number.isFinite(p.expenseTotal))).toBe(true);
  });
  it('sorts profiles into canonical order regardless of input order', () => {
    const reordered = structuredClone(parsedEconomy) as any;
    reordered.simulation.profiles.reverse();
    expect(simulateEconomy({ economy: reordered, items: itemMap as any, stages: stageMap as any }).profiles.map((p) => p.id)).toEqual(['beginner', 'mid', 'late']);
  });
  it('rejects malformed NG+ formulas and missing rank coefficients', () => {
    const malformed = structuredClone(parsedEconomy) as any;
    malformed.contest.ngplus_money_multiplier.formula = 'broken';
    expect(() => simulateEconomy({ economy: malformed, items: itemMap as any, stages: stageMap as any })).toThrow(/contest\.ngplus_money_multiplier\.formula/);
    const missingRank = structuredClone(parsedEconomy) as any;
    delete missingRank.contest.rank_coeffs.third_to_eighth;
    expect(() => simulateEconomy({ economy: missingRank, items: itemMap as any, stages: stageMap as any })).toThrow(/contest\.rank_coeffs\.third_to_eighth/);
  });
  it('rejects NG+ formulas with valid substrings but malformed tails', () => {
    for (const formula of ['mult(k) = 1 + 0.5 * k + typo', 'mult(k) = 1 + 0.5 * k2']) {
      const malformed = structuredClone(parsedEconomy) as any;
      malformed.contest.ngplus_money_multiplier.formula = formula;
      expect(() => simulateEconomy({ economy: malformed, items: itemMap as any, stages: stageMap as any })).toThrow(/contest\.ngplus_money_multiplier\.formula/);
    }
  });
  it('rejects a missing target ratio range', () => {
    const malformed = structuredClone(parsedEconomy) as any;
    delete malformed.meta.calibration_profile.target_income_expense_ratio;
    expect(() => simulateEconomy({ economy: malformed, items: itemMap as any, stages: stageMap as any })).toThrow(/meta\.calibration_profile\.target_income_expense_ratio/);
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

  it('emits parseable JSON from the root pnpm command', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const child = spawnSync('pnpm', ['sim:economy', '--', '--json'], { cwd: root, encoding: 'utf8' });

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout).target.pass).toBe(true);
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
    const malformed = structuredClone(economy) as any;
    malformed.simulation.profiles[0].training.directed_book_item_id = 'missing-book';
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
    const malformed = structuredClone(economy) as any;
    malformed.simulation.target_profile = 'late';
    const exitCode = await run([], { loadData: (file) => file.endsWith('economy.yaml') ? malformed : parseYaml(readFileSync(file, 'utf8')) });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('simulation.target_profile');
  });

  it('identifies the target ratio path when the gate fails', async () => {
    const lines = captureOutput();
    const malformed = structuredClone(economy) as any;
    malformed.meta.calibration_profile.target_income_expense_ratio = [99, 100];
    const exitCode = await run([], { loadData: (file) => file.endsWith('economy.yaml') ? malformed : parseYaml(readFileSync(file, 'utf8')) });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('meta.calibration_profile.target_income_expense_ratio');
  });

  it('renders null rather than Infinity for zero-expense profiles', async () => {
    const lines = captureOutput();
    const zeroExpense = structuredClone(economy) as any;
    for (const profile of zeroExpense.simulation.profiles) {
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
