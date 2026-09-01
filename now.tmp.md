# OInurturning M2 完成交接

更新时间：2026-09-02

## 工作区

- worktree：`/home/qzez/OInurturning/.claude/worktrees/m2-contest-story-work`
- branch：`worktree-m2-contest-story-work`
- committed HEAD：`5c1e0f8 feat(m2): complete contest story mode`
- M2 Task 3 follow-up 与 Task 4–9 已提交。
- M3.1 事件配置导入与抽取器当前为未提交工作区变更。
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

## M3.1 状态

- `packages/shared/src/config/events.ts`：事件/选择/结果 schema。
- `apps/api/src/config/loader.ts`：六文件导入、ConfigEvent 调和、CONFIG.events。
- `apps/api/src/modules/adventure/extractor.ts`：纯函数抽取器。
- `apps/api/tests/adventure-extractor.test.ts`：40 条真实事件与抽取边界。
- focused：3 个测试文件、32 个测试通过；shared/API typecheck、API lint 通过。
- T3.2 尚未开始：事件结算、情报预览、冷却历史持久化和 AdventureLog 待实现。

## 下一步

1. 完成 M3.1 全量质量门并提交独立 commit。
2. 设计 T3.2 的 AdventureLog/事件历史持久化和事务边界。
3. 决定是否将 `worktree-m2-contest-story-work` 合并回 `m2-contest-story`。
