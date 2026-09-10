# 测试脚本自查报告（Self-Review）

> 范围：本分支新增的全部测试——`apps/api/tests/*`（普通测试，跑在 `test` workflow）
> 与 `tests/e2e/**`（浏览器 e2e + API 全链路旅程，跑在 `e2e` workflow）。
> 方法：逐文件通读测试逻辑 → 回查被测源码/配置确认契约 → 列 defect → 修 → 本地可跑项全绿。
> 本地不可跑项（无 MySQL、无 Prisma 引擎下载）以 CI 为准，见 §5。

## 1. 修过的 defect（共 12 项，均已落码）

### 普通测试（API）

| # | 文件 | 缺陷 | 根因 | 修复 |
|---|------|------|------|------|
| 1 | `journey-full.e2e.test.ts` | 历练段 `expect(drawn.preview).toBe(true)` + `accept` 恒失败 | 无情报直抽 `preview=false`，分支直接挂 `event.choices`；`accept` 仅情报 preview 可用（`service.ts:858` 无 preview 时 `accept` 甚至不合法） | 改直抽 + 遍历 `event.choices` 逐分支 `optionIndex` 结算；同步改 `AdventureView` 接口 |
| 2 | `journey-full.e2e.test.ts` | 招募循环 `8` 轮找 V≥7，理论全失败率约 1e-4 | 单抽 V<7 概率约 19%（common 占 55% 且 V 上限约 11） | 8→12 轮（全失败约 2e-9）；注资 20 万覆盖最坏招募费 |
| 3 | `pvp-coverage.test.ts` | `finishTournament` 循环 4 次后抛错 | `advancePvpTournament(id, PAST)`：`PAST(2020) < autoStartAt(2099)` 触发 scheduler early-return（`scheduler.ts:277`），永远停在 REGISTERING | 改传 `OPEN`（2099），`now ≥ autoStartAt` 才开赛 |
| 4 | `adventure-gaps.test.ts` | 「日志倒序」测试的确定性注释是错的 | `drawAdventure` 建行时**忽略注入的 `now`**（`createdAt` 取库默认，`service.ts:349`），同毫秒建行则 `createdAt desc` 排序歧义 | 建行后直写 `createdAt`（12:00:00/02），再断言 `[second, first]` |
| 5 | `items-gaps.test.ts` | `[a.status, b.status].sort()` 字典序隐患 | 值域恰为 200/409 时碰巧正确，但属误用 | 改数值比较器；另核验：败方确定性走缺货分支（胜方提交删行后败方预检读到行缺失 → `INSUFFICIENT_RESOURCE`，见 `items/service.ts:149-202` 锁序） |

### 浏览器 e2e（Playwright）

| # | 文件 | 缺陷 | 根因 | 修复 |
|---|------|------|------|------|
| 6 | `story.spec.ts` / `full-journey.spec.ts` | `waitForURL(/\/records\/\d+/)` 永不匹配而超时 | 战报 id 是 cuid 字符串，`StoryPage` 跳 `/records/${cuid}` | 3 处改 `/\/records\/[^/]+/` |
| 7 | `adventure.spec.ts` | 两用例都等 `adventure-accept` 而超时 | 同 #1：无情报无 preview | 重写三用例：无情报直抽结算 / 情报激活→回避（`已回避`）/ 情报激活→接受→结算 |
| 8 | `lecture.spec.ts` | 主流程 `test.skip(v<7)`，约 19% 运行跳过 | 随机单抽 V 不可控 | 重写三用例：扫池定向招 V≥15（直讲必成功）/ 招 V∈[7,15)（强接）/ 单抽 + `national` 档（V 上限约 43 恒低于强接下限 72，确定性拒单） |
| 9 | `problems.spec.ts` | 缺"每日上限"浏览器覆盖（API 侧已有） | — | 新增用例：单人每日 2 道（第 3 次 `本日出题次数已达上限`），换学员可继续且旧报错消失（新 mutation 发起即重置 `create.error`） |
| 10 | `full-journey.spec.ts` | 历练段同 #7 必失败；另三处隐患 | ① 药水 picker 默认选中首学员而非 best，best 体力可能归零致 draw 失败；② 讲课分支用招募时 V 快照，训练后已抬升（V=13 快照走强接分支但真 V≥15 时 `lecture-force` 不渲染 → `check()` 失败）；③ 奶茶断言绝对 `×3`，历练奖励可能发放奶茶 | ① picker 内点选 best；② 讲课前重读 `/api/students` 真 V；③ `×N→×(N-1)` 动态断言；历练改直抽 |

### CI

| # | 文件 | 缺陷 | 修复 |
|---|------|------|------|
| 11 | `.github/workflows/e2e.yml` | 10 个 `定位-*` 步骤 grep `journey.log`，但该文件从未生成（无 `tee`）→ 失败时 10 个定位全红、且 artifact 缺日志 | API 旅程步骤加 `2>&1 \| tee journey.log; test ${PIPESTATUS[0]} -eq 0` |

### 核验后判定「无需改」的项

- **#12（`pvp-coverage` 外的其他并发断言）**：`auth-coverage` 并发重复注册（唯一键 → 恰其一 `ALREADY_EXISTS`）、`academy-gaps` 并发首建池（`P2002` 兜底重读同一池）与源码锁语义一致，不改。
- **`items-gaps` 并发用例**除 #5 外成立（见上表根因链），不改断言。
- **数值锚点**逐一验算源码公式：`directed N=3 → 174`（150×1.16）、出题 `N=3 → 26`、`beginner+V20+rep0 → 72 金/1 誉`（60×1.2）、`rep1000 → ×3 → 216 金`、剧情「八章 33 关」——全对。
- **测试端点全量 sweep**：API 测试用到的 40+ 路径逐一对照 router 注册表（含 `/api/problems`、`POST /:id/registration`、`PATCH /pvp-tournaments/:id` 等冷门项），无 404 引用。

## 2. 覆盖面核对（功能 → 测试）

| 功能 | 普通测试 | 浏览器 e2e | 全旅程 |
|------|---------|-----------|--------|
| 注册/登录/登出/改密/注销/封禁 | `auth-basic/session/coverage` | `auth.spec`、`settings.spec` | ✓（改密→注销→登录失败） |
| 招募/刷新/候选 | `academy/academy-gaps` | `academy.spec` | ✓（选 V 最高×2） |
| 学员详情/改名/开除 | `students/students-gaps` | `students.spec` | ✓（改名） |
| 基础/定向/专项训练 | `training/training-gaps` | `training.spec` | ✓（基础+定向） |
| 背包/道具使用 | `items/items-gaps` | `items.spec` | ✓（药水+奶茶） |
| 讲课五档/强接/声誉 | `lecture/lecture-gaps` | `lecture.spec` | ✓（按真 V 三分支） |
| 出题/题库/上限 | `problem-library/problems-gaps` | `problems.spec` | ✓ |
| 历练抽卡/分支/情报/回避 | `adventure/adventure-gaps/duel/extractor` | `adventure.spec` | ✓ |
| 剧情/解锁/NG+/战报 | `story/story-coverage/rewards` | `story.spec` | ✓（首关→战报→返回） |
| PVP 报名/开赛/奖励/认领 | `pvp-registration/scheduler/coverage` | `pvp.spec` | ✓（8 人+冠军认领） |
| 管理端/公告/审计 | `admin/admin-coverage` | `admin.spec` | —（旅程用 admin API 建赛） |
| 配置导入/经济仿真/数值回归 | `config-*/economy-simulation/balance-regression/m2-golden` | — | — |
| 基础设施（限流/信封/鉴权头） | `rate-limit/infra-coverage/health` | `smoke.spec`（空态巡检+加载失败排他） | — |

冒烟 `smoke.spec` 另覆盖：新用户 11 路由空态标记 + 管理员开管理端；`auth.spec` 覆盖未登录守卫跳转。

## 3. 已知残余风险（接受项，需 CI 验证）

1. **RNG 概率型断言**（均为上界可控）：`lecture.spec` 强接窗招募（8 人 ≈99.97%）、`recruitAtLeast` 扫池（10 池 ≈100%）、`journey` 12 轮（≈2e-9）。CI 若偶发失败，优先看是否落在上述小概率尾部。
2. **历练分支结算循环**：依赖"钥匙篮（4 种 `requires_item` 全覆盖）+ 20 万资金（`cost_money ≤ 8000` 已全表核验）+ 精力"保证必有可解分支；`energy_cost` 全表仅 1 个 outcome（耗 1 点），单分支失败由换分支兜底。
3. **讲课强接 60% 成功率**：浏览器 `lecture.spec` 强接用例接受成功/讲砸任一结果，无重试需求。
4. **`mysql` CLI 依赖**：两 workflow + `global-setup.ts` 均直接调用 `mysql`（与 GitHub 官方 service-container 文档模式一致，ubuntu runner 预装）。若未来换镜像需补 `apt-get install mysql-client`。
5. **本地未跑项**：API `typecheck`（缺 Prisma 引擎）、全部 DB 测试、Playwright 实跑——均待 CI。
6. **串行假设**：`vitest fileParallelism: false` 与 Playwright `workers: 1` 是正确性前提（共享库 + 全局配置导入），勿改并行。

## 4. 自查方法记录（可复现）

- testid 交叉：spec 用到的精确 `data-testid` 全在 `apps/web/src` 命中；动态 `train-tab-*` / `adventure-choice-${index}` 逐一对过生成点；`choice.index` 为真实位置下标（`service.ts:167`）。
- 文案交叉：`已领取/已回避/训练完成/讲砸/暂无记录。/本日出题次数已达上限/管理端数据加载失败。/用户名已被占用` 等断言文案全在页面源码命中。
- 失效模式：`useChooseAdventure` / `useTeachLecture` / `useUseItem` / `useCreateProblem` 的 `invalidateQueries` 逐一确认（列表刷新断言的前提）；`resolveAdventureChoice` 的 detach+换分支逻辑与 `adventure-choose-error` 显示条件一致。
- 账本复算：API 旅程体力 5→4→3→2→1→0→3→1→0（draw tier1 恰好归零）；浏览器旅程 best 体力 5→4→3→2→1→4→2→1（含药水点名 best）；招募费/刷新费上界均在注资内。

## 5. 本地验证结果

- `pnpm -r lint`：3 包全过（含 `apps/api/tests/`）。
- `pnpm e2e:typecheck` + `web/shared typecheck`：全过。
- API 测试改动文件：esbuild 转译 `SYNTAX-OK`（`tsc` 全量因缺 Prisma 引擎本地不可跑，CI 覆盖）。
- `git status`：36 项变更（15 个新 API 测试文件、`tests/e2e/` 整树、`.github/` 双 workflow、web 侧 `data-testid` 补齐、根 `package.json` 的 `e2e*` 脚本）。
