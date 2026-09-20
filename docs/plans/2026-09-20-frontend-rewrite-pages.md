# 前端重写 · 页面实施契约（并行分工用）

> 配套：`docs/plans/2026-09-20-frontend-rewrite.md`（总体方案与缺陷清单）。
> 本文只写「怎么写」的硬约束与词汇表，避免各页各写一套。**开工前必须先读本文 + 总方案 §3（不可破坏的契约）。**

## 0. 基础事实（已就绪，不要重造）

| 模块 | 作用 | 你该做什么 |
|---|---|---|
| `src/styles/app.css` | `@theme` 令牌 + 语义类（panel/mat-*/rainbow-*/meter/eyebrow/numeral/scanlines/animate-*）| 直接用类名；**不要新增主题色**，确需新类先看是否已存在 |
| `src/lib/labels.ts` | 全部中英映射（枚举/特性/家族/属性/限额文案等）| 需要新映射时**追加到对应表**，用 `satisfies Record<T, string>` 保证完整性 |
| `src/lib/rarity.ts` | 稀有度/严重度/难度/品质档色板与归一 | 用 `rarityChip/rarityText/rarityLabel/normRarity/QUALITY_MATERIAL/SEVERITY_CLS/TIER_TEXT` 等 |
| `src/components/icons.tsx` | 图标唯一来源（`Icon`、`NAV_ICON`、`itemIcon`、`talentIcon`、`verdictIcon`、`eventCategoryIcon`、`DIMENSION_ICON`）| 一律 `import { Icon } from '../../components/icons'`，**禁止 emoji** |
| `src/components/ui.tsx` | UI 基元：`Panel/Card/PageHeader/Btn/ActionLink/Chip/Meter/KeyVal/Numeral/RollingNumber/InlineLoader/Empty/ErrorNote/HoverCard/Modal` | 页面只组合基元；需要新基元时**加到 ui.tsx 末尾**并保持风格一致 |
| `src/lib/hooks.ts` | 查询层（含 `STALE` 分级、招募池 `staleTime: Infinity` 的正确性约束）| 只读不改；需要新查询时追加，并保持 `staleTime` 分级 |
| `src/app/App.tsx` / `guards.tsx` | 外壳与守卫 | 不要改 |

## 1. 视觉语言（四套体系，混用即 bug）

- **底色**：`bg-ink-950/900/850/800` 分层；面板 `panel`（1px 半透明描边 + 轻玻璃）；正文 `text-fg`，次要 `text-fg-muted`，弱 `text-fg-dim`，最弱 `text-fg-faint`。
- **强调**：主 = 电光青 `cyber-300/400/500`；次 = 弧光紫 `arc-*`。**红色只给错误、负向心态与 severity 刻度**，不做装饰色。
- **稀有度（道具/天赋，唯一高饱和光源）**：`text-rarity-*` / `border-rarity-*` / `bg-rarity-*/10`；彩档用 `rainbow-text` 或 `border-rarity-colorful/60`；灰档=廉价/有瑕疵（负面），**不要做成高级中性灰**。用 `rarityChip(r)` 得徽章类。
- **题目特性严重度**：`Ⅰ–Ⅵ` 罗马数字 + `SEVERITY_CLS[severity]` 描边，**不要做成灾难告警**；`red` 是最轻最高频的一档。
- **难度 8 档**：`TIER_TEXT[tier]`（同色相明度递进）+ `tierLabel(tier)`；**不要借稀有度六色**。
- **招募品质档**：材质层级 `QUALITY_MATERIAL[tier]`（mat-common/good/elite/genius），**不要复用稀有度色相**；招募**前**只能显示三档气质 `QUALITY_HINT[tier]`。
- **排版**：冲击力放巨型数字（`Numeral` / `numeral` 类 + `tnum`）；正文 12–14px 正常可读；等宽 `font-mono` 用于 id/seed/代号。
- **动效**：`animate-rise`（入场）、`animate-halo`（彩档呼吸）、`animate-pulse-dot`、`Meter` 宽度过渡、`Card` hover 描边；**一律不新增测试**，且必须能被 `prefers-reduced-motion` 降级（全局已处理，不要写死动画时长到 inline style 之外的地方）。

## 2. 硬约束（违反即返工）

1. **零 emoji**、零英文枚举 key、零裸 id、零调试元数据直出（Engine/RNG/Seed/SnapshotHash 只能进「技术详情」折叠区）。
2. **e2e DOM 契约不得改**：每个页面自己那一节的 testid 必须逐字保留（见总方案 §3.1 与各 spec）。改了 DOM 就要同提交改 spec —— **本阶段不允许改 spec**，只能保留契约。
3. 原生控件不得换成自绘：`<select>`、`<input type=checkbox>`、`role=radio`、真实 `disabled`、原生 `confirm()`。
4. 文案逐字断言不得改（`用户名或密码错误`、`招募（`、`已回避`、`情报已激活`、`已领取`、`暂不可用`、`金钱 / 声誉`、`拥有 N 张改名卡`、`暂无记录。`、`题库还是空的`、`暂无训练记录`、`未解锁`、`九维能力`、`天赋`、`结算`、`排名赛战报`、`出题对决战报`、`对阵结果`、`赛事奖励公示`、`第 N 轮`、`Ranking Battle · Parallel View`、`Duel Battle`、`Problem Detail` 等）。
5. 不加"方便"功能（尤其 `/admin`），不加空兼容分支，不留 TODO 注释。
6. 性能优先：能用 CSS 表达的不写 JS；列表渲染避免 O(n²)；不要引入新依赖（`lucide-react` 已有，图表自己画 SVG，**不引图表库**）。
7. 每个页面容器保留自己的 `data-testid`（如 `overview-page`）。

## 3. 分工与文件所有权

| 负责人 | 目录/文件 | 产出提交 |
|---|---|---|
| T-学员 | `features/overview/OverviewPage.tsx`、`features/students/*`、`components/RosterPicker.tsx` | `feat(web): rebuild overview dashboard` / `feat(web): rebuild student roster and profile cards` |
| T-训练 | `features/training/*`、`features/items/*`、`features/problems/*` | `feat(web): rebuild training, inventory and problem library` |
| T-学院 | `features/academy/*` | `feat(web): rebuild academy recruit and lecture` |
| T-征程 | `features/adventure/*`、`features/story/*` | `feat(web): rebuild adventure and story stage map` |
| T-PVP | `features/pvp/*`、`features/records/*` | `feat(web): rebuild pvp bracket and battle report` |
| 负责人（主） | `features/settings/*`、`features/admin/*`、`tests/e2e/specs/records.spec.ts`、跨页收尾 | 见总方案 §6 后三条 |

**不要碰别人的文件**；确需跨文件修复（例如共享基元缺能力）→ 在 ui.tsx 末尾追加，或回报主负责人。

## 4. 每页要点（来自总方案 §2.4 与 §3，逐条落实）

- **总览**：七区块重排为仪表盘；checklist 做任务轨道（`checklist-progress` 里**只能有** `N/M` 这一串数字）；`overview-wallet` 内需含 `金币 2500`/`声誉 10` 字样格式（`金币 {n}`）。
- **学员**：角色卡（自绘 SVG 六维雷达，约 40 行，不引库）；品质材质层级统一到 `QUALITY_MATERIAL`；心态双向条画 `0` / `B = clamp(1+Σmindset flat)` / `−6` 三标记（`−6` 是焦虑反噬阈值，独立告警），**不画"过高有害"**；体力 5 格 + 当前格回充进度；精力/专注分母取 `energyMax`/`focusCap`，**绝不能除 100**。
- **训练/背包/题库**：道具图标 + 稀有度光效；可用性由 `USABLE_ITEM_IDS`（`@oinur/shared/item-usage`）驱动 —— 不在白名单的**只展示中文 `effectDesc`，不渲染使用按钮**；`rename-card` 行保留「去学员页改名」链接；直用书要提示周限损失（`ITEM_USE_LIMITS.bookWeekCap` 与 `DIRECT_BOOK_GAIN`），提示必须挂在**选了学员 + 选了属性**之后；奶茶/咖啡/药水/心流引擎的限额提前 disable。
- **学院**：候选卡 = 三档气质 + 九维精确值（**短名标签 `数据/动态/数学/图论/贪心/字符串/代码/思维/出题` 是 e2e 契约，不得改**）+ 价格 + `data-tempid`；九维保持精确可见；招募价悬停提示「费用随在营学员数浮动」；`pool-msg` 只放错误，池重掷提示放 `pool-rotated`。
- **历练**：事件卡标注类别/稀有度/体力档与**「全队出战」（对决类）/「仅队长」（非对决类）**；4 条道具门槛事件用 `choice.requiresItem` + 背包名称；2 条不可重复（`EVENT_ONESHOT`）；冷却中条目不进池，UI 不需展示冷却。保留 `adventure-*` 全部 testid 与 `adventure-logs` 的 `listitem` 计数。
- **剧情**：8 章 33 关关卡地图/进程轨道（章节=难度 tier 8 档明度递进）；`story-enter` 真实 disabled、`story-roster-checkbox-*` 保留、未解锁显示「未解锁」。
- **PVP**：对阵树用 `displayName`（**不得用 `homeUserId` 裸数字当队名**）+ `pvp-match-{id}` 内保留「查看战报」；`pvp-roster-list` 阵容名用中文顿号「、」；奖励公示与领取（`pvp-claim` → 「已领取」）。
- **战报/回放**：AC 是爽点、WA 罚时是痛点、压哨是高潮；调试元数据（`reportVersion/engineVersion/rngVersion/seed/snapshotHash`）收进「技术详情」折叠区；保留全部 `replay-*` testid 与 `replay-pause` 的「暂停」↔「继续播放」翻转、`replay-speed-*x`、`replay-question-tab-特性`、`replay-member-panel` 计数；回放状态推进沿用**增量**实现（`useIncrementalReplay`），不要退回每 tick 全量重放。

## 5. 交付前自检

```bash
pnpm -C apps/web typecheck     # 只关心自己文件的报错（他人改动并发中）
pnpm -C apps/web lint
pnpm -C apps/web build
```

- 自查：页面是否还有 emoji / 英文 key / 裸 id / 调试元数据？
- 自查：本页 e2e testid 是否全部保留（对照总方案 §3.1 与对应 spec）？
- 报告：改了哪些文件、保留了哪些 testid、typecheck/lint/build 结果、遗留风险。
