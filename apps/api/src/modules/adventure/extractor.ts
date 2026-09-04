import type { ConfigRarity, EventConfig } from '@oinur/shared';
import type { RandomSource } from '../contest/engine/models.js';

export type AdventureStaminaCost = 1 | 2 | 3;
export type EventTimestamp = Date | string;

/** gameplay.md §3.2：投入档对应的稀有度权重。 */
export const ADVENTURE_LAYER_WEIGHTS: Readonly<
  Record<AdventureStaminaCost, Readonly<Partial<Record<ConfigRarity, number>>>>
> = {
  1: { gray: 70, yellow: 30 },
  2: { yellow: 42, green: 34, blue: 20, purple: 4 },
  3: { green: 25, blue: 35, purple: 31, colorful: 9 },
};

export interface AdventureEventDrawContext {
  availableStamina: number;
  investment: AdventureStaminaCost;
  reputation: number;
  sixMax: number;
  now: EventTimestamp;
  lastTriggeredAtByEvent?: ReadonlyMap<string, EventTimestamp>;
  oncePerStudentEventIds?: ReadonlySet<string>;
  weeklyUsageByEvent?: ReadonlyMap<string, number>;
  rng: RandomSource;
}

function timestamp(value: EventTimestamp): number {
  return typeof value === 'string' ? new Date(value).getTime() : value.getTime();
}

function weightedPick<T>(entries: readonly { value: T; weight: number }[], rng: RandomSource): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) throw new Error('[adventure] weighted pool is empty');

  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries[entries.length - 1]!.value;
}

function meetsRequirements(event: EventConfig, context: AdventureEventDrawContext): boolean {
  const requirements = event.requirements;
  if (requirements === null) return true;
  if (
    requirements.min_reputation !== undefined &&
    context.reputation < requirements.min_reputation
  ) {
    return false;
  }
  const minSixMax = requirements.min_stat?.six_max;
  return minSixMax === undefined || context.sixMax >= minSixMax;
}

function offCooldown(event: EventConfig, context: AdventureEventDrawContext): boolean {
  if (event.cooldown_days === 0) return true;
  const last = context.lastTriggeredAtByEvent?.get(event.id);
  if (last === undefined) return true;
  return timestamp(last) + event.cooldown_days * 86_400_000 <= timestamp(context.now);
}

function respectsLimits(event: EventConfig, context: AdventureEventDrawContext): boolean {
  if (event.once_per_student && context.oncePerStudentEventIds?.has(event.id)) return false;
  if (event.server_weekly_limit !== undefined) {
    const used = context.weeklyUsageByEvent?.get(event.id) ?? 0;
    if (used >= event.server_weekly_limit) return false;
  }
  return true;
}

/** 返回稳定排序后的可抽取事件；调用方可用同一结果展示候选池或做统计。 */
export function listEligibleAdventureEvents(
  events: readonly EventConfig[],
  context: AdventureEventDrawContext,
): EventConfig[] {
  return events
    .filter(
      (event) =>
        event.stamina_cost <= context.availableStamina &&
        event.stamina_cost === context.investment &&
        meetsRequirements(event, context) &&
        offCooldown(event, context) &&
        respectsLimits(event, context),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 按“投入档 → 稀有度 → 组内事件”抽取一个事件。
 * 空稀有度组会从本次可用组中重新归一化，不会把权重浪费在不可抽事件上。
 */
export function drawAdventureEvent(
  events: readonly EventConfig[],
  context: AdventureEventDrawContext,
): EventConfig | null {
  const staminaCost = context.investment;
  if (context.availableStamina < staminaCost) return null;

  const eligible = listEligibleAdventureEvents(events, context);
  if (eligible.length === 0) return null;

  const rarityEntries = Object.entries(ADVENTURE_LAYER_WEIGHTS[staminaCost])
    .map(([rarity, weight]) => ({
      value: rarity as ConfigRarity,
      weight: weight ?? 0,
    }))
    .filter(({ value, weight }) => weight > 0 && eligible.some((event) => event.rarity === value));
  if (rarityEntries.length === 0) return null;
  const rarity = weightedPick(rarityEntries, context.rng);
  const eventEntries = eligible
    .filter((event) => event.rarity === rarity)
    .map((event) => ({ value: event, weight: event.weight }));
  return weightedPick(eventEntries, context.rng);
}
