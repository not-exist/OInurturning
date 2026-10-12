/**
 * 跨端 wire 视图唯一真源（API 出参 ↔ 前端数据层）。
 *
 * 硬性约束：本模块只允许 `import type`——类型导入在编译期擦除，zod/config 的
 * runtime 依赖链不得进入本模块的 runtime 图（先例与教训见 src/item-usage.ts
 * 头注：经根 barrel 带入 zod 实测 +82KB 浏览器包）。api 侧删除本地声明改引
 * shared；web 侧 hooks.ts 以别名 re-export 对应消费点，浏览器包零增量。
 */
import type {
  AdventureStatus,
  DimensionKey,
  MatchStatus,
  Rarity,
  Role,
  TournamentStatus,
} from '../enums.js';
import type { EventCategory } from '../config/events.js';
import type { ConfigRarity, TalentDef } from '../config/talents.js';
import type { TutorialStepDef } from '../config/tutorial.js';
import type { BattleReplay, ContestFormat, ParticipantSnapshot, TEAM_SIZE_MAX, TEAM_SIZE_MIN } from './contest.js';
import type { LectureGrowthEntry, StudentView } from './student.js';
import type { ContestRecordType, ContestRecordView } from './story.js';

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

// ---------------------------------------------------------------------------
// 历练（adventure）
// ---------------------------------------------------------------------------

/** 体力投入档（EventConfig['stamina_cost'] 的值域）；抽取稀有度权重按档分层 */
export type AdventureStaminaCost = 1 | 2 | 3;

export interface AdventureChoiceView {
  index: number;
  text: string;
  available: boolean;
  requiresItem?: string;
  costMoney?: number;
}

export interface AdventureEventView {
  id: string;
  code: string;
  name: string;
  category: EventCategory;
  rarity: ConfigRarity;
  staminaCost: AdventureStaminaCost;
  description: string;
  choices: AdventureChoiceView[] | null;
}

export interface AdventureLogView {
  id: number;
  studentId: number | null;
  contestRecordId: string | null;
  tier: AdventureStaminaCost;
  status: AdventureStatus;
  preview: boolean;
  event: AdventureEventView;
  choices: number[];
  results: unknown[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdventureChoiceResult {
  adventure: AdventureLogView;
  completed: boolean;
  replay?: BattleReplay;
}

// ---------------------------------------------------------------------------
// 管理端与总览（admin / overview）
// ---------------------------------------------------------------------------

/** 管理端锦标赛行视图；status 与 Prisma TournamentStatus 同值域（R4-T8 对齐） */
export interface TournamentView {
  id: number;
  name: string;
  status: TournamentStatus;
  size: number;
  registerEndsAt: string;
  autoStartAt: string;
  prizes: unknown;
  config: unknown;
  createdBy: number | null;
  createdAt: string;
}

export interface AnnouncementView {
  id: number;
  title: string;
  body: string;
  /** 作者注销后置空（公告是全站内容，不随作者删除） */
  authorId: number | null;
  createdAt: string;
}

export interface UserAdminView {
  id: number;
  username: string;
  role: Role;
  money: number;
  reputation: number;
  bannedAt: string | null;
  createdAt: string;
}

export interface AuditView {
  id: number;
  adminId: number | null;
  adminNameSnapshot: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
}

/** checklist 全完成奖励徽章（User.badges 字符串，无 FK，纯展示）；api 侧常量以本类型注解锁值 */
export type ChecklistRewardBadge = 'rookie-done';

export type ChecklistStepId = 'train' | 'lecture' | 'adventure' | 'story' | 'recruit3';

export interface ChecklistStepView {
  id: ChecklistStepId;
  label: string;
  hint: string;
  done: boolean;
}

export interface ChecklistView {
  steps: ChecklistStepView[];
  doneCount: number;
  total: number;
  /** rookie-done 是否已领取 */
  claimed: boolean;
  rewardBadge: ChecklistRewardBadge;
}

export interface OverviewStoryView {
  clearedStages: number;
  totalStages: number;
  nextStage: { stageKey: string; name: string; chapter: string } | null;
}

export interface OverviewPoolView {
  count: number;
  refreshPrice: number;
  /** 下次免费刷新的 ISO 时间（generatedAt + free_interval_hours） */
  freeRefreshAt: string;
}

/** 总览「最近动态」用的战报摘要（瘦身：不含 report/inputSnapshot 大 JSON） */
export interface ContestRecordSummary {
  id: string;
  type: ContestRecordType;
  format: ContestFormat;
  stageKey: string | null;
  ngLevel: number | null;
  createdAt: string;
}

export interface OverviewRecentView {
  training: TrainingLogView[];
  lectures: LectureResultView[];
  adventures: AdventureLogView[];
  contests: ContestRecordSummary[];
}

export interface OverviewView {
  me: { money: number; reputation: number; onboardedAt: string | null };
  students: { total: number; items: StudentView[] };
  story: OverviewStoryView;
  pool: OverviewPoolView;
  recent: OverviewRecentView;
  announcements: AnnouncementView[];
  checklist: ChecklistView;
}

// ---------------------------------------------------------------------------
// 剧情（story）
// ---------------------------------------------------------------------------

/** 进关结果（POST /api/story/stages/:key/enter）；replayed 表示命中幂等键重放旧战报 */
export interface StoryEntryResult {
  record: ContestRecordView;
  replay: BattleReplay;
  replayed: boolean;
  firstClear: boolean;
}

// ---------------------------------------------------------------------------
// PVP（pvp）
// ---------------------------------------------------------------------------

/** 出战队伍人数即契约的队伍规模域（shared TEAM_SIZE_MIN~MAX），不是可调数值。 */
export type PvpRosterSize = typeof TEAM_SIZE_MIN | typeof TEAM_SIZE_MAX;

/** 锦标赛列表行；status 与 Prisma TournamentStatus 同值域（R4-T8 对齐） */
export interface PvpTournamentView {
  id: number;
  name: string;
  status: TournamentStatus;
  size: number;
  rosterSize: PvpRosterSize;
  registerEndsAt: string;
  autoStartAt: string;
  registered: boolean;
}

/**
 * 报名时冻结的预制题快照。dominantDim/rarity 诚实保留 string：
 * 快照是 ProblemLibraryEntry 两个 String 列的原样拷贝（写入侧 library.ts 确只喂
 * DimensionKey 与小写六档），但本类型既经 Json 列 `as unknown` 裸 cast 读出，读侧
 * scheduler.questionFor 也对脏值有容错回退（Set.has + 兜底 'DS'）——联合收窄会
 * 谎报 wire 边界且凭空引入构造期 cast，故不加。
 */
export interface PvpProblemSnapshot {
  id: number;
  name: string;
  dominantDim: string;
  rarity: string;
  quality: number;
  traitId: string | null;
}

export interface PvpRegistrationView {
  id: number;
  tournamentId: number;
  userId: number;
  rosterSize: PvpRosterSize;
  roster: ParticipantSnapshot[];
  problemEntryIds: number[];
  problemSnapshots: PvpProblemSnapshot[];
  createdAt: string;
  replayed: boolean;
}

export interface PvpMatchView {
  id: number;
  round: number;
  slot: number;
  homeUserId: number | null;
  awayUserId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerUserId: number | null;
  /** 与 Prisma MatchStatus 同值域（R4-T8 对齐） */
  status: MatchStatus;
  contestRecordId: string | null;
  reportUrl: string | null;
}

/**
 * 赛事详情（GET /api/pvp/tournaments/:id）。api 侧平铺、无 PvpTournamentView 的
 * registered 字段（列表才需要；web 旧类型 extends 带来的该幻影字段零消费方，已随上收删除）。
 */
export interface PvpTournamentDetail {
  id: number;
  name: string;
  status: TournamentStatus;
  size: number;
  rosterSize: PvpRosterSize;
  registerEndsAt: string;
  autoStartAt: string;
  prizes: unknown;
  config: unknown;
  registeredCount: number;
  myRegistration: number | null;
}

export type PvpRewardLine =
  | { type: 'item'; itemId: string; count: number }
  | { type: 'money'; amount: number }
  | { type: 'reputation'; amount: number };

export interface PvpRewardGrantView {
  id: number;
  tournamentId: number;
  userId: number;
  rank: number;
  rewards: PvpRewardLine[];
  claimedAt: string | null;
  claimable: boolean;
}

// ---------------------------------------------------------------------------
// 天赋目录（talents）
// ---------------------------------------------------------------------------

/** 天赋目录行（GET /api/talents；family 用于家族标签与净化链位置；effects 复用 config TalentDef） */
export interface TalentView {
  id: string;
  name: string;
  rarity: Rarity;
  kind: TalentDef['kind'];
  description: string;
  family: string | null;
  effects: TalentDef['effects'];
}

// ---------------------------------------------------------------------------
// 新手引导（tutorial）
// ---------------------------------------------------------------------------

export interface TutorialStateView {
  step: number;
  completed: boolean;
  total: number;
  steps: TutorialStepDef[];
  unlocked: string[];
  current: TutorialStepDef | null;
  /** 仅 do_recruit 步下发：在册 ACTIVE 学员数与该步门槛，供前端渲染「还需招募 N 人」 */
  studentsOwned?: number;
  studentsRequired?: number;
}
