import { Prisma, type Student, type StoryProgress as StoryProgressRow } from '@prisma/client';
import {
  CONFIG_RARITIES,
  frozenSolveHooksSchema,
  normalizeProblemTemplate,
  type ContestRecordView,
  type GrowthDelta,
  type ParticipantSnapshot,
  type ProblemTemplate,
  type QuestionSnapshot,
  type QuestionTraitSnapshot,
  type RankingInput,
  type RankingReport,
  type RewardLine,
  type StageConfig,
  type StoryOverview,
  type StoryProgressView,
  STAGE_CHAPTERS,
} from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createRandomStream, deriveSeed } from '../contest/engine/rng.js';
import {
  buildContestSummary as buildSummary,
  validateRankingReport,
} from '../contest/engine/report.js';
import { simulateRanking } from '../contest/engine/ranking.js';
import { generateNpcPool } from '../contest/npc.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';
import {
  createContestRecord,
  getContestRecordByIdempotency,
  getContestRecordForUser,
  upsertStoryProgress,
} from '../contest/repository.js';

const FULL_CLEAR_BADGE = 'badge-legend';
const FULL_CLEAR_TROPHY = 'trophy-gold';

export interface StoryEntryResult {
  record: ContestRecordView;
  replayed: boolean;
  firstClear: boolean;
}

function requireConfig() {
  const config = getConfig();
  if (config === undefined) throw new Error('[story] CONFIG 未加载');
  return config;
}

function orderedStages(): StageConfig[] {
  const config = requireConfig();
  const chapterOrder = new Map(STAGE_CHAPTERS.map((chapter, index) => [chapter, index]));
  return Object.values(config.stages).sort(
    (left, right) =>
      (chapterOrder.get(left.chapter) ?? 0) - (chapterOrder.get(right.chapter) ?? 0) ||
      left.stage_index - right.stage_index,
  );
}

function stageKey(stage: StageConfig): string {
  return `${stage.chapter}:${stage.stage_index}`;
}

function finalStageKeys(): string[] {
  const lastByChapter = new Map<string, StageConfig>();
  for (const stage of orderedStages()) {
    const current = lastByChapter.get(stage.chapter);
    if (current === undefined || current.stage_index < stage.stage_index) {
      lastByChapter.set(stage.chapter, stage);
    }
  }
  return STAGE_CHAPTERS.map((chapter) => lastByChapter.get(chapter))
    .filter((stage): stage is StageConfig => stage !== undefined)
    .map(stageKey);
}

function rowToProgress(row: StoryProgressRow): StoryProgressView {
  return {
    stageKey: row.stageKey,
    ngLevel: row.ngLevel,
    firstClearAt: row.firstClearAt?.toISOString() ?? null,
    bestRank: row.bestRank,
    clearCount: row.clearCount,
    rewards: row.rewards as unknown as RewardLine[],
    growth: row.growth as unknown as GrowthDelta[],
    ...(row.lastRecordId === null ? {} : { lastReportId: row.lastRecordId }),
    ...(row.lastSummary === null || row.lastSummary === undefined
      ? {}
      : { lastSummary: row.lastSummary as unknown as StoryProgressView['lastSummary'] }),
  };
}

async function hasFullClear(
  userId: number,
  ngLevel: number,
  db: typeof prisma | Prisma.TransactionClient,
): Promise<boolean> {
  const keys = finalStageKeys();
  if (keys.length !== STAGE_CHAPTERS.length) return false;
  const count = await db.storyProgress.count({
    where: { userId, ngLevel, stageKey: { in: keys }, clearCount: { gt: 0 } },
  });
  return count === keys.length;
}

async function maxUnlockedNgLevel(userId: number): Promise<number> {
  const keys = finalStageKeys();
  if (keys.length !== STAGE_CHAPTERS.length) return 0;
  const rows = await prisma.storyProgress.findMany({
    where: { userId, stageKey: { in: keys }, clearCount: { gt: 0 } },
    select: { ngLevel: true, stageKey: true },
  });
  const clearedByLayer = new Map<number, Set<string>>();
  for (const row of rows) {
    const cleared = clearedByLayer.get(row.ngLevel) ?? new Set<string>();
    cleared.add(row.stageKey);
    clearedByLayer.set(row.ngLevel, cleared);
  }
  let unlocked = 0;
  while (keys.every((key) => clearedByLayer.get(unlocked)?.has(key) === true)) unlocked += 1;
  return unlocked;
}

function isStageUnlocked(
  stages: readonly StageConfig[],
  progress: ReadonlyMap<string, StoryProgressRow>,
  stage: StageConfig,
  ngAvailable: boolean,
): boolean {
  if (!ngAvailable) return false;
  if (stage.stage_index > 1) {
    const previous = progress.get(`${stage.chapter}:${stage.stage_index - 1}`);
    return (previous?.clearCount ?? 0) > 0;
  }

  const index = stages.findIndex((candidate) => stageKey(candidate) === stageKey(stage));
  const previousChapter = stages[index - 1]?.chapter;
  if (previousChapter === undefined) return true;
  const previousFinal = stages
    .filter((candidate) => candidate.chapter === previousChapter)
    .sort((left, right) => right.stage_index - left.stage_index)[0];
  return (
    previousFinal !== undefined && (progress.get(stageKey(previousFinal))?.clearCount ?? 0) > 0
  );
}

export async function getStoryOverview(userId: number, ngLevel = 0): Promise<StoryOverview> {
  if (!Number.isInteger(ngLevel) || ngLevel < 0) {
    throw new ApiError('VALIDATION_FAILED', { field: 'ngLevel' });
  }
  const maxUnlocked = await maxUnlockedNgLevel(userId);
  if (ngLevel > maxUnlocked) {
    throw new ApiError('STATE_CONFLICT', {
      resource: 'ngLevel',
      ngLevel,
      reason: 'previous layer is incomplete',
    });
  }
  const stages = orderedStages();
  const rows = await prisma.storyProgress.findMany({ where: { userId, ngLevel } });
  const progress = new Map(rows.map((row) => [row.stageKey, row]));
  const ngAvailable = ngLevel === 0 || (await hasFullClear(userId, ngLevel - 1, prisma));
  if (!ngAvailable) {
    throw new ApiError('STATE_CONFLICT', {
      resource: 'ngLevel',
      ngLevel,
      reason: 'previous layer is incomplete',
    });
  }
  const overviewStages = stages.map((stage) => {
    const row = progress.get(stageKey(stage));
    return {
      stageKey: stageKey(stage),
      ngLevel,
      name: stage.name,
      recommendedLevel: stage.recommended_level,
      durationMin: stage.duration_min,
      staminaCost: requireConfig().stageDefaults.stamina_cost_by_chapter[stage.chapter],
      unlocked: isStageUnlocked(stages, progress, stage, ngAvailable),
      cleared: (row?.clearCount ?? 0) > 0,
      clearCount: row?.clearCount ?? 0,
      bestRank: row?.bestRank ?? null,
      firstClearAt: row?.firstClearAt?.toISOString() ?? null,
    };
  });

  return {
    ngLevel,
    chapters: STAGE_CHAPTERS.map((chapter) => ({
      chapter,
      stages: overviewStages.filter((stage) => stage.stageKey.startsWith(`${chapter}:`)),
    })),
    ngPlusUnlocked: maxUnlocked >= 1,
    maxUnlockedNgLevel: maxUnlocked,
  };
}

export async function getProgress(userId: number, ngLevel?: number): Promise<StoryProgressView[]> {
  if (ngLevel !== undefined && (!Number.isInteger(ngLevel) || ngLevel < 0)) {
    throw new ApiError('VALIDATION_FAILED', { field: 'ngLevel' });
  }
  const rows = await prisma.storyProgress.findMany({
    where: { userId, ...(ngLevel === undefined ? {} : { ngLevel }) },
    orderBy: [{ ngLevel: 'asc' }, { stageKey: 'asc' }],
  });
  return rows.map(rowToProgress);
}

export async function getContestRecord(
  userId: number,
  recordId: string,
): Promise<ContestRecordView> {
  const record = await getContestRecordForUser(userId, recordId);
  if (record === null) throw new ApiError('NOT_FOUND', { resource: 'contestRecord', recordId });
  return record;
}

function studentSnapshot(
  student: Student & { talents: { talentId: string }[] },
): ParticipantSnapshot {
  return {
    side: 'HOME',
    userId: student.userId,
    studentId: student.id,
    displayName: student.name,
    abilities: {
      DS: student.ds,
      DP: student.dp,
      MATH: student.math,
      GRAPH: student.graph,
      GREEDY: student.greedy,
      STRING: student.str,
      CODING: student.code,
      THINKING: student.thinking,
      PROBLEM: student.setting,
    },
    traits: student.talents.map((talent) => ({ traitId: talent.talentId })),
    mindset: student.mindset,
    focusCap: student.focusCap,
    energy: student.energy,
    energyMax: student.energyMax,
  };
}

function templatesForSlot(
  config: ReturnType<typeof requireConfig>,
  slot: StageConfig['problem_slots'][number],
): ProblemTemplate[] {
  return Object.values(config.problems).filter(
    (template) =>
      template.tier === slot.tier && (slot.dims === undefined || slot.dims.includes(template.dim)),
  );
}

function instantiateQuestions(
  stage: StageConfig,
  ngLevel: number,
  seed: number,
): QuestionSnapshot[] {
  const config = requireConfig();
  const random = createRandomStream(seed, 'order');
  const questions: QuestionSnapshot[] = [];
  const usedTemplates = new Set<string>();
  const multiplier = 1 + 0.15 * ngLevel;

  for (const slot of stage.problem_slots) {
    if (slot.chance !== undefined && random() >= slot.chance) continue;
    const templates = templatesForSlot(config, slot);
    if (templates.length === 0) {
      throw new ApiError('STATE_CONFLICT', { stageKey: stageKey(stage), tier: slot.tier });
    }
    for (let offset = 0; offset < slot.count; offset += 1) {
      const unused = templates.filter((template) => !usedTemplates.has(template.id));
      const pool = unused.length > 0 ? unused : templates;
      const template = pool[Math.floor(random() * pool.length)]!;
      usedTemplates.add(template.id);
      const normalized = normalizeProblemTemplate(template);
      questions.push({
        instanceId: `${template.id}@${stageKey(stage)}:ng${ngLevel}#${questions.length}`,
        index: questions.length,
        templateId: template.id,
        tier: template.tier,
        dimension: normalized.dim,
        demand: Math.round(template.requirements.d * multiplier),
        thought: Math.round(template.requirements.m * multiplier),
        codeVolume: Math.round(template.requirements.c * multiplier),
        score: template.score,
        timeLimitMin: template.time_limit_min,
        partialScores: template.partial_scores,
        traits: instantiateTraits(template, ngLevel, random),
        source: 'GENERATED',
      });
    }
  }
  if (questions.length === 0)
    throw new ApiError('STATE_CONFLICT', { stageKey: stageKey(stage), reason: 'no questions' });
  return questions;
}

function instantiateTraits(
  template: ProblemTemplate,
  ngLevel: number,
  random: () => number,
): QuestionTraitSnapshot[] {
  const config = requireConfig();
  const severityRank = new Map(
    ['red', 'yellow', 'blue', 'purple', 'black', 'colorful'].map((severity, index) => [
      severity,
      index,
    ]),
  );
  const highSeverityFloor =
    severityRank.get(config.ngPlus.trait_pool_shift.high_severity_extra.min_severity) ?? 0;
  const weighted = template.trait_pool.flatMap((entry) => {
    const trait = config.problemTraits[entry.trait];
    if (trait === undefined) return [];
    let weight = entry.weight * (1 + 0.1 * ngLevel);
    if ((severityRank.get(trait.severity) ?? 0) >= highSeverityFloor) weight *= 1 + 0.05 * ngLevel;
    return [{ trait, weight }];
  });
  const noTraitWeight = config.problemConventions.implicit_no_trait_weight;
  const totalWeight = weighted.reduce((total, entry) => total + entry.weight, noTraitWeight);
  let roll = random() * totalWeight;
  roll -= noTraitWeight;
  if (roll < 0) return [];
  const selected = weighted.find((entry) => {
    roll -= entry.weight;
    return roll < 0;
  })?.trait;
  if (selected === undefined) return [];
  const hook = frozenSolveHooksSchema.parse({
    ...selected.hooks,
    ...(selected.condition === undefined ? {} : { condition: selected.condition }),
  });
  return [{ traitId: selected.id, severity: selected.severity, hooks: [hook] }];
}

function pickRewardItem(
  stage: StageConfig,
  ngLevel: number,
  random: () => number,
  items: ReturnType<typeof requireConfig>['items'],
): RewardLine | undefined {
  const reward = stage.first_clear.items;
  if (random() >= reward.chance) return undefined;
  const totalWeight = reward.pool.reduce((total, entry) => total + entry.weight, 0);
  let roll = random() * totalWeight;
  const baseRarity = reward.pool.find((entry) => {
    roll -= entry.weight;
    return roll < 0;
  })?.rarity;
  if (baseRarity === undefined) return undefined;
  const shift =
    ngLevel >= requireConfig().ngPlus.item_rarity_shift.from_layer
      ? requireConfig().ngPlus.item_rarity_shift.shift
      : 0;
  const rarityIndex = CONFIG_RARITIES.indexOf(baseRarity);
  const rarity = CONFIG_RARITIES[Math.min(CONFIG_RARITIES.length - 1, rarityIndex + shift)]!;
  const candidates = Object.values(items).filter((item) => item.rarity === rarity);
  const item = candidates[Math.floor(random() * candidates.length)];
  return item === undefined
    ? undefined
    : { type: 'first_clear_item', itemId: item.id, count: reward.count };
}

function buildRewards(
  stage: StageConfig,
  ngLevel: number,
  firstClear: boolean,
  rank: number,
  seed: number,
): RewardLine[] {
  if (!rank || rank > 8) return [];
  const config = requireConfig();
  const rewards: RewardLine[] = [];
  const random = createRandomStream(seed, 'rewards');
  if (firstClear) {
    rewards.push({
      type: 'first_clear_money',
      amount: Math.round(stage.first_clear.money * (1 + 0.5 * ngLevel)),
    });
    const item = pickRewardItem(stage, ngLevel, random, config.items);
    if (item !== undefined) rewards.push(item);
    if (ngLevel === 0) {
      for (const milestone of stage.first_clear.milestone?.items ?? []) {
        rewards.push({ type: 'milestone_item', itemId: milestone.item, count: milestone.count });
      }
    }
  } else {
    const bonus =
      rank === 1
        ? config.ngPlus.repeat_clear_rank_bonus.champion
        : rank === 2
          ? config.ngPlus.repeat_clear_rank_bonus.runner_up
          : rank <= 8
            ? config.ngPlus.repeat_clear_rank_bonus.third_to_eighth
            : config.ngPlus.repeat_clear_rank_bonus.others;
    const chapterBaseMoney =
      orderedStages().find((candidate) => candidate.chapter === stage.chapter)?.first_clear.money ??
      stage.first_clear.money;
    if (bonus > 0)
      rewards.push({
        type: 'rank_bonus_money',
        rank,
        amount: Math.round(chapterBaseMoney * bonus * (1 + 0.5 * ngLevel)),
      });
  }
  return rewards;
}

function growthChance(current: number, base: number): number {
  const fade = Math.max(0, 1 - current / 100) ** 2;
  return base * fade;
}

function buildGrowth(
  report: RankingReport,
  student: Student,
  seed: number,
): { lines: GrowthDelta[]; data: Prisma.StudentUpdateManyMutationInput } {
  const random = createRandomStream(seed, 'growth');
  const lines: GrowthDelta[] = [];
  const counts = {
    ds: 0,
    dp: 0,
    math: 0,
    graph: 0,
    greedy: 0,
    str: 0,
    thinking: 0,
    code: 0,
    focusCap: 0,
    staminaRegen: 0,
  };
  const dimensionField = {
    DS: ['ds', 'ds'],
    DP: ['dp', 'dp'],
    MATH: ['math', 'math'],
    GRAPH: ['graph', 'graph'],
    GREEDY: ['greedy', 'greedy'],
    STRING: ['str', 'string'],
  } as const;

  for (const attempt of report.participants[0]?.attempts ?? []) {
    if (attempt.verdict !== 'AC') continue;
    const question = report.questions.find(
      (entry) => entry.instanceId === attempt.problemInstanceId,
    );
    if (question === undefined) continue;
    const [field, attr] = dimensionField[question.dimension];
    if (student[field] + counts[field] <= 99 && random() < growthChance(student[field], 0.15)) {
      counts[field] += 1;
      lines.push({ attr, delta: 1, sourceProblem: question.instanceId });
    }
  }
  if (student.thinking <= 99 && random() < growthChance(student.thinking, 0.1)) {
    counts.thinking += 1;
    lines.push({ attr: 'thinking', delta: 1 });
  }
  if (student.code <= 99 && random() < growthChance(student.code, 0.1)) {
    counts.code += 1;
    lines.push({ attr: 'code', delta: 1 });
  }
  if (student.focusCap < 100 && random() < 0.005) {
    counts.focusCap += 1;
    lines.push({ attr: 'focus_cap', delta: 1 });
  }
  if (student.staminaRegen < 100 && random() < 0.005) {
    counts.staminaRegen += 1;
    lines.push({ attr: 'stamina_regen', delta: 1 });
  }

  return {
    lines,
    data: {
      ...(counts.ds === 0 ? {} : { ds: { increment: counts.ds } }),
      ...(counts.dp === 0 ? {} : { dp: { increment: counts.dp } }),
      ...(counts.math === 0 ? {} : { math: { increment: counts.math } }),
      ...(counts.graph === 0 ? {} : { graph: { increment: counts.graph } }),
      ...(counts.greedy === 0 ? {} : { greedy: { increment: counts.greedy } }),
      ...(counts.str === 0 ? {} : { str: { increment: counts.str } }),
      ...(counts.thinking === 0 ? {} : { thinking: { increment: counts.thinking } }),
      ...(counts.code === 0 ? {} : { code: { increment: counts.code } }),
      ...(counts.focusCap === 0 ? {} : { focusCap: { increment: counts.focusCap } }),
      ...(counts.staminaRegen === 0 ? {} : { staminaRegen: { increment: counts.staminaRegen } }),
    },
  };
}

async function applyRewards(
  tx: Prisma.TransactionClient,
  userId: number,
  rewards: readonly RewardLine[],
  accountBadge?: string,
): Promise<void> {
  const money = rewards.reduce(
    (total, reward) =>
      total +
      (reward.type === 'first_clear_money' || reward.type === 'rank_bonus_money'
        ? reward.amount
        : 0),
    0,
  );
  if (money > 0)
    await tx.user.update({ where: { id: userId }, data: { money: { increment: money } } });
  for (const reward of rewards) {
    if (reward.type === 'first_clear_item' || reward.type === 'milestone_item') {
      if (reward.itemId.startsWith('badge-ngplus-')) continue;
      await tx.userItem.upsert({
        where: { userId_itemId: { userId, itemId: reward.itemId } },
        create: { userId, itemId: reward.itemId, quantity: reward.count },
        update: { quantity: { increment: reward.count } },
      });
    }
  }
  if (accountBadge !== undefined) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { badges: true },
    });
    const badges = Array.isArray(user.badges)
      ? user.badges.filter((badge): badge is string => typeof badge === 'string')
      : [];
    if (!badges.includes(accountBadge)) {
      await tx.user.update({
        where: { id: userId },
        data: { badges: [...badges, accountBadge] },
      });
    }
  }
}

export async function enterStoryStage(
  userId: number,
  requestedStageKey: string,
  ngLevel: number,
  roster: readonly number[],
  idempotencyKey: string,
  now: Date = new Date(),
): Promise<StoryEntryResult> {
  if (!Number.isInteger(ngLevel) || ngLevel < 0)
    throw new ApiError('VALIDATION_FAILED', { field: 'ngLevel' });
  if (roster.length !== 1 || !Number.isInteger(roster[0]) || roster[0]! <= 0) {
    throw new ApiError('VALIDATION_FAILED', {
      field: 'roster',
      reason: 'exactly one active student is required',
    });
  }
  if (idempotencyKey.length < 1 || idempotencyKey.length > 128) {
    throw new ApiError('VALIDATION_FAILED', { field: 'idempotencyKey' });
  }
  const config = requireConfig();
  const stage = config.stages[requestedStageKey];
  if (stage === undefined)
    throw new ApiError('NOT_FOUND', { resource: 'stage', stageKey: requestedStageKey });

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const replay = await getContestRecordByIdempotency(userId, idempotencyKey, tx);
    if (replay !== null) return { record: replay, replayed: true, firstClear: false };
    await tx.$queryRaw`SELECT id FROM Student WHERE id = ${roster[0]} FOR UPDATE`;
    const student = await tx.student.findUnique({
      where: { id: roster[0] },
      include: { talents: true },
    });
    if (student === null || student.status !== 'ACTIVE')
      throw new ApiError('NOT_FOUND', { resource: 'student', id: roster[0] });
    if (student.userId !== userId)
      throw new ApiError('FORBIDDEN', { resource: 'student', id: roster[0] });
    const settledStudent = settle(
      student,
      aggregateMeta(student.talents.map((talent) => talent.talentId)),
      now,
    );
    const entrant = { ...settledStudent, talents: student.talents };

    const progressRows = await tx.storyProgress.findMany({ where: { userId, ngLevel } });
    const progress = new Map(progressRows.map((row) => [row.stageKey, row]));
    const ngAvailable = ngLevel === 0 || (await hasFullClear(userId, ngLevel - 1, tx));
    if (!isStageUnlocked(orderedStages(), progress, stage, ngAvailable)) {
      throw new ApiError('STATE_CONFLICT', {
        resource: 'stage',
        stageKey: requestedStageKey,
        reason: 'stage is locked',
      });
    }

    const staminaCost = config.stageDefaults.stamina_cost_by_chapter[stage.chapter];
    if (staminaCost === undefined) {
      throw new ApiError('STATE_CONFLICT', { resource: 'stage', stageKey: requestedStageKey });
    }
    if (settledStudent.stamina < staminaCost) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'stamina', need: staminaCost });
    }
    const firstClear = (progress.get(requestedStageKey)?.clearCount ?? 0) === 0;
    const seed = deriveSeed(userId, student.id, requestedStageKey, ngLevel, idempotencyKey);
    const player = studentSnapshot(entrant);
    const input: RankingInput = {
      kind: 'story',
      stageRef: { chapter: stage.chapter, stageIndex: stage.stage_index, ngPlusLayer: ngLevel },
      student: player,
      participants: generateNpcPool(stage, seed),
      problems: instantiateQuestions(stage, ngLevel, seed),
      durationMin: stage.duration_min,
      npcPoolParam: {
        size: stage.npc_pool.size,
        meanLevel: stage.npc_pool.mean_level,
        spread: stage.npc_pool.spread,
      },
      firstClearAvailable: firstClear,
    };
    const initialReport = simulateRanking(input, seed);
    const rank =
      initialReport.standings.find((standing) => standing.participantIndex === 0)?.rank ??
      Number.POSITIVE_INFINITY;
    let rewards = buildRewards(stage, ngLevel, firstClear, rank, seed);
    const completedFinals = new Set(
      (
        await tx.storyProgress.findMany({
          where: { userId, ngLevel, stageKey: { in: finalStageKeys() }, clearCount: { gt: 0 } },
          select: { stageKey: true },
        })
      ).map((row) => row.stageKey),
    );
    if (initialReport.pass) completedFinals.add(requestedStageKey);
    const finalKeys = finalStageKeys();
    const layerFullClear =
      initialReport.pass &&
      finalKeys.includes(requestedStageKey) &&
      finalKeys.length === STAGE_CHAPTERS.length &&
      finalKeys.every((key) => completedFinals.has(key));
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { badges: true },
    });
    const layerBadge =
      ngLevel === 0
        ? FULL_CLEAR_BADGE
        : config.ngPlus.layer_badge.item_id_template.replace('{k}', String(ngLevel));
    const alreadyFullClear = Array.isArray(user.badges) && user.badges.includes(layerBadge);
    if (layerFullClear && !alreadyFullClear) {
      if (ngLevel === 0) {
        rewards = [
          ...rewards,
          { type: 'first_clear_money', amount: config.fullClear.money },
          ...config.fullClear.items.map((item): RewardLine => ({
            type: 'first_clear_item',
            itemId: item.item,
            count: item.count,
          })),
          { type: 'first_clear_item', itemId: FULL_CLEAR_TROPHY, count: 1 },
        ];
      } else {
        rewards = [
          ...rewards,
          {
            type: 'milestone_item',
            itemId: 'advance-stone',
            count: config.ngPlus.advance_stone_per_layer_clear,
          },
          {
            type: 'milestone_item',
            itemId: layerBadge,
            count: config.ngPlus.layer_badge.count,
          },
        ];
      }
    }

    const growth = buildGrowth(initialReport, settledStudent, seed);
    const report: RankingReport = validateRankingReport({
      ...initialReport,
      rewards,
      growth: growth.lines,
    });
    const timeline = report.participants[0];
    const energyAfter =
      timeline?.attempts.at(-1)?.resolution.energyAfter ?? player.energy ?? player.energyMax;
    const updatedStudent = await tx.student.updateMany({
      where: { id: student.id, userId, status: 'ACTIVE', updatedAt: student.updatedAt },
      data: {
        ...growth.data,
        stamina: settledStudent.stamina - staminaCost,
        energy: energyAfter,
        mindset: timeline?.finalMindset ?? settledStudent.mindset,
        lastSettledAt: now,
      },
    });
    if (updatedStudent.count !== 1) throw new ApiError('STATE_CONFLICT', { studentId: student.id });
    await applyRewards(
      tx,
      userId,
      rewards,
      layerFullClear && !alreadyFullClear ? layerBadge : undefined,
    );
    const summary = buildSummary(report);
    const record = await createContestRecord(
      {
        userId,
        type: 'STORY',
        format: 'RANKING',
        stageKey: requestedStageKey,
        ngLevel,
        idempotencyKey,
        inputSnapshot: report.inputSnapshot,
        report,
        summary,
        rewards,
        snapshotHash: report.snapshotHash,
        createdAt: now,
      },
      tx,
    );
    if (report.pass) {
      await upsertStoryProgress(
        {
          userId,
          ngLevel,
          stageKey: requestedStageKey,
          firstClearAt: progress.get(requestedStageKey)?.firstClearAt ?? now,
          bestRank: Math.min(
            progress.get(requestedStageKey)?.bestRank ?? Number.POSITIVE_INFINITY,
            rank,
          ),
          clearCount: (progress.get(requestedStageKey)?.clearCount ?? 0) + 1,
          rewards,
          growth: growth.lines,
          lastRecordId: record.id,
          lastSummary: summary,
        },
        tx,
      );
    }
    return { record, replayed: false, firstClear: firstClear && report.pass };
  });
}
