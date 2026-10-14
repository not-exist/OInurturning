/** 全局统一稀有度序列：灰 < 黄 < 绿 < 蓝 < 紫 < 彩（GAME-DESIGN §5） */
export const RARITIES = ['GRAY', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW'] as const;
export type Rarity = (typeof RARITIES)[number];

/** 六维键：六个独立数值，绝不合并（GAME-DESIGN §6） */
export const DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export const ABILITY_KEYS = [...DIMENSIONS, 'CODING', 'THINKING', 'PROBLEM'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];
