import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { economyConfigSchema } from '@oinur/shared';
import { runSemanticChecks, type SemanticIssue } from '../src/config/semantic.js';
import { simulateEconomy } from '../src/modules/economy/simulation.js';

const dataPath = (file: string) => path.resolve(import.meta.dirname, '../../../docs/data', file);
const economy = parseYaml(readFileSync(dataPath('economy.yaml'), 'utf8')) as Record<string, unknown>;
const items = parseYaml(readFileSync(dataPath('items.yaml'), 'utf8')) as { items: unknown[] };
const problems = parseYaml(readFileSync(dataPath('problems.yaml'), 'utf8')) as { templates: unknown[] };
const stages = parseYaml(readFileSync(dataPath('stages.yaml'), 'utf8')) as unknown;
const talents = parseYaml(readFileSync(dataPath('talents.yaml'), 'utf8')) as { talents: unknown[] };

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
  it('rejects a missing target ratio range', () => {
    const malformed = structuredClone(parsedEconomy) as any;
    delete malformed.meta.calibration_profile.target_income_expense_ratio;
    expect(() => simulateEconomy({ economy: malformed, items: itemMap as any, stages: stageMap as any })).toThrow(/meta\.calibration_profile\.target_income_expense_ratio/);
  });
});
