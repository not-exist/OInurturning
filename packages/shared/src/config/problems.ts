import { z } from 'zod';
import { DIMENSIONS, type DimensionKey } from '../enums.js';

export const CONFIG_DIMENSIONS = ['ds', 'dp', 'math', 'graph', 'greedy', 'string'] as const;
export type ConfigDimension = (typeof CONFIG_DIMENSIONS)[number];

export const PROBLEM_TIERS = ['cspj', 'csps', 'noip', 'province', 'noi', 'ctt', 'cts', 'ioi'] as const;
export type ProblemTier = (typeof PROBLEM_TIERS)[number];

export const PROBLEM_SEVERITIES = ['red', 'yellow', 'blue', 'purple', 'black', 'colorful'] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

const problemHookValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const problemTraitSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    severity: z.enum(PROBLEM_SEVERITIES),
    family: z.string().min(1).nullable(),
    family_note: z.string().optional(),
    condition: z.string().min(1).optional(),
    effect: z.string().min(1),
    hooks: z.record(problemHookValueSchema),
  })
  .strict();
export type ProblemTrait = z.infer<typeof problemTraitSchema>;

export const problemTraitPoolEntrySchema = z
  .object({
    trait: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    weight: z.number().finite().positive(),
  })
  .strict();
export type ProblemTraitPoolEntry = z.infer<typeof problemTraitPoolEntrySchema>;

export const problemRequirementsSchema = z
  .object({
    d: z.number().int().nonnegative(),
    m: z.number().int().nonnegative(),
    c: z.number().int().nonnegative(),
  })
  .strict();

export const problemTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    tier: z.enum(PROBLEM_TIERS),
    title: z.string().min(1),
    dim: z.enum(CONFIG_DIMENSIONS),
    requirements: problemRequirementsSchema,
    score: z.number().finite().nonnegative(),
    time_limit_min: z.number().finite().positive(),
    trait_pool: z.array(problemTraitPoolEntrySchema),
    partial_scores: z.boolean(),
  })
  .strict();
export type ProblemTemplate = z.infer<typeof problemTemplateSchema>;

export const problemConventionsSchema = z
  .object({
    requirement_band_reference: z.string().min(1),
    time_limit_semantics: z.string().min(1),
    implicit_no_trait_weight: z.number().finite().nonnegative(),
    adhoc_dim_mapping: z.enum(CONFIG_DIMENSIONS),
  })
  .strict();

export const problemConfigSchema = z
  .object({
    version: z.number().int().nonnegative(),
    updated: z.string().min(1),
    conventions: problemConventionsSchema,
    severity_ladder: z.array(z.enum(PROBLEM_SEVERITIES)).min(1),
    traits: z.array(problemTraitSchema).min(1),
    templates: z.array(problemTemplateSchema).min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const traitIds = new Set(config.traits.map((trait) => trait.id));
    config.templates.forEach((template, templateIndex) => {
      template.trait_pool.forEach((entry, entryIndex) => {
        if (!traitIds.has(entry.trait)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown problem trait: ${entry.trait}`,
            path: ['templates', templateIndex, 'trait_pool', entryIndex, 'trait'],
          });
        }
      });
    });
  });
export type ProblemConfig = z.infer<typeof problemConfigSchema>;

const configDimensionToDomain: Record<ConfigDimension, DimensionKey> = {
  ds: DIMENSIONS[0],
  dp: DIMENSIONS[1],
  math: DIMENSIONS[2],
  graph: DIMENSIONS[3],
  greedy: DIMENSIONS[4],
  string: DIMENSIONS[5],
};

export function normalizeProblemTemplate(template: ProblemTemplate): Omit<ProblemTemplate, 'dim'> & { dim: DimensionKey } {
  return { ...template, dim: configDimensionToDomain[template.dim] };
}

export function normalizeConfigDimension(dimension: ConfigDimension): DimensionKey {
  return configDimensionToDomain[dimension];
}
