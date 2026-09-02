# OInurturning M2 完成交接

更新时间：2026-09-02

## 工作区

- worktree：`/home/qzez/OInurturning/.claude/worktrees/m2-contest-story-work`
- branch：`worktree-m2-contest-story-work`
- committed HEAD：`79d8ede feat(m3): add adventure event extraction`
- M2 与 M3.1 已提交。
- M3.2 历练 API、页面、状态机与固定/check 结算当前为未提交工作区变更。
- 未执行 merge 或 push；仓库暂未配置远端。

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
- M3.3 基础 duel 接入与 ContestRecord 关联已完成；全量质量门 30 个测试文件、255 个测试通过。
- R4/P5 的题库入库与连胜奖金、复合检定、讲课、招募仍待 T3.4–T3.6。

## 下一步

1. 审阅并提交 M3.3 基础 duel 接入独立 commit。
2. 开始 T3.4：高级学院候选池和讲课规则拆分实现。
3. 决定是否将 `worktree-m2-contest-story-work` 合并回 `m2-contest-story`。
