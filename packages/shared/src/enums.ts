/** 全局统一稀有度序列：灰 < 黄 < 绿 < 蓝 < 紫 < 彩（GAME-DESIGN §5） */
export const RARITIES = ['GRAY', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW'] as const;
export type Rarity = (typeof RARITIES)[number];

/** 六维键：六个独立数值，绝不合并（GAME-DESIGN §6） */
export const DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export const ABILITY_KEYS = [...DIMENSIONS, 'CODING', 'THINKING', 'PROBLEM'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

// ---------------------------------------------------------------------------
// Prisma enum 对齐（权威：apps/api/prisma/schema.prisma）
// 值集合/顺序必须与 schema 一致；改 Prisma 侧时同步改这里。
// ---------------------------------------------------------------------------

/** 用户角色（Prisma Role） */
export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** 历练日志状态（Prisma AdventureStatus） */
export const ADVENTURE_STATUSES = ['PENDING', 'RESOLVED'] as const;
export type AdventureStatus = (typeof ADVENTURE_STATUSES)[number];

/** 锦标赛状态（Prisma TournamentStatus） */
export const TOURNAMENT_STATUSES = ['REGISTERING', 'RUNNING', 'FINISHED', 'CANCELLED'] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

/** 对局状态（Prisma MatchStatus） */
export const MATCH_STATUSES = ['PENDING', 'DONE', 'BYE'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** 获得途径（Prisma AcquiredVia） */
export const ACQUIRED_VIAS = ['RECRUIT', 'EVENT', 'UPGRADE', 'REROLL', 'ADMIN'] as const;
export type AcquiredVia = (typeof ACQUIRED_VIAS)[number];
