import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { economyConfigSchema, itemsFileSchema, stagesConfigSchema } from '@oinur/shared';
import { parseDocument } from 'yaml';
import { runSemanticChecks } from '../config/semantic.js';
import { simulateEconomy, type EconomySimulationReport } from '../modules/economy/simulation.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(MODULE_DIR, '../../../../docs/data');

export interface RunOptions {
  loadData?: (path: string) => unknown;
}

function parseYaml(pathname: string): unknown {
  const document = parseDocument(readFileSync(pathname, 'utf8'));
  if (document.errors.length > 0) throw new Error(`${pathname}: YAML syntax error`);
  return document.toJS();
}

function formatRatio(ratio: number | null): string {
  return ratio === null ? 'null' : ratio.toFixed(4);
}

function renderText(report: EconomySimulationReport): string {
  const lines: string[] = [];
  for (const profile of report.profiles) {
    lines.push(`== ${profile.id}: ${profile.label} ==`);
    lines.push('income:');
    for (const line of profile.income) lines.push(`  ${line.key}: ${line.amount}`);
    lines.push('expenses:');
    for (const line of profile.expenses) lines.push(`  ${line.key}: ${line.amount}`);
    lines.push(`incomeTotal: ${profile.incomeTotal}`);
    lines.push(`expenseTotal: ${profile.expenseTotal}`);
    lines.push(`net: ${profile.net}`);
    lines.push(`ratio: ${formatRatio(profile.ratio)}`);
  }
  lines.push(`target: ${report.target.profileId} [${report.target.min}, ${report.target.max}] actual=${formatRatio(report.target.actual)} ${report.target.pass ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

export async function run(argv: readonly string[] = [], options: RunOptions = {}): Promise<number> {
  const loadData = options.loadData ?? parseYaml;
  const economyPath = path.join(DATA_DIR, 'economy.yaml');
  const itemsPath = path.join(DATA_DIR, 'items.yaml');
  const stagesPath = path.join(DATA_DIR, 'stages.yaml');
  try {
    const economy = economyConfigSchema.parse(loadData(economyPath));
    if (economy.simulation === undefined) throw new Error(`${economyPath}: simulation is required`);
    const items = itemsFileSchema.parse(loadData(itemsPath)).items;
    const stages = stagesConfigSchema.parse(loadData(stagesPath));
    const issues = runSemanticChecks({ economy, items, stages, talents: [] });
    if (issues.length > 0) {
      const issue = issues[0]!;
      const filePath: Record<string, string> = { economy: economyPath, items: itemsPath, stages: stagesPath };
      throw new Error(`${filePath}: ${issue.path}: ${issue.message}`);
    }
    const report = simulateEconomy({
      economy,
      items: Object.fromEntries(items.map((item) => [item.id, item])),
      stages: Object.fromEntries(stages.stages.map((stage) => [`${stage.chapter}:${stage.stage_index}`, stage])),
    });
    console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : renderText(report));
    return report.target.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
