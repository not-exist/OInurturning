# 前端全盘重写（游戏化 UI）— 实施计划

> 接续：本次不改后端业务逻辑与共享包语义，目标是**整体替换 `apps/web` 的表现层**——把当前「Tailwind 默认灰阶 + emoji + 裸枚举 key」的原型级界面，重写为「看起来就是一款游戏」、对标 Awwwards / FWA / CSS Design Awards 每日最佳的沉浸式界面，并同步修掉调研中确认的 6 个真实缺陷。
> 本文档同时是交给执行 AI 的完整投喂材料，需自包含：读本文档即可开工，不必回看调研过程。

---

## 0. 给执行者的总纲

**身份**：兼具游戏 UI 设计师与前端工程师能力的执行者。

**三条硬验收线**（任一不满足即未完成）：

1. `pnpm -r typecheck && pnpm -r lint && pnpm -r build` 全绿。
2. `pnpm e2e`（51 个 Playwright 用例）全绿 —— 改了 DOM 契约必须**在同一提交**里同步改 spec。
3. 页面内**零 emoji**、**零英文枚举 key / 裸 id / 调试元数据**、**零开发注释文案**。

**项目一句话**：OI（信息学奥赛）题材网页**养成 + 模拟经营**游戏。玩家是 OI 训练营教练：招募学员 → 训练/历练 → 组队打比赛 → 讲课变现 → 扩张。现实时间驱动的轻挂机节奏，服务端权威结算。

**技术栈（不得替换）**：React 19 + TS + Vite + Tailwind v4（`@tailwindcss/vite`，无 config 文件，主题写在 CSS `@theme`）+ TanStack Query v5 + Zustand + react-router 8。后端 Express + Prisma + MySQL，共享包 `@oinur/shared`（`packages/shared`）。

**规模**：81 道具 / 61 天赋（23 家族 + 14 独立）/ 40 事件（6 类）/ 34 题模板 + 15 特性 / 8 章 33 关。

---

## 1. 问题分析

### 1.1 现状

| 层 | 文件 | 问题 |
|---|---|---|
| 规模 | `apps/web/src` 27 个文件 / 6792 行 | `BattleReplay.tsx` 单文件 **1328 行**；`lib/hooks.ts` **1147 行**（查询 hooks + 视图类型 + 展示映射混杂） |
| 视觉 | `styles/app.css` 全文仅 1 行 `@import 'tailwindcss';` | **无 `@theme`、无 CSS 变量、无色板、无自定义字体**；全站 99% 是 `neutral-*` 默认灰阶 |
| 入口 | `index.html` | 无字体、无 favicon、无 theme-color、无 meta description |
| 图标 | 全站 | **20+ 处 emoji**：`ui.tsx:17` 的 `Empty icon='🗂️'` 默认参数、`OverviewPage`（💰⭐✅❌🎖️🎓）、`BattleReplay`（⚔️🏁✓）、各页 `Empty`（🎓🧑‍💻🏫🎒🗒️🧭🏟️🏆） |
| 文案 | 16 个页面 | **24 处英文枚举 key / 裸 id 直出**（赛事 status、verdict、side、reason、`homeUserId` 当队名、天赋/道具 id、admin action/targetType、`{c.type} · {c.format}`…）；战报把 `Engine/RNG/Seed/SnapshotHash` 四行调试元数据**平铺**在主标题下 |
| 组件 | `components/ui.tsx` 仅 3 个导出 | **9 处复制粘贴的 loading 片段**；`PlaceholderPanel.tsx` 零引用孤儿 |
| 布局 | `app/App.tsx` | header + `md:w-44` 竖排导航 + main；10 项导航**无图标、无分组、无二级菜单** |
| 状态 | `main.tsx:25` | `new QueryClient()` **零配置**（`refetchOnWindowFocus:true`、`staleTime:0`），每次路由往返全量重拉 |
| 性能 | `BattleReplay.tsx:344-355`、`:636-666` | 回放每 tick 从 0 重放全部事件，**O(n²)** |

### 1.2 必须修的真实缺陷

| # | 缺陷 | 位置 |
|---|---|---|
| 1 | `colorful`↔`RAINBOW` 双轨归一失败 → 彩档徽章「文字写彩、底色是灰」 | `lib/hooks.ts:348`、`enums.ts:2`、`items/service.ts:46`、`adventure/service.ts:714` |
| 2 | 招募**前**泄露隐性品质档 + 天赋 id（违反 `student.md §3.6`，且天赋可确定性反推品质档） | `AcademyPage.tsx:119-121`、`:132-134`、`:166-179`；服务端 `academy/service.ts:78` |
| 3 | 品质档配色三套并存且互相矛盾（"良好"列表=黄 / 详情=绿 / 招募卡=黄；"精英"列表=蓝 / 招募卡=绿） | `StudentsPage.tsx:106`、`StudentDetailPage.tsx:200`、`AcademyPage.tsx:167` |
| 4 | 心态（−10…+10）只有一句纯数字，无零轴、无正负区分、无 ≤−6 告警 | `StudentsPage.tsx:97`、`StudentDetailPage.tsx:106` |
| 5 | 回放 O(n²) | `BattleReplay.tsx:344-355`、`:636-666` |
| 6 | `/api/talents`、`/api/problems` **实际已注册可用**（`apps/api/src/index.ts:111/113`，commit `aa33436`），前端注释与降级分支是过期的 | `hooks.ts:589/770`、`StudentDetailPage.tsx:167/176`、`TrainingPage.tsx:259` |
| 7 | 背包前端硬编码白名单漏了 `drumstick-bento` → 鸡腿便当（每关首通产出的 +5 体力稀缺品）显示"暂不可用"，点了没反应 | `InventoryPage.tsx:19-25` vs `items/effects.ts:137-178` |

| 8 | **招募池重掷导致「静默招错人」**：`tempId` 是位置编号会被复用，切标签页触发整池重掷后点「招募 c2」会招到另一个人，扣款与落库全部成功且无提示 | `academy/service.ts:123-127/205-206`、`recruit-gen.ts:372`、`main.tsx:25` |

### 1.3 目标

- 视觉达到 Awwwards 级：统一 Lucide 图标、无 emoji、实验性但不牺牲可读性的排版、物理感动效。
- 体验「像游戏」：HUD 资源条、角色卡、稀有度光效、难度阶梯、战报转播感，悬浮即看详情。
- 语义表达正确：稀有度 / 严重度 / 品质档 / 难度四套视觉语言各就各位，不混用。
- 清掉全部裸 key、调试元数据、开发注释文案。
- **不变**：后端 API、共享包语义、路由表、e2e DOM 契约、部署形态。

---

## 2. 设计方案

### 2.1 语义分层（最关键，混用即 bug）

**A. 全局稀有度**（权威 `GAME-DESIGN §5`）— 道具与天赋
`gray 灰 < yellow 黄 < green 绿 < blue 蓝 < purple 紫 < colorful 彩`
- **严禁出现红/橙**（早期废弃草案）。
- 灰 = **负面**（天赋灰档 6/6 全 `kind:negative`），读作"廉价/有瑕疵"，**不要做成高级中性灰**；黄 = 负面家族"净化链"终点（中性/微正面）；彩 = 传说、效果超标、进阶链顶点、**全服稀缺，必须低频出现才值钱**（彩虹渐变 + 呼吸/流动光效）。

**B. 题目特性严重度**（独立阶梯，`problems.yaml:28`）— 仅用于题目特性
`red < yellow < blue < purple < black < colorful`（15 条：红2/黄3/蓝3/**紫4**/黑2/彩2）
- 语义是「**毒性递增**」而非「危险告警」：red 是**最轻且最高频**的一档（权重 40，"新手最常见的第一课"）。
- 抽取权重 `b = [red:40, yellow:30, blue:18, purple:8, black:3, colorful:1]`，随出题能力 q 上移 → **高严重度标签本身就是"出题者很强"的信号**，UI 值得给分量。
- `colorful` 两档**不全是负面**：`miracle-easy 灵光乍现` 是正面（首题 ×0.75、AC +0.25），`chaos-domain 概率世界` 是中性双刃 → **不能把最高 severity 做成"灾难告警"**。
- 建议视觉：罗马数字刻度 Ⅰ–Ⅵ + 色相边框，与「提交判定错误态」空间分离。

**C. 招募品质档** — 只用于学员，与稀有度是两套体系
`common 普通 / good 良好 / elite 精英 / genius 天才`
- **不得复用稀有度色相**（否则误读"天才=彩卡"）→ 用**材质层级**：素面 → 细描边 → 内发光 → 动态光晕。
- **招募前品质档必须隐性**（`student.md §3.6`）：候选卡只显示三档气质 `hint`（普通与良好**共用**「气质普通」、精英「身手不凡」、天才「锋芒毕露」）；招募完成后才永久可见（开除代价 −5/−10/−20/−40 声誉）。
- 招募费按品质档分级（`×{1.0/1.5/2.5/5.0}`）是**设计意图内的推断线索，保留**（"防精确挑选"是 UI 呈现纪律，不是信息隐藏）。

**D. 难度 = 8 档赛事 tier**（与剧情 8 章一一对应）
`cspj / csps / noip / province / noi / ctt / cts / ioi` → CSP-J / CSP-S / NOIP / 省选 / NOI / CTT / CTS / IOI
能力锚点 10–20 / 25–40 / 40–60 / 60–75 / 75–88 / 85–92 / 88–95 / ≥90，`recommended_level` 10–97。
**不借稀有度六色**（避免"NOI 是紫卡"误读），用同一色相的 8 级明度递进 + 章节序号表达阶梯进程。

### 2.2 视觉体系

- **Art Direction**：「深夜机房 · 算法指挥中心」。深墨底 + 单色科技线 + 稀有度作为画面唯一的高饱和光源。冷峻、精密、有赛事感。
- **配色**：底色近黑冷调（`#0A0D12` → `#11161F` 分层）；主强调**电光青**、次强调**紫**；面板 1px 半透明描边 + 极轻玻璃感，不要圆角塑料风。**主色不要用红**（红留给错误、负向心态与 severity 刻度）。
- **排版**：中文系统栈 `system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`；数字/代号/seed 用等宽栈。冲击力放在**巨型数字**（V 值、排名、Q 值、金币）与**超大标题**上，正文层级保持正常可读。
- **字体**：CSP 禁止外链（见 §3.2）→ 中文系统栈 + **自托管 1 款拉丁 + 1 款等宽子集**（woff2，合计 ≤100KB）。**2026-09-21 改 `IBM Plex Sans`(可变 latin 45KB) + `IBM Plex Mono`(latin 400 15KB)**，字体文件由 `@fontsource*` 包提供（版本锁在 `apps/web/package.json`），但不引包内 CSS——可变 Sans 的 `wght.css` 会把西里尔/希腊/越南文一并打进产物（6 子集 ≈162KB），故手写 `@font-face` 直指 latin 单文件。选型理由见 §9。
- **背景**：可加低强度 canvas/程序化纹理（网格、扫描线、缓动粒子），**必须**响应 `prefers-reduced-motion`，不影响首屏。
- **动效**：spring 缓动、数字滚动、卡片轻微 3D tilt、模态 scale+blur、路由过渡、鼠标跟随光晕。默认 **CSS `@keyframes` + Web Animations API + rAF 手搓**；确需 spring 物理才考虑 `motion`，且必须一次性引入并说明收益（无 `unsafe-eval`）。

### 2.3 图标与翻译真源

**图标**：统一 `lucide-react`（新增依赖；名称可在 https://icones.js.org/ 检索）。**界面全程禁止 emoji。**
映射轴：先 `category` 兜底（nurture→`Sparkles` / book→`BookOpen` / functional→`Wrench` / contest→`Trophy` / quest→`ScrollText` / material→`Boxes`），再按 `effect.kind` 细分，再按 id 特化：
`advance-stone`→`Gem`、`reroll-ticket`/`reroll-shard`→`RefreshCw`、`direction-charm`→`Compass`、`rename-card`→`PenLine`、`calm-pill`→`Heart`、`vigor-drink`/`stamina-potion`→`Zap`、`drumstick-bento`→`Utensils`、`milk-tea`→`Milk`、`coffee`→`Coffee`、`focus-engine`→`Brain`、`vitality-core`→`Battery`、`firewall`/`spare-cable`/`circuit-board`→`Shield`/`Cpu`、`tag-card`→`Tag`、`entry-ticket`→`Ticket`、`legend-box`→`Gift`、`intel-slip`→`Search`、`recruit-clue`→`UserSearch`、`badge-legend`→`Medal`、`color-shard`→`Sparkles`。
事件六类：`Swords` 对决 / `Compass` 奇遇 / `Target` 试炼 / `Clover` 机缘 / `TriangleAlert` 麻烦 / `Handshake` 人情。
六维：`Boxes` 数据结构 / `GitBranch` DP / `Sigma` 数学 / `Network` 图论 / `Zap` 贪心 / `Type` 字符串；三能力 `Code`/`Brain`/`PenTool`。
判定：`CircleCheck` AC / `CircleX` WA / `Timer` TLE / `CircleSlash` UNFINISHED / `BatteryWarning` SKIP。
天赋按 `family` 配图标/色（23 家族），`family:null` 走通用图标；正面 `Sparkles` / 负面 `Skull`。
`Empty` 组件必须改造为接收 `ReactNode` 或 Lucide 组件（现在 emoji 是一等公民 API）。

**翻译**：新建 `apps/web/src/lib/labels.ts` 作为**唯一真源**，覆盖 26 项缺失/散落映射：
`EventCategory`(duel/windfall/trial/chance/trouble/social)、`PvpTournament.status`(REGISTERING/RUNNING/FINISHED/CANCELLED)、`PvpMatch.status`(PENDING/DONE/BYE)、`ContestFormat`(RANKING/DUEL)、`ContestRecordType`(STORY/PVP/ADVENTURE)、`ContestVerdict`(AC/WA/TLE/SKIP/UNFINISHED)、`ContestSide`(**3 个**：HOME/AWAY/**NPC** —— 现有 `BattleReplay.tsx:30-33` 的 `SIDE_LABEL` 只映射了 2 个，**漏 `NPC`**)、`LectureTierId`(beginner/junior/senior/provincial/national)、章节中文名、`PROBLEM_SEVERITIES`、`TalentDef.family`(23 slug)、`TalentEffect.stat`(**33** 键 = 13 属性 + 20 meta，`config/talents.ts:11-49`)、`TalentEffect.mode`(percent/flat)、`TalentDef.kind`(positive/negative)、`ItemEffect.kind`(28 个)、`AdventureStatus`、`AcquiredVia`、`Role`、`StudentStatus`、`ABILITY_KEYS`(CODING/THINKING/PROBLEM)、出题质量 6 档（习作<30 / 合格30 / 良好50 / 优秀70 / 杰作85 / 传世≥95）、声誉 6 档（默默无闻<300 / 小有名气≥300 / 知名教练≥1000 / 名家≥2500 / 大师≥4500 / 传奇≥6500）、problem `requirements` 的 `d`/`m`/`c`（六维需求/思维量/代码量）。
可直接复用：`QUALITY_LABEL`、`CATEGORY_LABEL`、`TRAINING_KIND_LABEL`、`ERROR_TEXT`。
**消灭 `BattleReplay.tsx` 内与 `hooks.ts` 完全重复的 `DIMENSION_LABEL` 等副本。**

### 2.4 交互骨架

- **顶部 HUD 常驻**：金币 / 声誉（含刻度称号）/ 体力，`tabular-nums`，变化时滚动 + 高亮。
- **左侧导航**：Lucide 图标 + 分组 + 激活态语义标记。
- **学员 = 角色卡**：内联 SVG 六维雷达（约 40 行自绘，**不引图表库**）、品质材质层级、天赋槽稀有度光效、心态双向条、体力 5 格。
- **全局 `HoverCard`**（统一实现，一套）：
  - 道具：名称 + 稀有度 + 中文分类 + `effectDesc` + `description` + 价格/来源 + 图标
  - 题目：主考六维 + 需求 d/m/c + 质量评级 + 特性（严重度 + 中文名 + effect 风味文本）+ 时限
  - 天赋：家族中文名 + 稀有度 + 效果（stat 中文 + mode + 数值）+ 升阶目标 / 净化链位置
  - 天赋的两层信息**不要混**：「是不是独立彩」用配置层 `family === null && rarity === 'colorful'` 判定（全表仅 `turing-colorful` 命中，可给专属光晕）；「这枚天赋怎么来的」用运行时 `acquiredVia`（`RECRUIT`/`EVENT`/`UPGRADE`/`REROLL`/`ADMIN`）—— 后者也是本次要补的中文表之一。
  - 只有 `memo`（记忆化）与 `guess`（猜结论大师）两条链能冲彩；全表彩天赋只有 3 条（`memo-colorful`/`guess-colorful`/`turing-colorful`）。6 条负面家族走灰→黄「净化链」（爆零战神→复盘之神、拖延症→时间管理者、手残→稳如磐石、考场失眠→赛前入定、数组越界→边界检查者、假算法→反证大师），**黄级即终点**，值得单独视觉仪式（"把 debuff 炼成天赋"）。
  - ⚠️ **进阶石只对"登记了上级形态"的天赋生效**：6 个单点家族（`seg`/`numth`/`dij`/`greed`/`kmp`）+ 14 个无家族天赋 + 所有链顶（含 6 条净化链的黄级）**都不可升阶**。「升阶」入口必须置灰并**给出具体理由**，否则玩家会以为进阶石没生效。
  - 学员：迷你雷达 + 天赋 + 洗练保底计数（`counters.reroll`，≥20 触发保底）
  - 事件：类别 + 稀有度 + 体力档 + 可能结果
- **战报 = 电竞转播**：AC 是爽点、WA +20min 罚时是痛点、压哨通过是高潮，队伍名次是最终裁决。调试元数据收进「技术详情」折叠区。
- **数值条**：
  - 心态双向条要画**三个标记**——`0` 警戒线、个人归位锚点 `B`（`clamp(1+Σmindset flat)`，实测 −1…+5，无天赋时 +1）、`−6` 焦虑反噬阈值（独立告警）。**无上限惩罚**（m∈[+1,+10] 单调增益），不画"过高有害"。
  - 体力 = 5 格 + 当前格回充进度（恢复约 45 分钟/点）。
  - 精力 / 专注：分母取学员当前 `energyMax` / `focusCap`（浮动上限，硬顶 100；新人 55–78 / 45–66），**绝不能除 100**；条上显示 `当前/上限`。**"精力未满"不是参赛门槛**（真正门槛是 `energy ≥ Eneed`，典型约 8 点/题）。
- **历练 EventCard** 必须显式标注「全队出战」（对决类，3 人各出一题答一题、独立扣精力算心态）/「仅队长」（非对决类，队友只出体力）。另三条实测约束（省掉不必要的工作量）：
  - **只有 4 条事件有道具门槛**，其余 36 条无 → 只给这 4 条做"持有 X 可解锁"提示：G4 断网事故（`spare-cable`）、G8 摸鱼被抓（`milk-tea`）、R6 天赋异动征兆（`direction-charm`）、L4 OJ 遭黑客攻击（`firewall`）。
  - **只有 2 条不可重复，必须显式标注**（否则玩家会以为抽不到是 bug）：R7 强者指点（每名队长限一次）、C2 图灵之遗（**全服每周限量 3 次**）。
  - 其余 38 条的冷却中条目**直接不进池**（玩家不会"看到但抽不到"）→ **UI 不需要为冷却做任何展示**。

### 2.5 数据层契约适配

- `normRarity` 修正为 `String(r).toUpperCase().replace('COLORFUL','RAINBOW')`，**只改前端、不动 shared 枚举**（`Rarity`/`ConfigRarity` 并存是有意设计）。wire 上双轨真值表：

  | 端点 | 大小写 | 最高档字面量 |
  |---|---|---|
  | `/api/items` | 小写 | `colorful` |
  | adventures 全系列 `event.rarity` | 小写 | `colorful` |
  | PVP `problemSnapshots[].rarity` | 小写 | `colorful` |
  | `/api/talents` | 大写 | `RAINBOW` |
  | `/api/problems`、`/api/problem-library` | 大写 | `RAINBOW` |

  （根因：`items/service.ts:46` 是裸 cast，`talents/service.ts:17`、`problems/service.ts:12` 正确调用了 `toRarity()`。）

- 消费真实端点：删 `hooks.ts:589/770` 过期注释与 `retry:false`；`/api/problems` ≡ `/api/problem-library`，**数据层只留 `/api/problem-library`**。
- `ParticipantSnapshot.abilities` 是全大写 9 键（`PROBLEM`↔`setting`、`STRING`↔`str`），与 `StudentView` 小写字段并存 → data 层做一次适配，**不要直接把 snapshot 当 Student 渲染**。
- 删 `hooks.ts` 中与 shared 重名的 `StoryOverview`/`StoryChapterView`/`StoryStageProgress`，改 import。
- **道具可用性是服务端白名单**（`items/effects.ts:137-178`），81 件里**只有 21 件可使用**，落空即 400：
  可直用非书 6 件：`calm-pill` / `milk-tea` / `stamina-potion` / `drumstick-bento` / `coffee` / `focus-engine`；
  直用书 15 件：`book-{thinking,coding,setting}-{gray..purple}`（3 科 × 5 档，规则生成）；
  显式 400 且有专属提示语 2 件：`vigor-drink`（M1 无比赛场景）、`rename-card`（须走改名接口）；
  其余 58 件（含 30 件**六维书**——它们是定向训练耗材，提供乘区而非点数）一律通用 400「该道具暂不可用」。
  → **不在白名单的只展示中文 `effectDesc`，不渲染"使用"按钮**；背包按可用性分组渲染，而不是逐件给按钮。
  → ⚠️ **`effect.kind` 命中 ≠ 可用**，会误判 2 件：`vigor-drink`（`energy_restore`，后端硬禁）与 `lecture-handout`（`attr_boost`，与直用书同 kind 但后端硬禁）。因此**可用性真源应放服务端或 shared 的 `USABLE_ITEM_IDS` 常量，前端不再自己维护白名单**——现有 `InventoryPage.tsx:19-25` 的前端硬编码正是漏掉 `drumstick-bento` 的根因。
  → 内置限额需前端提前 disable/提示：`MILK_TEA_DAILY_LIMIT=2`、`COFFEE_DAILY_LIMIT=2`、`STAMINA_POTION_DAILY_LIMIT=1`、`FOCUS_ENGINE_MAX_USES=1`、`BOOK_WEEK_CAP=10`（**是"单学员 × 单属性每周增益点数 ≤ 10"，不是"每周 10 本书"**）。
  注：`FOCUS_CAP_MAX=100` **不是道具限额**，是 `focus_cap` / `energy_max` / `stamina_regen` 的**属性硬顶**，不要混进道具使用次数。（失败不吞道具：全在同一 `$transaction`，抛错回滚。）
  → ⚠️ **直用书会被周额度截断**：周限 10 点/单学员/单属性，而增益梯度是 灰+2 / 黄+4 / 绿+7 / 蓝+12 / 紫+20 ⇒ **紫书（+20）在任何情况下都吃不满**（额度剩 3 点就只涨 3 点，17 点蒸发）。UI 必须在使用前明确警示「本周剩余 N 点，使用该书将损失 M 点」。**两类书的限额提示必须分开做**：直用书受周限（点数），六维书是定向训练耗材（乘区）不受此限。
- **Query 策略**：`QueryClient` 加 `defaultOptions` + 分级 `staleTime`（钱包/库存 30s、静态配置 5min、战报 Infinity），并按下述**两个不同性质**的问题分别处理：
  - **性能/锁竞争（`pvp/*`）**：后端 `advancePvpTournament` 经源码核对**完全幂等、终态吸收**（不会重复结算/发奖），但每次调用开头 `SELECT ... FOR UPDATE` 加行锁，`PvpPage` 三查询并发会在同一把锁上串行排队，且终态后仍全量跑奖励 upsert。→ detail/bracket/rewards 设 `refetchOnWindowFocus:false`，终态后 `staleTime: Infinity`。
  - **⚠️ 正确性（`/api/academy/pool` 与 `/api/overview`，用户可见、优先处理）**：`getPool` 一旦跨过 `free_interval_hours` 或日界，**任意一次 GET 就整池重掷**（仅不 stale 且未跨日时是纯读），而 `tempId` 是**位置编号 `c0..c4`**（`recruit-gen.ts:372`），重掷后编号复用；`recruit()` 回查是 `candidates.find(c => c.tempId === tempId)`（`service.ts:205-206`）。叠加 `refetchOnWindowFocus:true` 的后果是：**用户看着 c2（天才）→ 切标签页触发重掷 → 点「招募 c2」→ 命中全新的 c2（可能是普通学员）→ 扣款与落库全部成功、HTTP 200、无任何提示。** 这是静默的资金与预期损失，比 404 严重。
    → 必须做三件事：① 这两个查询 `refetchOnWindowFocus:false` + 合理 `staleTime`；② 用服务端已给的 `OverviewView.pool.freeRefreshAt`（= `generatedAt + free_interval_hours`）做守卫，**临近该时刻不再 refetch**；③ **refetch 后若 `generatedAt` 变化，立即作废当前选中项并提示「候选池已刷新」**——这条最关键，直接堵住"看着旧卡点新人"。
    注：`getPool` 全程无 `FOR UPDATE`（不同于 `refreshPool` 有 `lockPoolRow`），并发两个 GET 撞同一过期窗口会各自重掷、last-write-wins，故第 ③ 条不能只靠比较响应体，必须在交互层拦。

---

## 3. 不可破坏的契约

### 3.1 e2e（51 用例 / 16 spec，`tests/e2e/`）

**路由 16 条，路径不得变**：`/login` `/register` `/` `/settings` `/students` `/students/:id` `/training` `/backpack` `/academy` `/academy/lecture` `/problem-library` `/admin` `/pvp` `/story` `/adventure` `/records/:recordId`（`?details=1` = 跳过回放直达战报）。

**守卫**：未登录跳 `/login`；`/admin` 当前**无前端角色守卫**（仅靠 `App.tsx:23` 决定是否渲染入口 + 后端 403）→ 补 `RequireAdmin`，但**必须保持**"非 ADMIN 看不到『管理端』入口、直连显示『管理端数据加载失败。』"。

**原生控件不能换自绘**：`<select>` = `train-book`/`train-log-kind`/`lecture-student`/`lecture-tier`/`problem-student`/`pvp-select`/`admin-t-size`；`<input type=checkbox>` = `lecture-force`（**按 V 显隐**，非常驻禁用）、`*-checkbox-*`；`role=radio` = 专项训练预制题（可访问名 `/Q \d+/`）；真实 `disabled` = `story-enter`/`checklist-claim`/`rename-toggle`/`train-run`/`item-use-confirm`/`adventure-choice-*`。

**逐字断言文案**：`用户名或密码错误`、`用户名已被占用`、`金币不足`、`讲课未能开始`、`本日出题次数已达上限`、`体力或金币不足`、`两次新密码不一致`、`注销失败：密码确认不符`、`管理端数据加载失败。`、`战斗回放加载失败。`、`战报不存在、已失效或无权访问。`；任何页面不得出现「加载失败」；`欢迎回来，教练`、`训练完成`、`招募（`、`已回避`、`情报已激活`、`已领取`、`已暂停`、`全员并行作战中`、`本场战斗完成`、`九维能力`、`天赋`、`结算`、`排名赛战报`、`出题对决战报`、`对阵结果`、`赛事奖励公示`、`未解锁`、`暂无记录。`、`题库还是空的`、`暂不可用`、`金钱 / 声誉`、`拥有 N 张改名卡`；格式串 `金币 2500`、`声誉 10`、`我的学员（2）`、`当前候选 5 人`、`0/5`、`0/120`、`×N`、`V 12`、`第 1 轮`；英文硬断言 `Ranking Battle · Parallel View`、`Duel Battle`、`Problem Detail`；`replay-pause` 在「暂停」↔「继续播放」间翻转；`pvp-roster-list` 阵容名用中文顿号「、」。

**⚠️ 文案陷阱**：`lib/api.ts:72` 的 `ERROR_TEXT.INVALID_CREDENTIALS='账号或密码错误'` 与 `LoginPage.tsx:28` 硬编码的 `'用户名或密码错误'` **两套并存**，4 处 e2e 断言的是页面硬编码那版（含旗舰用例 `full-journey.spec.ts`）。**不要"顺手统一到 ERROR_TEXT"**，那会一次挂掉 3 个 spec 的 5 条断言。同理保留 `RegisterPage.tsx:28` 的 `用户名已被占用`。

**原生交互**：
- **注销** = 原生 `confirm()`（`SettingsPage.tsx:116`，全仓唯一），**有 3 处测试依赖**：`settings.spec.ts:55`、`:70`、`full-journey.spec.ts:244`（`page.on('dialog', d=>d.accept())`）。换自绘弹窗**必须同提交**改这 3 处（新增 `deactivate-confirm` testid + 各补一次点击），否则 Playwright 默认 dismiss 会让 `waitForURL('/login')` 挂到 180s 超时。**不要放进"可自由修改"清单。**
- **开除** = 自绘 `DismissDialog`（`StudentDetailPage.tsx:266-285`），**可自由改**，只需保留 `dismiss-open`/`dismiss-confirm`。

**两处 Tailwind 类名断言（换色的前置协调项）** —— 把"选中"从 utility 名升级为语义属性，断言改 attribute：
- `records.spec.ts:85`（速度按钮，`BattleReplay.tsx:1093-1101`）：`aria-pressed={speed===value}` → `toHaveAttribute('aria-pressed','true')`
- `records.spec.ts:61`（题目卡选项卡，`:758-767`）：`role="tablist"` + `role="tab" aria-selected` → `toHaveAttribute('aria-selected','true')`
  ⚠️ 裸 `<button>` 上写 `aria-selected` 是无效 ARIA，只能二选一。

**六维中文标签（分两套，都不得随意改）**：
- **官方名**：「数据结构 / 动态规划 / 数学 / 图论 / 贪心 / 字符串」（`talents.yaml:20`、`items.yaml:54-59` 两处一致）；GAME-DESIGN §6.1 里的「DP」只是缩写，不要当正式名。
- **候选卡短名**：`AcademyPage.tsx:152-164` 手写的「数据 / 动态 / …」是非官方截断，但 `fixtures.ts:202-212` 的 `candidateVProxy()` 用它正则抓九个数字反推 V → **短名是 e2e 契约**。若要统一成官方长名，**必须同提交改 `fixtures.ts` 的正则并跑通 `full-journey`**，否则 proxy 会**静默全返回 0**（不报错）→ `recruitBest` 挑错人 → 变低概率 flaky。
- 兜底：在 `fixtures.ts` 加 3 行（九个值全解析为 0 时直接 throw），让不同步立刻变红。

**属性选择器与格式串约束**：
- `data-itemid`（背包行主键，**7 处** spec 引用：`items.spec.ts:14/31/42/62`、`full-journey.spec.ts:118/154` + 1 处 variant）→ **必须保留**（每行 `data-testid` 相同，靠它唯一定位道具）。
- `data-tempid`（候选卡，0 处引用）→ **保留**（未来若改招募 UI 的唯一低成本定位抓手）。
- `data-member-index`（0 处引用）→ 可清理。
- `checklist-progress` 是 `toHaveText('0/5')` / `toHaveText('5/5')` **精确相等** → 元素内只能有这一个数字串，不能加"完成度"等前缀文字。

**字段名陷阱（禁止拉平）**：
- `RareGain` 用 **`amount`**（`stat` 取值：`code`/`thinking`/`setting`/`mindset`/`focus_cap`/`stamina_regen`，**含 `setting`**）；`GrowthDelta` 用 **`delta`**（恒为 1），`attr` **10 个值**：`ds`/`dp`/`math`/`graph`/`greedy`/`string`/`thinking`/`code`/`focus_cap`/`stamina_regen`（**写 `string` 不是 `str`，且无 `setting`**）。两套命名不同，映射表分开建。
- verdict 三套子集分别建模：全集 5 值（AC/WA/TLE/SKIP/UNFINISHED）；题目与参与者层 3 值（AC/SKIP/UNFINISHED）；单次提交与 `round.reason` 4 值（AC/WA/TLE/UNFINISHED）。
- 战报 `RewardLine`（first_clear_money/first_clear_item/milestone_item/rank_bonus_money）与 PVP `PvpRewardLine`（item/money/reputation）**是两套独立奖励体系，不可合并**。
- `decidedBy` = `REGULAR/SUDDEN_DEATH/ENERGY/QUALITY/FRIENDLY`；`hookCondition` = `first_problem/anti_ak`；`partialOverride` = `none/trap/keep`；question `source` = `GENERATED/PREMADE`。
- admin 审计 `action` 6 种、`targetType` 3 种（`PVP_TOURNAMENT`/`ANNOUNCEMENT`/`USER`），`adminId` 可为 null（用 `adminNameSnapshot`）。⚠️ 两者在类型层是**自由字符串、无 enum 约束**（`hooks.ts:169-176`），实际字面量只能从调用点 grep 得到，**前端不能假设封闭集合**，渲染时必须有兜底文案。
- `adventure choice.skill` = `six_max`/`mindset`/九维键，未知值 → STATE_CONFLICT；`EventConfig.code` 正则 `^[GYRLPC][0-9]+$`（G=灰、Y=黄、**R=绿**、**L=蓝**、P=紫、C=彩）。
- admin 路径不对称（创建 `/api/admin/tournaments` vs 改奖品/启动 `/api/admin/pvp-tournaments/...`）按字面实现，记入后续待办。

### 3.2 部署与环境

- nginx CSP：`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'` —— **无 font-src 白名单、无 CDN、无 `unsafe-eval`、script-src 只能 self** → **禁止外链字体**（必须自托管）、禁止依赖 eval 的库。有 SPA fallback 与 gzip（css/js/json/svg）。
- e2e 必须用 `vite dev`（preview 无 `/api` 代理）；`vite.config.ts` 的 `host 127.0.0.1` + `strictPort` + `/api` proxy 不得改。
- 新增 npm 依赖只需改 `apps/web/package.json`（Dockerfile 的 COPY 清单仅在新增 workspace 包时才需同步）。
- 本机坑：Node 无法 spawn `pnpm`（只有 shim）→ 跑 e2e 需手工先起 API 与 web；`prisma generate` 是 typecheck 前置；**动手前先 `git pull`**。

### 3.3 工程规范（`H:/project/AGENTS.md`）

- **不留兼容垃圾**：删就删干净，不留 shim、双开关、fallback 渲染分支。
- **每完成一个任务提交一次，产物必须完整可编译**；**只 commit 不 push**。
- **性能是硬指标**：优化 >10% 才合格，5ms 内视为噪音；行数变少也是好优化；复杂度升高 + 行数变多 = 垃圾，直接扔掉。**严格控制行数。**
- **不补测试**：51 个 Playwright 用例是唯一回归网，目标是保持绿而不是扩写。`V`/数值/钱包联动是核心语义值得保；动画样式不新增测试。
- **不在 `/admin` 加任何"方便"的辅助功能**。
- 功能修改后必须检查测试与版本是否相符（规则 9）。

---

## 4. 实施步骤（每 Step = 一次原子提交）

| Step | 内容 | 主要文件 |
|---|---|---|
| 0 | `git pull`；新增 `lucide-react`；建本计划文档；跑一次 typecheck 建立基线 | `apps/web/package.json`、`docs/plans/` |
| 1 | 设计系统地基：Tailwind `@theme`（深色底/主强调青/次强调紫/稀有度六色/严重度六色/难度 8 级/品质材质）、字体 `@font-face`、reset、`focus-visible`、`prefers-reduced-motion` | `apps/web/src/styles/app.css`、`index.html` |
| 2 | 图标与翻译真源：`components/icons.tsx`、`lib/labels.ts`（26 项）、`lib/rarity.ts`（三套色板 + `colorful↔RAINBOW` 归一）→ **修缺陷 1** | 新建 3 个文件；清理 `BattleReplay.tsx` 重复副本 |
| 3 | 数据层收敛：修 `normRarity`；消费 `/api/talents`、`/api/problem-library`，**删"接口待后端补充"降级文案** → **修缺陷 6**；`abilities` 适配；删与 shared 重名的 3 个本地 interface；`QueryClient` 分级 `staleTime` + 关 focus refetch；**招募池 `freeRefreshAt` 守卫 + `generatedAt` 变化即作废选中项 → 修缺陷 8**；回放改增量 reducer → **修缺陷 5** | `lib/hooks.ts`、`main.tsx`、`BattleReplay.tsx`、`StudentDetailPage.tsx`、`TrainingPage.tsx`、`features/academy/AcademyPage.tsx` |
| 4 | 外壳：新 `Layout`（HUD + 图标导航 + 激活态语义标记）、`RequireAdmin`、登录/注册游戏化启动页（**保留两行硬编码错误文案**） | `app/App.tsx`、`app/guards.tsx`、`main.tsx`、`features/auth/*` |
| 5 | 总览 `/`：七个区块重排为仪表盘，checklist 做任务轨道，调试元数据不入主视 | `features/overview/OverviewPage.tsx` |
| 6 | 学员与档案：角色卡（雷达/材质/天赋光效）、心态双向条（0/B/−6 三标记）、体力 5 格、统一品质档材质 → **修缺陷 3、4**；HoverCard | `features/students/*` |
| 7 | 训练 `/training`、背包 `/backpack`、题库 `/problem-library`：道具图标 + 稀有度光效 + **白名单驱动可用性与限额** → **修缺陷 7**；训练结算演出 | `features/training/*`、`features/items/*`、`features/problems/*` |
| 8 | 学院 `/academy` 与讲课：候选卡 = 三档 hint + 九维精确值（**短名标签**）+ 价格 + `data-tempid`，**删品质徽章与天赋行** → **修缺陷 2**；后端在 `academy/service.ts:78` `toPoolView()` 出参剥离 `qualityTier`/`talents`（**只改出参，不动存储**） | `features/academy/*`、`apps/api/src/modules/academy/service.ts` |
| 9 | 历练 `/adventure`、剧情 `/story`：事件卡（六类图标 + 稀有度 + 体力档 + **「全队出战」/「仅队长」**）；8 章 33 关关卡地图/进程轨道 | `features/adventure/*`、`features/story/*` |
| 10 | PVP 与战报：对阵树（**不得用 `homeUserId` 裸数字当队名**，取 `displayName`）；`BattleReplay.tsx`（1328 行）拆 `ranking/`、`duel/`、`shared/` + 播放控制；保留全部 `replay-*` testid 与三条英文文案 | `features/pvp/*`、`features/records/*` |
| 11 | 设置 / 管理端 / 收尾：删 `PlaceholderPanel.tsx`；管理端只做视觉重排**不加功能**；emoji 清零；a11y（ARIA、label、focus trap、Esc）；**同步 `records.spec.ts` 两处类名断言**；性能自查 | `features/settings/*`、`features/admin/*`、`tests/e2e/specs/records.spec.ts` |

**不在本次范围**：`/api/pvp/tournaments/:id/actions/start` **不是管理员专属**（普通用户 GET 详情到点且报名 ≥4 同样触发推进）→ 不要做成 admin-only UI。

---

## 5. 不变项 / 禁止项

**不变**：后端 API 与业务逻辑（**唯一例外**：Step 8 服务端出参剥离一行，已批准）、共享包语义、路由表 16 条、e2e 的 testid 与逐字文案、部署形态与 nginx CSP、`vite dev` + `/api` 代理。

**禁止**：
1. 任何 emoji 或非 Lucide 图标来源。
2. 为旧组件留兼容 shim、双主题开关、fallback 渲染分支。
3. 把难度 tier 画成稀有度六色；把招募品质档复用稀有度色相；把 severity 的 red 做成错误红。
4. 把六维合并成单一数值；把 `v` 用于任何结算判定。
5. 顺手统一 `用户名或密码错误` / `用户名已被占用` 到 `ERROR_TEXT`。
6. 给 `/admin` 加"方便"的辅助功能。
7. 为 UI 动画/样式新增测试。
8. 引 CDN 字体或外链资源。
9. push。

**已知冲突，本次不动、记入后续待办**：
- `docs/data/events.yaml:1021`，彩·传说事件 C1「金牌幽灵的对局」的 `rewards_win` 发了 `tag-card ×1`，违反「tag 获取卡 PVP 独占」红线（`GAME-DESIGN §13.2/§14/§20`、`progression.md §1.1`、`items.yaml` 的 sources）。→ **不要为 C1 做 tag 卡专属动效**；由产品裁定改奖励还是放开红线（放开需同步改四处文档）。
- 招募价格快照 bug（已定位到行）：`CandidatePayload.price` 是**建池瞬间**快照（`recruit-gen.ts:362`），而 `recruit()` 在 `service.ts:208-209` 按**当前**在册学员数重算（`recruit_base=300`、`recruit_growth=1.35` ⇒ 每招一人贵 35%：卡显示 300、实际扣 405），且 `:244-247` 只把该候选过滤掉、**不给剩余候选重算 price**。`service.ts:194-196` 注释写明"price 快照仅作展示；招募价以重算为准" ⇒ **重算是设计意图，缺的是写回**。
  → 前端：**禁止跨招募缓存候选价格**，招募成功后必须 invalidate pool；招募按钮悬停提示"费用随在营学员数浮动"。
  → 是否连带修后端（在 `:244-247` 一并写回剩余候选 price）**待定**，见下方待裁决项。
- **蓝书/紫书超周限（规格疏漏，需产品裁定；前端先按警示实现）**：直用书增益 灰+2/黄+4/绿+7/**蓝+12**/**紫+20**，而周限是 **10 点**（单学员 × 单属性 × 周）⇒ **蓝书与紫书单本就超限**。文档未说明是 clamp 还是硬拒，但**逻辑上只能是 clamp**——硬拒意味着额度上限恒为 10 < 12/20，蓝紫书将永远不可用。故实际后果是"花紫级的钱（2600 金）只能买到 ≤10 点收益"。
  → 前端先做「本周剩余 N 点，使用将损失 M 点」的**明确警示**（clamp 与硬拒两种裁定下都成立），且提示必须挂在**选中学员 + 选中属性之后**才计算（额度按学员×属性计）。
  → 数值方向（周限提到 ≥20 / 蓝紫不受限 / 按册数计）待裁定。
- ⚠️ 不要改 `apps/api/tests/items.test.ts:88`（`expect(calm.rarity).toBe('green')`）—— 该断言**主动锁定了错误的小写值**。本次方案是**只改前端归一、不动后端**，故无需动它；若日后要统一后端大小写，必须 service 与断言**成对改**。另：`items.yaml` 的 `cost_by_target_rarity` 用小写键，那是**配置键空间**，与 API 枚举值无关，不要一起改。

---

## 6. 原子提交计划

1. `chore(web): add lucide-react dependency`
2. `feat(web): add design tokens, fonts and global styles` —— Step 1
3. `feat(web): add icon and label single source of truth` —— Step 2（修缺陷 1）
4. `refactor(web): normalize rarity, consume talents/problem-library, fix query defaults` —— Step 3（修缺陷 5、6）
5. `perf(web): make battle replay incremental` —— Step 3
6. `feat(web): rebuild app shell, guards and auth pages` —— Step 4
7. `feat(web): rebuild overview dashboard` —— Step 5
8. `feat(web): rebuild student roster and profile cards` —— Step 6（修缺陷 3、4）
9. `feat(web): rebuild training, inventory and problem library` —— Step 7（修缺陷 7）
10. `fix(api): strip qualityTier and talents from pool view` —— Step 8 服务端一行
11. `feat(web): rebuild academy recruit and lecture` —— Step 8（修缺陷 2）
12. `feat(web): rebuild adventure and story stage map` —— Step 9
13. `feat(web): rebuild pvp bracket and battle report` —— Step 10
14. `test(e2e): assert semantic state attributes instead of tailwind classes` —— Step 11（records.spec.ts 两处）
15. `chore(web): remove placeholder panel, emoji sweep and a11y pass` —— Step 11

## 7. 开工前待裁决项

| # | 事项 | 选项 | 现状 |
|---|---|---|---|
| 1 | 招募**价格**是否一起修后端（`service.ts:244-247` 写回剩余候选 price） | a) 只做已批准的一行剥离（A）／b) A+B 一起做 | **待定**；不阻塞——前端按"禁止缓存价格 + 悬停提示"实现即可两分支兼容 |
| 2 | 紫书 +20 vs 周限 10 点 | 提高周限 / 蓝紫不受限 / 按册数计 / 维持 + UI 警示 | 前端先按**明确警示**实现，数值待裁 |
| 3 | C1 事件发 `tag-card` 违反 PVP 独占红线 | 改奖励 / 推翻红线（需同步四处文档 + `items.yaml`） | 前端**不为 C1 做 tag 卡专属动效** |

已裁决：九维**保持精确可见**；服务端**仅**在 `toPoolView()` 出参剥离 `qualityTier` 与 `talents`（不动存储结构，`recruit()` 落库仍需这两个字段）。`GET /api/academy/pool` **继续返回精确 `attrs`** —— `lecture.spec.ts` 的 `recruitAtLeast` / `recruitInWindow` 依赖它构造定向学员，剥离会让 3 个讲课核心用例只能删除或要求新增 `?minV=` 过滤参数。

> 每个提交必须通过 `pnpm -r typecheck && pnpm -r lint && pnpm -r build`；全部完成后再 push。

---

## 8. 实施记录（2026-09-20 完成）

**分支**：`UI-refactor`（原 `feat/frontend-rewrite`，2026-09-21 改名后推送并开 PR）。三条验收线全部达成：

| 验收线 | 结果 |
|---|---|
| `pnpm -r typecheck && pnpm -r lint && pnpm -r build` | 全绿 |
| `pnpm e2e`（51 用例） | **51 passed**（3.5 min，workers=1） |
| 零 emoji / 零裸 key / 零调试元数据 | 对 12 条路由（含 `?details=1` 战报）抓 `body.innerText` 审计：全部 clean；`neutral-*` 旧灰阶类 0 处 |

**6 个真实缺陷**：1（彩档双轨）2（招募前泄品质/天赋）3（品质配色三套）4（心态无刻度）5（回放 O(n²)）6（过期端点注释与降级分支）7（背包白名单漏鸡腿便当）8（招募池重掷静默招错人）全部修复。

### 与计划的偏差（5 项，均已在代码注释/提交信息中说明）

1. **天赋来源 `acquiredVia` 未渲染**：该字段只存在于 `StudentTalent` 表，未在任何前端消费的出参里（`StudentView.talents` 是 `string[]`）。按"唯一批准的后端改动"边界，未扩字段；`labels.ts` 相应表已删除以免留死代码。
2. **洗练保底计数 `counters.reroll` 未渲染**：服务端当前没有任何代码写入该计数器（洗练功能未落地），渲染会永远显示 0。`CountersView` 已按真实落库形状（`milkTea/coffeeDaily/staminaPotionDaily/bookWeek(*Key)`/`focusEngineUsed`）修正。
3. **道具可用性真源比计划更彻底**：新增 zod-free 模块 `@oinur/shared/item-usage`（`USABLE_ITEM_IDS` 21 件 + `ITEM_USE_LIMITS`），**API 的 `effects.ts` 与前端共用同一常量**（删掉本地重复常量与 `isDirectBook`，行为不变）；为此 shared 新开 `./item-usage` 与 `./enums` 子路径，避免前端经 barrel 把 config 的 zod schema 打进浏览器包（实测 +82KB → 保持 437KB 基线）。
4. **战报拆分粒度更细**：实际拆为 `records/{shared,ranking,duel}/` 19 个文件（最大 320 行），比计划的 3 个子模块多出 `bits/rewards/useReplayPlayback` 与 `ranking|duel` 各自的 `*Report`；`BattleReplay.tsx` 只剩 61 行的视图选择 + 继续对外导出 `BattleReplay`/`BattleWaiting`。
5. **PVP 奖励公示的未持有道具显示「未知道具」**：`/api/items` 只回已持有道具，前端拿不到 81 件名录。要显示全名需服务端补道具目录端点（不在本次范围）。

### 遗留待办（本次不动）

- 计划 §5 三条已知冲突（C1 事件的 `tag-card`、蓝紫书周限数值裁定、招募价写回）均按原口径处理，未改后端。
- 前端包 548KB / gzip 162KB（lucide 图标 + 页面重写，比改写前 +111KB）。若要压回，做**路由级代码分割**（`React.lazy` + Suspense）或按需 `dynamicIconImports`，评估后可另开提交。
- `/admin` 审计表保留原始动作码（`TOURNAMENT_CREATE` 等）作为审计追溯字段（e2e 逐字断言依赖它），中文标签并列显示。

---

## 9. 美观度第二轮：指挥台海拔（2026-09-21 完成）

第一轮重写 + `d10a32e` 截图 polish 修完硬伤后，截图仍像**深色 admin**：每块 panel 同等发光、总览钱包与 sticky HUD 重复、剧情是 8 章 × 33 关均质列表、稀有度把整行染色、空态像缺文件。本轮**只抬海拔、不铺新色**：色板、16 条路由、e2e testid 与逐字文案全部锁死。

| 提交 | 内容 |
|---|---|
| `fb91259` | 共享基元：HUD 加权（金币主 / 声誉次 / 学员安静 / 体力格 + 缺体点名）、`Empty` 升为无信号简报、可点 `Card` 1px 抬升、`.mat-genius` halo 去彩、`RARITY_GLOW` 加大、训练页改用共享 `StaminaCells` |
| `c1cd288` | 稀有度收进 40–44px 图标井（行壳回中性）；历练事件整卡呼吸 → 井上专属呼吸 |
| `8df093b` | 内容页空态 CTA：背包 → 剧情赛程、历练记录 → 出发准备、PVP → 公告 |
| `4a969d9` | HUD 色值死分支清理 |
| `b0bfbd2` | `full-journey` 的 `getByText` strict 冲突加 `{ exact: true }` |
| `e4e63e6` | 总览钱包降为一行刻度；`panel-corners` 只给唯一 live 块；动态空态补 CTA |
| `a891738` | 剧情章节地图（8 章节点横条 + 只展开当前章轨道，折叠章不卸载 DOM） |
| `9d66492` | 修生产构建：`.empty-briefing` 误用 `@apply panel` |
| `ccc0e15` | 拉丁排版换 IBM Plex Sans（可变）+ IBM Plex Mono，删掉 Chakra Petch / JetBrains Mono |

**验收**：`pnpm -r typecheck && pnpm -r lint && pnpm -r build` 全绿；`pnpm e2e` **51 passed**（5.2 min，workers=1）；另用 DOM/computed style 断言复核 23 项视觉验收点全部通过。

### 本轮修掉的 3 个真实缺陷（原计划外，已核实成因）

1. **彩档图标整体不可见**：`.rainbow-text` 是 `bg-clip-text text-transparent`，而 Lucide 图标走 `stroke: currentColor` → 凡把 `rarityText()` 或彩档 `rarityChip()` 打在含 SVG 图标的元素上，图标渲染为**透明**。命中 5 处（背包/题库图标井、历练日志、学员卡与悬浮详情的天赋图标）。新增 `RARITY_ICON`（彩档走实色）收敛；`rainbow-text` 仅保留给纯文字（`AuthFrame` 品牌字）。
2. **生产构建失败**：`.empty-briefing` 用 `@apply panel panel-corners` 组合语义类，而 `panel`/`panel-corners` 是 `@layer components` 的语义类、不是 Tailwind 工具类 → `vite build` 报 `Cannot apply unknown utility class 'panel'` 直接失败。**`vite dev` 不硬失败**，所以 e2e 一直没暴露（dev 下空态只是丢了玻璃底/圆角/四角刻度）。改为在 JSX 里组合类名，CSS 只写差异项。
3. **`full-journey` 随机失败**：`item-use-confirm` 文案「给 {学员名} 使用」与 spec 的 `getByText(best.name)` 撞车——默认预选 `students[0]` 恰为目标学员时，strict mode 同时命中学员行与按钮。与学员顺序相关，故时好时坏。加 `{ exact: true }` 锁定学员行，产品文案不动。

### 本轮明确不做（含理由）

- **题库空态不加 CTA**：出题工作台就在同页正上方且带主按钮，同义 CTA 属冗余。
- **不把 `animate-halo` 复用到稀有度彩档井**：该动画已归品质材质 `.mat-genius`（arc 色），复用即跨体系混用；改为独立的 `--animate-rainbow-halo`（只用 `--color-rarity-colorful`）。
- **不改共享 `HoverCard`**：它已带 `tabIndex=0` + `group-focus-within`，点击即聚焦展开、触屏可用；改它会影响 10 处调用点。
- **章节地图吸顶只在 `lg` 生效**：窄屏 HUD 会换行变高，`top: var(--hud-h)` 会被压住。
- 路由级 code-split 仍未做（本轮后包体 551.87 kB / gzip 163.85 kB，另开）。

### 字体选型（`ccc0e15`）

原栈的问题是**把斜切装饰窄体当正文用**：`--font-sans` 与 `--font-display` 同为 `Chakra Petch`，且只自托管 500/600/700、**无 400 字重** → 12–14px 正文被迫 500（小字发糊）、拉丁斜切骨架与中文方正黑体同排断裂、`tabular-nums` 因字形无 tnum 而不生效（数字滚动抖动）、标题没有字重梯度。

换 **IBM Plex Sans（可变 latin，wght 100–700）+ IBM Plex Mono（latin 400）** 的理由：
- **Sans 与 Mono 同骨架**，等宽与正文混排最协调（这是它相对 "Inter + JetBrains Mono" 的决定性优势）；
- IBM Plex 属**中性黑体**，与苹方/雅黑同族骨架，中西混排不断裂——这一点对本项目（全中文界面 + 大量拉丁数字）比"科技感"更重要；
- 实测：tabular 与默认上下文里 `1111`/`8888` 均同宽（数字不再抖）；中文实测 4 字 = 192px（= 4×48px 全角，与强制雅黑一致），**无豆腐块**；
- 体积 45.7KB + 14.7KB = **60.4KB**，仍在 §2.2 的 ≤100KB 内。

技能库命中的另两条作为反例排除：**Orbitron + JetBrains Mono**（比 Chakra Petch 更窄更游戏化，更不适合正文）、**Russo One + Chakra Petch**（纯电竞路子，与"精密指挥中心"冲突）。

### 已知遗留（本轮判定为既有问题，未修）

- 窄屏（400px）剧情页 `scrollWidth` 比视口多 **3px**：来源是共享 `HoverCard` 的隐藏 tooltip（`w-80`、`opacity-0`）越出视口。已用 `fb91259` 版本做对照测量，**改动前后同为 403**，非本轮引入；`overflow` 全页一致无真实横向滚动条。

