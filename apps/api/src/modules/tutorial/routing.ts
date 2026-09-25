import { TUTORIAL_ROUTE_KEYS, type TutorialStepDef } from '@oinur/shared';

/**
 * 引导锁的纯逻辑（无 prisma / loader / 任何 module 依赖，可被无 DB 的 unit 测试直接 import）。
 */

type RouteKey = (typeof TUTORIAL_ROUTE_KEYS)[number];

/**
 * 路由键 → 后端 API 前缀。
 * - 键集是 TUTORIAL_ROUTE_KEYS 的子集（编译期由 `satisfies` 约束）。
 * - 不保留 lecture 键：其两条前缀都被 academy 前缀段边界覆盖，是死配置，留着只会误导。
 */
export const ROUTE_MAP = {
  overview: ['/api/overview'],
  students: ['/api/students'],
  training: ['/api/training', '/api/problem-library', '/api/problems'],
  academy: ['/api/academy'],
  adventure: ['/api/adventures'],
  story: ['/api/story', '/api/records'],
  shop: ['/api/shop'],
  backpack: ['/api/items'],
  'problem-library': ['/api/problem-library', '/api/problems'],
  pvp: ['/api/pvp'],
  admin: ['/api/admin'],
} as const satisfies Partial<Record<RouteKey, readonly string[]>>;

/**
 * 恒放行前缀（与引导进度无关）：
 * - /api/tutorial：引导自身的读取与推进，否则无法解锁
 * - /api/overview、/api/users/me、/api/auth：登录态与指挥中心上下文
 * - /api/talents：静态天赋目录，Overview/Students/StudentDetail 在概览与学员步都会调
 */
export const ALWAYS_ALLOWED_PREFIXES: readonly string[] = [
  '/api/tutorial',
  '/api/overview',
  '/api/users/me',
  '/api/auth',
  '/api/talents',
];

/** 段边界前缀匹配：/api/shop 命中 /api/shop 与 /api/shop/catalog，但不命中 /api/shopxxx */
function matchesPrefix(apiPath: string, prefix: string): boolean {
  return apiPath === prefix || apiPath.startsWith(`${prefix}/`);
}

function routePrefixes(key: string): readonly string[] {
  const map: Readonly<Partial<Record<string, readonly string[]>>> = ROUTE_MAP;
  return map[key] ?? [];
}

export function isApiAllowed(unlocked: string[], apiPath: string): boolean {
  if (unlocked.includes('all')) return true;
  if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => matchesPrefix(apiPath, prefix))) return true;
  return unlocked.some((key) => routePrefixes(key).some((prefix) => matchesPrefix(apiPath, prefix)));
}

/** 未完成取当前步 unlock（越界钳到配置范围），已完成取 ['all']，兜底 ['overview'] */
export function unlockedForStep(step: number, completed: boolean, steps: TutorialStepDef[]): string[] {
  if (completed) return ['all'];
  const idx = clamp(step, 0, steps.length - 1);
  return steps[idx]?.unlock ?? ['overview'];
}

export interface TutorialProgress {
  step: number;
  completed: boolean;
  current: TutorialStepDef | null;
}

/** 归一化用户引导进度：越界 step 钳到配置范围（修「9/5」），已完成固定末位且 current 为 null */
export function resolveProgress(
  user: { tutorialStep: number; tutorialCompleted: boolean },
  steps: TutorialStepDef[],
): TutorialProgress {
  const last = steps.length - 1;
  if (user.tutorialCompleted) return { step: last, completed: true, current: null };
  const step = clamp(user.tutorialStep, 0, last);
  return { step, completed: false, current: steps[step] ?? null };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
