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
    'do_recruit',
    'do_lecture',
    'do_story',
  ]),
  /**
   * 条件式完成门槛：仅 action=do_recruit 有意义——在册 ACTIVE 学员数达到该值即自动放行，
   * 未达到则本步不推进。用于「老号免重做」与「新号必须补足到 N 人」两种情形共存。
   */
  requires_students: z.number().int().positive().optional(),
  /**
   * 仅 action=none 且带 target 的步有意义：默认（缺省/true）点被聚光的元素即推进。
   * 置 false 表示这一步只让人看，出口只有引导卡上的「下一步」——用于「先认界面、下一步才动手」
   * 的展示步（例如先看受众档位，下一步才去点「开始讲课」）。
   */
  advance_on_target_click: z.boolean().optional(),
  /**
   * 有高亮（洞口可见）时是否拦截洞外点击。默认（缺省/true）拦：聚光即焦点，点其他 UI 无效。
   * 置 false 仅用于玩家可能需要离开当前页的行为步（如 recruit：招募金不足时要先去讲课/历练
   * 赚钱再回来），拦死洞外会把这类步变成软锁。
   */
  block_outside_click: z.boolean().optional(),
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
