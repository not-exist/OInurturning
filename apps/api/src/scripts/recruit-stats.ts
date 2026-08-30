/**
 * 招募分布统计脚本（验收用，只跑打印人工核对，不进 vitest 断言）：
 *   pnpm -C apps/api exec tsx src/scripts/recruit-stats.ts [样本数=10000] [种子=20260830]
 *
 * 用真实 docs/data/talents.yaml + economy.yaml 采样 N 名候选，打印：
 *   1. 品质档分布（rep=0 / rep=8000）vs §3.2 期望 ±2σ；
 *   2. 天赋数量分布 vs §3.4 期望 ±2σ；
 *   3. 六维均值 vs §3.3 期望（rep=0 / rep=6000，±2σ）；
 *   4. genius 首槽稀有度分布（应全部 ≥ 绿）。
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import {
  economyConfigSchema,
  talentsFileSchema,
  type ConfigRarity,
} from '@oinur/shared';
import { mulberry32 } from '../lib/rng.js';
import {
  bucketTalents,
  generateCandidate,
  qualityWeights,
  repAdjustedE,
  type GenQuality,
} from '../modules/academy/recruit-gen.js';

const SAMPLES = Number(process.argv[2] ?? 10_000);
const SEED = Number(process.argv[3] ?? 20_260_830);

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(MODULE_DIR, '../../../../docs/data');

function loadYaml<T>(file: string, parse: (data: unknown) => T): T {
  const doc = parseDocument(readFileSync(path.join(DATA_DIR, file), 'utf8'));
  if (doc.errors.length > 0) throw new Error(`${file}: YAML 语法错误`);
  return parse(doc.toJS());
}

const talents = loadYaml('talents.yaml', (d) => talentsFileSchema.parse(d).talents);
const economy = loadYaml('economy.yaml', (d) => economyConfigSchema.parse(d));

const buckets = bucketTalents(Object.fromEntries(talents.map((t) => [t.id, t])));
const rarityOf = new Map(talents.map((t) => [t.id, t.rarity]));
const RARITY_RANK = new Map<ConfigRarity, number>(
  ['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'].map((r, i) => [r as ConfigRarity, i]),
);

interface Tally {
  quality: Record<GenQuality, number>;
  talentCount: number[];
  dimSum: Record<GenQuality, { sum: number; n: number }>;
  geniusFirstSlot: Partial<Record<ConfigRarity, number>>;
}

function sample(reputation: number): Tally {
  const rng = mulberry32(SEED);
  const tally: Tally = {
    quality: { common: 0, good: 0, elite: 0, genius: 0 },
    talentCount: [0, 0, 0, 0],
    dimSum: {
      common: { sum: 0, n: 0 },
      good: { sum: 0, n: 0 },
      elite: { sum: 0, n: 0 },
      genius: { sum: 0, n: 0 },
    },
    geniusFirstSlot: {},
  };
  const ctx = {
    reputation,
    ownedStudents: 0,
    buckets,
    recruitment: economy.recruitment,
  };
  for (let i = 0; i < SAMPLES; i++) {
    const c = generateCandidate(rng, `c${i}`, ctx);
    const q = c.qualityTier.toLowerCase() as GenQuality;
    tally.quality[q] += 1;
    tally.talentCount[c.talents.length] = (tally.talentCount[c.talents.length] ?? 0) + 1;
    const dims = [c.attrs.ds, c.attrs.dp, c.attrs.math, c.attrs.graph, c.attrs.greedy, c.attrs.str];
    tally.dimSum[q].sum += dims.reduce((a, b) => a + b, 0);
    tally.dimSum[q].n += dims.length;
    if (q === 'genius' && c.talents.length > 0) {
      const r = rarityOf.get(c.talents[0]!.talentId)!;
      tally.geniusFirstSlot[r] = (tally.geniusFirstSlot[r] ?? 0) + 1;
    }
  }
  return tally;
}

function sigmaLine(label: string, actual: number, p: number, n: number): string {
  const sigma = Math.sqrt((n * p * (1 - p)) / (n * n)); // 比例标准差
  const lo = p - 2 * sigma;
  const hi = p + 2 * sigma;
  const ok = actual >= lo && actual <= hi ? 'OK ' : '超出';
  return `  ${label.padEnd(22)} 实际 ${(actual * 100).toFixed(2)}%  期望 ${(p * 100).toFixed(2)}%  ±2σ=[${(lo * 100).toFixed(2)}%, ${(hi * 100).toFixed(2)}%]  ${ok}`;
}

function reportQuality(reputation: number): void {
  const t = sample(reputation);
  const w = qualityWeights(reputation);
  console.log(`\n== 品质档分布（rep=${reputation}，n=${SAMPLES}）==`);
  for (const q of ['common', 'good', 'elite', 'genius'] as const) {
    console.log(sigmaLine(q, t.quality[q] / SAMPLES, w[q], SAMPLES));
  }

  console.log(`  -- 六维均值（§3.3 期望 E${reputation > 0 ? '′（含声誉加成）' : ''}）--`);
  const dimE: Record<GenQuality, number> = { common: 8, good: 14, elite: 22, genius: 32 };
  for (const q of ['common', 'good', 'elite', 'genius'] as const) {
    const { sum, n } = t.dimSum[q];
    if (n === 0) continue;
    const e = reputation > 0 ? repAdjustedE(dimE[q], reputation) : dimE[q];
    console.log(`  ${q.padEnd(22)} 实际 ${(sum / n).toFixed(2)}  期望 ${e}`);
  }

  if (reputation === 0) {
    console.log('  -- 天赋数量分布（§3.4，按品质档整体汇总的每候选数量占比仅粗看）--');
    const total = t.talentCount.reduce((a, b) => a + b, 0);
    t.talentCount.forEach((cnt, k) => {
      console.log(`  ${k} 个天赋: ${((cnt / total) * 100).toFixed(2)}%`);
    });

    console.log('  -- genius 首槽稀有度（保底：应全部 ≥ 绿）--');
    const entries = Object.entries(t.geniusFirstSlot).sort(
      (a, b) => (RARITY_RANK.get(a[0] as ConfigRarity) ?? 0) - (RARITY_RANK.get(b[0] as ConfigRarity) ?? 0),
    );
    const geniusN = entries.reduce((a, [, v]) => a + v, 0);
    for (const [r, v] of entries) {
      console.log(`  ${r.padEnd(10)} ${((v / geniusN) * 100).toFixed(2)}%`);
    }
    const belowGreen = entries.filter(([r]) => (RARITY_RANK.get(r as ConfigRarity) ?? 0) < 2);
    console.log(belowGreen.length === 0 ? '  保底校验：OK（无绿以下）' : `  保底校验：失败 ${JSON.stringify(belowGreen)}`);
  }
}

console.log(`recruit-stats: samples=${SAMPLES} seed=${SEED} talents=${talents.length} 条（六档齐全校验：${
  (['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'] as const).every(
    (r) => buckets.byRarity[r].length > 0,
  )
    ? 'OK'
    : '缺档！'
}）`);
reportQuality(0);
reportQuality(8000);
