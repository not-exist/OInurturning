import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import {
  economyConfigSchema,
  eventsConfigSchema,
  itemsFileSchema,
  stagesConfigSchema,
  talentsFileSchema,
  STAGE_CHAPTERS,
  type EconomyConfig,
  type EventsConfig,
  type ItemDef,
  type StageConfig,
  type StagesConfig,
  type TalentDef,
} from '@oinur/shared';
import { runSemanticChecks } from '../config/semantic.js';
import { ATTR_TABLE, type GenQuality } from '../modules/academy/recruit-gen.js';
import { BOOK_MULT, QUALITY_MULT } from '../modules/training/gains.js';
import { daysForSessions, sessionsToV, type StudentStats } from '../modules/economy/progression.js';

/**
 * T5.2 数值平衡回归 CLI（docs/ROADMAP.md M5 T5.2）。
 * 两部分输出，全部确定性、无 DB、无随机：
 *  A. 训练耗时到各章正赛 recommended_level（即 GAME-DESIGN §6.2 通关锚点）的会话数与日历时长；
 *  B. 进阶石供给（剧情里程碑/NG+/PVP 默认/全服限量事件）vs 彩天赋需求（items.yaml 升阶消耗表）。
 * 运行：pnpm bal:regress [--json]
 *
 * 建模假设（自文档化，见输出 assumptions）：
 *  - 成长口径与 progression.ts 相同：无天赋 meta、无声誉加成、无直用书/赛事实战成长，
 *    即纯训练基线（真实玩家只会更快）；
 *  - 招募基线取 recruit-gen ATTR_TABLE 的 E（声誉 0 期望），六维同 E；
 *  - blend `mid-profile-mix` 复用 economy.yaml simulation.profiles.mid 的训练配比
 *    （basic5/directed4/specialized2）与其定向书稀有度；专项题质量倍率 YAML 未指定，
 *    按绿色预制题（QUALITY_MULT.green）假设；
 *  - cadence 为分析口径（非游戏配置）：focused=70 会话/周（每日两轮清体力+药水），
 *    casual=11 会话/周（T5.1 中期画像全队周训练量 11 次集中给一名主力）；
 *  - PVP 默认奖池按 M4.6/pvp-rewards.ts DEFAULT_PRIZES：冠军 2 + 亚军 1 = 3 石/届。
 */

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(MODULE_DIR, '../../../../docs/data');

export interface RunOptions {
  loadData?: (path: string) => unknown;
  /** 测试/冒烟用：跳过耗时的成长矩阵，只跑账本与校验 */
  skipGrowth?: boolean;
  maxSessions?: number;
}

function parseYaml(pathname: string): unknown {
  const document = parseDocument(readFileSync(pathname, 'utf8'));
  if (document.errors.length > 0) throw new Error(`${pathname}: YAML syntax error`);
  return document.toJS();
}

interface FinalTarget {
  stageKey: string;
  chapter: string;
  stageIndex: number;
  name: string;
  recommendedLevel: number;
}

function finalStages(stages: StageConfig[]): FinalTarget[] {
  const byChapter = new Map<string, StageConfig>();
  for (const stage of stages) {
    const prev = byChapter.get(stage.chapter);
    if (prev === undefined || stage.stage_index > prev.stage_index)
      byChapter.set(stage.chapter, stage);
  }
  const keys = [...byChapter.keys()].sort(
    (a, b) => STAGE_CHAPTERS.indexOf(a) - STAGE_CHAPTERS.indexOf(b),
  );
  return keys.map((chapter) => {
    const stage = byChapter.get(chapter)!;
    return {
      stageKey: `${stage.chapter}:${stage.stage_index}`,
      chapter: stage.chapter,
      stageIndex: stage.stage_index,
      name: stage.name,
      recommendedLevel: stage.recommended_level,
    };
  });
}

/** 从物品 effect 取非 schema 强类型的子键（effect 为 passthrough） */
function effectField<T>(item: ItemDef, field: string): T | undefined {
  return (item.effect as unknown as Record<string, T> | undefined)?.[field];
}

/** 升阶消耗表：items.yaml advance-stone effect.cost_by_target_rarity */
function stoneCostTable(advanceStone: ItemDef | undefined): {
  ordered: { rarity: string; cost: number }[];
} {
  const order = ['yellow', 'green', 'blue', 'purple', 'colorful'];
  if (advanceStone === undefined) throw new Error('items.yaml: advance-stone 未定义');
  const byTarget = effectField<Record<string, number>>(advanceStone, 'cost_by_target_rarity');
  if (byTarget === undefined) {
    throw new Error('items.yaml: advance-stone.effect.cost_by_target_rarity 缺失');
  }
  return { ordered: order.map((rarity) => ({ rarity, cost: byTarget[rarity] ?? Number.NaN })) };
}

interface StoneEventInfo {
  eventId: string;
  code: string;
  name: string;
  rarity: string;
  repeatable: boolean;
  cooldownDays: number;
  serverWeeklyLimit: number | null;
  expectedStonePerTrigger: number;
  expectedStonesPerServerWeek: number | null;
}

/** 扫描事件里直接给 advance-stone 的 outcome，计算单次触发期望（取各 choice 期望的最大值） */
function stoneEvents(events: EventsConfig): StoneEventInfo[] {
  const result: StoneEventInfo[] = [];
  for (const event of events.events) {
    let bestExpected = 0;
    for (const choice of event.choices) {
      const outcomes = choice.outcomes as unknown as {
        weight?: number;
        rewards?: { items?: { id: string; qty?: number }[] };
      }[];
      const weightTotal = outcomes.reduce((sum, outcome) => sum + (outcome.weight ?? 0), 0);
      if (weightTotal <= 0) continue;
      const expected = outcomes.reduce((sum, outcome) => {
        const stones = (outcome.rewards?.items ?? [])
          .filter((item) => item.id === 'advance-stone')
          .reduce((s, item) => s + (item.qty ?? 0), 0);
        return sum + ((outcome.weight ?? 0) / weightTotal) * stones;
      }, 0);
      bestExpected = Math.max(bestExpected, expected);
    }
    if (bestExpected <= 0) continue;
    result.push({
      eventId: event.id,
      code: event.code,
      name: event.name,
      rarity: event.rarity,
      repeatable: event.repeatable,
      cooldownDays: event.cooldown_days,
      serverWeeklyLimit: event.server_weekly_limit ?? null,
      expectedStonePerTrigger: bestExpected,
      expectedStonesPerServerWeek:
        event.server_weekly_limit !== undefined ? bestExpected * event.server_weekly_limit : null,
    });
  }
  return result;
}

interface ChainInfo {
  family: string;
  baseRarity: string;
  stonesToColorful: number;
}

/** 从 talents.yaml 升阶链反推「可用进阶石冲彩」的家族链成本（items.yaml 消耗表驱动） */
function colorfulChains(
  talents: TalentDef[],
  costByTarget: Record<string, number>,
): { chains: ChainInfo[]; colorfulWithoutChain: string[] } {
  const byId = new Map(talents.map((t) => [t.id, t]));
  const chains: ChainInfo[] = [];
  const colorfulWithoutChain: string[] = [];
  const families = new Map<string, TalentDef[]>();
  for (const talent of talents) {
    if (talent.family !== null) {
      const list = families.get(talent.family) ?? [];
      list.push(talent);
      families.set(talent.family, list);
    }
  }
  const rarityRank = new Map(
    ['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'].map((r, i) => [r, i]),
  );
  for (const [family, members] of families) {
    if (!members.some((t) => t.rarity === 'colorful')) continue;
    const base = [...members].sort(
      (a, b) => rarityRank.get(a.rarity)! - rarityRank.get(b.rarity)!,
    )[0]!;
    let total = 0;
    let cursor: TalentDef | undefined = base;
    while (cursor !== undefined && cursor.rarity !== 'colorful') {
      const nextId = cursor.upgrade_to;
      if (nextId === null) break;
      const next = byId.get(nextId);
      if (next === undefined || next.family !== family) break;
      const cost = costByTarget[next.rarity];
      if (cost === undefined) break;
      total += cost;
      cursor = next;
    }
    if (cursor !== undefined && cursor.rarity === 'colorful') {
      chains.push({ family, baseRarity: base.rarity, stonesToColorful: total });
    }
  }
  for (const talent of talents) {
    if (talent.rarity === 'colorful' && talent.family === null)
      colorfulWithoutChain.push(talent.id);
  }
  chains.sort((a, b) => a.family.localeCompare(b.family));
  return { chains, colorfulWithoutChain };
}

/** 品质档招募基线：ATTR_TABLE 期望 E（六维同一 E，声誉 0） */
function recruitBaseline(quality: GenQuality): StudentStats {
  const spec = ATTR_TABLE[quality];
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

interface BlendDef {
  id: string;
  label: string;
  mix: { basic: number; directed: number; specialized: number };
  bookMult: number;
  qualityMult: number;
}

const CADENCES = [
  { id: 'focused', sessionsPerWeek: 70, label: '重度：70 次/周（每日两轮清体力+药水，10 次/日）' },
  {
    id: 'casual',
    sessionsPerWeek: 11,
    label: '轻量：11 次/周（T5.1 中期画像全队周训练量集中一名主力）',
  },
] as const;

// 分析用判级阈值（非玩法数值；仅决定报告 note 的措辞）
const YEARS_WARN = 2;
const YEARS_SEVERE = 10;

interface Note {
  level: 'ok' | 'warn' | 'severe';
  message: string;
}

interface GrowthRow {
  tier: string;
  stageKey: string;
  chapter: string;
  recommendedLevel: number;
  blend: string;
  sessions: number;
  reached: boolean;
  finalV: number;
  finalStats: StudentStats;
  daysFocused: number;
  daysCasual: number;
}

interface BalanceReport {
  generatedAt: string;
  gates: {
    canonicalStones: { totalAfterThreeLayers: number; gdSection73Target: number; pass: boolean };
  };
  targets: FinalTarget[];
  blends: {
    id: string;
    label: string;
    mix: { basic: number; directed: number; specialized: number };
    bookMult: number;
    qualityMult: number;
  }[];
  cadences: typeof CADENCES;
  assumptions: string[];
  growth: GrowthRow[];
  ledger: {
    storyLayer0: {
      detail: {
        stageKey: string;
        chapter: string;
        name: string;
        milestoneItems: { item: string; count: number }[];
        stonesContributed: number;
      }[];
      total: number;
    };
    ngPlus: { perLayer: number; layersAssumed: number };
    canonical: { totalAfterThreeLayers: number; gdSection73Target: number };
    pvp: { defaultPerTournament: number; note: string };
    events: StoneEventInfo[];
  };
  demand: {
    costByTargetRarity: { rarity: string; cost: number }[];
    singleUpgradePurpleToColorful: number;
    grayChainTotal: number;
    greenChainMin: number;
    chains: ChainInfo[];
    colorfulWithoutChain: string[];
  };
  notes: Note[];
}

export async function run(argv: readonly string[] = [], options: RunOptions = {}): Promise<number> {
  const loadData = options.loadData ?? parseYaml;
  const economyPath = path.join(DATA_DIR, 'economy.yaml');
  const itemsPath = path.join(DATA_DIR, 'items.yaml');
  const stagesPath = path.join(DATA_DIR, 'stages.yaml');
  const eventsPath = path.join(DATA_DIR, 'events.yaml');
  const talentsPath = path.join(DATA_DIR, 'talents.yaml');

  try {
    const economy = economyConfigSchema.parse(loadData(economyPath)) as EconomyConfig;
    const itemsFile = itemsFileSchema.parse(loadData(itemsPath));
    const items = itemsFile.items;
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const stages = stagesConfigSchema.parse(loadData(stagesPath)) as StagesConfig;
    const events = eventsConfigSchema.parse(loadData(eventsPath)) as EventsConfig;
    const talentsFile = talentsFileSchema.parse(loadData(talentsPath));
    const talents = talentsFile.talents as TalentDef[];

    const issues = runSemanticChecks({ talents, items, economy, stages, events });
    if (issues.length > 0) {
      const issue = issues[0]!;
      throw new Error(`${issue.file}: ${issue.path}: ${issue.message}`);
    }

    const { ordered: stoneCostOrdered } = stoneCostTable(itemMap.get('advance-stone'));

    // ── A 部分数据：目标关卡、配比、基线 ──
    const targets = finalStages(stages.stages);
    if (targets.length !== STAGE_CHAPTERS.length) {
      throw new Error(`stages.yaml: 章节正赛数 ${targets.length} ≠ ${STAGE_CHAPTERS.length}`);
    }

    const midProfile = economy.simulation?.profiles.find((p) => p.id === 'mid');
    if (midProfile === undefined) throw new Error('economy.yaml: simulation.profiles.mid 缺失');
    const directedBook = midProfile.training.directed_book_item_id;
    const rarityMatch = /^book-[a-z]+-(gray|yellow|green|blue|purple)$/.exec(directedBook);
    const bookRarity = rarityMatch?.[1] ?? 'green';
    const bookMult = BOOK_MULT[bookRarity];
    if (bookMult === undefined)
      throw new Error(`economy.yaml: mid 定向书稀有度 ${bookRarity} 未知`);
    const qualityMult = QUALITY_MULT.green; // 专项题质量倍率假设（YAML 未指定稀有度）

    const blends: BlendDef[] = [
      {
        id: 'basic-only',
        label: '纯基础训练（随机六维，免费方向但低效）',
        mix: { basic: 1, directed: 0, specialized: 0 },
        bookMult: 1,
        qualityMult: 1,
      },
      {
        id: 'mid-profile-mix',
        label: `中期画像混合（basic5/directed4/specialized2，定向书 ${bookRarity}×${bookMult}，专项题按绿×${qualityMult}）`,
        mix: {
          basic: midProfile.training.basic_sessions,
          directed: midProfile.training.directed_sessions,
          specialized: midProfile.training.specialized_sessions,
        },
        bookMult,
        qualityMult,
      },
    ];

    const growth: GrowthRow[] = [];
    if (!options.skipGrowth) {
      const maxSessions = options.maxSessions ?? 1_000_000;
      const tiers: GenQuality[] = ['common', 'good', 'elite', 'genius'];
      for (const tier of tiers) {
        const baseline = recruitBaseline(tier);
        for (const target of targets) {
          for (const blend of blends) {
            const outcome = sessionsToV(
              baseline,
              blend.mix,
              target.recommendedLevel,
              { bookMult: blend.bookMult, qualityMult: blend.qualityMult },
              maxSessions,
            );
            growth.push({
              tier,
              stageKey: target.stageKey,
              chapter: target.chapter,
              recommendedLevel: target.recommendedLevel,
              blend: blend.id,
              sessions: outcome.sessions,
              reached: outcome.reached,
              finalV: outcome.v,
              finalStats: outcome.stats,
              daysFocused: daysForSessions(outcome.sessions, CADENCES[0].sessionsPerWeek),
              daysCasual: daysForSessions(outcome.sessions, CADENCES[1].sessionsPerWeek),
            });
          }
        }
      }
    }

    // ── B 部分数据：进阶石供给（一周目正赛里程碑 + NG+ + 事件）──
    const storyLayer0Detail: BalanceReport['ledger']['storyLayer0']['detail'] = [];
    let storyLayer0Stones = 0;
    for (const target of targets) {
      const stage = stages.stages.find(
        (s) => s.chapter === target.chapter && s.stage_index === target.stageIndex,
      )!;
      const milestoneItems = stage.first_clear.milestone?.items ?? [];
      let contributed = 0;
      for (const entry of milestoneItems) {
        let count = 0;
        if (entry.item === 'advance-stone') count = entry.count;
        else if (entry.item === 'legend-box') {
          const box = itemMap.get('legend-box');
          count =
            (box ? effectField<Record<string, number>>(box, 'contents')?.['advance-stone'] : 0) ??
            0;
        }
        contributed += count;
      }
      storyLayer0Stones += contributed;
      storyLayer0Detail.push({
        stageKey: target.stageKey,
        chapter: target.chapter,
        name: target.name,
        milestoneItems: milestoneItems.map((entry) => ({ item: entry.item, count: entry.count })),
        stonesContributed: contributed,
      });
    }

    const ngPlusPerLayer = stages.ng_plus.advance_stone_per_layer_clear;
    const layersAssumed = 3; // GAME-DESIGN §7.3「一周目＋NG+ 三层」
    const canonicalTotal = storyLayer0Stones + ngPlusPerLayer * layersAssumed;
    const gdSection73Target = 25;
    const stoneEventRows = stoneEvents(events);

    // ── B 部分数据：彩天赋需求 ──
    const costByTarget = Object.fromEntries(
      stoneCostOrdered.map((entry) => [entry.rarity, entry.cost]),
    );
    const { chains, colorfulWithoutChain } = colorfulChains(talents, costByTarget);
    const purpleToColorful = costByTarget['colorful'] ?? Number.NaN;
    const grayChainTotal = stoneCostOrdered.reduce((sum, entry) => sum + entry.cost, 0);
    const greenChainMin =
      chains.length > 0 ? Math.min(...chains.map((chain) => chain.stonesToColorful)) : Number.NaN;

    // ── 结论与门 ──
    const notes: Note[] = [];
    const canonicalPass = canonicalTotal === gdSection73Target;
    notes.push({
      level: canonicalPass ? 'ok' : 'severe',
      message: canonicalPass
        ? `一周目+NG+1..3 进阶石合计 ${canonicalTotal} 颗，达成 GAME-DESIGN §7.3「≈25 颗」目标线（一紫→彩 ${purpleToColorful} 或一整条绿→彩 ${greenChainMin} 均有富余，灰起步 ${grayChainTotal} 亦可覆盖）。`
        : `一周目+NG+1..3 进阶石合计 ${canonicalTotal} ≠ 预期 ${gdSection73Target}（§7.3），请核对 stages.yaml 里程碑与 ng_plus.advance_stone_per_layer_clear。`,
    });

    const serverDrip = stoneEventRows
      .filter((event) => event.expectedStonesPerServerWeek !== null)
      .reduce((sum, event) => sum + (event.expectedStonesPerServerWeek ?? 0), 0);
    if (serverDrip > 0) {
      notes.push({
        level: 'ok',
        message: `全服限量事件给石确定性期望 ≈ ${serverDrip.toFixed(2)} 石/周（全服合计）；PVP 另按默认每届 3 石由管理员节制。边际供给使全服彩天赋随时间缓慢增加，不破坏单玩家 25 颗主线的稀缺口径。`,
      });
    }

    const ioiRow = growth.find(
      (row) => row.tier === 'genius' && row.blend === 'mid-profile-mix' && row.stageKey === 'ioi:4',
    );
    if (ioiRow === undefined && !options.skipGrowth) {
      throw new Error('internal: growth 缺少 genius×mid-profile-mix×ioi:4 行');
    }
    if (ioiRow !== undefined) {
      const yearsFocused = ioiRow.daysFocused / 365.25;
      if (!ioiRow.reached) {
        notes.push({
          level: 'severe',
          message:
            '天才学员 + 中期画像混合在纯训练基线（无天赋/道具）下无法在 1e6 次会话内达到 IOI 正赛 recommended_level —— 一周目全通（NG+ 解锁前提）将难以达成，§7.3 的 NG+ 石头（+15）可能名存实亡；需核对 stages.yaml ioi 正赛难度或补终局成长源。',
        });
      } else if (yearsFocused > YEARS_SEVERE) {
        notes.push({
          level: 'severe',
          message: `纯训练基线下达 IOI 正赛约 ${yearsFocused.toFixed(1)} 现实年（70 次/周重度口径）——建议复核 ioi 正赛 recommended_level（当前 ${ioiRow.recommendedLevel}，GAME-DESIGN §6.2 仅要求 ≥90）。`,
        });
      } else if (yearsFocused > YEARS_WARN) {
        notes.push({
          level: 'warn',
          message: `纯训练基线下达 IOI 正赛约 ${yearsFocused.toFixed(1)} 现实年（重度口径）；天赋 meta 与直用书可显著缩短，但终局曲线值得复核。`,
        });
      }
    }

    const report: BalanceReport = {
      generatedAt: new Date().toISOString(),
      gates: {
        canonicalStones: {
          totalAfterThreeLayers: canonicalTotal,
          gdSection73Target,
          pass: canonicalPass,
        },
      },
      targets,
      blends: blends.map((b) => ({ ...b })),
      cadences: [...CADENCES],
      assumptions: [
        '成长口径为纯训练基线：无天赋 meta、无声誉加成、无直用书/赛事实战成长；实际玩家更快。',
        '招募基线 = recruit-gen ATTR_TABLE 期望 E（六维同 E，声誉 0）。',
        '专项题质量倍率按绿色预制题假设（economy.yaml 画像未指定稀有度）。',
        'reached 上限 1e6 次会话 ≈ 274 年（70 次/周），未达即视为不可达。',
        '终局判定以 stages.yaml recommended_level 作 V 阈值代理（与 GAME-DESIGN §6.2 锚点同刻度）。',
      ],
      growth,
      ledger: {
        storyLayer0: { detail: storyLayer0Detail, total: storyLayer0Stones },
        ngPlus: { perLayer: ngPlusPerLayer, layersAssumed },
        canonical: { totalAfterThreeLayers: canonicalTotal, gdSection73Target },
        pvp: {
          defaultPerTournament: 3,
          note: 'M4.6 pvp/rewards.ts DEFAULT_PRIZES：冠军 advance-stone×2 + 亚军 ×1；tag-card 不计石头。',
        },
        events: stoneEventRows,
      },
      demand: {
        costByTargetRarity: stoneCostOrdered,
        singleUpgradePurpleToColorful: purpleToColorful,
        grayChainTotal,
        greenChainMin,
        chains,
        colorfulWithoutChain,
      },
      notes,
    };

    console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : renderText(report));
    return canonicalPass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function fmtDays(days: number): string {
  if (!Number.isFinite(days)) return '∞';
  return days >= 365.25 ? `${(days / 365.25).toFixed(1)}年` : `${Math.round(days)}天`;
}

function renderText(report: BalanceReport): string {
  const lines: string[] = [];
  lines.push('==== T5.2 数值平衡回归报告 ====');
  lines.push('-- 目标关卡（各章正赛；recommended_level 即 V 阈值） --');
  for (const target of report.targets) {
    lines.push(
      `  ${target.stageKey.padEnd(10)} ${target.name.padEnd(4)} V≥${target.recommendedLevel}`,
    );
  }
  lines.push('-- 训练耗时（sessions = 纯训练会话数；days = 日历，两口径） --');
  for (const tier of ['common', 'good', 'elite', 'genius']) {
    lines.push(`[招募基线 ${tier}]`);
    for (const target of report.targets) {
      const cells: string[] = [];
      for (const blend of report.blends) {
        const row = report.growth.find(
          (r) => r.tier === tier && r.stageKey === target.stageKey && r.blend === blend.id,
        );
        if (row === undefined) continue;
        const mark = row.reached ? '' : '（未达会话上限）';
        cells.push(
          `${blend.id}: ${row.sessions} 次 → ${fmtDays(row.daysFocused)} @70/周 | ${fmtDays(row.daysCasual)} @11/周${mark}`,
        );
      }
      lines.push(
        `  V≥${String(target.recommendedLevel).padStart(2)} ${target.stageKey.padEnd(10)} ${cells.join(' | ')}`,
      );
    }
  }
  lines.push('-- 进阶石供给 --');
  lines.push(`  一周目正赛里程碑（含 IOI 传说礼盒内含）: ${report.ledger.storyLayer0.total} 颗`);
  lines.push(
    `  NG+ 每层全通: ${report.ledger.ngPlus.perLayer} 颗 × ${report.ledger.ngPlus.layersAssumed} 层 = ${report.ledger.ngPlus.perLayer * report.ledger.ngPlus.layersAssumed} 颗`,
  );
  lines.push(`  PVP 默认每届（冠军2+亚军1）: ${report.ledger.pvp.defaultPerTournament} 颗`);
  for (const event of report.ledger.events) {
    const serverBit =
      event.expectedStonesPerServerWeek !== null
        ? `；全服周期望 ${event.expectedStonesPerServerWeek.toFixed(2)} 颗`
        : '；无全服限量（按冷却/抽取）';
    lines.push(
      `  事件 ${event.code} ${event.name}(${event.rarity})：单次期望 ${event.expectedStonePerTrigger} 颗${serverBit}`,
    );
  }
  lines.push('-- 彩天赋需求 --');
  for (const chain of report.demand.chains) {
    lines.push(
      `  家族 ${chain.family}（${chain.baseRarity} 起步 → 彩）: ${chain.stonesToColorful} 颗`,
    );
  }
  for (const id of report.demand.colorfulWithoutChain) {
    lines.push(`  ${id}: family=null，不可用升阶石获得（仅随机渠道）`);
  }
  lines.push(
    `  单次紫→彩 ${report.demand.singleUpgradePurpleToColorful} 颗；灰→彩整链 ${report.demand.grayChainTotal} 颗`,
  );
  lines.push('-- 结论 --');
  for (const note of report.notes) lines.push(`  [${note.level}] ${note.message}`);
  return lines.join('\n');
}
