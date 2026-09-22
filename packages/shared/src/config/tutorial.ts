import { z } from 'zod';

/**
 * 引导 unlock 键的合法词表（含 'all' 之外的取值；yaml unlock 与此不一致时 config 层 failFast）。
 * 后端 ROUTE_MAP 的键集是它的子集：并非每个键都需要 API 门禁——例如 lecture 的两条前缀完全落在
 * academy 前缀段内，保留该键只会误导，故 ROUTE_MAP 不登记 lecture，而词表仍需保留它给 yaml 用。
 */
export const TUTORIAL_ROUTE_KEYS = [
  'overview',
  'students',
  'training',
  'academy',
  'lecture',
  'adventure',
  'story',
  'shop',
  'backpack',
  'problem-library',
  'pvp',
  'admin',
] as const;
export type TutorialRouteKey = (typeof TUTORIAL_ROUTE_KEYS)[number];

export const tutorialStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  desc: z.string().min(1),
  target: z.string().nullable(), // css selector or null for center modal
  unlock: z.array(z.string()).min(1), // route keys or 'all'
  action: z.enum([
    'none',
    'visit_students',
    'do_training',
    'visit_academy',
    'do_lecture',
    'do_adventure',
    'do_story',
    'visit_shop',
    'visit_backpack',
  ]),
  reward: z
    .object({
      money: z.number().int().nonnegative().optional(),
      reputation: z.number().int().nonnegative().optional(),
      item: z.string().optional(),
      count: z.number().int().positive().optional(),
      badge: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export type TutorialStepDef = z.infer<typeof tutorialStepSchema>;

export const tutorialConfigSchema = z.object({
  steps: z.array(tutorialStepSchema).min(1),
});

export type TutorialConfig = z.infer<typeof tutorialConfigSchema>;
