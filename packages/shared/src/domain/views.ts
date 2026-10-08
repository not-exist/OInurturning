/**
 * 跨端 wire 视图唯一真源（API 出参 ↔ 前端数据层）。
 *
 * 硬性约束：本模块只允许 `import type`——类型导入在编译期擦除，zod/config 的
 * runtime 依赖链不得进入本模块的 runtime 图（先例与教训见 src/item-usage.ts
 * 头注：经根 barrel 带入 zod 实测 +82KB 浏览器包）。api 侧删除本地声明改引
 * shared；web 侧 hooks.ts 以别名 re-export 对应消费点，浏览器包零增量。
 */
import type { DimensionKey, Rarity } from '../enums.js';
import type { LectureGrowthEntry } from './student.js';

// ---------------------------------------------------------------------------
// 训练（training）
// ---------------------------------------------------------------------------

/** API 层训练种别（小写 wire 名）；Prisma 枚举（大写）由 api 内映射表双向翻译 */
export type TrainingKind = 'basic' | 'directed' | 'specialized';

/** 附带成长命中项（wire 名 snake_case，区别于 Student 列名的 camelCase） */
export type RareGainStat =
  | 'code'
  | 'thinking'
  | 'setting'
  | 'mindset'
  | 'focus_cap'
  | 'stamina_regen';

export interface RareGain {
  stat: RareGainStat;
  /** 实际生效的增量（浮点累积，跨整数点为真增量） */
  amount: number;
}

export interface TrainingResult {
  dim: DimensionKey;
  /** 主收益（浮点累积，落在指定/随机维） */
  delta: number;
  /** 附带成长清单（code/thinking/setting/mindset/focus_cap/stamina_regen） */
  rareGains: RareGain[];
  cost: number;
  staminaAfter: number;
  /** 同一事务内落库的训练记录 id（GET /api/training/logs 可查） */
  logId: number;
}

export interface TrainingLogView {
  id: number;
  /** 学员行硬删后 SetNull 置空（开除是软删，保留关联），凭 studentName 快照可读 */
  studentId: number | null;
  studentName: string;
  kind: TrainingKind;
  dim: DimensionKey;
  delta: number;
  rareGains: RareGain[];
  cost: number;
  staminaAfter: number;
  bookItemId: string | null;
  problemId: number | null;
  createdAt: string;
}

export interface TrainingLogPage {
  items: TrainingLogView[];
  /** id 游标（倒序）：翻页传 cursor=nextCursor；null 表示到底 */
  nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// 背包（items）/ 学员处分（students）
// ---------------------------------------------------------------------------

/** 背包行视图：库存 + 配置名称/稀有度/类别/描述（join CONFIG.items；已软弃用/缺失不会出现在列表） */
export interface ItemView {
  itemId: string;
  quantity: number;
  name: string;
  rarity: Rarity;
  category: string;
  description: string;
  price: number | null;
  effectDesc: string | null;
}

export interface DismissResult {
  id: number;
  status: 'DISMISSED';
  /** 名义扣减（品质档罚则表） */
  reputationPenalty: number;
  /** 实际生效 delta（声誉 floor 0 截断后，≤0） */
  reputationDelta: number;
  /** 扣后声誉 */
  reputation: number;
  recycledRenameCard: boolean;
}

// ---------------------------------------------------------------------------
// 预制题（problems）
// ---------------------------------------------------------------------------

/** 学前列表视图（config 小写稀有度已归一化为共享 Rarity 大写六档） */
export interface ProblemView {
  id: number;
  name: string;
  dominantDim: DimensionKey;
  rarity: Rarity;
  quality: number;
  traitId: string | null;
  consumedAt: string | null;
}

export interface CreateProblemResult extends ProblemView {
  cost: number;
  staminaAfter: number;
}

// ---------------------------------------------------------------------------
// 讲课与招募（academy）
// ---------------------------------------------------------------------------

export type LectureTierId = 'beginner' | 'junior' | 'senior' | 'provincial' | 'national';

export interface LectureTierView {
  id: LectureTierId;
  threshold: number;
  /** 讲课成长的思维要求 R（issue #56；缺省=门槛） */
  thinkingReq: number;
  baseMoney: number;
  baseReputation: number;
  available: boolean;
}

export interface LectureResultView {
  id: number;
  studentId: number;
  tier: LectureTierId;
  teachingValue: number;
  threshold: number;
  /** 本场比对的思维要求 R（成长匹配判定的基准，落库审计） */
  thinkingReq: number;
  /** 主讲学员思维是否不足（thinking < R）：讲砸时会付出属性代价 */
  thinkingDeficit: boolean;
  forced: boolean;
  success: boolean;
  money: number;
  reputation: number;
  /** 本场成长清单（出题/思维）；amount 为负表示讲砸回落 */
  gains: LectureGrowthEntry[];
  staminaCost: number;
  staminaAfter: number | null;
  createdAt: string;
}

export interface CandidateAttrs {
  ds: number;
  dp: number;
  math: number;
  graph: number;
  greedy: number;
  str: number;
  code: number;
  thinking: number;
  setting: number;
  focusCap: number;
  energyMax: number;
  staminaRegen: number;
}

/**
 * 候选**出参**：招募前品质档与天赋必须隐性（student.md §3.6）——品质档直接暴露会诱导刷池，
 * 天赋更可由家族链确定性反推品质档。api 侧存储结构（CandidatePayload）仍含这两个字段。
 */
export interface CandidatePublicView {
  tempId: string;
  name: string;
  hint: string;
  attrs: CandidateAttrs;
  price: number;
}

export interface PoolView {
  candidates: CandidatePublicView[];
  generatedAt: string;
  refreshesToday: number;
  /** 当前再手动刷新一次的价格（04:00 日界重置后从 k=0 重新计） */
  refreshPrice: number;
}
