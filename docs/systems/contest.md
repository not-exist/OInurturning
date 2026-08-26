# 比赛模拟引擎细则

> 版本：v1.0（2026-08-26）
> 依据：`docs/GAME-DESIGN.md` §8（中心机制）、§13（剧情模式）、§14（PVP）、§6（学员属性）。
> 本文为唯一实现依据；数值配置见 `docs/data/problems.yaml`、`docs/data/stages.yaml`。
> 所有标识符英文、说明中文。所有属性取值范围除特别注明外为 1–100。

---

## 0. 术语与全局约定

### 0.1 属性键（与总纲一致）

| 组 | 键 |
|---|---|
| 六维 | `ds` / `dp` / `math` / `graph` / `greedy` / `string` |
| 能力 | `code`（代码能力）/ `thinking`（思维能力）/ `setting`（出题能力） |
| 状态 | `mindset`（心态，动态值，范围 **[-10, +10]**，机制权威 student.md §5）/ `focus_cap` / `energy_max` / `stamina_regen` |
| 资源 | `money` / `reputation` / `stamina` / `energy` / `focus` |

### 0.2 数学工具

```
σ(x)        = 1 / (1 + e^(−x))
clamp(v, lo, hi)
centered(A, B, gap) = 1 + A · ( σ(B·gap) − 0.5 )      // 居中 sigmoid 乘数：gap=0 时恒等于 1
fade(cur)   = (1 − cur/100)^2                          // 收益递减因子
```

### 0.3 取整与展示

- 引擎内部全程浮点运算；**战报展示时分钟数向上取整**，分数、心态、精力为整数。
- 概率一律 clamp 到 `[0.02, 0.98]` 后再掷点（除非另行注明）。

### 0.4 随机数策略（服务端 RNG，可复现种子）

- **只在服务端生成随机数**，客户端只读展示。
- PRNG：**mulberry32**（32-bit 状态，实现 5 行，分布质量足够游戏用途），算法版本号 `mulberry32-v1` 写入战报；未来换算法必须升版本号并保留旧版回放能力。
- 种子派生：

```
baseSeed = fnv1a32(`${userId}:${studentId}:${contestKey}:${serverNonce}`)
contestKey = story:cspj:4:ng0 | duel:{duelId} | pvp:{tournamentId}:{round}:{matchId}
serverNonce = contest_records 表自增序号（防同参数重放得到相同结果）
子流 = mulberry32(fnv1a32(`${hex(baseSeed)}:${label}`))   // label 见下
```

- 子流标签（互不串扰，便于审计定位）：`order`（选题顺序 tiebreak）、`noise`（用时噪声）、`judge`（判定）、`misc`（特性/杂项）、`npc:i`（第 i 个 NPC 的全部随机）。
- **审计回放**：战报存有 `seed`、`rngVersion` 与输入快照（题面实例、学员快照、NPC 参数），服务端可用同一函数序列逐位复现整场比赛。任何引擎改动若影响已存战报的可回放性，必须新增 `engineVersion` 并保留旧实现。

---

## 3. 排名制模拟赛（剧情模式，GAME-DESIGN §8.1）

### 3.1 时间推进模型：决策记录

**选择：解析式直接计算（事件驱动、逐题结算），不做分钟 tick。**

理由：
1. 总纲 §8.1 明示「即时结算，逐题模拟」，解析式与之天然对应；
2. 分钟 tick 需要 数百次/场 的 RNG 决策与状态分支，平衡调参困难、战报冗长不可读；
3. 解析式把随机性集中在少数关键掷点（噪声、判定、特性），种子回放短小可审计；
4. 计算量 O(题数 × 提交次数 × 选手数)，40 人 NPC 池 ×4 题毫秒级完成。

时间仍是硬约束资源：比赛有总时长 `duration_min`（仿真赛程时长，结算瞬时完成，不代表现实等待），选手在时长内按顺序攻题。

### 3.2 输入数据结构

```ts
interface StudentSnapshot {          // 参赛学员快照（结算前冻结）
  studentId: string;
  ds: number; dp: number; math: number; graph: number; greedy: number; string: number;
  code: number; thinking: number;
  mindset: number;                    // [-10,+10]
  focusCap: number;                   // 专注上限
  energy: number;                     // 入赛精力（≤ energy_max）
  traits: TraitInstance[];            // 天赋不在本引擎内生效，仅存档用
}

interface ProblemInstance {          // 由 problems.yaml 模板实例化（含 NG+ 变换、特性掷点结果）
  instanceId: string;                 // `${template.id}@${stageRef}#${n}`
  templateId: string;
  tier: Tier;                         // cspj|csps|noip|province|noi|ctt|cts|ioi
  dim: 'ds'|'dp'|'math'|'graph'|'greedy'|'string';
  reqD: number;                       // 六维需求 D（NG+ 后值）
  reqM: number;                       // 思维量 M
  reqC: number;                       // 代码量 C
  score: number;
  timeLimitMin: number;               // 单题参考用时基准（人类解题耗时，非 OJ 运行时限）
  partialScores: boolean;
  traits: ProblemTraitInstance[];     // 已附着的特性（id + 快照 hooks）
}

interface RankedContestInput {
  kind: 'story';
  stageRef: { chapter: ChapterId; stageIndex: number; ngPlusLayer: number };
  student: StudentSnapshot;
  problems: ProblemInstance[];
  durationMin: number;
  npcPoolParam: { size: number; meanLevel: number; spread: number };
  firstClearAvailable: boolean;
}
```

### 3.3 三缺口耗时模型

对每道题、每名选手计算三个缺口：

```
gapDim   = reqD − student[dim]
gapThink = reqM − student.thinking
gapCode  = reqC − student.code           // 正值 = 学员不足；负值 = 学员溢出
```

三个居中 sigmoid 乘数（常数见表）：

```
Kdim   = centered(1.6, 0.22, gapDim)     // 主导六维缺口：主要瓶颈，幅度最大
Kthink = centered(1.2, 0.25, gapThink)   // 思维量缺口：次级瓶颈
Kcode  = centered(0.7, 0.30, gapCode)    // 代码量缺口：对耗时有较小影响（主效果是耗精力，§3.5）
tEst   = timeLimitMin × Kdim × Kthink × Kcode ÷ S(focus)     // S 为专注提速，§3.4
tEst   = clamp(tEst, 0.35×timeLimitMin, 2.5×timeLimitMin)，且 ≥ 5
```

| 常数 | 值 | 含义 |
|---|---|---|
| A_dim / B_dim | 1.6 / 0.22 | 六维差满幅 ±80% 用时；每 1 点缺口移动 σ 输入 0.22 |
| A_think / B_think | 1.2 / 0.25 | 思维差幅度 ±60%；特性 `construct-poison` 将 B_think ×1.5 |
| A_code / B_code | 0.7 / 0.30 | 代码差对用时的幅度 ±35% |

**验算样例**（程序员单元测试可直接使用）：学员 `dim=50, thinking=48, code=52`，题 `D=55, M=45, C=50, TL=90`，focus=0：

- gapDim = 55−50 = **+5** → σ(1.1)=0.7503 → Kdim = 1+1.6×0.2503 = **1.4004**（六维不足，变慢）
- gapThink = 45−48 = **−3** → σ(−0.75)=0.3208 → Kthink = 1+1.2×(−0.1792) = **0.7850**（思维溢出，变快）
- gapCode = 50−52 = **−2** → σ(−0.56)=0.3635 → Kcode = 1+0.7×(−0.1365) = **0.9045**
- tEst = 90×1.4004×0.7850×0.9045 ≈ **89.5 min**

（注意方向：缺口为正 = 学员不足 → 变慢；缺口为负 = 学员溢出 → 变快；各缺口可互相抵偿。）

### 3.4 专注系统

- 入赛 `focus = 0`；上限为学员的 `focus_cap`。
- **离散入账约定**（保证解析式可精确复现）：当前题的提速只取决于该题开始时的 focus；该题结算完毕后一次性入账本题主得的专注。
- 提速曲线（饱和双曲型，永不无限加速）：

```
v(x) = 1 + 0.40 · x^0.8 （x = focus / focus_cap）   // x=0→1.000；0.25→1.132；0.50→1.230；0.75→1.318；1→1.400
                                                  // 权威曲线：student.md §6.3（满专注恰好 +40%）
```

- 每题结算后入账：

```
g(mindset)：m ≥ +1 → 1+0.04m；m = 0 → 0.70；m ≤ −1 → max(0, 0.7+0.07m)   // 权威表：student.md §5.3
Δfocus = round(0.06 × investedThisProblem × mf)
focus = clamp(focus + Δfocus, 0, focusCap)
若 mindset ≤ −6（焦虑反噬）：做题过程中专注额外每分钟 −1（下限 0）
```

| 常数 | 值 | 含义 |
|---|---|---|
| 专注增速 | 0.06/min × mf | 一场投入 ~300min、心态 50（mf=1.5）≈ 全程 +27 专注 |
| mf 斜率 | 0.01/点 | 心态 100 → 双倍获取；心态 −30 → 0.70 |
| 焦虑反噬 | 做题期间每分钟额外 −1 | 仅 mindset ≤ −6 时触发（student.md §5.3） |
| S 半饱和点 | 20 | 专注收益边际递减 |

### 3.5 精力模型（代码缺口 → 精力消耗）

```
Ebase = 3 + 0.10 × reqC                                  // 题目代码量的基础精力税
Emult = centered(1.4, 0.28, gapCode)                     // 缺口越大越费；溢出则省力
Eneed = round(Ebase × Emult)                             // 本题保底消耗
```

- **弃题前置检查**：开始一题前，若 `energy < Eneed` → 该题记 `SKIP_ENERGY`（弃题），立即转下一候选题；不消耗时间。全部剩余题均不可负担 → 空转到比赛结束。此即总纲「精力耗尽则弃题」的实现语义。
- **实际扣账在判定结束后一次性进行**：

```
energyCost = round(Ebase × Emult) + 4 × WA次数 + 2 × 判题TLE次数
energy = max(0, energy − energyCost)                     // 允许恰好打到 0
```

- 对决场景额外约定见 §4.5。

### 3.6 结果判定（AC / WA / TLE / 弃题的概率模型）

#### 3.6.1 AC 基础概率（思维 + 六维决定「能不能想出来」）

```
margin = 8 + (student[dim] − reqD) + (student.thinking − reqM)
Pac    = σ(0.15 × margin)
```

- 常数 8：恰好达标（双零差）时 Pac ≈ 77%（一次通过率体面但不稳）。
- 偏差 +10/+10 → margin 28 → Pac ≈ 98.5%（碾压）；偏差 −10/−10 → margin −12 → Pac ≈ 14%。
- 代码能力**不进入** AC 概率——它的作用通道是耗时（Kcode）与精力（§3.5），保持三缺口职责正交。

#### 3.6.2 提交流水线（每题循环）

```
attempt = 0; invested = 0; waCount = 0; tleJudgeCount = 0; mindsetDelta = 0
tFirst = tEst × e^(σn·z1)              // z1~N(0,1)，σn=0.15（lognormal 用时噪声）
loop:
  attempt++
  tSub  = attempt==1 ? tFirst : (0.6 × tEst) × e^(σn·z_a)    // 失败重写更快（思路已在）
  tSub += Σ hooks.submit_time_add                            // 如强制在线：每次提交 +8min
  if invested + tSub > remainingClock → UNFINISHED（见 3.6.4）
  invested += tSub

  // 第一掷：判题 TLE（运行超限 flavor，概率制而非时限制，见备注）
  PTLE = clamp(0.02 + Σ hooks.tle_prob_add, 0, 0.6)
  if rng.judge() < PTLE:
      fail(kind='TLE')                                        // 见 fail()
      continue

  // 第二掷：AC vs WA
  PacEff = clamp(Pac + Σ hooks.ac_prob_add + 0.08×(attempt−1), 0.02, 0.97)
  //         ↑ 学习效应：每次失败提交后 +8%
  if rng.judge() < PacEff:
      return AC(invested)                                     // 成功提交不再加罚时
  else:
      fail(kind='WA')

fail():   // WA 与判题 TLE 共用失败处理，仅 flavor 与个别 hook 不同
  penalty = 20 + Σ hooks.wa_penalty_add                      // 标准 WA 罚时 20min
  invested += penalty                                        // 罚时计入比赛时钟
  mindsetDelta −= 4 + Σ hooks.mindset_fail_add
  if kind=='WA': pendingEnergy += 4  else pendingEnergy += 2
  if invested ≥ remainingClock → UNFINISHED
```

| 常数 | 值 | 含义 |
|---|---|---|
| 噪声 σn | 0.15 | 用时乘性噪声；`tight-clock` 等特性 ×1.3 或 +0.10 |
| 重写系数 | 0.6 | 失败后重写基准 = 0.6×tEst |
| 学习效应 | +0.08/次失败 | AC 概率随尝试次数回升 |
| WA 罚时 | 20min | 特性可加重（`mod-longlong-curse` +5 等） |
| WA 心态 | −4 | 特性可加重（`precision-hell` 额外 −2） |
| 判题 TLE 概率基数 | 0.02/次提交 | 无特性时几乎不触发 |
| AC 心态 | +2/题 | 上限 100 |

> **备注：判题 TLE 为什么是概率制。** `time_limit_min` 是「人类参考解题用时」（成长与经济锚点），而 OJ 判题时限是程序运行秒数，二者不同量纲，不可混用。故判题 TLE 建模为「提交被判超时的概率」，主要由卡常类特性抬高；无特性时 2% 基数制造偶发翻车。**UNFINISHED**（比赛时钟耗尽未过题）承担传统意义上的"TLE 弃题"语义，二者在战报中分别呈现。

#### 3.6.3 心态变化汇总

| 事件 | Δmindset |
|---|---|
| 单次 WA / 判题 TLE | −4（+特性修正） |
| 单题 AC | +2 |
| SKIP_ENERGY（弃题） | −3 |
| 赛后名次百分位 ≤10% | +3 |
| 赛后名次百分位 ≤50% | +1 |
| 赛后名次百分位 >75% | −3 |
| 其余 | 0 |

全程累计后 clamp 到 [−10, +10] 并**持久化到学员**。定心丸等道具可在赛前抬心态。

#### 3.6.4 UNFINISHED 与部分分

- `UNFINISHED`：比赛时钟耗尽仍未通过该题。得分规则：
  - 若 `partialScores && partial_override 不为 none/trap && invested ≥ 0.5 × tEstAtStart` → 得 `floor(score × 0.3)`（部分分 30%）；
  - `partial_override: none`（如 SPJ、大数据范围）或 `trap`（部分分陷阱）→ 0 分；
  - 其余未尝试或投入不足 → 0 分。

### 3.7 AI 选题策略（含玩家学员，统一规则）

```
每轮从「未尝试 且 energy ≥ Eneed」的题目中选优先级最高者：
priority(p) = p.score / tEst(p, 当前 focus)
并列时取 instanceId 字典序小者（保证确定性）。
```

- 选题本身不消耗时间（开场读题并入第一题用时）。
- 被 SKIP_ENERGY 跳过的题仍留在候选集，精力不会回升（场内无回复），故自然形成「由易到难再回头」的行为。
- 该贪心对所有选手一致，保证玩家与 NPC 公平。

### 3.8 完整伪代码

```ts
function simulateRankedContest(input: RankedContestInput, seed: u32): ContestReport {
  const rng = streams(seed);                          // §0.4 子流
  const npcs  = input.npcPoolParam.map((p,i) => genNpc(p, i, rng.stream(`npc:${i}`)));
  const all   = [input.student, ...npcs];
  const results = all.map(s => simulateContestant(s, input.problems, input.durationMin,
                                                  rng.stream('order'), rng));
  const ranking = rank(results);                      // §3.11
  return settle(input, results, ranking);             // §3.12–3.14
}

function simulateContestant(stu, probs, durationMin, orderRng, rng): ContestantResult {
  let clock = durationMin, focus = 0, energy = stu.energy, mindset = stu.mindset;
  const timeline: AttemptRecord[] = [];
  const remaining = () => probs.filter(p => !resolved.has(p.instanceId));

  while (clock > 0 && remaining().length > 0) {
    const affordable = remaining().filter(p => energy >= eneed(p, stu));
    if (affordable.length === 0) {
      for (const p of remaining()) timeline.push(skipEnergyRecord(p));  // 各记弃题 −3 心态
      break;
    }
    const p = argmaxByPriority(affordable, stu, focus, orderRng);
    const r = resolveProblem(stu, p, clock, focus, energy, mindset, rng);
    apply(r): clock -= r.timeSpentMin; energy -= r.energyCost;
              focus  = updateFocus(focus, r, mindset, stu.focusCap);
              mindset = clamp(mindset + r.mindsetDelta, -10, 10);
              resolved.add(p.instanceId);
    timeline.push(r);
  }
  return { timeline, totals, mindsetEnd: mindset };
}

function resolveProblem(stu, p, clockRemain, focus, energy, mindset, rng): AttemptRecord {
  // 三缺口 → tEst → 噪声 → §3.6.2 提交流水线；返回 verdict ∈ {AC, UNFINISHED}
  // 及 timeSpentMin / energyCost / scoreAwarded / focusBefore/After / mindsetDelta / submissions
}

function updateFocus(focus, r, mindset, cap): number {
  let f = clamp(focus + round(1.2 * r.investedMin * g(mindset)), 0, cap);   // student.md §6.2 每分钟速率的逐题离散化
  if (mindset <= -6) f = Math.max(0, f - r.investedMin);                    // 焦虑反噬：做题期间每分钟额外 −1（student.md §5.3）
  return f;
}
```

### 3.9 特性系统 → 引擎 Hook 映射表

特性定义于 `problems.yaml`（severity 阶梯 red<yellow<blue<purple<black<colorful）。引擎识别以下 hook 键：

| hook | 类型 | 生效点 |
|---|---|---|
| `time_k_mul` | float | 乘在 tEst 上 |
| `ac_prob_add` | float | 加进 PacEff |
| `tle_prob_add` | float | 加进 PTLE |
| `wa_penalty_add` | int | 每次失败的罚时增量 |
| `submit_time_add` | int | 每次提交的固定耗时增量 |
| `energy_cost_add` | int | Eneed 增量 |
| `energy_per_submit_add` | int | 每次提交的额外精力 |
| `noise_sigma_add` / `noise_sigma_mul` | float | 用时噪声 |
| `mindset_fail_add` | int | 失败时额外心态惩罚 |
| `partial_override` | none/trap/keep | 覆盖部分分规则 |
| `think_weight_mul` | float | B_think 有效值放大（构造题思维瓶颈） |
| `condition` | null/first_problem/anti_ak | hook 的条件包装 |

条件语义：
- `first_problem`：仅对该选手**本场尝试的第一题**生效；
- `anti_ak`：仅当该题是该选手**最后一块拼图**（其余题均已 AC）时生效——玩家与 NPC 同受影响，用于拉开满分线。

映射实例（完整表以 problems.yaml 为准）：

| trait id | severity | 主要 hooks |
|---|---|---|
| wide-data 大数据范围 | red | partial_override:none, tle_prob_add:+0.05 |
| mod-longlong-curse 取模忘开longlong诅咒 | red | wa_penalty_add:+5, ac_prob_add:−0.03 |
| strict-spj SPJ严格判题 | yellow | partial_override:none, noise_sigma_add:+0.05 |
| off-by-one-boundary 差一边界陷阱 | yellow | ac_prob_add:−0.04, wa_penalty_add:+2 |
| interactive 强制在线交互·入门 | yellow | submit_time_add:+10, energy_cost_add:+2 |
| card-constant 卡常 | blue | tle_prob_add:+0.20 |
| greedy-counterexample 玄学贪心反例 | blue | ac_prob_add:−0.08 |
| partial-trap 部分分陷阱 | blue | partial_override:trap |
| construct-poison 毒瘤构造 | purple | think_weight_mul:1.5, ac_prob_add:−0.05 |
| anti-ak-shield 防AK护盾 | purple | condition:anti_ak → ac_prob_add:−0.15, tle_prob_add:+0.10 |
| force-online 强制在线·完全版 | purple | submit_time_add:+8, energy_per_submit_add:+1, partial_override:none |
| precision-hell 精度地狱 | black | ac_prob_add:−0.12, wa_penalty_add:+5, mindset_fail_add:−2 |
| tight-clock 极限时钟 | black | tle_prob_add:+0.30, noise_sigma_mul:1.3 |
| miracle-easy 灵光乍现 | colorful | condition:first_problem → time_k_mul:0.75, ac_prob_add:+0.25 |
| chaos-domain 概率世界 | colorful | prob_amplify:0.5（P←P+0.5(P−0.5)，作用于一切判定概率）, noise_sigma_add:+0.10 |

### 3.10 NPC 选手池生成

目标：同场排名有意义——分布连续、头部尾部都存在、与玩家用**同一套引擎**结算（绝不为 NPC 单开简化公式）。

```
level_i   = clamp(round(N(mean_level, spread)), 1, 100)
dominant  = 均匀随机六维之一
每个六维 a = clamp(round(level_i + N(0,3) + (a==dominant ? 5 : 0)), 1, 100)
thinking  = clamp(round(level_i + N(0,3)), 1, 100)
code      = clamp(round(level_i + N(0,3)), 1, 100)
mindset   = clamp(round(N(+1, 3)), -5, 10)
focus_cap = clamp(round(N(20 + 0.15·level_i, 5)), 5, 60)
energy    = clamp(round(N(70, 8)), 40, 100)
特性附着   P = clamp(0.08 + 0.002×level_i, 0.08, 0.30)；严重度按 §4.4 同一套 W_s 权重滚
姓名      从 NPC 名池按 seed 抽取（名池属 NPC 模块，另文定义）
```

- `mean_level` 按 §6.2 各章通关锚点下调 2–5 点设定（见 stages.yaml），保证推荐练度下「进前 8 通关」可达、「夺冠」需要超出锚点的培养。
- NPC 随机全部来自子流 `npc:i`，审计时可单独重放某一名对手。

### 3.11 结算：得分、排名、奖励发放顺序

**排名键**（ACM 习惯）：总分 desc → 罚时 asc → 场内稳定序号 asc。
罚时 pen = Σ(已 AC 题目的 investedMin)（其中已含各次 20min 罚时）。

**通关判定**：`rank ≤ 8`——固定前 8 名，与 NPC 池规模解耦（与名次奖金门槛一致；终裁记录见集成审查）。

**发奖顺序**（严格按序执行，任一步失败不阻断后续，全部落账进战报）：

1. 公示比分与名次；
2. 首通判定：`firstClearAvailable && pass` → 发放首通奖（money = M[chapter]×S[关位] + 道具池抽取 + 正赛的里程碑 U[chapter]），标记该关已首通；
3. 非首通的重复通关名次奖金（仅剧情层 NG+ 与二刷）：money = M[chapter] × 名次系数（冠军 0.3 / 亚军 0.2 / 第 3–8 名 0.1，其余 0）；需 pass 才有奖金；
4. 微量实战成长结算（§3.12）；
5. 心态持久化（赛中变动 + 名次修正）；
6. 精力扣账（赛后随现实时间恢复，恢复速率公式归养成系统文档）；
7. 战报落库（contest_records）。

体力消耗：剧情参赛每关固定 **stamina −2**（§4 授权"参赛按活动扣减"，此处取值 2，待 economy 校准确认）。PVP 由服务器定时代打，不扣玩家体力；历练对决按事件档 −1~−3。

### 3.12 微量实战成长（不可刷）

| 项 | 概率（每场） | 说明 |
|---|---|---|
| 已解出题的主导六维 | 每解出一题独立掷 `0.15 × fade(cur)` | +1 |
| thinking | `0.10 × fade(cur)`（全场一次） | +1 |
| code | `0.10 × fade(cur)`（全场一次） | +1 |
| focus_cap | 0.005 | +1（极低概率，呼应总纲 §9） |
| stamina_regen | 0.005 | +1（极低概率） |
| setting / mindset | — | 比赛不产出（出题能力走出题玩法） |

反刷论证：fade=(1−cur/100)^2，cur=80 时六维单题期望 ≈ 0.15×0.04=0.006 点。参赛体力按章 1–2 点（第 1–4 章 1 点、第 5–8 章 2 点，progression.md 口径），高练度下场均成长 <0.1 点；对照定向训练（大幅提升一维），比赛永远只是「顺带」，训练仍是主循环。

### 3.13 NG+ 参数注入点（总纲 §13.3）

引擎读取 stages.yaml `ng_plus` 块，在**题目实例化阶段**生效：

```
reqD/M/C ← round(req × (1 + 0.15k))
特性附加：模板池条目权重 ×(1 + 0.10k)（隐式无特性权重不变 → 特性更常见）
严重度上移：severity ≥ blue 的条目权重额外 ×(1 + 0.05k)，colorful 封顶
钱奖励 ×(1 + 0.5k)；道具池 k≥2 起稀有度上移一档（彩封顶）
进阶石里程碑不参与乘算：每层全通固定 +5 颗
```

### 3.14 战报数据结构（ContestReport）

```ts
interface ContestReport {
  id: string;
  engineVersion: string;              // 引擎版本（影响可回放性时必须升级）
  rngVersion: string;                 // 'mulberry32-v1'
  seed: string;                       // hex 种子
  kind: 'story' | 'custom';
  userId: string;
  studentId: string;
  stageRef?: { chapter: ChapterId; stageIndex: number; ngPlusLayer: number };
  config: {                           // 输入快照，审计回放的完整依据
    durationMin: number;
    problems: ProblemInstance[];
    npcPoolParam: { size: number; meanLevel: number; spread: number };
    studentSnapshot: StudentSnapshot;
  };
  timeline: AttemptRecord[];
  totals: {
    score: number; solvedCount: number; attemptCount: number;
    waCount: number; tleJudgeCount: number; skipEnergyCount: number;
    totalTimeMin: number; penaltyMin: number;
  };
  ranking: RankRow[];
  playerRank: number;
  playerPercentile: number;           // (rank−1)/(N−1)
  pass: boolean;
  rewards: RewardLine[];              // 按 §3.11 发放顺序排列
  growth: GrowthDelta[];
  mindsetStart: number; mindsetEnd: number;
  energyStart: number; energyEnd: number;
  focusTimeline: number[];            // 每题结算后的专注值
  createdAt: string;                  // ISO8601
}

interface AttemptRecord {
  problemInstanceId: string;
  verdict: 'AC' | 'UNFINISHED' | 'SKIP_ENERGY';
  submissions: number;                // 含 WA 与判题 TLE 的提交次数
  timeSpentMin: number;               // 含罚时
  penaltyMin: number;                 // 其中 20min 罚时合计
  energyCost: number;
  scoreAwarded: number;
  focusBefore: number; focusAfter: number;
  mindsetDelta: number;
  notes: string[];                    // 特性触发、弃题原因等 flavor
}

interface RankRow {
  contestantIndex: number;            // 0 = 玩家
  name: string; isPlayer: boolean;
  score: number; solvedCount: number; penaltyMin: number;
}

type RewardLine =
  | { type: 'first_clear_money'; amount: number }
  | { type: 'first_clear_item'; itemId: string; count: number }
  | { type: 'milestone_item'; itemId: string; count: number }
  | { type: 'rank_bonus_money'; rank: number; amount: number };

interface GrowthDelta {
  attr: 'ds'|'dp'|'math'|'graph'|'greedy'|'string'|'thinking'|'code'|'focus_cap'|'stamina_regen';
  delta: 1;
  sourceProblem?: string;             // instanceId（六维成长来源题）
}
```

---

## 4. 出题对决（PVP 与历练遭遇战，GAME-DESIGN §8.2）

### 4.1 总流程

```
准备阶段：A、B 各自临场生成 2 题（可用预制题替换己方坐庄局题），锁定阵容
   │
   ├─ 第1局  A 坐庄 pA1 ──► B 作答 ──┐
   ├─ 第2局  B 坐庄 pB1 ──► A 作答   │ 每局：解出 → 答题方 +1
   ├─ 第3局  A 坐庄 pA2 ──► B 作答   │       未解出 → 出题方 +1
   ├─ 第4局  B 坐庄 pB2 ──► A 作答 ──┘       （quality_scoring 启用时 +2）
   │
   └─ 4 局后比分？
        ├─ 不平 → 胜负分明，结算
        └─ 平局 → tiebreak 分流（§4.6）
```

轮次常量表：`[{setter:'A',answerer:'B',idx:1}, {setter:'B',answerer:'A',idx:1},
{setter:'A',answerer:'B',idx:2}, {setter:'B',answerer:'A',idx:2}]`

### 4.2 计分与【考察出题质量】

- 每局独立计分：答题方解出 → 答题方 +1；未解出 → 出题方 +1。
- **启用字段**：对决配置上的布尔字段 `quality_scoring: boolean`。为 `true` 时，未解出的局改为**出题方 +2**（考察出题质量：你的题别人做不出来，说明出得好）。启用来源：
  - 历练事件表中标注的事件（如 R4「OJ 出题委托」、C1「金牌幽灵的对局」、P2 部分）；
  - PVP 管理员赛事配置 `rules.qualityScoring`。
- 字段缺省为 `false`。

### 4.3 出题端：出题能力 → 题目数值映射

出题学员的 `setting`（记 q）与其主考六维值 V_dom 决定所生成题目：

```
主考六维 v：出题者指定；系统自动时取其六维最大者（并列 → 种子随机取一）
D = clamp(round( q            + N(0,3) ), 5, 98)
M = clamp(round( 0.92·q       + N(0,3) ), 5, 98)
C = clamp(round( 0.85·q       + N(0,3) ), 3, 98)
quality = clamp(round( 0.5·q + 0.3·V_dom + 0.2·thinking_setter ), 1, 100)
附带特性概率 P_trait = clamp(0.10 + 0.0035·q, 0.10, 0.50)     // 出题能力越高越容易出"毒题"
timeLimitMin = clamp(round(0.8·D + 0.6·M + 0.4·C), 45, 160)   // 同时作为该局答题时限基准
```

特性严重度权重（q 越高，高严重度相对越多）：

```
W_s = b_s × (1 + 0.006·q)^s ，s = red:0 … colorful:5
b = [red:40, yellow:30, blue:18, purple:8, black:3, colorful:1]   归一化后 roll
```

验算：q=20 → 高严重度占比 ≈ 18%；q=90 → ≈ 42%。彩特性始终极稀有的全服叙事由此保持。

### 4.4 答题端：与排名制复用

**复用方式**：答题端整体调用 §3.3–§3.6 的 `resolveProblem()`，不做第二套公式。差异仅以下五点（以参数注入）：

| # | 差异 | 实现 |
|---|---|---|
| 1 | 无专注积累 | `focus` 固定 0（S≡1.0），`updateFocus` 短路 |
| 2 | 时钟换成局限时 | `T_round = timeLimitMin × 1.25`（生成式见 §4.3），超时即 UNFINISHED=未解出 |
| 3 | 能力归属 | 三缺口用的六维/thinking/code 取**答题学员**；Eneed 从答题者 energy 中扣 |
| 4 | 心态归属 | 判定的心态变化记在答题者身上；出题者心态不受该局影响 |
| 5 | 开局能量不足 | 答题者 `energy < Eneed` → 直接判负该局（记 forfeit_energy，对方得分），不出伪流程 |

其余（WA 罚时 20min、学习效应 +0.08、判题 TLE、特性 hooks、噪声）全部原样生效——这保证「练度差距 → 表现差距」在全游戏只有一套刻度。

### 4.5 对决中的精力

- 答题消耗从答题学员的 `energy` 实时扣除（公式同 §3.5），跨局累计；历练事件随后可能用剩余精力做文章（by_energy）。
- PVP 自动对决同样扣除（赛后照常离线恢复），防止无脑连战。

### 4.6 平局 tiebreak 分流（枚举 `tiebreak`）

4 局比分配平后按对决配置的 `tiebreak` 字段分流：

```ts
type TiebreakMode = 'sudden_death' | 'by_energy' | 'by_quality' | 'friendly';
// PVP 固定 sudden_death；历练事件各自声明（events.yaml）
```

- **sudden_death（PVP 加赛·突然死亡）**
  1. 第 5 局起每两局为一组：组内先 B 答新 A 题、再 A 答新 B 题（新题重新走 §4.3 临场生成；预制题已在准备阶段锁定，不得追加携带）。
  2. 组内**恰有一方未解出 → 该方立即落败**（先失分者负）；双方同解出或同未解出 → 进下一组。
  3. 连续 3 组未分出 → 终审链：比较双方全场所用题目 quality 总和（高者胜）→ 再同比较全场罚时合计（低者胜）→ 仍平 → 以 `seed` 奇偶裁决并在战报 `tiebreak.trail` 明示（可审计、非暗箱）。
- **by_energy（比剩余精力）**：比较两名**答题侧**学员 4 局后的剩余 `energy`，高者胜；相等 → 按友好平局收场（见 friendly）。典型事件：R1「区域赛热身对抗」。
- **by_quality（比出题质量）**：比较双方各自所出题目 `quality` 总和，高者胜；相等 → 友好收场。典型事件：OJ 出题委托类评审视角。
- **friendly（友谊收场）**：不判胜负，双方各得小额 consolation money（金额由事件定义）。典型事件：G2「路人学员切磋」。

### 4.7 预制题替换规则（题库联动，总纲 §11）

- **携带数量上限：2 道/人**（正好覆盖自己 2 个坐庄局）。
- **替换时机**：仅存在于**准备阶段**——对决创建后、第 1 局开始前，双方一次性锁定阵容（哪些局用预制题、用哪一道），此后不可更换、不可中途补充。
- **质量保证机制**：
  1. 只有**本人题库**中、由本人学员出题行动产出的预制题可携带；
  2. 携带上场门槛：`quality ≥ 40`（防摆烂带垃圾题凑数）；
  3. 替换后该局使用库存题的**完整存储数值**（D/M/C/dim/traits/quality 均以入库时定格为准，绝不重掷）——这就是"保证质量"的含义：把不确定的临场生成换成已知的好题；
  4. 同一道预制题在同一届 PVP 赛事内不可重复携带；对决结束后该题打上 `used_for_duel` 标记（不可再次带入对决，但仍可用于专项训练）。
- UI 提示：准备阶段显示临场生成题的预估 quality 与库存题对比，辅助替换决策。

### 4.8 对决战报（DuelReport）

```ts
interface DuelReport {
  id: string;
  engineVersion: string; rngVersion: string; seed: string;
  kind: 'pvp' | 'encounter';                  // PVP 淘汰赛 / 历练遭遇战
  encounterEventId?: string;                  // kind=encounter 时的 events.yaml 事件 id
  sides: {
    A: DuelSide;                              // 先手坐庄方
    B: DuelSide;
  };
  qualityScoring: boolean;                    // 【考察出题质量】是否启用
  tiebreak: TiebreakMode;
  rounds: DuelRoundRecord[];                  // 4 局 + 可能的加赛局，按时间序
  scoreAfterEachRound: { a: number; b: number }[];
  winner: 'A' | 'B' | 'draw';
  decidedBy: 'regular' | 'sudden_death' | 'by_energy' | 'by_quality' | 'friendly';
  tiebreakTrail?: string[];                   // 终审链逐步记录（§4.6）
  rewards: RewardLine[];                      // 复用 ContestReport 的 RewardLine
  createdAt: string;
}

interface DuelSide {
  userId: string;
  studentSnapshot: StudentSnapshot;           // 含入场 energy/mindset
  generatedProblems: ProblemInstance[];       // 临场生成题（§4.3 公式输出快照）
  carriedProblems: CarriedProblemRef[];       // 预制题引用（可为空，≤2）
}

interface CarriedProblemRef {
  bankProblemId: string;
  replacedRoundIndex: number;                 // 替换哪个坐庄局（0-based）
  qualitySnapshot: number;
}

interface DuelRoundRecord {
  roundIndex: number;                         // 0..3（加赛续编 4,5,…）
  setterSide: 'A' | 'B'; answererSide: 'A' | 'B';
  problem: ProblemInstance;
  problemSource: 'generated' | 'carried';
  roundLimitMin: number;
  solved: boolean;
  forfeitEnergy: boolean;                     // 答题方开局精力不足直接判负
  submissions: number; timeSpentMin: number; penaltyMin: number;
  energyCost: number;                         // 答题者支出
  answererMindsetDelta: number;
  scoreAwardedTo: 'setter' | 'answerer';
  points: number;                             // 1 或（quality_scoring 且未解出时）2
  notes: string[];
}
```

---

## 5. 常数速查表（实现对照用）

| 常数 | 值 |
|---|---|
| K_dim / K_think / K_code | centered(1.6, 0.22) / centered(1.2, 0.25) / centered(0.7, 0.30) |
| tEst clamp | [0.35×TL, 2.5×TL]，≥5min |
| 用时噪声 σn | 0.15（lognormal）；重写基准 0.6×tEst |
| Pac | σ(0.15 × (8 + dimGap + thinkGap))；失败 +0.08/次；clamp [0.02, 0.97] |
| PTLE | 0.02 + Σadd，cap 0.6 |
| WA 罚时 / 心态 / 精力 | +20min / −4 / +4（判题 TLE 精力 +2） |
| AC 心态 | +2 |
| Ebase / Emult | 3 + 0.10×reqC / centered(1.4, 0.28, gapCode) |
| 专注 | Δ=round(0.06×invested×mf)；S(f)=1+0.5f/(f+20)；衰减 ×0.7−1（mindset≤0） |
| mf | clamp(1+0.01×mindset, 0.2, 2.0) |
| mindset 范围 | [-10, +10]（权威：student.md §5） |
| 排名 | score desc → penalty asc → 稳定序；pass = rank ≤ 8 |
| 名次奖金 | 冠军 0.3 / 亚军 0.2 / 3–8 名 0.1 × M[chapter] |
| 剧情体力 | −2/关 |
| NPC | level~N(mean,spread)；dominant +5；mindset~N(50,10)；focus_cap~N(20+0.15L,5) |
| 出题端 | D=q±3 / M=0.92q / C=0.85q；quality=0.5q+0.3V_dom+0.2thinking；P_trait=0.10+0.0035q |
| 严重度权重 | W_s = b_s×(1+0.006q)^s，b=[40,30,18,8,3,1] |
| 局时限 | T_round = TL_generated × 1.25（clamp 45–160 由生成式保证） |
| 预制题 | ≤2 道，quality ≥40，准备阶段锁，赛后 used_for_duel |

## 6. 与 GAME-DESIGN.md 的差异备注（待总纲确认）

1. **mindset 下界**：~~总纲 §6.1 称所有属性范围 1–100~~ → 集成时总纲已修订为「能力属性 1–100，心态例外取 −10～+10」，本文同步采用 **[-10, +10]**。已解决。
2. **TLE 二分**：总纲的「TLE」拆为 `UNFINISHED`（时钟耗尽）与判题 TLE（提交超限，概率制），理由见 §3.6.2 备注。
3. **新增字段**（总纲未定，集成确认采纳）：`duration_min`（仿真赛程时长）、NPC 附带特性概率公式——保留为本文明细字段；参赛体力已改为按章 1–2 点（progression 口径）、通关线已终裁固定前 8 名。
4. `time_limit_min` 语义明确为**人类参考解题用时**，不是 OJ 运行时限。
