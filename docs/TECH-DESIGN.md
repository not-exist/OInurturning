# OInurturning 技术架构设计（TECH-DESIGN）

> 版本：v0.1（2026-08-26）
> 上游依据：`docs/GAME-DESIGN.md` v0.1（唯一权威规格，下称 GAME-DESIGN）及根目录 `InitPlan` 背景草案。本文落实其 §17 技术要点、支撑 §1–§16 全部玩法系统，并为 §18 里程碑给出验证策略。
> 约定：正文中文、标识符英文；**一切玩法数值一律以 `docs/data/*.yaml` 与 `docs/systems/*.md` 为准，本文只引用配置键名、不复述数值**。技术侧常量（bcrypt cost、JWT TTL 等）不属于玩法数值，在本文给出建议值。

## 目录

- 0. 总体架构与技术原则
- 1. Monorepo 结构
- 2. packages/shared 共享类型契约
- 3. 数据库设计（Prisma Schema 级）
- 4. 配置即数据管线
- 5. API 设计
- 6. 行动时钟与懒结算
- 7. 比赛模拟服务
- 8. 前端设计
- 9. 安全基线
- 10. 部署
- 11. 开发阶段验证策略（M0–M5）
- 12. 关键技术取舍汇总
- 13. 规格模糊点与假设清单

---

## 0. 总体架构与技术原则

### 0.1 部署拓扑

```
浏览器 SPA（React + Vite 构建产物）
        │ HTTPS（TLS 由宿主环境/反代层终结）
        ▼
   nginx 容器
   ├── /            → 静态文件（index.html + assets，SPA fallback）
   └── /api/*       → 反向代理
                        ▼
                 Node.js API 容器（Express，单实例）
                        │ Prisma（参数化查询）
                        ▼
                     MySQL 8 容器
```

没有其它运行部件：无 WebSocket、无 Redis、无消息队列、无独立定时任务进程。所有"时间驱动"的效果（体力/精力/心态恢复、被动收入、PVP 按期开赛）均采用**读时惰性结算**（§6），由普通请求路径触发。

### 0.2 技术原则

| # | 原则 | 含义与理由 |
|---|---|---|
| P1 | **服务端权威结算** | 客户端只提交意图（"用学员 A 进行定向训练"），一切数值判定、随机、扣减都在服务端完成；客户端只读展示。防作弊做到够用即可的根基。 |
| P2 | **即时模拟 + 战报回放** | 比赛/对决在请求内同步模拟完毕并落库战报 JSON；无长连接、无后台对局进程。前端渲染的是持久化战报而非实时流。 |
| P3 | **读时惰性结算** | 时间资源（体力/精力/心态/被动收入）不在时钟上推进，而在读写时按 `now - lastSettledAt` 差值一次性补偿（§6）。免 cron、免重启补偿逻辑。 |
| P4 | **配置即数据** | `docs/data/*.yaml` 同时是策划文档与运行时数据源，API 启动时经 zod 校验导入 MySQL Config 表（§4）。改数值 = 改 yaml + 重启，无需发版。 |
| P5 | **最小依赖面** | 明确排除 WebSocket / Redis / 消息队列。若未来确需"PVP 开赛提醒"这类弱实时推送，降级替代方案已内置：前端每 30s 轮询 `/api/pvp/tournaments` + 浏览器 Notification API，服务端零改造。 |
| P6 | **确定性可复现模拟** | 模拟器是纯函数：`(快照输入, seed) → 战报`，不读时钟、不读数据库、不用 `Math.random()`。同 seed 必得同战报，用于审计、bug 复现与单测（§7）。 |

### 0.3 规模假设

朋友/社区规模（数十至数百注册用户，峰值并发数十）：**API 单实例部署**即可承载。单实例是若干简化决策的前提（内存幂等缓存、内存限流桶、进程内可选加速器），相关取舍与升级路径见 §12。

---

## 1. Monorepo 结构

pnpm workspaces 管理，**不引入 Turborepo/Nx**——三个包的构建编排用根脚本足够，任务图复杂度配不上额外工具。

```
OInurturning/
├── package.json                  # 根脚本编排（dev/lint/typecheck/test/build/migrate）
├── pnpm-workspace.yaml           # packages: apps/*, packages/*
├── tsconfig.base.json            # 全仓共享 TS 编译选项（strict、NodeNext 等）
├── .env.example                  # 环境变量模板（对应 §10.2 清单）
├── docker-compose.yml            # 本地开发编排（mysql only，api/web 跑在本机）
├── InitPlan                      # 原始策划草案（存档，不再演进）
├── docs/
│   ├── GAME-DESIGN.md            # 游戏规划总纲（唯一权威规格）
│   ├── TECH-DESIGN.md            # 本文
│   ├── ROADMAP.md                # 开发里程碑排期（规划中）
│   ├── systems/*.md              # 分系统细则（公式常数、模拟规则等）
│   └── data/*.yaml               # 运行时配置源：talents/items/problems/events/stages/economy
├── apps/
│   ├── web/                      # 前端 React SPA
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx          # 入口：挂载 RouterProvider
│   │       ├── app/              # 路由表、布局、鉴权守卫
│   │       ├── features/         # 领域页面组件（students/story/pvp/adventure/academy/admin…）
│   │       ├── components/       # 通用 UI 组件（ResourceBar、RarityBadge、VerdictChip…）
│   │       ├── lib/              # api client（fetch 封装）、query hooks、zustand store、ticker
│   │       └── styles/           # Tailwind 入口与主题 token
│   └── api/                      # 后端 Express 服务
│       ├── prisma/
│       │   ├── schema.prisma     # §3 的完整 schema
│       │   └── migrations/       # prisma migrate 版本化迁移
│       ├── tests/                # vitest 单测 + supertest 集成测
│       └── src/
│           ├── index.ts          # 入口：装配中间件、路由、错误处理
│           ├── config/env.ts     # 环境变量加载与启动校验（zod）
│           ├── config/config-import.ts   # §4 配置导入管线
│           ├── lib/              # prisma client、pino logger、errors、jwt、idempotency
│           ├── middlewares/      # requireAuth、requireAdmin、rateLimit、errorHandler、requestId
│           ├── domain/           # 领域逻辑：settlement（懒结算）、growth（成长曲线）、economy
│           ├── engine/           # §7 比赛模拟：rng / model / npc / ranking-sim / duel-sim / report
│           └── modules/          # 按业务域划分的路由+服务层（§5），每个模块 router.ts/service.ts/schemas.ts
├── packages/
│   └── shared/                   # 前后端共享 TS 包（直接以 TS 源码被消费，无独立构建步骤）
│       └── src/
│           ├── enums.ts          # 稀有度、六维键、事件类别等基础枚举
│           ├── config-types.ts   # YAML 对应的 zod schema + 推断类型（§4 校验共用）
│           ├── domain.ts         # StudentSnapshot、ContestReport、DuelReport 等领域类型
│           ├── api.ts            # 各端点请求/响应 DTO
│           └── index.ts
├── deploy/
│   ├── docker-compose.yml        # 生产编排（mysql + api + nginx，§10.1）
│   ├── api.Dockerfile            # 多阶段构建：pnpm build → node:22-alpine 运行时
│   ├── web.Dockerfile            # 多阶段构建：vite build → nginx:alpine 托管静态 + 内嵌反代配置
│   ├── nginx.conf                # SPA fallback、/api 反代、安全响应头
│   └── backup.sh                 # mysqldump 备份脚本（供 crontab 调用，§10.3）
└── scripts/
    ├── sim-economy.ts            # M5 收支模拟验证脚本（读 economy.yaml 推演周收支）
    └── seed-admin.ts             # 初始化管理员账号
```

要点说明：

- **shared 包不做构建**：Vite 天然消费 TS 源码；API 侧用 tsup/esbuild 打包时一并转译 workspace 依赖。省掉 watch 联动与产物同步问题。
- **docs/data 是 API 镜像的一部分**：`api.Dockerfile` 必须 `COPY docs/data` 进镜像（`CONFIG_DIR=/app/config`），因为配置导入发生在容器启动时。
- **本地开发**：根目录 `docker-compose.yml` 只起 mysql，`pnpm dev` 并行跑 `apps/api`（tsx watch）与 `apps/web`（vite dev server，proxy `/api` → localhost:3000）。

---

## 2. packages/shared 共享类型契约

shared 包是前后端唯一类型来源：后端用它做 zod 运行时校验，前端用它做编译期检查。以下为契约基线，实现中允许增补字段但不允许改已有字段语义。**所有涉及具体数值的字段一律由 yaml 注入，类型只描述形状。**

### 2.1 基础枚举（enums.ts）

```ts
/** 全局统一稀有度序列：灰 < 黄 < 绿 < 蓝 < 紫 < 彩（GAME-DESIGN §5） */
export const RARITIES = ['GRAY', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW'] as const;
export type Rarity = (typeof RARITIES)[number];

/** 题目特性严重度阶梯：红 < 黄 < 蓝 < 紫 < 黑 < 彩（独立于全局稀有度） */
export const TRAIT_SEVERITIES = ['RED', 'YELLOW', 'BLUE', 'PURPLE', 'BLACK', 'RAINBOW'] as const;
export type TraitSeverity = (typeof TRAIT_SEVERITIES)[number];

/** 六维键（GAME-DESIGN §6：六个独立数值，绝不合并） */
export const DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];
export type AbilityKey =
  | DimensionKey | 'CODING' | 'THINKING' | 'PROBLEM';   // 可被训练/书籍提升的能力

/** 道具六大分类（GAME-DESIGN §15） */
export type ItemCategory = 'GROWTH' | 'BOOK' | 'FUNCTIONAL' | 'CONTEST' | 'QUEST' | 'MATERIAL';

/** 历练事件六类别（GAME-DESIGN §10） */
export type EventCategory = 'DUEL' | 'FORTUNE' | 'TRIAL' | 'SERENDIPITY' | 'TROUBLE' | 'BOND';

/** 剧情章节 */
export const CHAPTERS = ['CSP_J', 'CSP_S', 'NOIP', 'PROVINCIAL', 'NOI', 'CTT', 'CTS', 'IOI'] as const;
export type ChapterKey = (typeof CHAPTERS)[number];

/** 讲课受众档位（报酬/门槛数值见 economy.yaml 的 lectureTiers） */
export type LectureTier = 'ENTRY' | 'BASIC' | 'ADVANCED' | 'PROVINCIAL' | 'NATIONAL';
```

### 2.2 配置侧类型（config-types.ts，与 docs/data/*.yaml 一一对应）

每个类型配有同名 zod schema（此处省略 schema 代码，模式为 `z.object(...)` 严格模式，未知键报错）：

```ts
/** talents.yaml —— 天赋定义 */
export interface TalentDef {
  id: string;                    // 稳定 id，如 "memoize.green"；家族升阶链由 parent 串成
  name: string;                  // 展示名，如「记忆化·绿」
  rarity: Rarity;
  parentId: string | null;       // 升阶目标（至多一个，null=不可升阶）；灰色天赋的 parent 为净化方向
  description: string;
  effects: TalentEffect[];       // 效果语义枚举以本文件 zod schema 为准
}
export interface TalentEffect {
  kind: string;                  // TRAIN_BONUS / ADVENTURE_BONUS / STAT_MULTIPLIER / SPECIAL …
  target?: AbilityKey | 'ALL';
  value: number;                 // 数值含义由 kind 决定
}

/** items.yaml —— 道具定义 */
export interface ItemDef {
  id: string;
  name: string;
  rarity: Rarity;
  category: ItemCategory;
  price: number | null;          // 非 null → 商城直售（marketplace 列表即 price!=null 的条目）
  stackable: boolean;
  usableOn: 'STUDENT' | 'SELF' | 'NONE';
  action: ItemAction;            // 判别联合：使用效果
  description: string;
}
export type ItemAction =
  | { type: 'RENAME_CARD' }                                   // 改名卡
  | { type: 'TALENT_UPGRADE' }                                // 进阶石（消耗量按目标稀有度查 economy.yaml）
  | { type: 'TALENT_REROLL' }                                 // 洗练券
  | { type: 'MINDSET_DELTA'; amount: number }
  | { type: 'ENERGY_MAX_DELTA'; amount: number }
  | { type: 'BOOK'; ability: AbilityKey }                     // 六维书/思维书/代码书/出题书
  | { type: 'STAMINA_POTION' }
  | { type: 'TAG_CARD' }                                      // PVP 独占 tag 获取卡
  | { type: 'BOX'; rolls: BoxRollSpec[] }                     // 礼盒：按权重池开箱
  | { type: 'EVENT_TOOL'; toolId: string }                    // 奶茶/备用网线/防火墙等事件化解道具
  | { type: 'QUEST_MARKER' };                                 // 情报/线索类，仅持有判定

/** events.yaml —— 历练事件（41 条，GAME-DESIGN §10 底稿的字段化） */
export interface EventDefinition {
  id: string;                    // "G1" .. "C2"，稳定且不可复用
  title: string;
  category: EventCategory;
  rarity: Rarity;
  staminaCost: 1 | 2 | 3;
  once: boolean;                 // 一次性事件
  cooldownDays?: number;         // 可重复事件的冷却
  weight: number;                // 同稀有度池内抽取权重
  requires?: EventRequirement[];
  options: EventOption[];        // ≥1 个；多段事件靠 option outcome 分支续接
}
export type EventRequirement =
  | { kind: 'REPUTATION_AT_LEAST'; value: number }
  | { kind: 'ITEM_HELD'; itemId: string }
  | { kind: 'ABILITY_AT_LEAST'; ability: AbilityKey; value: number };
export interface EventOption {
  label: string;
  requirements?: EventRequirement[];
  outcomes: WeightedOutcome[];   // 加权抽取；含 DUEL 型 outcome 时走 §8.2 对决
}
export interface WeightedOutcome {
  weight: number;
  outcome:
    | { type: 'MONEY'; delta: number }
    | { type: 'REPUTATION'; delta: number }
    | { type: 'ITEM_GRANT'; itemId: string; quantity: number }
    | { type: 'ITEM_CONSUME'; itemId: string }               // 用道具化解麻烦
    | { type: 'STAT_DELTA'; ability: AbilityKey; delta: number; studentScope: 'ACTOR' | 'ALL' }
    | { type: 'MINDSET_DELTA'; delta: number }
    | { type: 'DUEL'; duel: DuelEventSpec }                  // 对决/遭遇战
    | { type: 'MINI_CONTEST'; contest: MiniContestSpec }     // Y1 校内模拟赛等小型赛
    | { type: 'RECRUIT_OFFER'; qualityFloor: string }        // P6 天才少年等招募机会
    | { type: 'PASSIVE_INCOME'; kind: 'SPONSORSHIP' | 'GUEST_LECTURER'; durationDays?: number } // P4/Y6
    | { type: 'BUFF'; buffId: string; durationHours: number } // Y8 曝光 buff 等
    | { type: 'BRANCH'; eventId: string };                   // 跳转到后续事件
}

/** stages.yaml —— 剧情章节/关卡/NPC 池/奖励 */
export interface StageConfig {
  key: string;                   // 如 "csp-j.s1"
  chapter: ChapterKey;
  index: number;                 // 关位 1..5
  kind: 'WARMUP' | 'MOCK_1' | 'MOCK_2' | 'MOCK_3' | 'FINAL';
  rosterSize: number;            // 参赛学员数（题目数与之匹配）
  questions: QuestionTemplateRef[];   // 引用 problems.yaml 模板 id
  npcPool: NpcPoolParams;             // NPC 选手池参数（人数/属性分布），数值全在 yaml
  rewards: StageRewardSpec;           // 首通钱/道具池/里程碑道具，引用 items.yaml id
}
export interface QuestionTemplateRef {
  templateId: string;            // problems.yaml 中的模板 id
  dimension: DimensionKey;       // 主导六维
  traitPool?: { severityFloor: TraitSeverity; chanceBps: number }[];  // 特性出现概率随 NG+ 上移
}

/** economy.yaml —— 经济与恢复参数（单文档单对象，非列表） */
export interface EconomyConfig {
  recovery: {
    staminaPerHourBase: number;      // 体力恢复速率基准（× 学员 staminaRegen）
    energyPerHourBase: number;
    mindsetPerHour: number;          // 心态向基线回归速率
    mindsetBaseline: number;         // 回归目标
  };
  trainingCostFormula: string;       // 表达式串，随学员数增长（§9 训练消耗）
  recruitCostFormula: string;        // 招募费递增公式
  poolRefreshCost: number;
  upgradeStoneCostByTarget: Record<Rarity, number>;   // §7.3 进阶石消耗（灰→黄=1 … 紫→彩=8）
  lectureTiers: { tier: LectureTier; requirement: Record<AbilityKey, number>; rewardFormula: string }[];
  passiveIncome: Record<'SPONSORSHIP' | 'GUEST_LECTURER', { moneyPerDay: number; repPerDay?: number }>;
  dismissRepPenalty: number;         // 开除声誉惩罚
  dismissRenameCardChanceBps: number;// 开除回收改名卡概率
  ngPlus: { demandMultiplierPerLevel: number; traitChanceAddBpsPerLevel: number; moneyMultiplierPerLevel: number };
}
```

> 注：以上接口是**契约形状**。zod schema 才是运行时权威；两者由 `z.infer` 绑定保证一致。effect/outcome 的 `kind/type` 取值集合最终以 `config-types.ts` 中 schema 定义收口，新增玩法先扩 schema 再写逻辑。

### 2.3 领域快照与战报（domain.ts）

```ts
/** 学员对外展示快照（API 返回给前端的形态；内部浮点资源已取整） */
export interface StudentView {
  id: number;
  name: string;
  sex: 'MALE' | 'FEMALE';
  abilities: Record<AbilityKey, number>;   // 六维 + coding/thinking/problemSkill
  mindset: number;
  focusCap: number;
  energy: number; energyMax: number;
  stamina: number; staminaMax: number; staminaRegen: number;
  talents: { talentId: string; name: string; rarity: Rarity }[];
  status: 'ACTIVE' | 'DISMISSED';
  recruitedAt: string;
}

/** 参赛者模拟输入快照（进入比赛时冻结，之后学员变化不影响已开赛事） */
export interface ParticipantSnapshot {
  side: 'HOME' | 'AWAY' | 'NPC';
  userId: number | null;          // NPC 为 null
  studentId: number | null;
  displayName: string;
  abilities: Record<AbilityKey, number>;
  mindset: number;
  focusCap: number;
  energyMax: number;
}

/** 题目参数快照 */
export interface QuestionSnapshot {
  index: number;
  dimension: DimensionKey;
  demand: number;                 // 六维需求 D
  thought: number;                // 思维量 M
  codeVolume: number;             // 代码量 C
  score: number;
  timeLimitMin: number;
  trait?: { traitId: string; severity: TraitSeverity };
  source: 'GENERATED' | 'PREMADE';   // 临场生成 or 预制题
  premadeEntryId?: number;
}

/** 战报公共头 */
export interface ReportHeader {
  reportVersion: 1;               // 引擎结构版本，渲染层按版本兼容
  seed: number;                   // u32；同 seed 同输入必复现本报告
  createdAt: string;
}

/** §8.1 排名制赛战报（剧情/小型赛） */
export interface RankingReport extends ReportHeader {
  format: 'RANKING';
  questions: QuestionSnapshot[];
  participants: ParticipantTimeline[];
  standings: { participantIndex: number; totalScore: number; rank: number }[];
}
export interface ParticipantTimeline {
  participant: ParticipantSnapshot;
  attempts: {
    questionIndex: number;
    verdict: 'AC' | 'WA' | 'TLE' | 'SKIP';    // SKIP=弃题（精力耗尽）
    minutesUsed: number;
    penaltyMin?: number;                       // WA +20min 一类罚时由特性/规则注入
    focusGain: number;
    energyCost: number;
    mindsetDelta: number;
  }[];
  totalEnergySpent: number;
  finalMindset: number;
}

/** §8.2 出题对决战报（PVP/历练遭遇战） */
export interface DuelReport extends ReportHeader {
  format: 'DUEL';
  rounds: DuelRoundReport[];      // 固定 4 局 + 可能的加赛局
  scores: { home: number; away: number };
  tiebreak?: 'SUDDEN_DEATH' | 'ENERGY' | 'QUALITY' | 'FRIENDLY';  // 平局分流侧重，由场景注入
  qualityRuleOn: boolean;         // 是否启用【考察出题质量】（未解出出题方+2）
  winnerSide: 'HOME' | 'AWAY' | 'DRAW';
}
export interface DuelRoundReport {
  roundNo: number;                // 1..4，加赛从 5 起
  setterSide: 'HOME' | 'AWAY';    // 本局出题方
  question: QuestionSnapshot;
  answerer: ParticipantSnapshot;
  solved: boolean;
  scoreAwarded: number;           // 常规 +1；考察出题质量下未解出为 +2
  reason: 'AC' | 'WA' | 'TLE';
}

export type ContestReport = RankingReport | DuelReport;

/** 结果摘要（落库 ContestRecord.summary，列表页免解析大 JSON） */
export interface ContestSummary {
  format: 'RANKING' | 'DUEL';
  rank?: number; participantCount?: number; totalScore?: number;   // RANKING
  winnerSide?: 'HOME' | 'AWAY' | 'DRAW'; homeScore?: number; awayScore?: number; // DUEL
}
```

### 2.4 API DTO（api.ts，示例节选）

统一信封与分页：

```ts
export interface ApiEnvelope<T> { ok: true; data: T }
export interface ApiError {
  ok: false;
  error: { code: ErrorCode; message: string; details?: unknown };
}
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'INVALID_CREDENTIALS' | 'TOKEN_EXPIRED'
  | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED'
  | 'INSUFFICIENT_RESOURCE' | 'STATE_CONFLICT' | 'ALREADY_EXISTS'
  | 'RATE_LIMITED' | 'INTERNAL';
```

代表性请求/响应（完整清单随模块实现扩充，命名规约：`XxxReq` / `XxxRes`）：

```ts
export interface LoginReq  { username: string; password: string }
export interface LoginRes  { accessToken: string; user: MeView }   // refreshToken 走 HttpOnly Cookie
export interface MeView    { id: number; username: string; role: 'USER'|'ADMIN';
                             money: number; reputation: number; badges: string[];
                             createdAt: string; lastLoginAt: string|null }

export interface TrainBasicReq    { studentId: number }
export interface TrainDirectedReq { studentId: number; ability: AbilityKey }   // 自动扣减对应书籍
export interface TrainSpecializedReq { studentId: number; ability: AbilityKey; problemEntryId: number }

export interface AdventureDrawReq   { studentId: number; tier: 1|2|3 }
export interface AdventureDrawRes   { logId: number; event: EventDefinition; availableOptions: number[] }
export interface AdventureChoiceReq { logId: number; optionIndex: number }

export interface StoryEnterReq { roster: number[] }               // 长度=stage.rosterSize
export interface StoryEnterRes { recordId: number; report: RankingReport }

export interface PvpRegisterReq { roster: number[]; problemEntryIds?: number[] }

export interface UseConsumableReq { itemId: string; params?: { talentId?: string; targetTalentId?: string } }
```

---
## 3. 数据库设计（Prisma Schema 级）

MySQL 8 + Prisma 最新稳定版（6.x）。设计要点先行：

- **主键**：业务表用 `Int autoincrement`（规模下 21 亿上限足够）；配置表用**语义化字符串 id**（如 `memoize.green`、`G1`、`csp-j.s1`），保证跨环境/跨版本稳定，是"配置即数据"的锚点。
- **快照优于引用**：参赛学员属性、报名阵容、题目参数一律在开赛/报名时刻**冻结为 JSON 快照**存入记录表；此后学员成长、开除、道具变动都不影响历史对局的可复现性与公平性。战报与快照自包含，不依赖 join。
- **JSON 列**用于：战报、快照、奖励明细、配置 payload、勋章列表。形状由 shared 类型约束，读取端按 `reportVersion` 容错渲染。
- **浮点资源列**：`stamina/energy/mindset` 存 `Float`——惰性恢复是连续量，取整只发生在 API 出口（`Math.floor`），避免高频小额结算丢失小数（§6）。
- **删除策略**：玩家数据随账号注销**硬删**（DB 级联），仅 AdminAuditLog 留档并将 adminId 置空（理由见 §9.6）。学员开除是软状态（`status=DISMISSED`），保留供历史战报/历练档案展示。

```prisma
// apps/api/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// ───────────────────────── 枚举 ─────────────────────────

enum Role {
  USER
  ADMIN
}

enum Sex {
  MALE
  FEMALE
}

enum StudentStatus {
  ACTIVE
  DISMISSED
}

enum ContestType {
  STORY
  PVP
  ADVENTURE
}

enum ContestFormat {
  RANKING
  DUEL
}

enum AdventureStatus {
  PENDING   // 已抽到事件、等待提交选项
  RESOLVED
}

enum TournamentStatus {
  REGISTERING
  RUNNING
  FINISHED
  CANCELLED
}

enum MatchStatus {
  PENDING
  DONE
  BYE       // 轮空
}

enum AcquiredVia {
  RECRUIT
  EVENT
  UPGRADE    // 进阶石升阶
  REROLL     // 洗练券洗出
  ADMIN
}

enum EntryStatus {
  AVAILABLE
  CONSUMED
}

enum PassiveKind {
  SPONSORSHIP      // P4 商业赞助契约
  GUEST_LECTURER   // Y6 雇教练代课
  OTHER
}

// ───────────────────────── 账号域 ─────────────────────────

model User {
  id            Int       @id @default(autoincrement())
  username      String    @unique @db.VarChar(32)
  passwordHash  String?   // 注销流程中先置空再级联硬删（§9.6）
  role          Role      @default(USER)
  money         Int       @default(0)          // Int 上限约 2.1e9，代码层加溢出护栏
  reputation    Int       @default(0)
  badges        Json      @default("[]")       // 勋章 id 数组，如 "legendary_coach"
  tokenVersion  Int       @default(0)          // 改密/登出全部设备时 +1，使存量 JWT 失效
  bannedAt      DateTime?                       // 管理员封禁；非空则一切鉴权拒绝
  lastLoginAt   DateTime?
  lastSettledAt DateTime  @default(now())      // 被动收入惰性结算锚点（§6）
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  students         Student[]
  items            UserItem[]
  problemEntries   ProblemLibraryEntry[]
  contestRecords   ContestRecord[]
  storyProgress    StoryProgress[]
  adventureLogs    AdventureLog[]
  pvpRegistrations PvpRegistration[]
  passiveSources   PassiveIncomeSource[]
  reputationLogs   ReputationLog[]
}

model ReputationLog {
  id           Int      @id @default(autoincrement())
  userId       Int
  delta        Int                                    // 正负皆可
  reason       String   @db.VarChar(64)               // LECTURE / CONTEST_RANK / DISMISS / EVENT:<id> / PVP_PRIZE …
  refType      String?  @db.VarChar(32)               // CONTEST_RECORD / ADVENTURE_LOG / …
  refId        String?  @db.VarChar(64)
  balanceAfter Int                                    // 冗余余额，审计免逐条累加
  createdAt    DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}

// ───────────────────────── 学员域 ─────────────────────────

model Student {
  id           Int           @id @default(autoincrement())
  userId       Int
  name         String        @db.VarChar(24)
  sex          Sex
  // —— 能力值（1–100；成长曲线见 systems/progression.md）——
  coding       Int                                         // 代码能力
  thinking     Int                                         // 思维能力
  dimDs        Int                                         // 六维：数据结构
  dimDp        Int                                         // 六维：DP
  dimMath      Int                                         // 六维：数学
  dimGraph     Int                                         // 六维：图论
  dimGreedy    Int                                         // 六维：贪心
  dimStr       Int                                         // 六维：字符串
  problemSkill Int                                         // 出题能力
  // —— 战斗内资源与上限 ——
  mindset      Float                                       // 心态，可为负；内部浮点便于惰性回归
  focusCap     Int                                         // 专注力上限
  energyMax    Int
  energy       Float
  staminaMax   Int                                         // 当前规格恒定值来自配置，仍落列以备未来道具扩展
  stamina      Float
  staminaRegen Float                                       // 体力恢复效率系数（基准 1.0）
  status       StudentStatus @default(ACTIVE)
  lastSettledAt DateTime      @default(now())              // 学员资源惰性结算锚点（§6）
  recruitedAt  DateTime      @default(now())
  dismissedAt  DateTime?
  updatedAt    DateTime      @updatedAt

  user           User                    @relation(fields: [userId], references: [id], onDelete: Cascade)
  talents        StudentTalent[]
  adventures     AdventureLog[]          @relation("AdventureActor")
  authoredProblems ProblemLibraryEntry[] @relation("ProblemAuthor")

  @@index([userId, status])
}

model StudentTalent {
  id           Int          @id @default(autoincrement())
  studentId    Int
  talentId     String       @db.VarChar(64)             // → ConfigTalent.id
  acquiredVia  AcquiredVia
  fromTalentId String?      @db.VarChar(64)             // 升阶/洗练前的天赋 id，溯源用
  createdAt    DateTime     @default(now())

  student Student      @relation(fields: [studentId], references: [id], onDelete: Cascade)
  talent  ConfigTalent @relation(fields: [talentId], references: [id], onDelete: Restrict)

  @@unique([studentId, talentId])                        // 同一天赋不可重复持有（家族升阶=替换行）
  @@index([talentId])
}

// ───────────────────────── 物品域 ─────────────────────────

model UserItem {
  id       Int    @id @default(autoincrement())
  userId   Int
  itemId   String @db.VarChar(64)                       // → ConfigItem.id
  quantity Int                                            // >0 才保留行；扣到 0 即删除行

  user User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  item ConfigItem @relation(fields: [itemId], references: [id], onDelete: Restrict)

  @@unique([userId, itemId])
  @@index([itemId])
}

model ProblemLibraryEntry {
  // 【M1-R8 修订】M1 落地为最小版（专项训练耗材），M3 出题玩法上线时
  // 以迁移追加 demand/thought/codeVolume/traitId/status/timesUsed 等列。
  id              Int         @id @default(autoincrement())
  userId          Int                                        // 归属玩家（题库是账号资产）
  authorStudentId Int?                                       // 出题学员；开除后置空保留题目
  name            String      @db.VarChar(64)
  dominantDim     String      @db.VarChar(8)                 // DimensionKey（锚定六维）
  rarity          String      @db.VarChar(8)                 // 六档稀有度（→专项训练 QualityMult）
  quality         Int                                        // 质量评级 Q（0–100）
  consumedAt      DateTime?                                  // 被专项训练消耗时间（耗材语义）
  createdAt       DateTime   @default(now())

  @@index([userId, consumedAt])
}

// ───────────────────────── 对局域 ─────────────────────────

model ContestRecord {
  id              Int           @id @default(autoincrement())
  userId          Int                                          // 发起玩家（PVP 对局归属主队侧玩家各存一条亦可，见下注）
  type            ContestType                                  // STORY | PVP | ADVENTURE
  format          ContestFormat                                // RANKING | DUEL
  refType         String?       @db.VarChar(32)                // STORY_STAGE / ADVENTURE_EVENT / PVP_MATCH
  refId           String?       @db.VarChar(64)
  participants    Json                                         // ParticipantSnapshot[]（含 NPC）
  problemSnapshot Json                                         // QuestionSnapshot[]（预制题为值拷贝）
  seed            Int                                          // u32 种子（有符号存储，经 toU32 归一使用）
  summary         Json                                         // ContestSummary
  rewards         Json?                                        // 奖励发放明细 [{itemId,quantity}|{money}|{stone}]
  report          Json                                         // ContestReport 完整战报
  createdAt       DateTime      @default(now())

  user User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  pvpMatch      PvpMatch?                                           // PVP 对局反向可达（1:1）
  adventureLogs AdventureLog[]                                      // 历练对决产出引用

  @@index([userId, createdAt])
  @@index([userId, type, createdAt])
}

model StoryProgress {
  id           Int       @id @default(autoincrement())
  userId       Int
  ngLevel      Int                                     // 0 = 一周目；NG+ 第 k 层即 k
  stageKey     String    @db.VarChar(32)               // → ConfigStage.id（chapter 由 key 编码）
  firstClearAt DateTime?
  bestRank     Int?
  clearCount   Int       @default(0)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, ngLevel, stageKey])
}

model AdventureLog {
  id        Int             @id @default(autoincrement())
  userId    Int
  studentId Int?                                           // 执行学员；开除后置空
  eventId   String          @db.VarChar(32)                // → ConfigEvent.id
  tier      Int                                            // 体力投入档 1|2|3（抽事件时已扣减）
  seed      Int
  status    AdventureStatus @default(PENDING)
  choices   Json            @default("[]")                 // 已提交选项索引序列
  results   Json            @default("[]")                 // 分段结算摘要
  contestRecordId Int?                                    // 对决/小型赛产出 → ContestRecord
  createdAt DateTime        @default(now())
  resolvedAt DateTime?

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  actorStudent  Student?       @relation("AdventureActor", fields: [studentId], references: [id], onDelete: SetNull)
  contestRecord ContestRecord? @relation(fields: [contestRecordId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([userId, status])                               // "存在 PENDING 则禁止再抽"查询
  @@index([userId, eventId])                              // once 一次性判定
}

// ───────────────────────── PVP 域 ─────────────────────────

model PvpTournament {
  id              Int              @id @default(autoincrement())
  name            String           @db.VarChar(64)
  status          TournamentStatus @default(REGISTERING)
  registerEndsAt  DateTime
  autoStartAt     DateTime                                      // 到点后由懒推进结算（§6.5）
  prizes          Json             @default("{}")               // 名次→奖励明细（管理员可改）
  config          Json             @default("{}")               // rosterSize 等（键名契约见 shared）
  createdBy       Int?
  createdAt       DateTime         @default(now())

  admin         User?             @relation(fields: [createdBy], references: [id], onDelete: SetNull)
  registrations PvpRegistration[]
  matches       PvpMatch[]

  @@index([status, autoStartAt])                              // 懒推进扫描
}

model PvpRegistration {
  id              Int      @id @default(autoincrement())
  tournamentId    Int
  userId          Int
  roster          Json                                     // ParticipantSnapshot[] 报名即锁定
  problemEntryIds Json     @default("[]")                  // 携带预制题 id 列表（对局时值拷贝）
  createdAt       DateTime @default(now())

  tournament PvpTournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([tournamentId, userId])
}

model PvpMatch {
  id              Int         @id @default(autoincrement())
  tournamentId    Int
  round           Int                                          // 1 = 首轮
  slot            Int                                          // 轮内位置
  homeUserId      Int?
  awayUserId      Int?
  homeScore       Int?
  awayScore       Int?
  winnerUserId    Int?                                         // BYE 时=晋级方
  status          MatchStatus @default(PENDING)
  contestRecordId Int?                                         // → ContestRecord（对局战报）
  playedAt        DateTime?

  tournament     PvpTournament  @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  contestRecord  ContestRecord? @relation(fields: [contestRecordId], references: [id], onDelete: SetNull)

  @@unique([tournamentId, round, slot])
  @@index([tournamentId, round])
}

// ───────────────────────── 被动收入 ─────────────────────────

model PassiveIncomeSource {
  id          Int         @id @default(autoincrement())
  userId      Int
  kind        PassiveKind
  moneyPerDay Int         @default(0)
  repPerDay   Int         @default(0)
  startedAt   DateTime    @default(now())
  expiresAt   DateTime?                                   // null = 无限期
  originRef   String?     @db.VarChar(64)                 // 来源 AdventureLog / 事件 id

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// ───────────────────────── 配置域（yaml 导入目标） ─────────────────────────
// 公共字段约定：id=语义化稳定 id；sourceHash=导入批次指纹；payload=zod 校验后的完整定义；
// deprecated=本批 yaml 中消失的历史条目（软弃用，绝不物理删除——玩法数据外键仍需有效）。

model ConfigTalent {
  id         String   @id @db.VarChar(64)
  sourceHash String   @db.VarChar(64)
  payload    Json
  deprecated Boolean  @default(false)
  importedAt DateTime @updatedAt

  studentTalents StudentTalent[]
}

model ConfigItem {
  id         String   @id @db.VarChar(64)
  sourceHash String   @db.VarChar(64)
  payload    Json
  deprecated Boolean  @default(false)
  importedAt DateTime @updatedAt

  holdings UserItem[]
}

model ConfigProblem {          // 题目模板 + 特性定义（problems.yaml）
  id         String   @id @db.VarChar(64)
  sourceHash String   @db.VarChar(64)
  payload    Json
  deprecated Boolean  @default(false)
  importedAt DateTime @updatedAt
}

model ConfigEvent {            // 历练事件（events.yaml）
  id         String   @id @db.VarChar(64)
  sourceHash String   @db.VarChar(64)
  payload    Json
  deprecated Boolean  @default(false)
  importedAt DateTime @updatedAt
}

model ConfigStage {            // 章节/关卡/NPC 池/首通奖励（stages.yaml）
  id         String   @id @db.VarChar(64)
  sourceHash String   @db.VarChar(64)
  payload    Json
  deprecated Boolean  @default(false)
  importedAt DateTime @updatedAt
}

model ConfigEconomy {          // 经济参数单行（economy.yaml，id 固定 "active"）
  id         String   @id @db.VarChar(64)
  sourceHash String   @db.VarChar(64)
  payload    Json
  deprecated Boolean  @default(false)
  importedAt DateTime @updatedAt
}

model ConfigImport {           // 导入历史（审计 + 幂等跳过依据）
  id         Int      @id @default(autoincrement())
  sourceHash String   @db.VarChar(64)
  manifest   Json                                    // 文件→字节数/实体数/耗时
  ok         Boolean
  errorCount Int      @default(0)
  createdAt  DateTime @default(now())

  @@index([createdAt])
}

// ───────────────────────── 管理域 ─────────────────────────

model AdminAuditLog {
  id                Int      @id @default(autoincrement())
  adminId           Int?                                  // 管理员注销后置空
  adminNameSnapshot String @db.VarChar(32)                // 冗余用户名留档
  action            String @db.VarChar(64)               // TOURNAMENT_CREATE / PRIZE_UPDATE / USER_BAN / CONFIG_RELOAD …
  targetType        String? @db.VarChar(32)
  targetId          String? @db.VarChar(64)
  payload           Json?                                 // 请求要点脱敏后留档
  ip                String? @db.VarChar(45)
  createdAt         DateTime @default(now())

  @@index([adminId, createdAt])
  @@index([action, createdAt])
}
```

### 3.1 索引设计说明

| 表 | 索引 | 支撑的查询 / 理由 |
|---|---|---|
| User | `username` unique | 登录与注册重名检查；唯一索引即查询索引 |
| Student | `(userId, status)` | 学员管理列表恒定按"当前玩家 + 过滤 DISMISSED"查询 |
| StudentTalent | `(studentId,talentId)` unique、`talentId` | 唯一性防重复持有；talentId 用于全服天赋分布统计 |
| UserItem | `(userId, itemId)` unique | 背包页整包读 + 使用道具原子扣减定位 |
| ProblemLibraryEntry | `(ownerId,status,createdAt)` | 题库页按可用状态倒序分页 |
| ContestRecord | `(userId,createdAt)`、`(userId,type,createdAt)` | 个人战绩时间线；按类型筛选（剧情/PVP/历练） |
| StoryProgress | `(userId,ngLevel,stageKey)` unique | 进度读写均按此三元组点查；唯一约束兼防重复首通竞态 |
| AdventureLog | `(userId,createdAt)`、`(userId,status)`、`(userId,eventId)` | 历史、PENDING 判定、once 判定三条热路径 |
| PvpTournament | `(status,autoStartAt)` | 锦标赛列表 + 懒推进候选扫描 |
| PvpRegistration | `(tournamentId,userId)` unique | 报名幂等；重复报名直接冲突报错 |
| PvpMatch | `(tournamentId,round,slot)` unique、`(tournamentId,round)` | 轮次生成防重；对阵树按轮读取 |
| PassiveIncomeSource | `(userId)` | 用户级惰性收入结算扫描 |
| Config* 表 | 主键即语义 id | 运行时点查为主；导入走 upsert 主键命中 |
| ReputationLog / AdminAuditLog | `(userId/adminId,createdAt)` | 审计时间线倒序分页 |

不建索引的原则：JSON 列一律不建索引（无 JSON_CONTAINS 查询需求，快照只在拿到记录 id 后读取）；低基数列（sex、format）单独索引无意义，仅作为复合索引尾列出现。

---
## 4. 配置即数据管线

### 4.1 总体流程

```mermaid
flowchart TD
    A["docs/data/*.yaml<br/>talents / items / problems / events / stages / economy"] --> B["启动时加载 + YAML 解析"]
    B --> C{"zod schema 逐文件校验<br/>(strict: 未知键报错)"}
    C -- 任一失败 --> F["汇总全部错误打印表格<br/>process.exit(1) 快速失败"]
    C -- 通过 --> D{"语义交叉校验<br/>(引用完整性/公式可求值)"}
    D -- 任一失败 --> F
    D -- 通过 --> E["sourceHash = SHA-256(全部原始 yaml 拼接)"]
    E --> G{"config_imports 已有<br/>同 hash 且 ok=true ?"}
    G -- 是 --> H["直接载入内存缓存 CONFIG<br/>(幂等跳过, 秒级启动)"]
    G -- 否 --> I["单事务: 逐条 upsert Config_* 表<br/>本批缺失的历史条目置 deprecated=true<br/>插入 config_imports 记录"]
    I --> J["冻结为只读内存缓存 CONFIG"]
    J --> K["GET /api/meta 暴露 configVersion=sourceHash 前 12 位"]
```

设计动机：`docs/data/*.yaml` 是策划与运行时的**单一事实源**。策划改数值 → 提交 yaml → 重启容器即生效，无需发版、无需后台管理界面维护两套数据。

### 4.2 导入器伪代码（apps/api/src/config/config-import.ts）

```ts
const FILES = ['talents', 'items', 'problems', 'events', 'stages', 'economy'] as const;

async function importConfigs(prisma: PrismaClient): Promise<ConfigBundle> {
  // 1. 加载与解析
  const raw = Object.fromEntries(
    FILES.map(f => [f, loadYamlFileSync(path.join(CONFIG_DIR, `${f}.yaml`))]),
  );

  // 2. 结构校验 —— 收集"所有"文件的"所有"错误，一次性报全，绝不逐个试错
  const errors: ZodErrorWithFile[] = [];
  const parsed = {} as ParsedConfigs;
  for (const f of FILES) {
    const r = configSchemas[f].safeParse(raw[f]);       // shared 包导出的 zod schema
    if (r.success) parsed[f] = r.data;
    else errors.push({ file: f, issues: r.error.issues });
  }
  if (errors.length > 0) {
    printErrorTable(errors);                            // 文件/路径/期望/实得 三列表格
    throw new FatalStartupError('config validation failed');
  }

  // 3. 语义校验（跨文件引用完整性，同样收集全部错误）
  runSemanticChecks(parsed);
  //   - talent.parentId 必须存在，且目标稀有度恰好高一级（家族链合法性）
  //   - events 的 ITEM_GRANT/ITEM_CONSUME/BOX 引用的 itemId 必须存在于 items
  //   - stages.questions[].templateId 必须存在于 problems；奖励道具 id 同上
  //   - economy 公式串可求值且对自变量单调（防手滑写出负成本）
  //   - upgradeStoneCostByTarget 覆盖全部六档稀有度

  // 4. 版本指纹与幂等判断
  const sourceHash = sha256(canonicalJson(raw));
  const done = await prisma.configImport.findFirst({ where: { sourceHash, ok: true } });
  if (done) return loadBundleFromDb(prisma);            // 重启零成本

  // 5. 事务性导入：配置整体要么全量生效、要么保持旧版
  await prisma.$transaction(async tx => {
    for (const t of parsed.talents)
      await tx.configTalent.upsert({
        where: { id: t.id },
        create: { id: t.id, sourceHash, payload: t },
        update: { sourceHash, payload: t, deprecated: false },   // 复活曾弃用条目
      });
    // ... items/problems/events/stages/economy 同构循环 ...
    // 本批消失的条目 → 软弃用（保留行，历史外键仍有效）
    await markDeprecated(tx, 'configTalent',
      idsOf(parsed.talents), /* where */ { deprecated: false, id: { notIn: idsOf(parsed.talents) } });
    // ... 其余 Config 表同理 ...
    await tx.configImport.create({
      data: { sourceHash, manifest: buildManifest(raw), ok: true },
    });
  }, { timeout: 20_000 });

  return loadBundleFromDb(prisma);                      // 冻结进只读内存缓存 CONFIG
}
```

要点：

- **快速失败**：启动路径上任何校验失败都让 API 容器以非零码退出。compose 中 api 是 mysql 的下游消费者，api 起不来在 `docker compose ps` 一眼可见——坏配置永远不会带病上线。
- **软弃用而非删除**：历史玩法数据（StudentTalent、UserItem、AdventureLog.eventId）外键指向 Config 表。条目从 yaml 移除时仅标记 `deprecated=true`，保证老记录永远可解释。
- **运行时只读内存缓存**：游戏逻辑读 `CONFIG.talents['memoize.green']` 纯内存操作，不查库。缓存视为不可变；管理员触发的 `POST /api/admin/config/reload` 会重新执行同一管线并原子替换缓存对象引用。
- **canonicalJson**：键排序后的稳定序列化，保证同一份文件在任何机器算出相同 hash。

---

## 5. API 设计

### 5.1 通用约定

- **前缀与版本**：统一 `/api` 前缀，**不做 `/v1` 版本化**——前后端同仓同发布节奏，breaking change 由 TS 类型在编译期暴露，无第三方客户端。
- **鉴权方式**：`Authorization: Bearer <accessToken>`（15 分钟短效 JWT）；刷新令牌走 HttpOnly Cookie（§9.2）。公开端点在下表标注"公开"。
- **时间**：一律 ISO 8601 UTC 字符串；前端用 `GET /api/meta` 返回的服务器时间 + 恢复速率做本地投影倒计时（§8）。
- **分页**：`?page=&pageSize=`，默认 20，上限 100，响应包 `Page<T>`。
- **幂等键**：高代价变更端点接受可选 `Idempotency-Key` 请求头（UUID），服务端在内存 LRU（TTL 10 分钟）中记录 key→响应，重放返回原响应而非重复执行。覆盖端点：剧情开赛、招募、商城下单、PVP 报名。单实例前提下内存方案足够（§12 T8）。

统一响应包装：

```jsonc
// 成功
{ "ok": true, "data": { /* 各端点定义 */ } }
// 失败
{ "ok": false, "error": {
    "code": "INSUFFICIENT_RESOURCE",
    "message": "体力不足",
    "details": { "resource": "STAMINA", "need": 2, "have": 1 } } }
```

错误码约定：

| code | HTTP | 场景 |
|---|---|---|
| UNAUTHENTICATED | 401 | 未登录 / token 无效或已因 tokenVersion 变更失效 |
| INVALID_CREDENTIALS | 401 | 用户名或密码错误（不区分二者，防枚举） |
| TOKEN_EXPIRED | 401 | accessToken 过期；前端应静默调 refresh 后重放 |
| FORBIDDEN | 403 | 权限不足（含访问他人学员、USER 打 admin 路由、被封禁） |
| NOT_FOUND | 404 | 资源不存在或不属于当前用户（后者统一 404 防探测） |
| VALIDATION_FAILED | 400 | zod 校验失败，details 携带字段级问题 |
| INSUFFICIENT_RESOURCE | 409 | 钱/声誉/体力/精力/道具不足，details.resource 标明种类 |
| STATE_CONFLICT | 409 | 状态机不允许（报名已截止、赛事已开赛、事件选项非法等） |
| ALREADY_EXISTS | 409 | 唯一冲突（重复报名、槽位已被招募） |
| RATE_LIMITED | 429 | 触发限流 |
| INTERNAL | 500 | 未预期异常（日志含 requestId） |

并发控制三件套（贯穿下表所有扣减类端点）：

1. **条件 UPDATE 防负数**：一切资源扣减使用带条件的 `updateMany`，影响行数为 0 即资源不足：

```ts
const r = await tx.student.updateMany({
  where: { id, userId, status: 'ACTIVE', stamina: { gte: cost } },
  data: { stamina: { decrement: cost } },
});
if (r.count === 0) throw new ApiError('INSUFFICIENT_RESOURCE', { resource: 'STAMINA' });
```

2. **行锁串行化写路径**：涉及"结算→判定→多表写"的动作（训练/历练/开赛/使用道具）在交互式事务内先 `SELECT ... FOR UPDATE` 锁定学员行再做后续步骤，杜绝双击双扣与结算丢失（详见 §6.3）。
3. **固定加锁顺序**：同时涉及 User 与 Student 行的事务按 `User → Student` 顺序加锁，杜绝交叉死锁；事务冲突（Prisma P2034）统一由 `withTxRetry` 包装做小退避重试。

### 5.2 路由总表

鉴权列：公开 / 登录 / 管理。共 **48** 个端点。

**认证与元信息**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 1 | POST /api/auth/register | 公开 | username+password（zod 强度校验） | 自动登录，accessToken + 刷新 Cookie | 注册 |
| 2 | POST /api/auth/login | 公开 | username+password | accessToken + 刷新 Cookie；更新 lastLoginAt | 登录 |
| 3 | POST /api/auth/refresh | 公开(Cookie) | 无 body，读 HttpOnly 刷新 Cookie | 轮换新 accessToken + 新 Cookie | 会话续期 |
| 4 | POST /api/auth/logout | 登录 | — | 清 Cookie；tokenVersion+1 全设备失效 | 登出 |
| 5 | PUT /api/auth/password | 登录 | oldPassword+newPassword | 成功后 tokenVersion+1，需重新登录 | 设置页改密 |
| 6 | POST /api/auth/deactivate | 登录 | password 确认 | 硬删账号数据（§9.6），清 Cookie | 设置页注销 |
| 7 | GET /api/users/me | 登录 | — | MeView（id/注册时间/lastLoginAt/钱/声誉/勋章） | 设置页展示 |
| 8 | GET /api/meta | 公开 | — | configVersion、serverTime、恢复速率常量 | 前端本地投影 |

**学员管理**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 9 | GET /api/students | 登录 | ?status=&sort= | StudentView[]，含惰性投影后的体力/精力 | 学员列表 |
| 10 | GET /api/students/:id | 登录 | — | StudentView 详情 + 天赋列表 | 学员详情 |
| 11 | PATCH /api/students/:id/name | 登录 | newName；自动消耗改名卡×1 | 新名字；无改名卡 409 | 改名卡改名 |
| 12 | DELETE /api/students/:id | 登录 | — | 扣声誉（economy.dismissRepPenalty）、概率回收改名卡、status→DISMISSED | 开除 |
| 13 | POST /api/students/:id/consumables | 登录 | itemId + params（升阶指明天赋、洗练指定方向锁定等） | 结算结果（升阶成败必成/洗练新天赋/心态增量） | 养成道具 |

**训练**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 14 | POST /api/trainings/basic | 登录 | studentId | 扣钱+体力1，随机六维+Δ（递减曲线），极低概率附赠成长 | §9 基础训练 |
| 15 | POST /api/trainings/directed | 登录 | studentId+ability | 消耗对应书籍，大幅提升指定维度 | 定向训练 |
| 16 | POST /api/trainings/specialized | 登录 | studentId+ability+problemEntryId | 消耗自制预制题，效率高于定向；题目标记 timesUsed+1 | 专项训练 |

**历练**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 17 | POST /api/adventures/draw | 登录 | studentId+tier(1..3)；已有 PENDING 则 409 | 先抽档过滤再稀有度加权池抽取；返回事件与可用选项 | §10 抽事件 |
| 18 | POST /api/adventures/:id/choice | 登录 | optionIndex（须满足 requirements） | 分支/对决（内联生成 ContestRecord）/奖励结算；RESOLVED | 事件选项 |
| 19 | GET /api/adventures/logs | 登录 | 分页 | AdventureLog 历史（含结果摘要） | 历练档案 |

**高级学院**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 20 | GET /api/academy/pool | 登录 | — | 当前学员池（品质档隐藏，只露可见属性）；过期则懒刷新 | §12 招募池 |
| 21 | POST /api/academy/pool/refresh | 登录 | — | 扣 poolRefreshCost，重掷学员池 | 手动刷新 |
| 22 | POST /api/academy/recruits | 登录 | slotId；幂等键 | 按 recruitCostFormula 扣钱；声誉微幅加成属性；生成学员+天赋 | 招募 |
| 23 | GET /api/academy/lecture-tiers | 登录 | — | 五档受众：门槛/报酬公式说明/解锁状态 | 讲课接单面板 |
| 24 | POST /api/academy/lectures | 登录 | studentId+tier | 能力达标即时结算钱+声誉（溢出加成；不足强接则扣声誉）；学员进入讲课冷却 | §12 讲课 |
| 25 | GET /api/academy/lectures | 登录 | 分页 | 讲课历史与收益 | 讲课记录 |

**出题题库**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 26 | POST /api/problem-library | 登录 | studentId+dimension；扣体力 | 出题能力映射质量评级与特性概率；题目入库 | §11 出题行动 |
| 27 | GET /api/problem-library | 登录 | ?status=AVAILABLE | 题目列表（参数+质量+特性+用途计数） | 题库页 |
| 28 | DELETE /api/problem-library/:id | 登录 | — | 仅 AVAILABLE 可删 | 删除预制题 |

**剧情模式**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 29 | GET /api/story/overview | 登录 | ?ngLevel= | 八章关卡树 + 解锁状态 + 进度合并视图 | §13 章节选择 |
| 30 | POST /api/story/stages/:stageKey/enter | 登录 | roster[]（长度=rosterSize）；幂等键；校验前置关卡解锁与 NG+ 层级 | 同步模拟 → ContestRecord + RankingReport + 发奖（首通/名次奖金） | §13 开赛 |
| 31 | GET /api/story/progress | 登录 | — | StoryProgress 全集 | 进度查询 |
| 32 | GET /api/records/:recordId | 登录 | — | ContestRecord（战报 JSON；剧情/PVP/历练共用查看器） | 战报回放 |

**PVP**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 33 | GET /api/pvp/tournaments | 登录 | ?status= | 锦标赛列表（状态/截止/奖池概要） | §14 赛事大厅 |
| 34 | GET /api/pvp/tournaments/:id | 登录 | — | 详情（规则/奖池/我的报名状态）；顺带触发懒推进 | 赛事详情 |
| 35 | POST /api/pvp/tournaments/:id/registration | 登录 | roster[]+problemEntryIds[]；截止前可提交 | 冻结阵容快照入库；重复报名 409 | 报名锁阵 |
| 36 | DELETE /api/pvp/tournaments/:id/registration | 登录 | — | 截止前退赛；截止后 409 | 退赛 |
| 37 | GET /api/pvp/tournaments/:id/bracket | 登录 | — | 对阵树（轮次/比分/胜者/战报链接）；顺带触发懒推进 | 对阵树 |

**背包与商城**

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 38 | GET /api/items | 登录 | — | UserItem[] 合并 ConfigItem 元数据（名称/稀有度/分类） | §15 背包 |
| 39 | GET /api/marketplace | 登录 | — | price!=null 的 ItemDef 列表 | 商城书架 |
| 40 | POST /api/marketplace/orders | 登录 | itemId+quantity(≤99)；幂等键 | 条件 UPDATE 扣钱入账道具 | 书籍购买 |

**管理端**（requireAdmin，全部写 AdminAuditLog）

| # | 方法 路径 | 鉴权 | 请求要点 | 响应要点 | 玩法 |
|---|---|---|---|---|---|
| 41 | POST /api/admin/pvp-tournaments | 管理 | name/registerEndsAt/autoStartAt/config | 创建 REGISTERING 锦标赛并全服公告位可见 | §14 发布通告 |
| 42 | PATCH /api/admin/pvp-tournaments/:id | 管理 | prizes 等（REGISTERING 期可改） | 更新奖池 | 配置奖池 |
| 43 | POST /api/admin/pvp-tournaments/:id/actions/start | 管理 | — | 截止即开：生成首轮对阵（奇数轮空）；提前触发懒推进 | 手动开赛 |
| 44 | GET /api/admin/users | 管理 | ?q=&page= | 用户列表（钱/声誉/学员数/封禁态） | 用户管理 |
| 45 | PATCH /api/admin/users/:id | 管理 | role 或 banned 布尔 | 改角色/封禁解封（封禁即 tokenVersion+1 踢下线） | 用户管理 |
| 46 | GET /api/admin/audit-logs | 管理 | ?action=&page= | AdminAuditLog 分页 | 审计查询 |
| 47 | POST /api/admin/config/reload | 管理 | — | 重跑 §4 导入管线并热替换内存缓存 | 运维换配置 |
| 48 | GET /api/health | 公开 | — | { ok, uptime, configVersion }；供容器 healthcheck | 运维探活 |

---
## 6. 行动时钟与懒结算

### 6.1 问题与方案选择

体力/精力/心态是**现实时间驱动**的资源（GAME-DESIGN §4），被动收入（P4 赞助、Y6 代课）同理。两种实现路径：

- **cron 推进**：定时器周期性给所有在线/离线学员加资源。
- **读时惰性结算**：不在时间轴上推进，任何读写发生时按 `now − lastSettledAt` 一次性补算。

选**懒结算**，理由：

1. **部署简单性**：compose 单机没有调度基础设施；引入 cron 需要额外常驻进程或 node-cron 内嵌，而后者随进程重启丢调度状态。懒结算零新增部件。
2. **离线补偿天然正确**：玩家离线 8 小时回来，一条 `now − lastSettledAt` 差值计算即精确补齐，不需要"错过的 tick 逐个补"的簿记逻辑，也不怕停机窗口。
3. **避免写放大**：时间资源只在被展示或被消费时才有意义，提前结算纯属浪费——数百用户 × 每人若干学员的周期性 UPDATE 全是无用功。
4. **不选 cron 的第四个理由**：若未来多实例化，cron 还需分布式锁防重复发放；懒结算把推进权绑定在数据行上，无此问题。

### 6.2 双路径设计：读投影 / 写权威

| 路径 | 行为 | 是否写库 |
|---|---|---|
| **读**（GET 学员列表/详情） | 只做**投影**：按恢复速率算出"此刻应有值"，直接返回 | 否 |
| **写**（训练/历练/开赛/道具） | 在事务内**权威结算**：锁定行 → 补算落库 → 再执行动作扣减 | 是 |

读路径永不写库，GET 风暴零写放大；写路径才产生权威状态。前端拿 `/api/meta` 的 serverTime 与恢复速率，可在两次轮询之间自行插值出平滑倒计时条。

### 6.3 核心伪代码（apps/api/src/domain/settlement.ts）

```ts
const MIN_SETTLE_GAP_MS = 30_000;   // 写路径节流：距上次结算不足 30s 视为已新鲜

/** 读路径投影：纯函数，不改库 */
export function projectStudent(s: StudentRow, now: Date): ProjectedResources {
  const dtH = hoursBetween(s.lastSettledAt, now);
  const R = CONFIG.economy.recovery;
  return {
    stamina: floor(clamp(s.stamina + R.staminaPerHourBase * s.staminaRegen * dtH, 0, s.staminaMax)),
    energy:  floor(clamp(s.energy  + R.energyPerHourBase  * dtH, 0, s.energyMax)),
    // 心态向基线线性回归（可正可负方向）；速率可为 0 = 关闭回归
    mindset: Math.round(clamp(
      s.mindset + Math.sign(R.mindsetBaseline - s.mindset) * R.mindsetPerHour * dtH,
      MINDSET_MIN, MINDSET_MAX)),
  };
}

/** 写路径权威结算：调用方必须处于交互式事务内，且已持有该学员行锁 */
export function settleStudent(tx: Tx, locked: StudentRow, now: Date): StudentRow {
  if (now.getTime() - locked.lastSettledAt.getTime() < MIN_SETTLE_GAP_MS) return locked;
  const p = projectRaw(locked, now);            // 同上但不取整（内部保持 Float）
  return tx.student.update({
    where: { id: locked.id },
    data: {
      stamina: p.stamina, energy: p.energy, mindset: p.mindset,
      lastSettledAt: now,                       // 锚点前移，差值只结算一次
    },
  });
}

/** 标准动作包装：锁行 → 结算 → 业务回调（回调内做条件扣减） */
export async function withSettledStudent<T>(
  prisma: PrismaClient, userId: number, studentId: number,
  fn: (tx: Tx, student: StudentRow, now: Date) => Promise<T>,
): Promise<T> {
  return withTxRetry(prisma, async prisma => prisma.$transaction(async tx => {
    // 固定加锁顺序第一步：先锁 User（§5.1 并发三件套之 3）
    await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
    const [locked] = await tx.$queryRaw<StudentRow[]>(
      `SELECT * FROM \`Student\` WHERE id = ${studentId} AND userId = ${userId} FOR UPDATE`);
    if (!locked) throw new ApiError('NOT_FOUND');
    const settled = settleStudent(tx, locked, new Date());
    return fn(tx, settled, new Date());         // 例：此处校验 stamina≥cost 后 updateMany 扣减
  }, { timeout: 10_000 }));
}
```

被动收入走同一模式但锚在 `User.lastSettledAt`：

```ts
export async function settleUserIncome(tx: Tx, lockedUser: UserRow, now: Date): Promise<void> {
  const days = daysBetween(lockedUser.lastSettledAt, now);
  if (days <= 0) return;
  const sources = await tx.passiveIncomeSource.findMany({
    where: { userId: lockedUser.id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  });
  const money = sum(sources, s => s.moneyPerDay * days);
  const rep   = sum(sources, s => s.repPerDay * days);
  if (money || rep) {
    await tx.user.update({ where: { id: lockedUser.id },
      data: { money: { increment: money }, reputation: { increment: rep }, lastSettledAt: now } });
    for (const s of sources)                   // 逐笔留痕，可审计
      appendReputationLog(tx, lockedUser.id, /* reason */ `PASSIVE:${s.kind}`, ...);
  } else {
    await tx.user.update({ where: { id: lockedUser.id }, data: { lastSettledAt: now } });
  }
}
```

小数处理：内部列保持 `Float` 连续累积，只在 API 出口取整展示——高频小额结算（连续点训练）不会丢失小数尾巴。

### 6.4 竞态防护：为什么选行锁而非乐观锁

- 动作是**多步 check-then-act**（结算→验证门槛→条件扣减→掷随机→写日志/奖励），乐观锁（版本号 CAS）一旦冲突需整段重试，重试段里还包含随机结果，语义别扭且放大延迟。
- 冲突面极窄：只有**同一玩家的同一学员**并发操作才会争锁，人类操作频率下行锁等待近乎为零；InnoDB 行锁开销在此规模可忽略。
- Prisma 对 `FOR UPDATE` 的支持经由 `$queryRaw` 模板字符串即可，参数化安全（§9.5）。
- 死锁防控靠**固定加锁顺序**（User → Student，全局唯一顺序）+ `withTxRetry` 对 P2034 做指数退避重试兜底。
- 条件 UPDATE（stamina ≥ cost）仍然保留为第二道防线：即使未来有人绕过 `withSettledStudent` 直接写扣减逻辑，负数也不可能产生。

### 6.5 PVP 锦标赛的同构应用

PVP "到点自动对决"复用懒结算思想：`autoStartAt` 到期后由**任意触及该赛事的请求**（详情/对阵树/管理端 start）触发推进，全程锦标赛行锁 + 状态二次确认：

```mermaid
flowchart TD
    A["任意请求触及锦标赛<br/>GET detail / bracket 或 admin start"] --> B{"now >= autoStartAt<br/>且 status != FINISHED ?"}
    B -- 否 --> Z["原样返回"]
    B -- 是 --> C["事务: 锦标赛行 FOR UPDATE<br/>二次确认状态"]
    C --> D["逐场生成/执行未完成对局:<br/>seed = hash(tournamentId, matchId)<br/>duel-sim(双方报名快照)"]
    D --> E["写 PvpMatch 比分胜者<br/>+ ContestRecord 战报"]
    E --> F["胜者填入下一轮 slot<br/>末轮结束 → FINISHED + 发奖 + 审计"]
    F --> Z
```

进程内可选加一个每分钟的轻量扫描器（belt-and-braces，仅加速"无人访问时也能按时出结果"），它不是正确性的必要组件——即使进程重启漏扫，下一次访问也会补齐全部轮次。这保持了"无外部定时设施"的约束。

---

## 7. 比赛模拟服务

### 7.1 模块划分（apps/api/src/engine/）

```
engine/
├── rng.ts          # 可复现随机源
├── model.ts        # ParticipantSnapshot / QuestionSnapshot / TickContext 等（引用 shared 类型）
├── npc.ts          # NPC 选手池生成：stages.yaml 参数 + 种子 → NPC 阵容快照
├── ranking-sim.ts  # §8.1 排名制模拟（剧情/小型赛）：纯函数
├── duel-sim.ts     # §8.2 出题对决模拟（PVP/历练遭遇战）：纯函数
└── report.ts       # 战报组装、reportVersion 标注、zod 自校验后序列化
```

rng.ts 提供：

```ts
export type Rng = () => number;                    // [0,1)
export function mulberry32(seed: number): Rng;     // u32 种子 → 快速高质量 PRNG
export function derive(seed: number, label: string): number;
// 子流派生：derive(seed, `q${i}:verdict`) —— 每题/每局/每参与者独立子种子，
// 保证调整某处消耗的随机数个数不影响其它部分的序列（对调试与平衡分析至关重要）
```

### 7.2 为什么必须是确定性纯函数

签名即契约：

```ts
simulateRanking(participants: ParticipantSnapshot[], questions: QuestionSnapshot[],
                rules: StageRules, seed: number): RankingReport;
simulateDuel(home: DuelSide, away: DuelSide, opts: DuelOptions, seed: number): DuelReport;
```

1. **审计与申诉**：朋友社区里"PVP 是不是被黑箱坑了"是真实社交风险。管理员可凭 `(快照, seed)` 重放任一对局向全服证明结果。
2. **bug 复现**：线上战报异常时，把 seed 与输入塞回单测即可最小重现，不用猜随机数环境。
3. **测试友好**：golden-seed 快照测试 + 统计性 property 测试（见 §11）都依赖确定性。
4. **架构红利**：纯函数天然支持同步 HTTP 请求内完成比赛（P2 原则），不需要队列与轮询。

纯函数纪律（code review 清单级约束）：

- 输入只能是显式参数快照；禁止读 `Date.now()`、`Math.random()`、数据库、环境变量、模块级可变状态；
- 参与者处理顺序先按稳定键排序（id），消除对象遍历序差异；
- 浮点运算在同一 JS 引擎内可复现；战报一经生成即持久化，日常展示从不重放模拟——跨引擎浮点差异仅在"主动重放调试"这一开发场景下理论存在，可接受；
- 所有随机消费经 `derive` 子流，互不串扰。

### 7.3 报告序列化

- `report.ts` 组装报告后先过一遍 shared 导出的 zod schema（防御自校验），再作为 `ContestRecord.report` JSON 落库；
- `reportVersion: 1` 显式标注结构版本：引擎日后演进（加字段、改判定枚举）时，前端渲染层按版本分支兼容历史战报；
- `summary` 字段冗余存排名/比分摘要，列表页无需反序列化完整战报。

### 7.4 性能预估

排名制最坏情形：虚拟赛长 ~300 分钟 tick（1 分钟步进）、参赛者 ≈ 玩家阵容上限 + NPC 池 ≈ 13 个 agent、每 agent-tick 约 50 次算术/分支 + 0~3 次 rng 调用：

```
300 ticks × 13 agents × ~50 ops ≈ 2×10^5 次基本操作 ≈ 远低于 1ms（现代 CPU）
```

出题对决更小：固定 4~6 局，每局一次 sigmoid 判定。加上 JSON 序列化与 DB 写入，单次开赛请求端到端预估 < 20ms。数百用户规模下不存在性能问题，无需 worker/队列。

---

## 8. 前端设计

### 8.1 技术选型

| 关注点 | 选型 | 理由 |
|---|---|---|
| 路由 | React Router v7（library 模式） | SPA 标准解；data router 的 loader 与 TanStack Query 配合良好 |
| 服务端状态 | **TanStack Query v5** | 本游戏本质是"服务端资源的读写视图"：每个玩法动作=mutation，成功后 invalidate 相关 query 即全站一致（背包、学员、钱声誉联动刷新）。缓存、重试、失效、乐观更新全是现成的 |
| 客户端状态 | zustand | 只放真正的客户端状态：accessToken（内存，防 XSS 读 localStorage）、抽屉开关、主题偏好。刻意不放任何服务端数据，杜绝双源真相 |
| 样式 | Tailwind CSS v4 + 少量自建组件 | 无重型 UI 库依赖；稀有度配色等游戏皮肤自定义成本低。六维雷达图用 ~40 行内联 SVG 自绘，不引图表库 |

API client：薄 fetch 封装（自动带 Bearer、解信封、401 时静默 refresh-and-retry 一次、抛类型化 ApiError），配合小型 codegen 式手写 hooks（`useStudents()`、`useTrainMutation()` …）。

### 8.2 页面路由表

| 路径 | 页面组件 | 守卫 | 说明 |
|---|---|---|---|
| /login | LoginPage | 公开（已登录重定向） | 登录 |
| /register | RegisterPage | 公开 | 注册 |
| / | AppLayout | RequireAuth | 主布局：顶栏（≥md）/底部标签栏（<md）+ `<Outlet/>` |
| /students | StudentManagementPage | 登录 | 学员管理列表 |
| /students/:id | StudentDetailPage | 登录 | 详情（属性/天赋/养成/训练入口/历史） |
| /backpack | BackpackPage | 登录 | Tab：背包 / 商城（书籍购买） |
| /academy/recruit | AcademyRecruitPage | 登录 | 招募池 + 刷新 + 招募 |
| /academy/lecture | AcademyLecturePage | 登录 | 讲课接单 + 记录 |
| /adventure | AdventurePage | 登录 | 历练：投入档位 → 事件卡 → 选项 → 结果 |
| /story | StoryPage | 登录 | 八章关卡树 + NG+ 层切换 |
| /pvp | PvpListPage | 登录 | 锦标赛大厅 |
| /pvp/:tournamentId | PvpTournamentPage | 登录 | 详情/报名/对阵树 |
| /records/:recordId | RecordReportPage | 登录 | 统一战报查看器（剧情/PVP/历练共用） |
| /settings | SettingsPage | 登录 | 用户信息/改密/注销 |
| /admin/users | AdminUsersPage | RequireAdmin | 用户管理 |
| /admin/tournaments | AdminTournamentsPage | RequireAdmin | 发赛/奖池配置 |
| /admin/audit | AdminAuditPage | RequireAdmin | 审计查询 |

### 8.3 关键页面组件树

学员管理（含详情抽屉）：

```
<StudentManagementPage>
 ├─ <ResourceBar>                        # 钱 / 声誉（zustand 全局，mutation 后 invalidate 同步）
 ├─ <StudentFilterBar>                   # 状态筛选 / 六维排序
 └─ <StudentCardGrid>
     └─ <StudentCard> ×n                 # 稀有度边框=最高天赋色；体力以 5 格点亮显示
         ├─ <HexStatMini>                # 六维迷你雷达（内联 SVG）
         └─ <TalentBadgeList>

<StudentDetailPage route="/students/:id">
 ├─ <AttributePanel>                     # 全数值 + 惰性恢复倒计时条（本地 ticker 插值）
 ├─ <TalentPanel>
 │   ├─ <TalentFamilyTree position>      # 家族链上该天赋位置预览
 │   └─ <UpgradeButton need={economy.upgradeStoneCostByTarget[next]}>
 └─ <ActionPanel>
     ├─ <TrainingSection>                # 基础 / 定向（书库存联动禁用）/ 专项（选题库题）
     ├─ <ConsumablePicker>               # 背包联动：洗练券 / 定心丸 / 进阶石
     └─ <DismissDialog>                  # 开除二次确认（明示声誉损失与改名卡概率文案）
```

战报页（RANKING 与 DUEL 双格式自适应）：

```
<RecordReportPage recordId>
 ├─ <ReportHeader>                       # 类型徽标 / 章节·事件名 / seed 可复制 / reportVersion
 ├─ [format=RANKING]
 │   ├─ <StandingsTable>                 # 名次 · 总分 · AC 数
 │   └─ <QuestionTabs> per 题
 │       └─ <AttemptTimeline>            # 我的逐题线：AC绿 / WA黄(+罚时标注) / TLE灰 / 弃题红
 │           ├─ <FocusSparkline>         # 专注积累曲线（SVG polyline）
 │           └─ <DeltaChips>             # 心态Δ / 精力Δ / 用时
 └─ [format=DUEL]
     ├─ <DuelScoreBoard home away>       # 四局比分大数字 + 加赛局高亮
     │   └─ <DuelRoundCard> per 局       # 出题方 / 答题方 / solved / scoreAwarded
     └─ <QualityRuleTag on?>             # 【考察出题质量】标记
 └─ <RewardSummary>                      # 钱/道具/进阶石入账动画
```

### 8.4 移动端适配策略

响应式 Web，不做原生 App/PWA 安装包：

- 断点：`<640px` 手机单列；`640–1024px` 平板两列；`≥1024px` 桌面布局。
- `<md` 用底部固定标签栏（学员/背包/学院/历练/更多五项），`≥md` 切换为顶栏横向导航；admin 入口收进"更多"。
- 表格类内容（ standings、背包、审计）在小屏折叠为卡片或启用容器内横向滚动（`overflow-x:auto`），页面本身绝不横滚。
- 战报时间线的判定色块序列允许横向滚动并带渐隐提示。
- 触控目标 ≥44px；所有 mutation 按钮提交期间禁用（配 Idempotency-Key 双保险）。
## 9. 安全基线

定位：朋友/社区小规模服务，防"顺手作恶"与脚本小子，不做企业级加固；但认证存储、注入面、权限边界三项按正确方式做。

### 9.1 密码存储

- **bcrypt，cost = 12**（典型 VPS 单次 ~200–300ms，登录/改密可接受；若部署机性能弱可在 env 降为 10，代码读配置）。
- 密码策略：**最短 8 字符、最长 72**（bcrypt 输入上限），不强制组成规则（NIST 800-63B 立场：长度优于复杂度）；注册 zod 校验 + 前端同规则提示。
- 登录失败不区分"用户不存在/密码错误"，统一 `INVALID_CREDENTIALS` 防用户枚举。

### 9.2 JWT 与会话

| 项 | 值 | 说明 |
|---|---|---|
| 算法/密钥 | HS256 / `JWT_SECRET` ≥32 字节随机 | 启动时校验长度，不合格拒绝启动 |
| accessToken | TTL 15 分钟，仅存前端内存（zustand） | 不落 localStorage，XSS 无法持久窃取 |
| refreshToken | TTL 7 天，HttpOnly + Secure + SameSite=Strict Cookie（Path=/api/auth） | Strict 完全隔离跨站携带，CSRF 面归零；仅 refresh/logout 两端点消费 |
| 轮换 | 每次 refresh 签发新对 | 旧 access 自然过期 |
| 全局失效 | User.tokenVersion 写入 JWT claim；改密/登出全部设备/封禁/注销时 +1 | 无状态实现"踢下线"，不需要 token 黑名单表 |
| 已接受风险 | refreshToken 无使用检测（reuse detection 需服务端存储） | 社区规模下风险与成本不成比例；Cookie 属性已限窄路径 |

### 9.3 HTTP 安全头 / CORS / 限流

- **helmet**（API）：默认全部中间件；API 只出 JSON，CSP 由 nginx 在静态层负责。
- **nginx 响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、CSP `default-src 'self'; img-src 'self' data:`（Vite 产物无内联脚本；样式允许 `'unsafe-inline'` 以兼容框架注入，后续可收紧）。
- **CORS**：生产同源部署（nginx 反代），**不发 CORS 头即是最严策略**；仅开发环境为 vite dev server（默认 `http://localhost:5173`）开白名单，来源取 `WEB_ORIGIN` env。
- **express-rate-limit**（内存桶，单实例前提）：

| 维度 | 建议值 |
|---|---|
| 全局 | 300 req/min/IP |
| `/api/auth/*`（登录/注册/刷新） | 10 req/15min/IP（爆破缓解） |
| 登录后变更类端点合计 | 60 req/min/user |

### 9.4 权限模型

两级角色（USER/ADMIN）。`requireAuth` 从 JWT 恢复身份并检查 `tokenVersion/bannedAt`；`requireAdmin` 叠加 role 判定。所有 admin 路由写 AdminAuditLog（含 IP 与脱敏 payload）。资源归属校验在 service 层强制：查询恒带 `userId` 条件，他人资源一律 404。

### 9.5 注入面

Prisma 全程参数化。纪律：

- 业务代码只允许 `$queryRaw` / `$executeRaw` 的**模板字符串**形式（自动参数化）；`$queryRawUnsafe` / `$executeRawUnsafe` 由 ESLint 规则禁用（现存的 FOR UPDATE 行锁是唯一豁免点，且无外部输入拼接进标识符）。
- 排序字段等"不能参数化"的动态标识符，用白名单映射（`sortKey → 列名字面量`），绝不拼接用户输入。

### 9.6 注销账户的数据处理

选择**硬删**（软删被否决，理由见 §12 T4）：

1. 校验密码 → 事务内 `tokenVersion+1`；
2. DB 级联硬删该用户的 students / user_items / problem_entries / contest_records / story_progress / adventure_logs / registrations / passive_sources / reputation_logs（schema 中全部 `onDelete: Cascade`）；
3. AdminAuditLog 不删：`adminId` 置空，靠 `adminNameSnapshot` 冗余列保留审计可读性；
4. username 随行删除而释放，朋友可复用昵称；
5. PvpMatch 历史战报引用的 ContestRecord 一并级联删除——对阵树对该局显示"[账号已注销]"占位（查询侧 leftJoin 兜底）。

---

## 10. 部署

### 10.1 生产编排（deploy/docker-compose.yml）

```yaml
name: oinur

services:
  mysql:
    image: mysql:8.4
    container_name: oinur-mysql
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${MYSQL_DATABASE:-oinur}
      MYSQL_USER: ${MYSQL_USER:-oinur}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?set in .env}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?set in .env}
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
    volumes:
      - dbdata:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u$$MYSQL_USER -p$$MYSQL_PASSWORD --silent"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  api:
    build: { context: .., dockerfile: deploy/api.Dockerfile }
    container_name: oinur-api
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE}
      JWT_SECRET: ${JWT_SECRET:?set in .env}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      CONFIG_DIR: /app/config
    depends_on:
      mysql: { condition: service_healthy }   # 健康后才启动；启动脚本再跑 migrate deploy
    expose: ["3000"]
    logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }

  nginx:
    build: { context: .., dockerfile: deploy/web.Dockerfile }   # 多阶段：vite build → nginx 托管产物
    container_name: oinur-web
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on: [api]
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

volumes:
  dbdata:
```

api.Dockerfile 要点：多阶段构建（node:22-alpine；stage1 pnpm install --frozen-lockfile + 构建 api/web/shared；stage2 仅拷贝产物 + prisma CLI），入口脚本先 `prisma migrate deploy` 再 `node dist/index.js`——迁移版本化，重复执行幂等。web.Dockerfile 内嵌反代配置与 nginx.conf 一致。

nginx.conf 核心段：

```nginx
server {
  listen 80;
  # …§9.3 安全响应头…

  location /api/ {
    proxy_pass http://api:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Request-Id $request_id;
    client_max_body_size 1m;
  }
  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;   # SPA fallback
  }
  location /assets/ { expires 30d; add_header Cache-Control "public, immutable"; }
}
```

### 10.2 环境变量清单

| 变量 | 必填 | 示例/默认 | 用途 |
|---|---|---|---|
| DATABASE_URL | 是 | mysql://user:pass@mysql:3306/oinur | Prisma 连接串 |
| JWT_SECRET | 是 | ≥32B 随机串（openssl rand -base64 32） | JWT 签名密钥 |
| NODE_ENV | 否 | production | 运行模式 |
| PORT | 否 | 3000 | API 监听端口 |
| CONFIG_DIR | 否 | /app/config（容器）/ ../docs/data（本地） | yaml 配置目录 |
| LOG_LEVEL | 否 | info | pino 日志级别 |
| WEB_ORIGIN | 仅 dev | http://localhost:5173 | 开发期 CORS 白名单 |
| MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD | 是（compose） | — | MySQL 初始化 |

### 10.3 备份策略

宿主机 crontab 两行（每日 04:00 全量 dump + 14 天滚动清理）：

```cron
0 4 * * * docker exec oinur-mysql sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --quick "$MYSQL_DATABASE"' | gzip > /var/backups/oinur/oinur-$(date +\%Y\%m\%d).sql.gz
30 4 * * * find /var/backups/oinur -name '*.sql.gz' -mtime +14 -delete
```

- `--single-transaction` 基于 InnoDB MVCC 取一致性快照，不锁业务表；
- 恢复演练命令（建议每月手动跑一次到临时库验证）：`gunzip < oinur-xxx.sql.gz | docker exec -i oinur-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`；
- 有条件时用 rclone/rsync 把 /var/backups/oinur 同步到异机，一行即可。

### 10.4 日志与监控（最简方案）

- **日志**：pino（JSON 到 stdout），HTTP 层用 pino-http 记录方法/路径/状态码/耗时/requestId，`password` 等字段在 redact 列表中；错误经统一 errorHandler 输出 `{reqId, stack}`。运维即 `docker compose logs -f api`（本地开发接 `| pino-pretty`）。
- **轮转**：compose `logging.options` 上限（见上），无需宿主 logrotate。
- **探活**：容器 healthcheck 打 `GET /api/health`；`docker compose ps` 即健康总览。
- **告警**：默认零监控栈。若需要，外挂一个 Uptime-Kuma 容器探测 /api/health 即可（可选件，不属于核心依赖）。Prometheus/Grafana 明确不引入。

---

## 11. 开发阶段验证策略

### 11.1 测试体系总览

| 层 | 工具 | 范围与优先级 |
|---|---|---|
| 引擎纯函数单测 | vitest | **最高优先**：ranking-sim / duel-sim / rng / npc。golden-seed 快照测试 + 统计性 property 测试 |
| 领域逻辑单测 | vitest | settlement 投影与结算（固定时钟注入）、growth 递减曲线、economy 公式求值、config zod 对 yaml 样例 fixture 的通过/失败用例 |
| API 集成测试 | supertest + 一次性 MySQL（testcontainers-node，或本地 compose `--profile test` 起独立库） | 每模块 happy path + 权限矩阵 + 并发双发（同一动作并发两次只扣一次） |
| 前端 | TS 编译期类型约束为主；E2E **暂缓**（上线后视情况补 Playwright 冒烟） | 手工回归清单随里程碑维护 |

CI 顺序：`pnpm -r lint → typecheck → unit → integration`；集成任务以 service 容器方式提供 MySQL 8.4。

### 11.2 里程碑可验证产出（对照 GAME-DESIGN §18）

| 阶段 | 可验证产出（Definition of Done） | 关键测试 |
|---|---|---|
| M0 | monorepo 骨架 + 注册/登录/设置页（信息展示/改密/注销）+ compose 一键起全栈；`GET /api/health` 绿 | auth 集成套件全绿；注销后数据级联删除断言；安全响应头快照测试 |
| M1 | 学员管理（招募外的 CRUD/养成道具）、背包、训练三式、体力精力恢复时钟生效 | 训练扣钱扣体力条件 UPDATE 断言；递减曲线 property 测试（属性越高增量越小）；离线恢复投影精度（注入固定时间差）；并发双击训练不多扣不少扣 |
| M2 | 模拟引擎（排名制）、八章剧情 + NPC 池 + 首通/名次奖励 + NG+ 解锁 | 同 seed 同报告哈希（golden 快照 ×N seed）；"属性↑→期望名次↑"统计性测试（大样本 seeds）；首通幂等（重打不发首通）；奖励与 stages.yaml 断言一致 |
| M3 | 历练 41 事件、学院招募/讲课、出题题库闭环 | events.yaml 全量过 zod（41/41）；once/冷却行为测试；讲课门槛与报酬公式抽测；出题质量分布单元测 |
| M4 | 出题对决、PVP 锦标赛全生命周期（报名→懒推进→对阵树→发奖）、管理员工具 | 对决计分规则表驱动测试（含考察出题质量/四类平局分流）；淘汰赛轮转含奇数轮空集成测；USER 打 admin 全 403 矩阵；审计留痕断言 |
| M5 | economy 收支模拟脚本 + 数值平衡打磨 + 上线 | `scripts/sim-economy.ts` 输出中期玩家周收支落在 GAME-DESIGN §16 目标区间；接口冒烟压测（简单并发脚本）即可 |

每个里程碑收尾产出：可运行的 compose 环境 + 通过 CI 的测试套件 + 更新 ROADMAP.md 的验收记录。

---

## 12. 关键技术取舍汇总

| # | 取舍 | 选择与理由 | 放弃项及代价 |
|---|---|---|---|
| T1 | 时间资源推进 | 读时惰性结算（§6）：免 cron、离线补偿天然正确、零写放大 | cron 方案；代价：读路径返回投影值与库内值有微小时间差（无害，写路径权威化） |
| T2 | 实时能力 | 无 WebSocket/Redis/MQ，即时模拟+战报；弱提醒用轮询+浏览器 Notification 降级 | 实时推送；代价：PVP 开赛通知延迟 ≤30s |
| T3 | 战报存储 | ContestRecord 单表承载 STORY/PVP/ADVENTURE 三类（GAME-DESIGN §17 所述 contest_records/duel_records 合一，format 字段区分）：生命周期与信封完全同构，少一张表一套读写 | 双表方案；代价：无 |
| T4 | 注销数据处理 | 硬删 + 审计日志脱敏留档：小社区无需合规留存，username 可回收 | 软删；代价：误注销不可恢复（登录前二次确认缓解） |
| T5 | 并发控制 | 写路径行锁（FOR UPDATE）+ 固定加锁顺序 + 条件 UPDATE 双保险；读路径零写入投影 | 乐观锁版本号；代价：$queryRaw 一处受控豁免 |
| T6 | 会话失效 | tokenVersion claim 无状态踢人 | refresh token 存储表/reuse detection；代价：被盗 Cookie 无法定向吊销单个设备（只能全体失效） |
| T7 | 部署形态 | API 单实例：内存限流桶、内存幂等缓存成立 | 多实例水平扩展；升级路径：限流换 Redis 存储、幂等缓存入库——均为局部改造，架构不推翻 |
| T8 | 配置生命周期 | Config 表软弃用（deprecated 标记），历史数据外键永不断裂 | 物理删除旧配置；代价：表内残留少量历史行 |
| T9 | 共享包 | 直发 TS 源码，无构建步骤 | npm 包式产物；代价：消费方必须具备转译能力（本仓两端都有） |
| T10 | API 版本化 | 无 /v1：同仓前后端同步发布，TS 类型编译期暴露 breaking change | URL 版本协商；代价：未来若出现第三方客户端需补版本层 |

---

## 13. 规格模糊点与本文档假设清单

GAME-DESIGN 未明确、本文按以下假设推进（均已在正文对应位置标注）。数值类假设最终落位 `docs/data/*.yaml`，由策划复核覆盖：

| # | 模糊点 | 本文假设 |
|---|---|---|
| A1 | 心态是否随时间恢复（§4 只写明体力/精力恢复） | 心态向基线缓慢线性回归，速率与基线在 `economy.yaml.recovery.mindsetPerHour/mindsetBaseline`；速率置 0 即关闭该机制 |
| A2 | 心态数值边界 | 闭区间 [−100, +100]，界值在 economy.yaml 定义；专注衰减语义由 systems/contest.md 细化 |
| A3 | 历练事件的参与者模型 | 单学员执行 + 投入档位二选一；Y1 小型赛等也由该学员单独参赛；多学员协作事件暂不存在 |
| A4 | 同一时间能否并行多个事件 | 不能：每玩家至多一个 PENDING AdventureLog，抽新事件前必须解决当前事件 |
| A5 | PVP 出战阵容人数 | 报名锁定 rosterSize 名学员（具体数值入 stages/economy 配置），对阵模拟按报名快照进行 |
| A6 | 对决中答题学员如何产生 | 服务端从锁定阵容中按当局主导六维确定性择优（可由 seed 复现），不支持实时指定——批量结算架构下无实时交互窗口 |
| A7 | 专注机制适用范围 | 仅排名制赛（§8.1）；出题对决的一次性 sigmoid 判定不引入专注 |
| A8 | 讲课结算时机 | 接单即时一次性结算报酬与声誉，学员进入冷却；Y6/P4 的持续收益走 PassiveIncomeSource 表惰性入账 |
| A9 | 学院招募池刷新节奏 | 懒定时窗：访问池时若超过配置周期则自动重掷，另支持付费立即刷新；周期与价格在 economy.yaml |
| A10 | NG+ 进度链独立性 | 每个 ngLevel 独立保存进度链（StoryProgress 以 (userId, ngLevel, stageKey) 为粒度），层间解锁仅要求前层全通 |
| A11 | 会话细节 | 登录态 = 15min access + 7d rotating refresh；"登出"默认登出所有设备（tokenVersion+1）——设置页文案如实告知 |
| A12 | 商城范围 | 商城 = items.yaml 中 price≠null 条目的直售列表（书籍为主），无购物车/限时上架逻辑 |
| A13 | 开除概率掉落改名卡 | 概率值 economy.yaml.dismissRenameCardChanceBps，服务端掷点、结果记入 ReputationLog 关联审计 |

> 以上假设如与后续 systems/*.md 细则冲突，以细则为准并回改本文相应段落；结构性假设（A4/A6/A7/A8）若要推翻，需重新评估对应模块设计。
