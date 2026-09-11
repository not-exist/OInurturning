# T5.3 前端打磨 — 交接报告

> 日期：2026-09-09 ｜ 分支：arena/01a08546-oinurturning
> 权威口径：`docs/ROADMAP.md` M5 T5.3（人工走查清单；浏览器视觉走查留最终部署窗口）

## 交付物

| 文件 | 说明 |
|---|---|
| `apps/web/src/components/ui.tsx` | 新共用组件：`Empty`（空态卡 + 引导 CTA）、`InlineLoader`（spinner 加载条）、`ActionLink` |
| `apps/web/src/lib/api.ts` | 新增 `apiErrorMessage(e)`（ApiCallError 错误码 → 中文人话，11 码全覆盖，未知码回退 code、非 API 错误回退网络文案）；`apiErrorDetails`（字段校验 details 拼接，备用） |
| 11 个 feature 页面 | 加载/失败（带重试）/空态/操作失败提示统一化 |
| `apps/web/src/features/records/RecordReportPage.tsx` | 战报分享 + 记录类型感知的返回按钮 + 结算奖励文案化 |

## 改动明细（按页面）

- **训练中心 TrainingPage**：学员加载 spinner、失败 apiErrorMessage+重试；无学员 Empty→去招募；操作失败红底提示（原只有裸错误码）。
- **背包 InventoryPage**：加载条、失败重试、空背包 Empty；用道具弹窗错误人话化+红底。
- **学员 StudentsPage / StudentDetail**：spinner、失败重试+返回链接、无学员 Empty→去招募；改名/开除失败经 apiErrorMessage 前缀说明。
- **高级学院 AcademyPage**：刷新失败重试、候选池空 Empty、msg 红底化；招募失败金币不足/人话化。
- **讲课 AcademyLecturePage**：spinner、数据失败重试、无学员 Empty；体力不足与门槛提示细化。
- **出题题库 ProblemLibraryPage**：spinner、重试、无学员/空题库 Empty；失败分类提示（满库/次数/资源）。
- **历练 AdventurePage**：spinner、重试、无学员 Empty（移除原重复 amber 文案）。
- **剧情 StoryPage**：spinner、重试、无学员 Empty→去招募；进关失败人话化。
- **PVP PvpPage**：修复「无赛事时 detail/bracket/rewards 禁用查询被误判 loading → 永久 spinner」bug（按 selectedTournamentId 门控）；失败重试；空赛事 Empty。
- **战报 /records/:id**：分享按钮生成纯文本摘要（标题/赛事·时间/我方名次·总分或对决比分·逐局/AC 等统计/奖励/Engine·RNG·Seed·Snapshot/完整链接）；`navigator.share` 优先、剪贴板兜底并提示「已复制」；返回按钮按 `record.type`（STORY/ADVENTURE/PVP）路由；奖励行文案化为 首通奖金/里程碑/名次奖金。

## 人工走查清单（部署窗口内执行）

- [ ] 空账号：学员列表/训练/讲课/出题/历练/剧情/PVP 七个入口分别打开，确认 Empty 引导与无死按钮
- [ ] 断网/500 态：各页失败文案 + 重试按钮可用
- [ ] 训练扣体力成功提示、改名卡耗尽按钮禁用态
- [ ] 360px 与 768px 两档宽度走查（表格横向滚动、导航横向滚动）
- [ ] 分享战报：PC 复制文案、移动端系统分享面板；STORY/ADVENTURE/PVP 三类记录返回目标正确
- [ ] Docker 冒烟全链路

## 质量门（沙箱内已过）

- `apps/web tsc -b` ✅
- `eslint apps/web/src` ✅（0 error）
- `vite build` ✅（106 modules）
- 注：改动文件按仓库 `.prettierrc` 统一格式（该批文件 HEAD 未过 prettier，含纯格式噪音）；`git diff --check` ✅

## 遗留

- 前端暂缓 E2E（M5 仅冒烟）——按 ROADMAP 横切约定，浏览器人工走查属部署窗口验收项。
- Admin 端 / Auth / 设置页状态已可接受，未做大改；如走查发现问题再收口。
