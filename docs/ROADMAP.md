# OInurturning 开发路线图

> 版本：v0.1（2026-08-26）
> 依据 `docs/GAME-DESIGN.md` §18 展开。每个里程碑以「可验证产出」收口；任务编号 T<阶段>.<序>。
> 技术实现细节见 `docs/TECH-DESIGN.md`；数值一律引用 `docs/data/*.yaml`。

## 总览

| 阶段 | 内容 | 关键依赖 | 可验证产出 |
|---|---|---|---|
| M0 | monorepo 骨架、账号系统、部署链路 | 无 | 注册→登录→改密→注销全链路在容器环境跑通 |
| M1 | 学员管理、背包、训练、恢复时钟 | M0；配置管线 | 招募→训练→用书→体力随时间恢复闭环 |
| M2 | 模拟内核（排名制+出题对决）、剧情模式 | M1；problems/stages.yaml | 8 章 33 关可通关，战报与奖励正确 |
| M3 | 历练 40 事件、高级学院、出题题库 | M2（对决内核） | 历练抽事件可玩，招募/讲课变现成立 |
| M4 | PVP 淘汰赛、管理员工具、己方题库入赛 | M2 对决内核、M3 | 一场端到端 AI 锦标赛自动跑完并发奖 |
| M5 | 经济校准、打磨、上线 | M1–M4 | 收支模拟报告达标；上线检查单全绿 |

---

## M0 骨架与账号

| 任务 | 内容 | 验收标准 |
|---|---|---|
| [x] T0.1 | pnpm workspace 初始化：apps/web、apps/api、packages/shared；TS/ESLint/Prettier 统一配置 | `pnpm i && pnpm -r build` 通过 |
| [x] T0.2 | packages/shared 建立，迁移 GAME-DESIGN 核心类型（Student/ContestReport 等 stub） | api 与 web 均能 import |
| [x] T0.3 | Prisma 接入 MySQL，User 表迁移（id/username/passwordHash/role/createdAt/lastLoginAt/reputation/money） | migrate 成功，可 CRUD |
| [x] T0.4 | Auth API：注册、登录（bcrypt+JWT）、改密、注销（软删）、GET /me（含 lastLoginAt 维护） | supertest 集成测试通过 |
| [x] T0.5 | 前端骨架：Vite+React+Router+Tailwind；登录/注册页；主布局壳（左侧标签导航） | 浏览器走通登录 |
| [x] T0.6 | 用户设置页：ID/注册时间/last login 展示、改密、注销确认流 | 手动验收 |
| [x] T0.7 | deploy/docker-compose.yml：mysql(healthcheck)+api+nginx(静态+/api 反代)；环境变量表落地 | `docker compose up` 一键起全栈 |

> **M0 实测记录（2026-08-30）**：`pnpm install && pnpm typecheck && pnpm lint && pnpm test` 全绿；
> 注册→登录→改密→注销全链路 20 项集成测试通过。实测环境为**本地 MariaDB（127.0.0.1:3306）+ 进程直跑（vitest/tsx）**，
> 非 docker 容器环境；docker 编排文件已落地（T0.7），容器内一键起栈留待部署窗口验收。
> 收尾审查另修复三项：/refresh 畸形 Cookie 归一 401、登录计时侧信道均衡、限流 429 统一信封（详见 git log `fix(api)`）。

## M1 学员·背包·训练

| 任务 | 内容 | 验收标准 |
|---|---|---|
| [x] T1.1 | 配置即数据管线：zod schema → 校验 → 事务导入 Config 表（先导 talents/items/economy）；失败快速失败 | 坏 YAML 启动报错并定位行 |
| [x] T1.2 | Student 表 + 懒结算时钟（stamina/energy/mindset 回复按读时结算），并发防护（条件 UPDATE） | 并发压测无负数/超上限 |
| [x] T1.3 | 招募池：四档品质权重、属性期望生成、刷新机制（免费间隔+付费） | 分布统计脚本符合设计期望±容差 |
| [x] T1.4 | 学员管理 API+页面：列表、详情（九维面板/天赋区/心态等）、改名卡消耗、开除（声誉扣减+概率回收改名卡） | 全操作落库正确 |
| [x] T1.5 | 背包：UserItem、道具列表页、使用道具（书籍六维提升/定心丸/vigor-drink 等） | 使用后属性与库存一致 |
| [x] T1.6 | 训练：基础/定向/专项三接口+页面，费用随学员数曲线，递减收益公式，稀有成长 roll | 数值与 economy.yaml/talents 口径一致 |
| [x] T1.7 | 种子数据脚本（测试账号、样例学员、道具） | 一键搭建演示环境 |

> **M1 实测记录（2026-08-31，进程直跑）**：`pnpm install && pnpm typecheck && pnpm lint && pnpm test` 全绿；T1.1–T1.7 全部落地。
> `pnpm -C apps/api seed` 一键搭建演示环境：coach/demo1234（钱 5000、声誉 100）、3 名样例学员（普通/良好/精英）、
> 背包样例道具（改名卡×2、定心丸×3、体力药水×2、浓咖啡×2、奶茶×2、精力药剂×1、六维书若干）、2 道样例预制题、免费招募池已生成；重复运行幂等跳过。
> 冒烟（curl 走 HTTP）：登录 coach → GET /api/academy/pool（5 候选/refreshPrice 100）→ GET /api/students（3 人）
> → GET /api/items（12 种）→ GET /api/problems（2 道未消耗）→ POST /api/training/basic（δ≈0.97、cost 70、体力 5→4、千雪 DP 累计），
> 响应要点如上。实测环境为**本地 MariaDB（127.0.0.1:3306）+ 进程直跑（tsx/tsc/vitest）**，非 docker 容器环境；
> docker 编排文件已落地（T0.7），容器内一键起栈留待部署窗口验收。

## M2 模拟内核与剧情模式

| 任务 | 内容 | 验收标准 |
|---|---|---|
| [x] T2.1 | **共享求解内核**（纯函数）：RNG（可复现种子）、三缺口耗时 sigmoid、代码差→精力消耗、专注积累与提速曲线、WA/TLE/弃题判定 | 单元测试覆盖边界（0差/满差/0精力/满专注） |
| [x] T2.2 | 排名制模拟器（多题串接、特性扰动、NPC 实力模型）+ ContestReport 结构 | 同 seed 结果逐字节一致（确定性） |
| [x] T2.3 | **出题对决模拟器**：4 局轮流坐庄、计分、【考察出题质量】+2、tiebreak 枚举（sudden_death/by_energy/by_quality/friendly）、预制题替换 | 单测覆盖平局各分支 |
| [x] T2.4 | problems/stages 配置导入 + NPC 选手池生成器 | 33 关配置全部通过校验 |
| [x] T2.5 | Story API：章节/关卡列表、开赛（体力扣减+快照）、战报存取、首通判定与奖励发放（钱/道具/里程碑）、进度表 | 首通奖励与 stages.yaml 数字一致（自动化断言） |
| [x] T2.6 | 战报渲染组件：逐题时间线、判定色标、得分名次、奖励摘要 | 移动端可读 |
| [x] T2.7 | NG+：层级开启、需求乘数、奖励乘算（石头除外）、独立首通状态；重复通关名次奖金 | NG+k=1..3 断言通过 |
| [x] T2.8 | 一周目全通检测 → 传奇教练勋章 + 解锁 NG+ | 集成测试 |

> **M2 实测记录（2026-09-01，本地 MariaDB + 进程直跑）**：`pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全绿；API 共 27 个测试文件、244 个测试通过。consolidated golden 固定 ranking hash `ec43a98d`、duel hash `909f2bf8`，真实配置 34 个题目模板/33 个关卡通过导入，8 个章末正赛进度可连续解锁 NG+1/NG+2。
> HTTP smoke：`coach` 登录 → `GET /api/story/overview` → 精英学员进入 `cspj:1`（rank 2）→ `GET /api/records/:id` → 同 `Idempotency-Key` 重放；两次返回同一 record，数据库实测 money `5000→5500`、stamina `5→4`、ContestRecord 1 条、StoryProgress 1 条，首通奖励未重复。另测失败场 rank 17：只扣一次体力并保留一条 record，不写 progress/reward。Web `/story` 已由 Vite dev server 提供，production build 通过；Docker 与浏览器视觉走查留待部署窗口。

> **M3.1 实测记录（2026-09-02，本地 MariaDB + 进程直跑）**：shared 事件 schema、六文件配置导入、ConfigEvent 调和/软弃用/深冻结与纯函数抽取器已落地；真实 `events.yaml` 40 条事件全部通过校验。抽取器按投入体力档先抽稀有度再抽组内事件，空组重归一化，并覆盖声誉/属性门槛、单事件冷却、`once_per_student`、`server_weekly_limit`、可用体力与确定性排序；focused 回归 3 个测试文件、32 个测试通过。

> **M3.2 实测记录（2026-09-02，本地 MariaDB + 进程直跑）**：AdventureLog/AdventureWeeklyUsage 持久化、账号级 `intel-slip` 激活、PENDING/RESOLVED 状态机、事件抽取与固定/单属性检定结算已落地。`POST /api/adventures/draw`、`POST /api/adventures/:id/choice`、`GET /api/adventures/logs` 已接入；情报支持 accept/avoid，avoid 不扣体力且事件回池。奖励、道具消耗、声誉审计、学员能力/心态/精力与 `next_training` buff 在同一事务内结算；全量回归 29 个测试文件、254 个测试通过，开发库迁移 `20260902100000_adventure_logs` 已应用；Y7/R5 及 L7 的固定/check/duel 分支由 T3.2/T3.3 共同覆盖。

> **M3.3 实测记录（2026-09-02，本地 MariaDB + 进程直跑）**：事件 duel outcome 已接入 M2 `simulateDuel`，生成确定性 HOME/AWAY 快照、事件对手、四局题目、quality rule 与 tiebreak；玩家答题侧的精力和心态变化写回学员，完整 DuelReport 通过 ContestRecord 保存，并由 AdventureLog `contestRecordId` 关联。G2 真实友谊切磋、R4 `bank_add`、P5 服务器日连胜奖金、L3 题库奖励已集成测试；复合检定、讲课、招募仍由后续 slice 接续。全量回归 32 个测试文件、268 个测试通过。

> **M3.5 实测记录（2026-09-02，本地 MariaDB + 进程直跑）**：讲课配置完整 schema、五档受众查询、LectureLog、即时钱/声誉结算、声誉乘区、能力溢出、强接风险和 04:00 日界每日额度已落地。`GET /api/academy/lecture-tiers`、`POST /api/academy/lectures`、`GET /api/academy/lectures` 与 `/academy/lecture` 页面已接入；exact threshold、差 1 门槛、强接窗口、声誉/溢出计算、全营 3 场/学员 2 场边界测试通过。全量质量门 31 个测试文件、261 个测试通过，开发库迁移 `20260902150000_lecture_logs` 已应用。

> **M3.6 实测记录（2026-09-02，本地 MariaDB + 进程直跑）**：出题行动、Q 质量评级、六维目标选择、setting/thinking 加权、特性概率与按严重度 seed 抽取、题库 120 容量、每学员每日 2 次、成本/体力扣减、题库列表和可用题删除已落地。`POST/GET/DELETE /api/problem-library` 与 `/problem-library` 页面已接入；题目保留 authorStudentId/traitId，专项训练继续消费同一 ProblemLibraryEntry。M3 收口后全量质量门 32 个测试文件、268 个测试通过，开发库 migration `20260902170000_problem_traits` 已应用。

> **M4.1 实测记录（2026-09-03，本地 MariaDB + 进程直跑）**：管理员中间件、PVP 赛事创建、公告发布、用户查询和审计日志已落地。`/api/admin/*` 全部由数据库确认的 ADMIN role 保护；赛事规模/报名时间窗校验，管理员名称快照和脱敏用户视图已覆盖测试；`/admin` 管理页面已接入。全量质量门 33 个测试文件、271 个测试通过，开发库 migration `20260902190000_admin_tools` 已应用。

> **M4.2 实测记录（2026-09-03，本地 MariaDB + 进程直跑）**：PVP 赛事列表、报名和报名详情已接入；报名事务按 User → Tournament → Student 顺序加锁，原子扣除 `entry-ticket`，单账号单届唯一报名，限制赛事容量，保存出战学员与最多 2 道质量 ≥40 预制题的快照。截止时间后拒绝新报名，重复请求返回原报名且不重复扣票；HTTP 与 owner scope 已覆盖。全量质量门待本次提交前最后执行，开发库 migration `20260902210000_pvp_registrations` 已应用。

> **M4.2 实测补充（2026-09-03）**：题目快照按报名请求顺序保存，赛事满员也在事务内拒绝；最终全量质量门为 34 个测试文件、275 个测试通过，workspace typecheck/lint/build 与 Prisma migration status 全部通过。

> **M4.2 页面补充（2026-09-03）**：`/pvp` 页面已接入赛事选择、报名券余额、出战学员、最多两道达标预制题选择及锁定快照展示；报名后不暴露修改入口。

## M3 历练·学院·题库

| 任务 | 内容 | 验收标准 |
|---|---|---|
| [x] T3.1 | events 导入 + 抽取器：三层体力档权重、once 移除、冷却、情报道具预览 | 权重分布统计符合 events.yaml |
| [x] T3.2 | 历练 API+页面：投体力→事件卡→选项分支→结果结算（含 buff 存储 next_training 等） | 多段选项事件（Y7/L7/R5）全分支可走 |
| [x] T3.3 | 历练对决事件接入 T2.3 内核（G2/R1/R4/L1/L7/P1/P5/C1/C2 相关路径） | DuelReport 正确入 AdventureLog |
| [x] T3.4 | 高级学院：招募池 API/页面（含付费刷新）、招募费曲线、声誉加成 | 与 gameplay.md 参数一致 |
| [x] T3.5 | 讲课：五档受众门槛校验、报酬计算（声誉曲线+溢出加成）、强接惩罚、次数限制 | 边界（恰好达标/差1点）行为正确 |
| [x] T3.6 | 出题玩法：出题行动、质量评级公式、ProblemLibraryEntry 入库、预制题管理页 | 评级与 contest.md 公式一致 |

## M4 PVP 与管理端

| 任务 | 内容 | 验收标准 |
|---|---|---|
| [x] T4.1 | 管理员工具：创建锦标赛（规模/时间窗/奖池）、公告、用户查询、审计日志页；admin 角色中间件 | 非 admin 全部 403 |
| [x] T4.2 | 报名：entry-ticket 校验、出战名单+预制题携带锁定（快照不可再改） | 截止后修改无效 |
| T4.3 | 锦标赛调度器：对阵树生成、批量排队模拟、轮次推进、结果公示页 | 16 人赛全自动跑完 |
| T4.4 | 加赛（sudden_death）与平局分流落地 | 单测覆盖 |
| T4.5 | 己方题库入赛：提交 N 题入赛场题池、对手未解出的声誉收益与每场计次上限 | 防刷规则生效 |
| T4.6 | 奖励发放：tag-card 冠军独占+管理员配置奖池；公示领奖 | 发放幂等（重跑不重复发） |

## M5 校准与上线

| 任务 | 内容 | 验收标准 |
|---|---|---|
| T5.1 | 收支模拟脚本：模拟「新手周/中期周/后期周」三类玩家行为画像，输出收入/支出报表 | 中期周收支比落在 [0.9, 1.15] |
| T5.2 | 数值平衡回归：训练耗时到 IOI 的总时长估算、进阶石全服产量 vs 彩天赋需求 | 达成 GAME-DESIGN §7.3 稀缺目标 |
| T5.3 | 打磨：空态/加载/错误提示全覆盖、移动端适配复查、战报分享文案 | 人工走查清单 |
| T5.4 | 上线检查单：备份 cron（mysqldump）、日志滚动、限流参数、JWT_SECRET 强随机、管理员账号初始化 | 检查单全绿 |

## 横切约定

- **测试优先级**：模拟内核纯函数单测 > API 集成测（supertest）> 前端暂缓 E2E（M5 仅冒烟）。
- **数值改动纪律**：任何平衡调整只改 `docs/data/*.yaml`，代码不得硬编码数值；PR 必须附受影响的收支模拟结果。
- **里程碑评审**：每阶段结束对照本文档验收标准逐条打勾，未过项不进入下一阶段。
