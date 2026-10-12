/** 全局统一稀有度序列：灰 < 黄 < 绿 < 蓝 < 紫 < 彩（GAME-DESIGN §5） */
export const RARITIES = ['GRAY', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW'] as const;
export type Rarity = (typeof RARITIES)[number];

/** 六维键：六个独立数值，绝不合并（GAME-DESIGN §6） */
export const DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

/** 非六维的三项全局能力（code/thinking/setting 的 TS 键） */
export const GLOBAL_ABILITIES = ['CODING', 'THINKING', 'PROBLEM'] as const;
export type GlobalAbility = (typeof GLOBAL_ABILITIES)[number];
// TS/请求侧键：CODING→列 code、THINKING→列 thinking、PROBLEM→列 setting（非直觉映射见 ABILITY_COLUMN）。

export const ABILITY_KEYS = [...DIMENSIONS, ...GLOBAL_ABILITIES] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

// ---------------------------------------------------------------------------
// Prisma Student 列名（权威：apps/api/prisma/schema.prisma Student 模型；
// 字符串维列名是 str，与配置侧 wire 名 string 是两个命名空间）。
// ---------------------------------------------------------------------------

/** Student 六维列名（schema.prisma ds…str） */
export const DIMENSION_COLUMNS = ['ds', 'dp', 'math', 'graph', 'greedy', 'str'] as const;
export type DimensionColumn = (typeof DIMENSION_COLUMNS)[number];

/** Student 全部九项能力列名（六维 + code/thinking/setting） */
export const ABILITY_COLUMNS = [...DIMENSION_COLUMNS, 'code', 'thinking', 'setting'] as const;
export type AbilityColumn = (typeof ABILITY_COLUMNS)[number];

/** AbilityKey → Prisma 列名桥（显式逐字，不按下标推导） */
export const ABILITY_COLUMN = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'str',
  CODING: 'code',
  THINKING: 'thinking',
  PROBLEM: 'setting',
} satisfies Record<AbilityKey, AbilityColumn>;

// ---------------------------------------------------------------------------
// Prisma enum 对齐（权威：apps/api/prisma/schema.prisma）
// 值集合/顺序必须与 schema 一致；改 Prisma 侧时同步改这里。
// R6 架构测试机械校验 schema 对齐（apps/api/tests/architecture.test.ts）。
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
