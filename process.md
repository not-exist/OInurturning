# OInurturning 开发过程记录

> 生成时间：2026-09-08
> 本文件由历史 session 压缩整理，替代原 `session-ses_fa34.md`、`session-ses_fafa.md`、`codex-session-*.md`。

---

## 项目概述

**OInurturning** 是一款 AI 编程教练模拟经营游戏。玩家扮演教练，招募学员、训练参赛、经营学院。

- **技术栈**：pnpm monorepo（apps/api + apps/web + packages/shared）
- **后端**：Node.js + TypeScript + Prisma + MySQL（MariaDB）
- **前端**：Vite + React + Tailwind
- **测试**：vitest（单元 + 集成）

---

## 里程碑总览

| 阶段 | 内容 | 状态 | 测试规模 |
|------|------|------|----------|
| **M0** | monorepo 骨架、账号系统、部署链路 | ✅ 完成 | 20 tests |
| **M1** | 学员管理、背包、训练、恢复时钟 | ✅ 完成 | — |
| **M2** | 模拟内核（排名制+出题对决）、剧情模式 | ✅ 完成 | 244 tests / 27 files |
| **M3** | 历练 40 事件、高级学院、出题题库 | ✅ 完成 | 268 tests / 32 files |
| **M4** | PVP 淘汰赛、管理员工具、己方题库入赛 | ✅ 完成 | 289 tests / 35 files |
| **M5** | 经济校准、打磨、上线 | 🔄 进行中 | 321 tests / 36 files |

---

## 各阶段完成详情

### M0 骨架与账号（2026-08-30）

- pnpm workspace 初始化、Prisma 接入 MySQL
- Auth API：注册/登录/改密/注销（bcrypt+JWT）
- 前端骨架：登录/注册页、主布局
- Docker 编排文件（mysql+api+nginx）
- 实测：全链路 20 项集成测试通过

### M1 学员·背包·训练（2026-08-31）

- 配置即数据管线（zod schema → Config 表）
- Student 懒结算时钟（stamina/energy/mindset 按读时恢复）
- 招募池（四档品质权重、刷新机制）
- 训练系统（基础/定向/专项，递减收益公式）
- 种子数据脚本（`pnpm seed` 一键搭建演示环境）

### M2 模拟内核与剧情（2026-09-01）

- **共享求解内核**：RNG 可复现种子、三缺口 sigmoid、精力消耗、专注积累
- **排名制模拟器**：多题串接、特性扰动、NPC 实力模型
- **出题对决模拟器**：4 局轮流坐庄、quality rule、tiebreak 枚举
- **Story API**：章节/关卡、开赛、战报、首通奖励、NG+
- Golden hash 固定：ranking `ec43a98d`、duel `909f2bf8`

### M3 历练·学院·题库（2026-09-02）

- **T3.1** events 导入 + 三层体力档抽取器
- **T3.2** 历练 API：投体力→事件卡→选项分支→结果结算
- **T3.3** 历练对决接入 M2 内核（G2/R1/R4/L1/L7/P1/P5/C1/C2）
- **T3.4** 高级学院招募池（沿用 M1）
- **T3.5** 讲课：五档受众、报酬计算、强接惩罚、次数限制
- **T3.6** 出题：质量评级、ProblemLibraryEntry、题库管理页

### M4 PVP 与管理端（2026-09-03 ~ 09-04）

- **T4.1** 管理员工具：创建锦标赛、公告、用户查询、审计日志
- **T4.2** 报名：entry-ticket 校验、出战名单+预制题快照锁定
- **T4.3** 锦标赛调度器：对阵树、批量模拟、轮次推进
- **T4.4** 加赛 sudden_death 与平局分流
- **T4.5** 己方题库入赛：声誉收益与每场计次上限
- **T4.6** 奖励发放：tag-card 冠军独占 + 管理员配置奖池

### M5 经济校准与上线（2026-09-06 ~ 进行中）

- **T5.1** ✅ 收支模拟脚本完成
  - 新手周：1120/1469/-349（0.76）
  - 中期周：3990/3804/186（1.05）← gate PASS
  - 后期周：66775/9299/57476（7.18）
- **T5.2** ⬜ 数值平衡回归（下一步）
- **T5.3** ⬜ 打磨：空态/加载/错误提示、移动端、战报分享
- **T5.4** ⬜ 上线检查单：备份、日志、限流、JWT、管理员初始化

---

## 当前状态（2026-09-08）

### 仓库状态

- **当前分支**：`main`（已合并 m2-contest-story 的 48 commits）
- **剩余分支**：`main`、`m0-skeleton`、`m1-students`
- **Worktree**：已全部清理
- **测试**：36 files / 321 tests
- **质量门**：typecheck ✅ / lint ✅ / build ✅ / `git diff --check` ✅

### 待办优先级

1. **T5.2** — 数值平衡回归（训练到 IOI 总时长估算、进阶石产量 vs 彩天赋需求）
2. **T5.3** — UI 打磨（空态/加载/错误提示、移动端适配、战报分享）
3. **T5.4** — 上线检查单（备份 cron、日志滚动、限流参数、JWT_SECRET、管理员初始化）
4. **部署验收** — Docker/浏览器手动验收（延后到最终部署窗口）

---

## 关键文件索引

| 类别 | 路径 |
|------|------|
| 路线图 | `docs/ROADMAP.md` |
| 技术设计 | `docs/TECH-DESIGN.md` |
| 游戏设计 | `docs/GAME-DESIGN.md` |
| 玩法系统 | `docs/systems/gameplay.md` |
| 数值配置 | `docs/data/economy.yaml`、`events.yaml` |
| 模拟脚本 | `apps/api/src/scripts/sim-economy.ts` |
| Prisma Schema | `apps/api/prisma/schema.prisma` |
| M5 交接 | `now.tmp.md` |
