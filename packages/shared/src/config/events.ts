import { z } from 'zod';
import { CONFIG_RARITIES, type ConfigRarity } from './talents.js';

export const EVENT_CATEGORIES = [
  'duel',
  'windfall',
  'trial',
  'chance',
  'trouble',
  'social',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_OUTCOME_TYPES = ['duel', 'check', 'fixed'] as const;
export type EventOutcomeType = (typeof EVENT_OUTCOME_TYPES)[number];

const eventRequirementsSchema = z
  .object({
    min_reputation: z.number().int().nonnegative().optional(),
    min_stat: z
      .object({
        six_max: z.number().finite().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type EventRequirements = z.infer<typeof eventRequirementsSchema>;

const eventOutcomeSchema = z
  .object({
    weight: z.number().finite().positive(),
    type: z.enum(EVENT_OUTCOME_TYPES),
  })
  .passthrough();
export type EventOutcome = z.infer<typeof eventOutcomeSchema>;

const eventConsumeSchema = z
  .object({
    item: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    qty: z.number().int().positive(),
  })
  .strict();

const eventChoiceSchema = z
  .object({
    text: z.string().min(1),
    requires_item: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    consume: eventConsumeSchema.optional(),
    cost_money: z.number().int().nonnegative().optional(),
    outcomes: z.array(eventOutcomeSchema).min(1),
  })
  .passthrough();
export type EventChoice = z.infer<typeof eventChoiceSchema>;

export const eventConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    code: z.string().regex(/^[GYRLPC][0-9]+$/),
    name: z.string().min(1),
    category: z.enum(EVENT_CATEGORIES),
    rarity: z.enum(CONFIG_RARITIES),
    stamina_cost: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    repeatable: z.boolean(),
    once_per_student: z.boolean().optional(),
    server_weekly_limit: z.number().int().positive().optional(),
    cooldown_days: z.number().int().nonnegative(),
    weight: z.number().finite().positive(),
    requirements: eventRequirementsSchema.nullable(),
    description: z.string().min(1),
    choices: z.array(eventChoiceSchema).min(1),
  })
  .strict();
export type EventConfig = z.infer<typeof eventConfigSchema>;

export const eventsConfigSchema = z
  .object({
    version: z.string().min(1),
    events: z.array(eventConfigSchema).min(1),
  })
  .strict();
export type EventsConfig = z.infer<typeof eventsConfigSchema>;

export const EVENT_RARITIES = CONFIG_RARITIES satisfies readonly ConfigRarity[];
