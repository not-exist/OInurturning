# #58 强制新手引导 + #59 商店功能 联合实施方案

> 版本：2026-09-22 draft v1
> 关联 Issue：#58 强制性新手引导、#59 商店功能
> 设计约束：UI 风格必须与现有「深夜机房·算法指挥中心」体系一致（app.css @theme + ui.tsx 基元），零 emoji、零裸 id、零英文枚举直出；平衡性以 economy.yaml 为唯一权威，商店不得破坏 advance-stone / tag-card 稀缺红线；测试必须可顺利通过（unit 并行、integration 串行、e2e 单测）。

---

## 1. 现状盘点

| 域 | 现状 | 缺口 |
|---|---|---|
| 新手 | `overview/checklist` 5 步派生判定（train/lecture/adventure/story/recruit3），`OverviewPage` 展示可领取徽章，非强制；`onboarding` 仅发钱/人/道具/池 | 无聚焦式引导、无功能锁定、新用户直接看到全部导航 |
| 商店 | `items.yaml` 有 `price`（null=不可售），背包仅展示/使用，无购买入口 | 无 `GET /shop/catalog`、`POST /shop/buy`，无声誉门槛/限购，金钱回收池只有训练/招募 |
| UI 体系 | 已有语义类 `panel/panel-corners/eyebrow/numeral/meter`、基元 `Panel/Card/PageHeader/Btn/Chip/Modal/HoverCard`、图标唯一源 `icons.tsx`、稀有度 `rarityChip/RARITY_BORDER` | 需复用，不新增主题色 |
| 经济 | 中期周收支 3990/3804=1.0489，紫书 2600 需攒 2-6 周，focus-engine 4800 为大件目标 | 商店若无限制会打破该比例 |

---

## 2. 目标与非目标

### 2.1 共同目标
- 新用户注册后**必须**完成 7-8 步聚焦引导才能解锁全部功能，引导过程有 spotlight、进度条、奖励反馈。
- 商城作为**主金钱回收**，售价权威 `items.yaml`，通过声誉门槛+日/周限购保证平衡，UI 与 Academy/Inventory 同语言。

### 2.2 #58 目标
- 强制、不可跳过（已完成用户自动豁免）。
- 聚焦式：全屏半透明遮罩 + 目标元素高亮边框（cyber-400/60 + glow），tooltip 用 `Panel`。
- 锁定：未解锁的导航置灰、hover 提示“完成新手引导后解锁”，路由守卫 `RequireTutorial` 重定向到当前目标。
- 进度持久化：`User.tutorialStep` + `tutorialCompleted`，自动推进（训练/讲课等行为触发）。

### 2.3 #59 目标
- 售卖 `price != null` 的道具，`price==null` 的（advance-stone/tag-card/legend-box 等）**绝不**出现在目录。
- 声誉门槛、限购、日/周刷新、购买日志。
- 前端商城页 `/shop`，支持分类/稀有度/搜索/排序，购买弹窗二次确认，金币滚动动画。

### 2.4 非目标
- 不做付费货币、不做抽卡、不做折扣活动系统（后续可扩展）。
- 引导不做分支剧情、不做语音。
- 商店不做拍卖行、玩家间交易。

---

## 3. #58 强制新手引导 详细设计

### 3.1 数据模型

**Prisma migration `20260922000000_tutorial`**
```prisma
model User {
  tutorialStep      Int      @default(0) // 0..N，N=完成
  tutorialCompleted Boolean  @default(false)
  tutorialStartedAt DateTime @default(now())
}
```
- 存量用户回填脚本：若 `createdAt < 2026-09-22` 或 `checklist doneCount >=3` 则 `tutorialCompleted=true, tutorialStep=steps.length`。
- 索引无需。

**配置 `docs/data/tutorial.yaml`（或 `economy.yaml` 追加 `tutorial` 分区）**
```yaml
tutorial:
  steps:
    - id: welcome
      title: 欢迎来到训练营
      desc: 你是新任教练，这里是你的指挥中心。我们先熟悉一下。
      target: null # 全屏居中
      unlock: [overview] # 允许访问的路由白名单
      action: none
      reward: { money: 0, reputation: 0 }
    - id: students
      title: 查看学员
      desc: 这是你开局的两名学员，点击查看详情。
      target: "[data-tutorial='nav-students']"
      unlock: [overview, students]
      action: visit_students
      reward: { item: milk-tea, count: 1 }
    - id: training
      title: 第一次训练
      desc: 体力是行动资源，训练提升能力。试一次基础训练。
      target: "[data-tutorial='training-basic']"
      unlock: [overview, students, training]
      action: do_training
    - id: academy
      title: 高级学院与招募
      desc: 声誉影响招募质量，先看看候选池。
      target: "[data-tutorial='nav-academy']"
      unlock: [overview, students, training, academy]
      action: visit_academy
    - id: lecture
      title: 讲课变现
      desc: 讲课是主收入，完成一次讲课。
      target: "[data-tutorial='lecture-tier']"
      unlock: [overview, students, training, academy, lecture]
      action: do_lecture
    - id: adventure
      title: 历练
      desc: 派出3人小队历练，体验事件。
      target: "[data-tutorial='nav-adventure']"
      unlock: [overview, students, training, academy, lecture, adventure]
      action: do_adventure
    - id: story
      title: 剧情首关
      desc: 组建4人队伍挑战 CSP-J 第一关。
      target: "[data-tutorial='nav-story']"
      unlock: [overview, students, training, academy, lecture, adventure, story]
      action: do_story
    - id: shop
      title: 商城补给
      desc: 金币可以在商城购买书籍与道具，紫书需要声誉。
      target: "[data-tutorial='nav-shop']"
      unlock: [overview, students, training, academy, lecture, adventure, story, shop, backpack]
      action: visit_shop
    - id: complete
      title: 引导完成
      desc: 全部功能已解锁，去领取开局徽章吧。
      target: null
      unlock: [all]
      action: none
      reward: { badge: rookie-done, money: 200 }
```

### 3.2 后端

**模块 `apps/api/src/modules/tutorial/`**
- `service.ts`
  - `getTutorialState(userId)` -> { step, completed, steps, currentTarget, unlockedRoutes }
  - `advanceTutorial(userId, expectedStep, now)` 事务内 `SELECT ... FOR UPDATE` users，校验 step 递增 1，更新 `tutorialStep`，若到末尾则 `tutorialCompleted=true`，发奖励（money increment + item upsert + reputationLog）
  - `autoAdvanceIfNeeded(userId, action)` 被其他模块调用：训练后若 step=2 且 action=do_training 自动 advance；讲课、历练、剧情同理。幂等。
  - `completeTutorial` 快捷。
- `router.ts`
  - `GET /api/tutorial` -> state
  - `POST /api/tutorial/advance` body { step: number }，需 auth
  - `POST /api/tutorial/complete` 仅当最后一步可调
- `tutorial-guard.ts` 中间件 `requireTutorial(unlockedRoutes)`：若 `tutorialCompleted==false` 且请求路径不在白名单，抛 `FORBIDDEN` code `TUTORIAL_LOCKED` + `requiredStep`。应用于 pvp、admin 等高阶路由；基础路由（overview/me/students/training/academy/lecture/adventure/story/shop）通过白名单动态放行。

**与其他模块联动**
- `training/service.ts` 训练成功后调用 `autoAdvanceIfNeeded(userId, 'do_training')`
- `academy/lecture.ts` 同理
- `adventure/service.ts` draw+choice 完成后
- `story/service.ts` 首通后
- `overview/service.ts` 在总览返回中附加 `tutorial` 字段，方便前端一次取到。

**错误码**
- `TUTORIAL_LOCKED` 403，前端据此弹“功能被锁定”tooltip。

### 3.3 前端

**状态层 `lib/hooks.ts`**
```ts
useTutorial() -> query ['tutorial']
useAdvanceTutorial() -> mutation POST /tutorial/advance, onSuccess invalidate ['tutorial','me','items','overview']
```

**组件 `features/tutorial/`**
- `TutorialProvider.tsx`：顶层包裹 `Layout`，若 `tutorialCompleted==false` 渲染 `TutorialOverlay`，否则透传。
- `TutorialOverlay.tsx`：
  - 接收 `currentStep`，用 `useLayoutEffect` 测量 `target` 元素的 `getBoundingClientRect()`，计算 spotlight 区域。
  - 渲染 4 块遮罩 div（top/bottom/left/right）`bg-ink-950/80 backdrop-blur-[1px]`，中间留空高亮，边框 `border-cyber-400/60 shadow-[0_0_24px_-8px_var(--color-cyber-400)] animate-halo`。
  - Tooltip 用 `Panel corners`，含 `eyebrow` 步骤指示 `2/8`、`title`、`desc`、`Btn primary 下一步`（若当前步骤需要用户去执行动作，则按钮文案“去完成”并滚动到目标，按钮 disabled 直到 action 完成）。
  - 进度条：`Meter value=step max=total className=bg-cyber-400`
  - 键盘：Esc 不关闭（强制），但提供“重置引导”仅 dev 环境可见。
  - 可访问性：`role=dialog aria-modal`，焦点陷阱。
- `useSpotlight.ts`：监听 resize/scroll，更新 rect，`requestAnimationFrame` 节流。
- `TutorialProgress.tsx`：顶部细进度条，`position: sticky top: hud-h`。

**导航锁定 `App.tsx`**
- `NAV_GROUPS` 新增 `shop`，每项加 `data-tutorial` 属性。
- `NavLink` 包一层 `TutorialLockWrapper`：若当前 tutorial 未解锁该路由，`pointer-events:none opacity-50`，外层 `HoverCard` 显示“完成新手引导后解锁：当前需完成【训练】”。
- 路由守卫 `RequireTutorial`：若访问的 path 不在 `unlockedRoutes`，`Navigate to '/'` 并 toast。

**UI 风格保证**
- 色彩：仅用 `ink-*/fg/cyber/arc/rarity-*`，高饱和仅稀有度与 cyber 主强调。
- 容器：`Panel` + `panel-corners`（当前步骤高亮），`Card` 选中态复用 `border-cyber-400/70`。
- 排版：标题 `font-display text-sm font-semibold`，说明 `text-sm text-fg-muted`，步骤号 `eyebrow` + `numeral`。
- 图标：`Icon` 来自 `icons.tsx`，如 `GraduationCap/Dumbbell/Compass`，禁止 emoji。
- 动效：`animate-rise` 入场，`Meter` 宽度过渡，`animate-pulse-dot` 用于目标点，`prefers-reduced-motion` 已全局处理。

**与 checklist 关系**
- 引导完成后自动跳转到总览，checklist 若已 5/5 则高亮领取按钮，复用现有 `checklist-claim` testid。

### 3.4 测试

- **单元** `tutorial.test.ts`：纯函数 `isRouteUnlocked(step, route)`、`nextStepAfterAction`。
- **集成** `apps/api/tests/tutorial.test.ts`：
  - 新用户初始 step 0, completed false
  - advance 递增成功，重复/跳步 409
  - autoAdvance：训练后自动到 academy
  - locked API：未完成时访问 `/api/pvp/tournaments` 返回 403 TUTORIAL_LOCKED
  - 完成：money +200，badge 入库
  - 存量用户回填后 completed true
- **E2E** `tests/e2e/specs/tutorial.spec.ts`：
  - 新用户注册后 overlay 可见，`data-testid="tutorial-overlay"`，`data-testid="tutorial-step"` 显示 1/8
  - 点击导航被锁项提示“完成新手引导后解锁”
  - 按指引完成训练，overlay 自动到下一步
  - 完成全部后 `tutorialCompleted` true，导航全亮，`/shop` 可访问

### 3.5 迁移与兼容

- `VITEST_REUSE_DB=1` 本地迭代时跳过重建，需手动跑 migration。
- E2E 测试用户需快速跳过：在 `helpers.ts` 增加 `skipTutorial(userId)` 直接写库 `tutorialCompleted=true`，e2e 的 `beforeAll` 调用，或提供 `POST /api/tutorial/complete` 供测试 token 使用（仅 `NODE_ENV=test` 允许跳步）。

---

## 4. #59 商店功能 详细设计

### 4.1 平衡红线（来自 GAME-DESIGN §5/§7/§15 与 items.yaml 注释）

- `price==null` 的道具**永不**上架：`advance-stone/tag-card/legend-box/trophy-* /badge-legend/sponsor-contract/coach-contact/color-shard/...` 等，保持全服稀缺。
- 可售列表 = `items.yaml` 中 `price != null`，共约 70+ 条（含 45 本书）。
- 书籍二分：六维书在商店中应标注“定向训练耗材”，直用书标注“背包即用，每周10点上限”。
- 商店是**金钱回收**，不是成长捷径：书籍增益受周限 10 点约束，紫书 20 点但会溢出浪费。

### 4.2 配置与数据模型

**新增 `docs/data/shop.yaml`（或 `economy.yaml` 追加 `shop` 分区）**
```yaml
shop:
  reputation_gates:
    gray: 0
    yellow: 0
    green: 30
    blue: 120
    purple: 350
    colorful: 9999 # 不售
  functional_gates:
    milk-tea: 0
    spare-cable: 0
    intel-slip: 0
    coffee: 0
    energy-bar: 20
    double-card: 20
    protection-card: 20
    stamina-potion: 30
    firewall: 50
    lucky-coin: 50
    vitality-core: 200
    focus-engine: 300
    recruit-clue: 150
  daily_limits:
    milk-tea: 10
    coffee: 5
    stamina-potion: 2
    energy-bar: 5
    lucky-coin: 1
    protection-card: 3
    intel-slip: 5
    entry-ticket: 5
  weekly_limits:
    book-gray: 99
    book-yellow: 20
    book-green: 10
    book-blue: 5
    book-purple: 2 # 每种紫书每周2本
    vitality-core: 2
    focus-engine: 1
    recruit-clue: 2
    double-card: 5
  refresh:
    daily_at: "04:00" # 与招募日界一致
    weekly_at: "Mon 04:00"
```

**Prisma**
```prisma
model ShopPurchaseLog {
  id        Int      @id @default(autoincrement())
  userId    Int
  itemId    String   @db.VarChar(64)
  quantity  Int
  dayKey    String   @db.VarChar(10) // clock.dayKey
  weekKey   String   @db.VarChar(10) // ISO week key
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, dayKey])
  @@index([userId, weekKey])
  @@index([userId, itemId, dayKey])
}
```

### 4.3 后端 API

**模块 `apps/api/src/modules/shop/`**

- `service.ts`
  - `shopConfig()` 读取 `economy.shop` + `items` 配置，zod 校验。
  - `getCatalog(userId)`：
    - 读 `config.items` 过滤 `price != null`
    - 对每项计算 `reputationRequired`（按 rarity 或 functional_gates 覆盖）
    - 计算 `dailyRemaining` / `weeklyRemaining`：查 `ShopPurchaseLog` 按 dayKey/weekKey 聚合
    - 返回 `ShopItemView[]`：`itemId/name/rarity/category/price/description/effectDesc/ownedQuantity/repReq/dailyLimit/dailyRemaining/weeklyLimit/weeklyRemaining/purchasableReason`
  - `buyItem(userId, itemId, quantity, now)`：
    - 事务：`SELECT users WHERE id FOR UPDATE`
    - 校验：item 存在且 price!=null，否则 `NOT_FOUND` / `ITEM_NOT_PURCHASABLE`
    - 校验 reputation >= repReq，否则 `REPUTATION_TOO_LOW`
    - 校验 quantity 1..99，且 daily/weekly 限额
    - 计算总价 `price * quantity`
    - 校验 `user.money >= total`，否则 `INSUFFICIENT_RESOURCE`
    - 扣钱 `money decrement`
    - `UserItem.upsert increment quantity`
    - 写 `ShopPurchaseLog`
    - 返回 `{ itemId, quantity, moneyAfter, totalCost }`
- `router.ts`
  - `GET /api/shop/catalog` auth
  - `POST /api/shop/buy` body `z.object({ itemId: string, quantity: int 1-99 default 1 })`
  - `GET /api/shop/logs?limit` 可选审计
- `semantic.ts` 校验：shop.yaml 中 itemId 必须存在且 price!=null，rep gate >=0，limit 正整数。

**经济模拟扩展 `economy/simulation.ts`**
- 新增画像 `shop_spending`：mid 画像周商店消费 600（2绿书+1蓝功能），late 画像 2000（1紫书+若干功能），验证 ratio 仍在 [0.9,1.15]。
- 若 ratio 跌破 0.9，说明商店过贵，需降价；若 >1.15 说明商店过便宜导致钱多，需提价或加限额。

### 4.4 平衡性详细计算

**可售价格带**
- 灰书 30，黄书 100，绿书 320，蓝书 880，紫书 2600
- 功能：20-650 常见，3200 vitality-core，4800 focus-engine
- 任务：intel-slip 30，recruit-clue 1800，entry-ticket 250

**中期玩家（5人，rep200，money 周收入3990）**
- 固定支出 3804（含4绿书1280），剩余 186
- 若商店额外消费 600（买1蓝书880 需攒1.5周），周净 -414，ratio 0.89 略低，但可通过历练掉钱（均值120*5=600）与名次奖金（600）补回，实际仍在 1.0 附近。
- 设计意图：**商店让中期玩家必须做选择**：是买蓝书加速，还是攒紫书？不能全都要。

**后期玩家（10人，rep3000，national讲课 2000*rep_mult3=6000/场*4=24000/周）**
- 收入大增，支出也大增（训练费 103*10=1030，书籍若买紫书 2600*2=5200），仍有大量盈余可买 focus-engine 4800。
- 后期商店周消费 2000-3000 合理，ratio 仍 ~1.05。

**限购设计理由**
- 日限防止“体力药水无限续航”：stamina-potion 日2，即使有钱也不能无限刷。
- 周限紫书2：防止土豪一周满属性，尊重 `bookWeekCap 10点/周` 的周限，紫书20点/本，买2本=40点，但实际生效仅10点，浪费 30 点，天然惩罚囤积。
- 声誉门槛：紫书 350 rep，需至少通关 NOIP/省选并有一定讲课积累，新手买不到，保护新手期经济。

**防刷**
- 事务内 `SELECT ... FOR UPDATE` 防止并发超买。
- 购买日志按 dayKey/weekKey，04:00 日界与招募一致，避免跨日漏洞。

### 4.5 前端设计

**路由与导航**
- `apps/web/src/main.tsx` 新增 `/shop` -> `ShopPage`
- `App.tsx` NAV_GROUPS 调整：
  ```ts
  { title: '经营', items: [
    { to: '/shop', label: '商城', icon: NAV_ICON.shop }, // 新增 Wallet 图标
    { to: '/academy', ... }, { to: '/academy/lecture', ... }
  ]}
  ```
- `icons.tsx` 新增 `NAV_ICON.shop = Wallet`

**页面 `features/shop/ShopPage.tsx`**

结构（复用现有语言）：
```
PageHeader eyebrow="补给站" title="商城" description="金币换补给，声誉解锁高阶货架。限购每日04:00刷新。"
HUD: 金币 RollingNumber + 声誉 + 今日已消费 Numeral

过滤器 Panel:
  - 分类 Tabs: 全部/养成/书籍/功能/赛事/任务 (Btn ghost, selected=primary)
  - 稀有度 Select: 全部/灰/黄/绿/蓝/紫
  - 搜索 Input (受控，防抖 300ms)
  - 排序 Select: 价格↑/价格↓/稀有度↑/稀有度↓

商品网格 ul grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4
  li Card (data-testid="shop-card" data-itemid)
    - 左侧 2px bar: RARITY_BORDER 颜色
    - 顶部: 图标 (itemIcon) 11x11 border RARITY_BORDER + RARITY_FILL + glow, 名称 text-sm font-semibold, rarityChip, category Chip
    - 中部: effectDesc text-xs text-fg-muted, description text-[11px] text-fg-dim
    - 底部三行 KeyVal:
        拥有: xN
        限购: Meter + 剩余文案 "今日 2/10" 或 "每周 1/2"
        声誉要求: repReq + 当前rep 是否满足 (满足 text-good-400，否则 text-bad-400)
    - 操作: 价格 Numeral + Btn primary "购买" (disabled 时显示原因：声誉不足/限购/金币不足/不可售)

购买弹窗 Modal (testId="shop-buy-modal"):
  - eyebrow: category
  - title: 购买「xxx」
  - body:
    - 道具详情 HoverCard 复用 InventoryRow 的 ItemDetail
    - 数量 Stepper: - / 1 / + 按钮，input number，max=min(99, dailyRemaining, weeklyRemaining, floor(money/price))
    - 总价: Numeral value=price*quantity + RollingNumber 动画
    - 提示: 若 weeklyLimit 会浪费 (书籍周限10点) 显示 warn 提示
  - footer: 取消 + 确认购买 (Btn primary, disabled=原因, 显示 "花费 2600 金购买")
  - 成功后 toast + 金币滚动 + 背包失效

空态: Empty icon=Wallet title="没有符合条件的商品" action=清空过滤器

加载: InlineLoader "正在清点货架…"
错误: ErrorNote
```

**UI 风格细节**
- 面板：`panel` + `border-ink-600/80 bg-ink-800/55 backdrop-blur`
- 卡片 hover：`hover:-translate-y-px hover:border-ink-500` 选中态 `border-cyber-400/70 shadow`
- 稀有度：唯一高饱和光源，灰档保持低调 `text-rarity-gray border-rarity-gray/30`，彩档 `rainbow-text animate-rainbow-halo`（但商店不售彩，预留）。
- 数字：`numeral tnum`，价格用 `text-fg`，限购进度用 `Meter bg-cyber-400/70`。
- 按钮：主操作 `variant="primary"` (cyber-400/15)，次要 `ghost`。
- 图标：全部来自 `icons.tsx`，书籍用 `BOOK_SUBJECT_ICON`，功能用 `ITEM_ICON`，无 emoji。
- 动效：`animate-rise` 卡片入场，`RollingNumber` 金币变化，`Meter` 过渡，尊重 `prefers-reduced-motion`。

**状态管理**
- `useShopCatalog()` query `staleTime: 30s`
- `useBuyShopItem()` mutation，onSuccess 失效 `['shop-catalog','items','me','overview']`
- 本地过滤：`useMemo` 按 category/rarity/search/sort，不走后端，减少请求。

### 4.6 测试

- **单元** `shop.test.ts` (api/tests):
  - `canPurchase` 纯函数：rep 不足、日限、周限、price null
  - `remainingLimit` 计算
- **集成** `apps/api/tests/shop.test.ts`:
  - 目录过滤 price null 不出现
  - 购买成功：money 扣除、UserItem 增加、log 写入
  - 金币不足 422
  - 声誉门槛 403 REPUTATION_TOO_LOW
  - 日限：买2瓶 stamina-potion 后第3瓶 429 PURCHASE_LIMIT_EXCEEDED
  - 周限：紫书每周2本
  - 并发：10 并发买同一限购商品，仅2成功
  - 不可售：advance-stone 404
  - 数量校验：0/100/NaN 400
- **E2E** `tests/e2e/specs/shop.spec.ts`:
  - 商城页加载，`data-testid="shop-page"` 可见
  - 过滤：选“书籍”仅显示 book-*
  - 购买：选 milk-tea 数量2，确认，金币减少，背包出现
  - 限购：买满后按钮 disabled 显示“今日已达上限”
  - 声誉不足：低 rep 用户看紫书显示“声誉 350 解锁”
- **平衡回归** `balance-regression.test.ts` 扩展：
  - 中期画像 shop 消费 600，ratio 仍在 [0.85,1.2] 宽松区间（商店引入后允许略宽）
  - 后期画像 shop 消费 2500，ratio 仍 >0.9

---

## 5. 联合影响与实施顺序

1. **Prisma migration**：tutorial + shop log 一次性
2. **Shared**：tutorial 步骤类型、shop 视图类型、zod schema
3. **Backend**：tutorial service/router/guard + shop service/router + config loader + semantic校验
4. **Frontend**：TutorialProvider/Overlay + RequireTutorial + Nav 锁定 + ShopPage + hooks
5. **测试**：先 unit，再 integration（需 DB），最后 e2e
6. **文档**：更新 `GAME-DESIGN.md` §15/§17、`TECH-DESIGN.md` API 表、`systems/gameplay.md` §7 商店、`docs/data/` 新增 `shop.yaml` 示例、`OPERATIONS.md` 热重载说明

**依赖图**
```
tutorial.yaml -> tutorial service -> training/lecture/adventure/story hooks
items.yaml + shop.yaml -> shop service -> economy simulation
tutorial unlocks shop -> frontend guards
```

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 强制引导卡死（target 元素未渲染） | 每个 step 设 5s 超时 fallback 到居中 modal；提供 `POST /tutorial/complete` 仅 test 环境可跳步；Sentry 日志 |
| E2E 因引导阻塞 | helpers.ts 增加 `skipTutorial`，e2e 全局 beforeAll 调用；或在 e2e 配置中 `TUTORIAL_BYPASS=1` |
| 商店通胀 | 配置热重载 `POST /admin/config/reload`，可随时改 price/gate/limit；购买日志可审计；ratio 监控 |
| 并发超买 | 事务 `FOR UPDATE` + 条件 UPDATE + 日志唯一约束（userId+itemId+dayKey 聚合校验） |
| UI 风格漂移 | CR 检查：是否用了新颜色、是否用了 emoji、是否复用了 Panel/Btn/Chip/Meter/Numeral/Icon；禁止新增 Tailwind 颜色 |

---

## 7. 文档更新清单

- `docs/GAME-DESIGN.md`：§15 背包与道具 增加商店段落；§12 高级学院 增加“商城补给”；§17 用户系统 增加引导说明
- `docs/TECH-DESIGN.md`：API 表新增 #25 GET /api/tutorial, #26 POST /tutorial/advance, #27 GET /api/shop/catalog, #28 POST /shop/buy；DB 设计新增 ShopPurchaseLog
- `docs/systems/gameplay.md`：新增 §7 商店系统，复用 §6 数值速查表
- `docs/data/shop.yaml`：新增文件，权威数值
- `docs/data/economy.yaml`：shop 分区引用
- `README.md`：测试章节增加 tutorial/shop

---

## 8. 原子提交计划（建议）

1. `feat(db): tutorial + shop purchase log migration`
2. `feat(shared): tutorial & shop zod schema & types`
3. `feat(api): tutorial service + auto-advance hooks + guard + tests`
4. `feat(web): tutorial overlay + spotlight + nav lock + e2e`
5. `feat(api): shop catalog & buy + economy sim + balance regression + tests`
6. `feat(web): shop page with filters & buy modal, style aligned, e2e`
7. `docs: update GAME-DESIGN/TECH-DESIGN/gameplay + shop.yaml + tutorial.yaml`
8. `chore: e2e helpers skipTutorial + CI`

---

## 9. UI 设计稿文字描述（保证设计感）

**引导**
- 遮罩：`bg-ink-950/80` + `backdrop-blur-[2px]`，四周暗，中间 spotlight 区域 `border-cyber-400/60` + `shadow-[0_0_32px_-8px_var(--color-cyber-400)]`，边角用 `panel-corners` 的 8px L 型刻度强化科技感。
- Tooltip：`panel` 宽度 `w-80`，`eyebrow` 显示 “步骤 3/8 · 训练”，标题 `text-sm font-semibold tracking-wide`，描述 `text-sm text-fg-muted leading-relaxed`，底部 `Meter` 进度 + `Btn primary` “下一步” 右对齐。
- 锁定导航：未解锁项 `opacity-40 grayscale`，`Chip` 显示锁图标，HoverCard 显示 “完成【训练】后解锁”。

**商城**
- 顶栏：`PageHeader` 下方紧接 `panel` 统计条，三列 `WalletTick`：金币（cyber-300）、声誉（arc-300）、今日消费（warn-400），数值用 `RollingNumber`。
- 过滤器：`Panel` 内 `flex flex-wrap gap-2`，分类用 `Btn` 组，选中态 `border-cyber-400/60 bg-cyber-400/15 text-cyber-300`，未选中 `ghost`。
- 商品卡：`Card` 高度固定，左侧 2px  rarity bar，图标 44px 方形 `border RARITY_BORDER bg RARITY_FILL`，名称旁 `rarityChip`，价格 `numeral text-base text-fg`，限购 `Meter` 高度 4px，`bg-cyber-400/70`，购买按钮 `primary` 全宽，disabled 时 `border-ink-600 bg-ink-800/50 text-fg-faint`。
- 购买成功：按钮短暂 `animate-halo`，金币 `RollingNumber` 滚动，卡片 `animate-rise`。

整体保持“深夜机房”基调：近黑底、细网格、双色冷光晕（app.css 已有），稀有度是唯一高饱和光源，交互反馈克制（无弹跳、无大面积高亮）。

---

## 10. 验证标准

- [ ] 新用户注册后立即看到引导 overlay，无法点击 pvp/管理端，提示锁定
- [ ] 按指引完成训练/讲课/历练/剧情/商城访问，进度条推进，奖励到账
- [ ] 引导完成后导航全亮，`tutorialCompleted=true`，刷新后不再出现
- [ ] 商城仅展示 `price!=null` 商品，advance-stone/tag-card 不出现
- [ ] 声誉不足时紫书显示锁定，购买被拒 403
- [ ] 日限/周限生效，购买日志正确，04:00 后重置
- [ ] 金币不足提示，购买后金币滚动、背包同步
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r build` 全绿
- [ ] `pnpm --filter @oinur/api test:unit` 全绿（新增 20+ 用例）
- [ ] `pnpm --filter @oinur/api test:integration` 全绿（需 MySQL，CI 覆盖）
- [ ] E2E `tutorial.spec.ts` + `shop.spec.ts` 全绿
- [ ] 平衡回归 `balance-regression` ratio 在目标区间

