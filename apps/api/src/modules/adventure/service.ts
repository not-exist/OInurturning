import { randomInt } from 'node:crypto';
import { Prisma, type AdventureLog, type Student } from '@prisma/client';
import {
  type ConfigRarity,
  type DuelInput,
  type DuelReport,
  type EventChoice,
  type EventConfig,
  type EventOutcome,
  type ParticipantSnapshot,
  type QuestionSnapshot,
} from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { dayKey, weekKey } from '../../lib/clock.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createRandomStream } from '../contest/engine/rng.js';
import { deriveStreamSeed } from '../contest/engine/rng.js';
import { simulateDuel } from '../contest/engine/duel.js';
import { generateDuelOpponent, type DuelOpponentKind } from '../contest/npc.js';
import { createContestRecord } from '../contest/repository.js';
import { aggregateMeta } from '../students/meta.js';
import { settle } from '../students/settle.js';
import {
  drawAdventureEvent,
  type AdventureEventDrawContext,
  type AdventureStaminaCost,
} from './extractor.js';

type JsonRecord = Record<string, unknown>;

export interface AdventureChoiceInput {
  action?: 'accept' | 'avoid';
  optionIndex?: number;
  skill?: string;
}

export interface AdventureChoiceView {
  index: number;
  text: string;
  available: boolean;
  requiresItem?: string;
  costMoney?: number;
}

export interface AdventureEventView {
  id: string;
  code: string;
  name: string;
  category: EventConfig['category'];
  rarity: ConfigRarity;
  staminaCost: AdventureStaminaCost;
  description: string;
  choices: AdventureChoiceView[] | null;
}

export interface AdventureLogView {
  id: number;
  studentId: number | null;
  contestRecordId: string | null;
  tier: AdventureStaminaCost;
  status: 'PENDING' | 'RESOLVED';
  preview: boolean;
  event: AdventureEventView;
  choices: number[];
  results: unknown[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdventureChoiceResult {
  adventure: AdventureLogView;
  completed: boolean;
}

const STAT_FIELDS = {
  ds: 'ds',
  dp: 'dp',
  math: 'math',
  graph: 'graph',
  greedy: 'greedy',
  string: 'str',
  code: 'code',
  thinking: 'thinking',
  setting: 'setting',
} as const;

const SIX_FIELDS = ['ds', 'dp', 'math', 'graph', 'greedy', 'str'] as const;
type StatField = (typeof STAT_FIELDS)[keyof typeof STAT_FIELDS];

function requireConfig() {
  const config = getConfig();
  if (config === undefined) throw new Error('[adventure] CONFIG 未加载');
  return config;
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown, random: () => number, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const range = record(value);
  if (
    typeof range.min === 'number' &&
    Number.isFinite(range.min) &&
    typeof range.max === 'number' &&
    Number.isFinite(range.max) &&
    range.max >= range.min
  ) {
    return range.min + Math.floor(random() * (range.max - range.min + 1));
  }
  throw new ApiError('STATE_CONFLICT', { resource: 'adventure', field, reason: 'invalid reward value' });
}

function weightedPick<T>(entries: readonly { value: T; weight: number }[], random: () => number): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'empty outcome pool' });
  let roll = random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries[entries.length - 1]!.value;
}

function outcomeSupported(outcome: EventOutcome): boolean {
  const raw = outcome as unknown as JsonRecord;
  if (outcome.type === 'duel') {
    const duel = record(raw.duel);
    return (
      typeof duel.opponent === 'string' &&
      duel.rounds === 4 &&
      typeof duel.quality_rule === 'boolean' &&
      typeof duel.tiebreak === 'string' &&
      ![raw.rewards_win, raw.rewards_lose, raw.rewards_draw].some(unsupportedRewards)
    );
  }
  if (outcome.type === 'check') {
    const check = record(raw.check);
    if (check.kind !== undefined && check.kind !== 'single') return false;
    if (typeof check.skill !== 'string' || typeof check.dc !== 'number') return false;
  }
  if (unsupportedRewards(raw.rewards) || unsupportedRewards(raw.rewards_success) || unsupportedRewards(raw.rewards_fail)) {
    return false;
  }
  return true;
}

function unsupportedRewards(rewards: unknown): boolean {
  const value = record(rewards);
  if (['lecture', 'recruit'].some((key) => key in value)) return true;
  if (value.target_student !== undefined && value.target_student !== 'participant') return true;
  return 'chosen_skill' in record(value.stat_gain);
}

function choiceSupported(choice: EventChoice): boolean {
  return choice.outcomes.every(outcomeSupported);
}

function choiceView(choice: EventChoice, index: number): AdventureChoiceView {
  return {
    index,
    text: choice.text,
    available: choiceSupported(choice),
    ...(choice.requires_item === undefined ? {} : { requiresItem: choice.requires_item }),
    ...(choice.cost_money === undefined ? {} : { costMoney: choice.cost_money }),
  };
}

function eventView(event: EventConfig, revealChoices: boolean): AdventureEventView {
  return {
    id: event.id,
    code: event.code,
    name: event.name,
    category: event.category,
    rarity: event.rarity,
    staminaCost: event.stamina_cost,
    description: event.description,
    choices: revealChoices ? event.choices.map(choiceView) : null,
  };
}

function resultPhase(log: AdventureLog): string | undefined {
  const last = array(log.results).at(-1);
  const phase = record(last).phase;
  return typeof phase === 'string' ? phase : undefined;
}

function isAvoided(log: { status: string; results: Prisma.JsonValue }): boolean {
  return log.status === 'RESOLVED' && record(array(log.results).at(-1)).status === 'AVOIDED';
}

function toLogView(log: AdventureLog, event: EventConfig, revealChoices: boolean): AdventureLogView {
  const tier = log.tier as AdventureStaminaCost;
  return {
    id: log.id,
    studentId: log.studentId,
    contestRecordId: log.contestRecordId,
    tier,
    status: log.status,
    preview: resultPhase(log) === 'PREVIEW',
    event: eventView(event, revealChoices),
    choices: array(log.choices).filter((value): value is number => typeof value === 'number'),
    results: array(log.results),
    createdAt: log.createdAt.toISOString(),
    resolvedAt: log.resolvedAt?.toISOString() ?? null,
  };
}

async function lockStudent(
  tx: Prisma.TransactionClient,
  userId: number,
  studentId: number,
  now: Date,
): Promise<{ current: Student & { talents: { talentId: string }[] }; settled: Student }> {
  await tx.$queryRaw`SELECT id FROM Student WHERE id = ${studentId} FOR UPDATE`;
  const current = await tx.student.findUnique({ where: { id: studentId }, include: { talents: true } });
  if (current === null || current.status !== 'ACTIVE') {
    throw new ApiError('NOT_FOUND', { resource: 'student', id: studentId });
  }
  if (current.userId !== userId) throw new ApiError('FORBIDDEN', { resource: 'student', id: studentId });
  const settled = settle(current, aggregateMeta(current.talents.map((talent) => talent.talentId)), now);
  return { current, settled };
}

async function persistStudentSettlement(
  tx: Prisma.TransactionClient,
  current: Student,
  settled: Student,
  stamina?: number,
  energy?: number,
  mindset?: number,
  extra?: Prisma.StudentUpdateManyMutationInput,
): Promise<void> {
  const updated = await tx.student.updateMany({
    where: { id: current.id, updatedAt: current.updatedAt },
    data: {
      stamina: stamina ?? settled.stamina,
      energy: energy ?? settled.energy,
      mindset: mindset ?? settled.mindset,
      lastSettledAt: settled.lastSettledAt,
      ...extra,
    },
  });
  if (updated.count !== 1) throw new ApiError('STATE_CONFLICT', { studentId: current.id });
}

async function claimWeeklyLimit(
  tx: Prisma.TransactionClient,
  event: EventConfig,
  now: Date,
): Promise<void> {
  if (event.server_weekly_limit === undefined) return;
  const currentWeek = weekKey(now);
  await tx.adventureWeeklyUsage.upsert({
    where: { eventId_weekKey: { eventId: event.id, weekKey: currentWeek } },
    create: { eventId: event.id, weekKey: currentWeek },
    update: {},
  });
  const claimed = await tx.adventureWeeklyUsage.updateMany({
    where: { eventId: event.id, weekKey: currentWeek, count: { lt: event.server_weekly_limit } },
    data: { count: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    throw new ApiError('STATE_CONFLICT', { resource: event.id, reason: 'weekly event limit reached' });
  }
}

async function drawContext(
  tx: Prisma.TransactionClient,
  userId: number,
  student: Student & { talents: { talentId: string }[] },
  investment: AdventureStaminaCost,
  now: Date,
): Promise<AdventureEventDrawContext> {
  const [user, logs, weekly] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { reputation: true } }),
    tx.adventureLog.findMany({
      where: { userId },
      select: { eventId: true, studentId: true, status: true, results: true, createdAt: true },
    }),
    tx.adventureWeeklyUsage.findMany({ where: { weekKey: weekKey(now) } }),
  ]);
  const lastTriggeredAtByEvent = new Map<string, Date>();
  const oncePerStudentEventIds = new Set<string>();
  for (const log of logs) {
    if (isAvoided(log)) continue;
    const previous = lastTriggeredAtByEvent.get(log.eventId);
    if (previous === undefined || previous < log.createdAt) lastTriggeredAtByEvent.set(log.eventId, log.createdAt);
    if (log.studentId === student.id) oncePerStudentEventIds.add(log.eventId);
  }
  return {
    availableStamina: student.stamina,
    investment,
    reputation: user.reputation,
    sixMax: Math.max(student.ds, student.dp, student.math, student.graph, student.greedy, student.str),
    now,
    lastTriggeredAtByEvent,
    oncePerStudentEventIds,
    weeklyUsageByEvent: new Map(weekly.map((row) => [row.eventId, row.count])),
    rng: createRandomStream(randomInt(0, 2_147_483_647), 'draw'),
  };
}

export async function drawAdventure(
  userId: number,
  studentId: number,
  investment: AdventureStaminaCost,
  now: Date = new Date(),
): Promise<AdventureLogView> {
  if (![1, 2, 3].includes(investment)) {
    throw new ApiError('VALIDATION_FAILED', { field: 'tier', reason: 'must be 1, 2, or 3' });
  }
  const config = requireConfig();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const pending = await tx.adventureLog.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending !== null) {
      throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'pending adventure exists' });
    }
    const { current, settled } = await lockStudent(tx, userId, studentId, now);
    if (settled.stamina < investment) {
      throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'stamina', need: investment });
    }
    const context = await drawContext(tx, userId, { ...current, stamina: settled.stamina }, investment, now);
    const event = drawAdventureEvent(
      Object.values(config.events).filter((candidate) => candidate.choices.some(choiceSupported)),
      context,
    );
    if (event === null) {
      throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'no eligible event' });
    }
    const seed = randomInt(0, 2_147_483_647);
    const preview = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { adventureIntelReady: true },
    });
    if (!preview.adventureIntelReady) {
      await claimWeeklyLimit(tx, event, now);
      await persistStudentSettlement(tx, current, settled, settled.stamina - investment);
    }
    const log = await tx.adventureLog.create({
      data: {
        userId,
        studentId,
        eventId: event.id,
        tier: investment,
        seed,
        choices: [],
        results: preview.adventureIntelReady ? [{ phase: 'PREVIEW' }] : [],
      },
    });
    return toLogView(log, event, !preview.adventureIntelReady);
  });
}

function skillScore(student: Student, skill: string, meta: Record<string, number>): number {
  let base: number;
  if (skill === 'six_max') {
    base = Math.max(student.ds, student.dp, student.math, student.graph, student.greedy, student.str);
  } else if (skill === 'mindset') {
    base = student.mindset;
  } else {
    const field = STAT_FIELDS[skill as keyof typeof STAT_FIELDS];
    if (field === undefined) {
      throw new ApiError('STATE_CONFLICT', { resource: 'check', skill, reason: 'unknown skill' });
    }
    base = student[field];
  }
  const flat = meta[`${skill}_flat`] ?? 0;
  const percent = meta[`${skill}_percent`] ?? 0;
  return base + flat + (base * percent) / 100;
}

function rewardObject(outcome: JsonRecord): JsonRecord {
  const unsupported = ['lecture', 'recruit'];
  const rewards = record(outcome.rewards);
  const found = [...unsupported, 'duel'].find((key) => key in rewards);
  if (found !== undefined) {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: `reward ${found} is not implemented` });
  }
  if (rewards.target_student !== undefined && rewards.target_student !== 'participant') {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'non-actor target is not implemented' });
  }
  return rewards;
}

function resolveCheck(
  outcome: JsonRecord,
  student: Student,
  meta: Record<string, number>,
  random: () => number,
): { rewards: JsonRecord; check: JsonRecord } {
  const check = record(outcome.check);
  if (check.kind !== undefined && check.kind !== 'single') {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'compound check is not implemented' });
  }
  const skill = typeof check.skill === 'string' ? check.skill : undefined;
  const dc = typeof check.dc === 'number' ? check.dc : undefined;
  if (skill === undefined || dc === undefined) {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'invalid check definition' });
  }
  const score = skillScore(student, skill, meta);
  const margin = score - dc;
  const probability = 1 / (1 + Math.exp(-margin / 12));
  const success = random() < probability;
  let rewards = success ? record(outcome.rewards_success) : record(outcome.rewards_fail);
  if (success && Array.isArray(outcome.grades)) {
    const grade = outcome.grades.find((entry) => {
      const candidate = record(entry);
      return typeof candidate.margin_min === 'number' && margin >= candidate.margin_min;
    });
    if (grade !== undefined) rewards = record(record(grade).rewards);
  }
  return {
    rewards,
    check: { skill, dc, score, margin, probability, success },
  };
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

const DUEL_DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;

function studentParticipant(
  student: Student & { talents?: { talentId: string }[] },
  side: 'HOME' | 'AWAY',
): ParticipantSnapshot {
  return {
    side,
    userId: side === 'HOME' ? student.userId : null,
    studentId: side === 'HOME' ? student.id : null,
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
    traits: (student.talents ?? []).map((talent) => ({ traitId: talent.talentId })),
    mindset: student.mindset,
    focusCap: student.focusCap,
    energy: student.energy,
    energyMax: student.energyMax,
  };
}

function duelTiebreak(value: unknown): DuelInput['tiebreak'] {
  const modes: Record<string, NonNullable<DuelInput['tiebreak']>> = {
    sudden_death: 'SUDDEN_DEATH',
    by_energy: 'ENERGY',
    by_quality: 'QUALITY',
    friendly: 'FRIENDLY',
  };
  if (typeof value !== 'string' || modes[value] === undefined) {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'invalid duel tiebreak' });
  }
  return modes[value];
}

function duelQuestions(
  home: ParticipantSnapshot,
  away: ParticipantSnapshot,
  seed: number,
): QuestionSnapshot[] {
  const random = createRandomStream(deriveStreamSeed(seed, 'questions'), 'duel');
  return Array.from({ length: 4 }, (_, index) => {
    const setter = index % 2 === 0 ? home : away;
    const dimension = DUEL_DIMENSIONS[
      Math.max(
        0,
        DUEL_DIMENSIONS.reduce(
          (best, key, position) =>
            setter.abilities[key] > setter.abilities[DUEL_DIMENSIONS[best]!] ? position : best,
          0,
        ),
      )
    ]!;
    const setting = setter.abilities.PROBLEM;
    const dimensionValue = setter.abilities[dimension];
    const thinking = setter.abilities.THINKING;
    const demand = clamp(Math.round(setting + (random() * 2 - 1) * 3), 5, 98);
    const thought = clamp(Math.round(setting * 0.92 + (random() * 2 - 1) * 3), 5, 98);
    const codeVolume = clamp(Math.round(setting * 0.85 + (random() * 2 - 1) * 3), 3, 98);
    const quality = clamp(Math.round(0.5 * setting + 0.3 * dimensionValue + 0.2 * thinking), 1, 100);
    const timeLimitMin = clamp(Math.round(0.8 * demand + 0.6 * thought + 0.4 * codeVolume), 45, 160);
    return {
      instanceId: `adventure-duel:${seed}:round:${index + 1}`,
      index,
      tier: 'cspj',
      dimension,
      demand,
      thought,
      codeVolume,
      score: quality,
      quality,
      timeLimitMin,
      partialScores: false,
      traits: [],
      source: 'GENERATED',
    };
  });
}

function duelInput(
  student: Student & { talents?: { talentId: string }[] },
  duel: JsonRecord,
  seed: number,
): DuelInput {
  const opponent = duel.opponent;
  const kinds: readonly DuelOpponentKind[] = [
    'random_common',
    'random_skilled',
    'random_elite',
    'platform_reviewer',
    'legendary_ghost',
  ];
  if (typeof opponent !== 'string' || !kinds.includes(opponent as DuelOpponentKind)) {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'unknown duel opponent' });
  }
  const params = record(duel.opponent_params);
  const powerMultiplier = typeof params.power_mult === 'number' ? params.power_mult : 1;
  const home = studentParticipant(student, 'HOME');
  const away = generateDuelOpponent(
    opponent as DuelOpponentKind,
    deriveStreamSeed(seed, 'opponent'),
    powerMultiplier,
  );
  return {
    home,
    away,
    questions: duelQuestions(home, away, seed),
    qualityRuleOn: duel.quality_rule === true,
    tiebreak: duelTiebreak(duel.tiebreak),
  };
}

function playerDuelState(report: DuelReport, settled: Student): { energy: number; mindset: number } {
  const initialEnergy = report.inputSnapshot.home.energy ?? report.inputSnapshot.home.energyMax;
  const spent = report.rounds
    .filter((round) => round.answererSide === 'HOME')
    .reduce((total, round) => total + round.energyCost, 0);
  const mindsetDelta = report.rounds
    .filter((round) => round.answererSide === 'HOME')
    .reduce((total, round) => total + round.answererMindsetDelta, 0);
  return {
    energy: clamp(initialEnergy - spent, 0, settled.energyMax),
    mindset: clamp(settled.mindset + mindsetDelta, -10, 10),
  };
}

async function priorWinStreak(
  tx: Prisma.TransactionClient,
  userId: number,
  eventId: string,
  now: Date,
): Promise<number> {
  const rows = await tx.adventureLog.findMany({
    where: { userId, eventId, status: 'RESOLVED', createdAt: { gte: new Date(now.getTime() - 8 * 86_400_000) } },
    orderBy: { createdAt: 'desc' },
    select: { results: true, createdAt: true },
  });
  let streak = 0;
  for (const row of rows) {
    if (dayKey(row.createdAt) !== dayKey(now)) continue;
    const result = record(array(row.results).at(-1));
    if (result.duelWinnerSide !== 'HOME') break;
    streak += 1;
  }
  return streak;
}

function rewardItemId(
  rawId: string,
  rarity: ConfigRarity | undefined,
  random: () => number,
): string {
  const config = requireConfig();
  if (rawId !== 'dim-book') {
    if (!config.items[rawId]) throw new ApiError('STATE_CONFLICT', { resource: 'item', itemId: rawId });
    return rawId;
  }
  const candidates = Object.values(config.items).filter(
    (item) =>
      item.id.startsWith('book-') &&
      ['ds', 'dp', 'math', 'graph', 'greedy', 'string'].some((dimension) => item.id.startsWith(`book-${dimension}-`)) &&
      (rarity === undefined || item.rarity === rarity),
  );
  const item = candidates[Math.floor(random() * candidates.length)];
  if (item === undefined) throw new ApiError('STATE_CONFLICT', { resource: 'item', itemId: rawId });
  return item.id;
}

function applyStatGain(
  rewards: JsonRecord,
  student: Student,
  random: () => number,
  chosenSkill?: string,
): { values: Partial<Record<StatField, number>>; mindset: number } {
  const raw = record(rewards.stat_gain);
  const values: Partial<Record<StatField, number>> = {};
  let mindset = student.mindset;
  for (const [key, rawValue] of Object.entries(raw)) {
    const value = numberValue(rawValue, random, `stat_gain.${key}`);
    if (key === 'mindset') {
      mindset = Math.min(10, Math.max(-10, mindset + value));
      continue;
    }
    if (key === 'all_six') {
      for (const field of SIX_FIELDS) values[field] = Math.min(100, Math.max(1, (student[field] as number) + value));
      continue;
    }
    if (key === 'chosen_skill') {
      if (chosenSkill === undefined || !(chosenSkill in STAT_FIELDS)) {
        throw new ApiError('VALIDATION_FAILED', { field: 'skill', reason: 'choose a valid student skill' });
      }
      const field = STAT_FIELDS[chosenSkill as keyof typeof STAT_FIELDS];
      values[field] = Math.min(100, Math.max(1, (student[field] as number) + value));
      continue;
    }
    const field = STAT_FIELDS[key as keyof typeof STAT_FIELDS];
    if (field === undefined) throw new ApiError('STATE_CONFLICT', { resource: 'stat', stat: key });
    values[field] = Math.min(100, Math.max(1, (student[field] as number) + value));
  }
  return { values, mindset };
}

const BANK_DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;

function problemRarity(quality: number): string {
  if (quality < 30) return 'gray';
  if (quality < 50) return 'yellow';
  if (quality < 70) return 'green';
  if (quality < 85) return 'blue';
  if (quality < 95) return 'purple';
  return 'colorful';
}

async function addBankProblems(
  tx: Prisma.TransactionClient,
  userId: number,
  studentId: number,
  event: EventConfig,
  bank: JsonRecord,
  sourceQuestion: QuestionSnapshot | undefined,
  random: () => number,
  now: Date,
): Promise<Prisma.InputJsonValue[]> {
  const sourceQuality = sourceQuestion?.quality ?? sourceQuestion?.score;
  const qualityMultiplier = bank.quality_mult;
  const count = bank.count === undefined ? 1 : numberValue(bank.count, random, 'bank_add.count');
  if (!Number.isInteger(count) || count < 1) {
    throw new ApiError('STATE_CONFLICT', { resource: 'adventure', field: 'bank_add.count' });
  }
  const available = await tx.problemLibraryEntry.count({ where: { userId, consumedAt: null } });
  if (available + count > 120) {
    throw new ApiError('STATE_CONFLICT', { resource: 'problemLibrary', reason: 'capacity reached' });
  }
  const lines: Prisma.InputJsonValue[] = [];
  for (let index = 0; index < count; index += 1) {
    const quality =
      typeof qualityMultiplier === 'number'
        ? Math.min(100, Math.max(0, Math.round((sourceQuality ?? 0) * qualityMultiplier)))
        : Math.min(100, Math.max(0, Math.round(numberValue(bank.quality, random, 'bank_add.quality'))));
    const dimension = sourceQuestion?.dimension ?? BANK_DIMENSIONS[Math.floor(random() * BANK_DIMENSIONS.length)]!;
    const row = await tx.problemLibraryEntry.create({
      data: {
        userId,
        authorStudentId: studentId,
        name: `${event.code}·历练成品·${index + 1}`,
        dominantDim: dimension,
        rarity: problemRarity(quality),
        quality,
        traitId: sourceQuestion?.traits[0]?.traitId ?? null,
        createdAt: now,
      },
    });
    lines.push({ type: 'bank_problem', problemId: row.id, quality, dimension });
  }
  return lines;
}

async function resolveRewards(
  tx: Prisma.TransactionClient,
  userId: number,
  student: Student,
  settled: Student,
  event: EventConfig,
  choice: EventChoice,
  outcome: EventOutcome,
  now: Date,
  random: () => number,
  chosenSkill?: string,
  bankSourceQuestion?: QuestionSnapshot,
  winStreak = 0,
): Promise<{ rewardLines: Prisma.InputJsonValue[]; studentData: Prisma.StudentUpdateManyMutationInput }> {
  const outcomeRecord = outcome as unknown as JsonRecord;
  const rewardObjectValue = rewardObject(outcomeRecord);
  const rewardLines: Prisma.InputJsonValue[] = [];
  const stat = applyStatGain(rewardObjectValue, settled, random, chosenSkill);
  const studentData: Prisma.StudentUpdateManyMutationInput = {
    ...stat.values,
    mindset: stat.mindset,
  };
  const energyCost = rewardObjectValue.energy_cost;
  const energyAfter =
    energyCost === undefined
      ? settled.energy
      : settled.energy - numberValue(energyCost, random, 'energy_cost');
  if (energyAfter < 0) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'energy', need: settled.energy - energyAfter });
  studentData.energy = energyAfter;

  const moneyBase = rewardObjectValue.money === undefined ? 0 : numberValue(rewardObjectValue.money, random, 'money');
  const streak = record(rewardObjectValue.win_streak_bonus);
  const streakExtra =
    winStreak > 0 && typeof streak.per_win_extra_money === 'number' && typeof streak.cap === 'number'
      ? Math.min(streak.cap, streak.per_win_extra_money * winStreak)
      : 0;
  const money = moneyBase + streakExtra;
  const reputation =
    rewardObjectValue.reputation === undefined
      ? 0
      : numberValue(rewardObjectValue.reputation, random, 'reputation');
  const netMoney = -(choice.cost_money ?? 0) + money;
  if (netMoney !== 0) {
    const changed = await tx.user.updateMany({
      where: { id: userId, ...(netMoney < 0 ? { money: { gte: -netMoney } } : {}) },
      data: netMoney > 0 ? { money: { increment: netMoney } } : { money: { decrement: -netMoney } },
    });
    if (changed.count !== 1) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'money', need: -netMoney });
    rewardLines.push({ type: 'money', amount: netMoney });
  }
  if (streakExtra > 0) rewardLines.push({ type: 'win_streak_bonus', amount: streakExtra, streak: winStreak });
  if (reputation !== 0) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { reputation: true } });
    const next = Math.max(0, user.reputation + reputation);
    await tx.user.update({ where: { id: userId }, data: { reputation: next } });
    await tx.reputationLog.create({ data: { userId, delta: next - user.reputation, reason: `EVENT:${event.id}` } });
    rewardLines.push({ type: 'reputation', amount: next - user.reputation });
  }

  const consume = choice.consume;
  if (consume !== undefined) {
    const quantity = consume.qty;
    const consumed = await tx.userItem.updateMany({
      where: { userId, itemId: consume.item, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (consumed.count !== 1) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: consume.item, need: quantity });
    await tx.userItem.deleteMany({ where: { userId, itemId: consume.item, quantity: { lte: 0 } } });
    rewardLines.push({ type: 'consume_item', itemId: consume.item, count: quantity });
  }

  if (Array.isArray(rewardObjectValue.items)) {
    for (const entry of rewardObjectValue.items) {
      const item = record(entry);
      const probability = item.prob === undefined ? 1 : numberValue(item.prob, random, 'items.prob');
      if (random() >= probability) continue;
      const itemId = rewardItemId(
        typeof item.id === 'string' ? item.id : '',
        typeof item.rarity === 'string' ? (item.rarity as ConfigRarity) : undefined,
        random,
      );
      const count = numberValue(item.qty ?? 1, random, 'items.qty');
      await tx.userItem.upsert({
        where: { userId_itemId: { userId, itemId } },
        create: { userId, itemId, quantity: count },
        update: { quantity: { increment: count } },
      });
      rewardLines.push({ type: 'item', itemId, count });
    }
  }
  if (rewardObjectValue.bank_add !== undefined) {
    rewardLines.push(
      ...(await addBankProblems(
        tx,
        userId,
        student.id,
        event,
        record(rewardObjectValue.bank_add),
        bankSourceQuestion,
        random,
        now,
      )),
    );
  }
  if (Object.keys(record(rewardObjectValue.buffs)).length > 0 || Array.isArray(rewardObjectValue.buffs)) {
    const buffs = Array.isArray(rewardObjectValue.buffs) ? rewardObjectValue.buffs : [rewardObjectValue.buffs];
    const existing = array(record(student.counters).adventureBuffs);
    studentData.counters = {
      ...record(student.counters),
      adventureBuffs: [...existing, ...buffs.map((buff) => ({ ...record(buff), appliedAt: now.toISOString() }))],
    } as Prisma.InputJsonValue;
    rewardLines.push(...buffs.map((buff) => ({ type: 'buff', ...record(buff) })) as Prisma.InputJsonValue[]);
  }
  return { rewardLines, studentData };
}

export async function chooseAdventure(
  userId: number,
  adventureId: number,
  input: AdventureChoiceInput,
  now: Date = new Date(),
): Promise<AdventureChoiceResult> {
  const config = requireConfig();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM AdventureLog WHERE id = ${adventureId} FOR UPDATE`;
    const log = await tx.adventureLog.findUnique({ where: { id: adventureId } });
    if (log === null || log.userId !== userId) throw new ApiError('NOT_FOUND', { resource: 'adventure', id: adventureId });
    const event = config.events[log.eventId];
    if (event === undefined) throw new ApiError('STATE_CONFLICT', { resource: 'event', eventId: log.eventId });
    if (log.status === 'RESOLVED') {
      return { adventure: toLogView(log, event, true), completed: true };
    }

    const preview = resultPhase(log) === 'PREVIEW';
    if (preview && input.action === 'avoid') {
      await tx.user.update({ where: { id: userId }, data: { adventureIntelReady: false } });
      const resolved = await tx.adventureLog.update({
        where: { id: adventureId },
        data: { status: 'RESOLVED', results: [{ status: 'AVOIDED' }], resolvedAt: now },
      });
      return { adventure: toLogView(resolved, event, true), completed: true };
    }
    if (preview && input.action === 'accept') {
      if (log.studentId === null) throw new ApiError('STATE_CONFLICT', { resource: 'student', reason: 'actor dismissed' });
      const { current, settled } = await lockStudent(tx, userId, log.studentId, now);
      if (settled.stamina < log.tier) {
        throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'stamina', need: log.tier });
      }
      await claimWeeklyLimit(tx, event, now);
      await persistStudentSettlement(tx, current, settled, settled.stamina - log.tier);
      await tx.user.update({ where: { id: userId }, data: { adventureIntelReady: false } });
      const accepted = await tx.adventureLog.update({
        where: { id: adventureId },
        data: { results: [{ phase: 'ACCEPTED' }] },
      });
      return { adventure: toLogView(accepted, event, true), completed: false };
    }
    if (input.optionIndex === undefined || !Number.isInteger(input.optionIndex)) {
      throw new ApiError('VALIDATION_FAILED', { field: 'optionIndex' });
    }
    if (preview) throw new ApiError('STATE_CONFLICT', { resource: 'adventure', reason: 'accept preview first' });
    const choice = event.choices[input.optionIndex];
    if (choice === undefined) throw new ApiError('VALIDATION_FAILED', { field: 'optionIndex' });
    if (choice.requires_item !== undefined) {
      const held = await tx.userItem.findUnique({ where: { userId_itemId: { userId, itemId: choice.requires_item } } });
      if (!held || held.quantity < 1) {
        throw new ApiError('INSUFFICIENT_RESOURCE', { resource: choice.requires_item, need: 1 });
      }
    }
    if (choice.cost_money !== undefined) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { money: true } });
      if (user.money < choice.cost_money) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'money', need: choice.cost_money });
    }
    if (log.studentId === null) throw new ApiError('STATE_CONFLICT', { resource: 'student', reason: 'actor dismissed' });
    const { current, settled } = await lockStudent(tx, userId, log.studentId, now);
    const meta = aggregateMeta(current.talents.map((talent) => talent.talentId));
    const random = createRandomStream(log.seed, `choice:${input.optionIndex}`);
    const selected = weightedPick(
      choice.outcomes.map((outcome) => ({ value: outcome, weight: outcome.weight })),
      random,
    );
    const outcomeRecord = { ...(selected as unknown as JsonRecord) };
    let duelReport: DuelReport | undefined;
    let rewardStudent = settled;
    let winStreak = 0;
    let bankSourceQuestion: QuestionSnapshot | undefined;
    if (selected.type === 'duel') {
      const duel = record(outcomeRecord.duel);
      const inputSnapshot = duelInput(
        { ...current, energy: settled.energy, mindset: settled.mindset },
        duel,
        log.seed,
      );
      duelReport = simulateDuel(inputSnapshot, log.seed);
      const rewardKey =
        duelReport.winnerSide === 'HOME'
          ? 'rewards_win'
          : duelReport.winnerSide === 'AWAY'
            ? 'rewards_lose'
            : 'rewards_draw';
      outcomeRecord.rewards = record(outcomeRecord[rewardKey]);
      const playerState = playerDuelState(duelReport, settled);
      rewardStudent = { ...settled, energy: playerState.energy, mindset: playerState.mindset };
      bankSourceQuestion = duelReport.rounds.find((round) => round.setterSide === 'HOME')?.question;
      if (record(outcomeRecord.rewards).win_streak_bonus !== undefined && duelReport.winnerSide === 'HOME') {
        winStreak = (await priorWinStreak(tx, userId, log.eventId, now)) + 1;
      }
    }
    let checkSummary: JsonRecord | undefined;
    if (selected.type === 'check') {
      const checked = resolveCheck(outcomeRecord, rewardStudent, meta, random);
      outcomeRecord.rewards = checked.rewards;
      checkSummary = checked.check;
    }
    const applied = await resolveRewards(
      tx,
      userId,
      current,
      rewardStudent,
      event,
      choice,
      outcomeRecord as EventOutcome,
      now,
      random,
      input.skill,
      bankSourceQuestion,
      winStreak,
    );
    await persistStudentSettlement(
      tx,
      current,
      settled,
      settled.stamina,
      typeof applied.studentData.energy === 'number' ? applied.studentData.energy : settled.energy,
      typeof applied.studentData.mindset === 'number' ? applied.studentData.mindset : settled.mindset,
      {
        ...applied.studentData,
      },
    );
    const contestRecord =
      duelReport === undefined
        ? null
        : await createContestRecord(
            {
              userId,
              type: 'ADVENTURE',
              format: 'DUEL',
              idempotencyKey: `adventure:${log.id}`,
              inputSnapshot: duelReport.inputSnapshot,
              report: duelReport,
              summary: {
                format: 'DUEL',
                winnerSide: duelReport.winnerSide,
                homeScore: duelReport.scores.home,
                awayScore: duelReport.scores.away,
                rewards: [],
                growth: [],
              },
              rewards: [],
              snapshotHash: duelReport.snapshotHash,
              createdAt: now,
            },
            tx,
          );
    const result = {
      status: 'RESOLVED',
      choiceIndex: input.optionIndex,
      outcomeType: selected.type,
      ...(checkSummary === undefined ? {} : { check: checkSummary }),
      ...(contestRecord === null ? {} : { contestRecordId: contestRecord.id }),
      ...(duelReport === undefined ? {} : { duelWinnerSide: duelReport.winnerSide }),
      rewards: applied.rewardLines,
    };
    const resolved = await tx.adventureLog.update({
      where: { id: adventureId },
      data: {
        status: 'RESOLVED',
        choices: [input.optionIndex],
        results: [result] as unknown as Prisma.InputJsonValue,
        contestRecordId: contestRecord?.id,
        resolvedAt: now,
      },
    });
    return { adventure: toLogView(resolved, event, true), completed: true };
  });
}

export async function listAdventureLogs(userId: number, limit = 20): Promise<AdventureLogView[]> {
  const config = requireConfig();
  const rows = await prisma.adventureLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.flatMap((row) => {
    const event = config.events[row.eventId];
    return event === undefined ? [] : [toLogView(row, event, row.status === 'RESOLVED' || resultPhase(row) === 'ACCEPTED')];
  });
}
