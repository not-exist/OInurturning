# OInurturning M2 完成交接

更新时间：2026-09-04

## 工作区

- worktree：`/home/qzez/OInurturning`
- branch：`m2-contest-story`
- committed HEAD：`a016342 feat(m4): credit pvp carried problem reputation`
- M2、M3.1–M3.6、M4.1、M4.2、T4.3、T4.4 与 T4.5 已提交。
- 工作树干净；未执行 merge 或 push；仓库暂未配置远端。

## M2 状态

| Task | 状态 | 结果 |
|---|---|---|
| 1 共享契约 | 完成 | scoped review clean |
| 2 RNG/求解内核 | 完成 | draw ordering + direct NaN 回归已固定 |
| 3 排名模拟/战报 | 完成 | fix round 2，Critical/Important 0 |
| 4 对决模拟器 | 完成 | 四局、quality、四类 tiebreak、shared report schema |
| 5 配置/NPC | 完成 | 34 templates、33 stages、五文件 importer |
| 6 持久化 | 完成 | ContestRecord/StoryProgress migration + repository |
| 7 Story API | 完成 | overview/progress/entry/record、奖励、成长、NG+、幂等 |
| 8 Web UI | 完成 | `/story`、`/records/:recordId`、响应式布局 |
| 9 质量门 | 完成 | ROADMAP T2.1–T2.8 已关闭 |

## 最终证据

- `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`：通过。
- workspace tests：27 files / 244 tests。
- ranking golden：`ec43a98d`。
- duel golden：`909f2bf8`。
- `git diff --check`：通过。
- Prisma migration：`20260901121305_contest_records_story_progress` 已应用到本地 `oinur`。
- HTTP success smoke：rank 2；首通奖励 500 + item；同 key 重放同一 record；money 5000→5500、stamina 5→4、record/progress 各 1。
- HTTP failure smoke：rank 17；同 key 重放同一 record；只扣一次体力，无 progress/reward。
- dev server：`http://localhost:5173/story`，API `http://localhost:3000`。

## Review

- Final Critical：0。
- Final Important：0。
- Deferred Minor：Task 1 snapshot arrays 仍是 mutable type；`ContestReportView` 仍为 alias。二者不阻塞 M2。
- Docker 部署与浏览器视觉走查留到部署窗口；代码、HTTP 与 production build 均已验证。

## M3 状态

- `packages/shared/src/config/events.ts`：事件/选择/结果 schema。
- `apps/api/src/config/loader.ts`：六文件导入、ConfigEvent 调和、CONFIG.events。
- `apps/api/src/modules/adventure/extractor.ts`：纯函数抽取器。
- `apps/api/tests/adventure-extractor.test.ts`：40 条真实事件与抽取边界。
- M3.1 focused：3 个测试文件、32 个测试通过；shared/API typecheck、API lint 通过。
- `apps/api/src/modules/adventure/service.ts`：AdventureLog 状态机、资源/奖励事务、fixed/check 结算。
- `apps/api/src/modules/adventure/router.ts`：draw/choice/logs API。
- `apps/web/src/features/adventure/AdventurePage.tsx`：历练操作与记录页面。
- M3.2 focused 与全量质量门已通过；开发库迁移 `20260902100000_adventure_logs` 已应用。基础 fixed/check slice 可用。
- `apps/api/src/modules/contest/npc.ts`：事件对手快照生成。
- M3.3 基础 duel 接入与 ContestRecord 关联、R4 bank_add、P5 同日连胜奖金已完成；全量质量门 32 个测试文件、268 个测试通过。
- 复合检定、讲课 outcome、招募 outcome 仍待后续系统；M3 主要验收项已关闭。
- T3.4 高级学院招募池沿用 M1 已完成实现；T3.5 讲课 API、页面、LectureLog 和结算已完成，focused 6/6、全量 261/261 通过。
- T3.6 出题 API、页面、ProblemLibraryEntry traitId 和质量评级已完成，focused 4/4、全量 268/268 通过；开发库迁移 `20260902170000_problem_traits` 已应用。
- T4.1 管理端 API、页面、PvpTournament/AdminAnnouncement/AdminAuditLog 和 `requireAdmin` 已完成，focused 3/3、全量 271/271 通过；开发库迁移 `20260902190000_admin_tools` 已应用。
- T4.2 PVP 报名 API、页面、PvpRegistration 与快照锁定已完成，focused 4/4；entry-ticket、容量、唯一报名、质量/归属、截止时间、题目顺序和 HTTP 路由均已覆盖；开发库迁移 `20260902210000_pvp_registrations` 已应用。
- T4.3 PVP 调度器、确定性 bracket/bye、8/16 人自动推进、取消退款、快照重放、参赛双方战报权限、管理员审计和 Web bracket 已完成；focused 12/12、全量 283/283、workspace typecheck/lint/build 通过；migration `20260903000000_pvp_matches` 已应用。
- T4.4 PVP 调度器已读取赛事 `rules.qualityScoring`（兼容顶层 camelCase/snake_case），透传到每场 duel；PVP tiebreak 固定 `SUDDEN_DEATH`。新增质量规则集成测试；focused scheduler+duel 20/20、全量 35 files/284 tests、workspace typecheck/lint/build 与 `git diff --check` 通过。
- T4.5 PVP 调度器已对携带预制题的对手未解题结果发放声誉；`PVP_PROBLEM` 审计键实现同题同场幂等和单题单届 12 点上限。新增未解题收益/重放与上限测试；focused scheduler+duel 21/21、全量 35 files/286 tests、workspace typecheck/lint/build 与 Prisma 校验通过。
- T4.6 PVP 奖励台账、冠军独占 `tag-card`、管理员奖池 PATCH、公开奖励查询与本人幂等领取已完成；默认奖励桶和首轮胜者返票已覆盖；全量 35 files/289 tests、workspace typecheck/lint/build 与 Prisma 校验通过；开发库迁移 `20260904120000_pvp_reward_grants` 已应用。

## 下一步

1. M4 完成后安排最终 Docker/浏览器手动验收和 M5。
