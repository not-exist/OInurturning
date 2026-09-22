import { z } from 'zod';

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
