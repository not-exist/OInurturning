import type {
  AbilityKey,
  ContestFormat,
  ContestRecordType,
  ContestSide,
  ContestVerdict,
  DimensionKey,
  EventCategory,
  ItemEffectKind,
  ProblemSeverity,
  ProblemTier,
  QualityTier,
  Rarity,
  TalentEffectStat,
} from '@oinur/shared';

/**
 * 文案唯一真源：所有中英映射集中于此，页面不得再出现英文枚举 key / 裸 id。
 * 严格表（`satisfies`）用于封闭集合；`xxxLabel(raw)` 容错函数用于 wire 上的自由字符串
 * （例如 admin 审计的 action/targetType 在类型层无 enum 约束，只能兜底渲染）。
 */

// ---------------------------------------------------------------------------
// wire 上的封闭集合（shared 未导出的补于此）
// ---------------------------------------------------------------------------

export type TrainingKind = 'basic' | 'directed' | 'specialized';
export type LectureTierId = 'beginner' | 'junior' | 'senior' | 'provincial' | 'national';
export type AcquiredVia = 'RECRUIT' | 'EVENT' | 'UPGRADE' | 'REROLL' | 'ADMIN';
export type MatchStatus = 'PENDING' | 'DONE' | 'BYE';
export type TournamentStatus = 'REGISTERING' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
export type StudentStatus = 'ACTIVE' | 'DISMISSED';
export type Role = 'USER' | 'ADMIN';
/** 单局判定理由比 verdict 全集少一个 SKIP */
export type RoundReason = Exclude<ContestVerdict, 'SKIP'>;

// ---------------------------------------------------------------------------
// 能力 / 属性
// ---------------------------------------------------------------------------

/** 六维官方名（talents.yaml / items.yaml 一致；缩写 DP 不是正式名） */
export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  DS: '数据结构',
  DP: '动态规划',
  MATH: '数学',
  GRAPH: '图论',
  GREEDY: '贪心',
  STRING: '字符串',
};

/** 九维 = 六维 + 三能力（「九维能力」区） */
export const ABILITY_LABEL: Record<AbilityKey, string> = {
  ...DIMENSION_LABEL,
  CODING: '代码能力',
  THINKING: '思维能力',
  PROBLEM: '出题能力',
};

export const SEX_LABEL: Record<'MALE' | 'FEMALE', string> = { MALE: '男', FEMALE: '女' };

/** 招募品质档（材质层级视觉在 rarity.ts QUALITY_MATERIAL） */
export const QUALITY_LABEL: Record<QualityTier, string> = {
  COMMON: '普通',
  GOOD: '良好',
  ELITE: '精英',
  GENIUS: '天才',
};

/** 开局任务徽章 id 是服务端字面量 `rookie-done`；未领取态用中文，已领取态必须原样输出（e2e 断言 `已领取：rookie-done`） */
export const CHECKLIST_BADGE_LABEL: Record<string, string> = {
  'rookie-done': '新秀徽章',
};

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: '在营',
  DISMISSED: '已开除',
};

export const ROLE_LABEL: Record<Role, string> = { USER: '玩家', ADMIN: '管理员' };

export const TRAINING_KIND_LABEL: Record<TrainingKind, string> = {
  basic: '基础',
  directed: '定向',
  specialized: '专项',
};

// ---------------------------------------------------------------------------
// 难度 8 档（赛事 tier；与剧情 8 章一一对应）
// ---------------------------------------------------------------------------

export const TIER_ORDER: ProblemTier[] = [
  'cspj',
  'csps',
  'noip',
  'province',
  'noi',
  'ctt',
  'cts',
  'ioi',
];

export const TIER_LABEL: Record<ProblemTier, string> = {
  cspj: 'CSP-J',
  csps: 'CSP-S',
  noip: 'NOIP',
  province: '省选',
  noi: 'NOI',
  ctt: 'CTT',
  cts: 'CTS',
  ioi: 'IOI',
};

export function tierLabel(raw: string): string {
  return (TIER_LABEL as Record<string, string>)[raw] ?? raw;
}

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

export const ITEM_CATEGORY_LABEL: Record<string, string> = {
  nurture: '养成',
  book: '书籍',
  functional: '功能',
  contest: '竞赛',
  quest: '任务',
  material: '材料',
};

export const ITEM_EFFECT_KIND_LABEL = {
  rename: '改名',
  talent_advance: '天赋进阶',
  talent_reroll: '天赋洗练',
  talent_reroll_lock: '洗练锁定',
  mentality_add: '心态调整',
  energy_restore: '精力恢复',
  energy_cap_add: '精力上限',
  stamina_restore: '体力恢复',
  focus_cap_add: '专注上限',
  attr_boost: '属性增益',
  training_buff: '训练增益',
  event_defuse: '事件化解',
  contest_buff: '比赛增益',
  adventure_buff: '历练增益',
  adventure_insurance: '历练保障',
  info_preview: '情报预览',
  recruit_guarantee: '招募保障',
  recruit_quality_buff: '招募品质',
  account_aura: '账号光环',
  unlock_tag: '标签解锁',
  unlock_passive: '被动解锁',
  passive_income_source: '被动收入',
  pvp_entry: '赛事入场',
  grant_box: '礼盒',
  choose_grant: '自选奖励',
  compose_input: '合成材料',
  vendor_sell: '可出售',
  display: '陈列品',
} satisfies Record<ItemEffectKind, string>;

/** 两件有专属不可用语义的道具（其余一律「暂不可用」） */
export const ITEM_UNAVAILABLE_REASON: Record<string, string> = {
  'vigor-drink': '需在比赛场景中使用',
};

export const RENAME_CARD_ID = 'rename-card';

/** 直接使用类书籍（可直用 15 件书的 3 个科目；六维书是定向训练耗材） */
export const DIRECT_BOOK_SUBJECTS = ['thinking', 'coding', 'setting'] as const;
export type DirectBookSubject = (typeof DIRECT_BOOK_SUBJECTS)[number];

export const DIRECT_BOOK_SUBJECT_LABEL: Record<DirectBookSubject, string> = {
  thinking: '思维',
  coding: '代码实现',
  setting: '出题',
};

/** 直用书增益（灰/黄/绿/蓝/紫）：用于「本周剩余 N 点」损失预警 */
export const DIRECT_BOOK_GAIN: Record<Rarity, number> = {
  GRAY: 2,
  YELLOW: 4,
  GREEN: 7,
  BLUE: 12,
  PURPLE: 20,
  RAINBOW: 0,
};

export function itemEffectKindLabel(kind: string): string {
  return (ITEM_EFFECT_KIND_LABEL as Record<string, string>)[kind] ?? '特殊效果';
}

export function itemCategoryLabel(category: string): string {
  return ITEM_CATEGORY_LABEL[category] ?? '其他';
}

// ---------------------------------------------------------------------------
// 天赋
// ---------------------------------------------------------------------------

export const TALENT_KIND_LABEL: Record<'positive' | 'negative', string> = {
  positive: '正面',
  negative: '负面',
};

/** 23 个家族（talents.yaml 家族注释） */
export const TALENT_FAMILY_LABEL: Record<string, string> = {
  memo: '记忆化',
  tabu: '打表怪',
  sense: '数感',
  construct: '构造直觉',
  hack: '对拍之手',
  guess: '猜结论大师',
  const: '卡常大师',
  heur: '玄学复杂度',
  type: '键盘侠',
  tmpl: '模板大师',
  lect: '讲台之星',
  grind: '刷题狂魔',
  seg: '线段树园丁',
  numth: '数论爱好者',
  dij: '最短路行者',
  greed: '贪心信奉者',
  kmp: 'KMP信徒',
  zeron: '爆零战神',
  oob: '数组越界体质',
  proc: '拖延症',
  clum: '手残',
  insom: '考场失眠',
  wrong: '假算法惯犯',
};

/** 6 条灰→黄净化链（黄级即终点，值得单独的视觉仪式） */
export const PURIFY_CHAINS = new Set(['zeron', 'oob', 'proc', 'clum', 'insom', 'wrong']);

export const TALENT_STAT_LABEL = {
  ds: '数据结构',
  dp: '动态规划',
  math: '数学',
  graph: '图论',
  greedy: '贪心',
  string: '字符串',
  code: '代码能力',
  thinking: '思维能力',
  setting: '出题能力',
  mindset: '心态',
  focus_cap: '专注上限',
  energy_max: '精力上限',
  stamina_regen: '体力恢复效率',
  training_all: '训练总收益',
  training_ds: '数据结构训练',
  training_dp: '动态规划训练',
  training_math: '数学训练',
  training_graph: '图论训练',
  training_greedy: '贪心训练',
  training_string: '字符串训练',
  training_code: '代码能力触达',
  training_thinking: '思维能力触达',
  book_effect: '书籍收益',
  duel_posing: '对决出题强度',
  duel_solve: '对决解题',
  lecture_income: '讲课收入',
  focus_gain: '专注积累速率',
  energy_cost_reduce: '比赛精力消耗',
  energy_regen: '赛后精力恢复',
  wa_penalty_reduce: 'WA 罚时',
  mindset_loss_reduce: '心态损失',
  event_luck: '历练幸运',
  setting_quality: '出题质量',
} satisfies Record<TalentEffectStat, string>;

/**
 * 天赋获取途径（运行时 acquiredVia）。
 * 与「是不是独立彩」区分：后者用配置层 family === null && rarity === RAINBOW 判定。
 */
export const ACQUIRED_VIA_LABEL: Record<AcquiredVia, string> = {
  RECRUIT: '招募自带',
  EVENT: '历练所得',
  UPGRADE: '进阶所得',
  REROLL: '洗练所得',
  ADMIN: '管理员发放',
};

export function acquiredViaLabel(raw: string): string {
  return (ACQUIRED_VIA_LABEL as Record<string, string>)[raw] ?? '来历不明';
}

export function talentFamilyLabel(family: string | null): string {
  return family ? (TALENT_FAMILY_LABEL[family] ?? family) : '独立天赋';
}

export function talentStatLabel(stat: string): string {
  return (TALENT_STAT_LABEL as Record<string, string>)[stat] ?? stat;
}

// ---------------------------------------------------------------------------
// 出题
// ---------------------------------------------------------------------------

/** 出题需求三参数（problems.yaml requirements） */
export const REQUIREMENT_LABEL: Record<'d' | 'm' | 'c', string> = {
  d: '需求',
  m: '思维量',
  c: '代码量',
};

/** 题库容量（gameplay.md §5.3） */
export const PROBLEM_LIBRARY_CAP = 120;

export interface TraitInfo {
  name: string;
  severity: ProblemSeverity;
  effect: string;
}

/**
 * 15 条题目特性（problems.yaml 真源；API 只回 traitId，severity 仅随题目快照回来）。
 * effect 取配置文案压缩版，避免 HoverCard 里堆整段策划注释。
 */
export const PROBLEM_TRAITS: Record<string, TraitInfo> = {
  'wide-data': {
    name: '大数据范围',
    severity: 'red',
    effect: '暴力骗分被堵死，判题超时概率 +5%。新手最常见的第一课。',
  },
  'mod-longlong-curse': {
    name: '取模忘开longlong诅咒',
    severity: 'red',
    effect: 'AC 概率 −3%，WA 后多花 5 分钟定位溢出。',
  },
  'strict-spj': {
    name: 'SPJ严格判题',
    severity: 'yellow',
    effect: '特殊判题器逐字段核对输出（不存在部分分），输出噪声容差更小。',
  },
  'off-by-one-boundary': {
    name: '差一边界陷阱',
    severity: 'yellow',
    effect: '数据点精准卡在边界 ±1 上：AC 概率 −4%，WA 罚时略增。',
  },
  interactive: {
    name: '强制在线交互·入门',
    severity: 'yellow',
    effect: '每次失败提交额外等一轮交互（罚时 +10min），精力开销略增。',
  },
  'card-constant': {
    name: '卡常',
    severity: 'blue',
    effect: '正解常数巨大：超时概率 +20%/次，逼选手反复卡常重交。',
  },
  'greedy-counterexample': {
    name: '玄学贪心反例',
    severity: 'blue',
    effect: '表面贪心存在精心构造的反例集合，AC 概率 −8%。',
  },
  'partial-trap': {
    name: '部分分陷阱',
    severity: 'blue',
    effect: '未 AC 的已尝试题目得分归零（覆盖默认 30% 部分分规则）。',
  },
  'construct-poison': {
    name: '毒瘤构造',
    severity: 'purple',
    effect: '思维缺口对耗时的影响系数 ×1.5，AC 概率再 −5%。',
  },
  'anti-ak-shield': {
    name: '防AK护盾',
    severity: 'purple',
    effect: '已 AC 其余所有题时本题突然变难：AC −15%、超时 +10%。',
  },
  'force-online': {
    name: '强制在线·完全版',
    severity: 'purple',
    effect: '每次提交重读全部历史输入（+8min）并多耗 1 点精力，无部分分。',
  },
  'precision-hell': {
    name: '精度地狱',
    severity: 'black',
    effect: '实数运算精度坑遍布：AC 概率大幅下降、WA 罚时加重，失败时心态额外 −2。',
  },
  'tight-clock': {
    name: '极限时钟',
    severity: 'black',
    effect: '判题时限压到极限：超时概率 +30%，且用时噪声 ×1.3（强手更稳、弱手更崩）。',
  },
  'miracle-easy': {
    name: '灵光乍现',
    severity: 'colorful',
    effect: '仅对全场第一题生效：用时 ×0.75、AC 概率 +25%。高严重度里唯一的正面存在。',
  },
  'chaos-domain': {
    name: '概率世界',
    severity: 'colorful',
    effect: '双刃：所有判定概率向两极放大（强者更强、弱者更弱），用时噪声 +0.10。',
  },
};

export function traitInfo(traitId: string): TraitInfo | null {
  return PROBLEM_TRAITS[traitId] ?? null;
}

export function traitName(traitId: string): string {
  return PROBLEM_TRAITS[traitId]?.name ?? traitId;
}

/**
 * 题目特性冻结 hook 键（contest.md §3.9）：题目详情「特性」页展示，禁止直出 snake_case。
 * 14 键 + condition / partial_override 两个枚举键。
 */
export const HOOK_LABEL: Record<string, string> = {
  condition: '触发条件',
  time_k_mul: '用时系数',
  ac_prob_add: 'AC 概率',
  tle_prob_add: '超时概率',
  wa_penalty_add: 'WA 罚时',
  submit_time_add: '提交加时',
  energy_cost_add: '精力开销',
  energy_per_submit_add: '每次提交精力',
  noise_sigma_add: '用时噪声',
  noise_sigma_mul: '用时波动',
  mindset_fail_add: '失败心态',
  partial_override: '部分分',
  think_weight_mul: '思维权重',
  prob_amplify: '概率放大',
};

export const HOOK_CONDITION_LABEL: Record<string, string> = {
  first_problem: '仅首题',
  anti_ak: '仅最后一块拼图',
};

export const PARTIAL_OVERRIDE_LABEL: Record<string, string> = {
  none: '无部分分',
  trap: '部分分归零',
  keep: '保留部分分',
};

export function hookLabel(key: string): string {
  return HOOK_LABEL[key] ?? key;
}

/** hook 值人话化：概率类转百分比、乘区带 ×、罚时带分钟，其余带符号原值 */
export function hookValueLabel(key: string, value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key === 'condition') return HOOK_CONDITION_LABEL[String(value)] ?? String(value);
  if (key === 'partial_override') return PARTIAL_OVERRIDE_LABEL[String(value)] ?? String(value);
  if (typeof value !== 'number') return String(value);
  if (key.endsWith('_prob_add')) {
    return `${value >= 0 ? '+' : '−'}${Math.round(Math.abs(value) * 100)}%`;
  }
  if (key.endsWith('_mul')) return `×${value}`;
  if (key.endsWith('_time_add') || key === 'wa_penalty_add') {
    return `${value >= 0 ? '+' : '−'}${Math.abs(value)} 分钟`;
  }
  return `${value >= 0 ? '+' : ''}${value}`;
}

// ---------------------------------------------------------------------------
// 竞赛 / 战报
// ---------------------------------------------------------------------------

export const CONTEST_FORMAT_LABEL: Record<ContestFormat, string> = {
  RANKING: '排名赛',
  DUEL: '出题对决',
};

export const CONTEST_RECORD_TYPE_LABEL: Record<ContestRecordType, string> = {
  STORY: '剧情赛',
  PVP: '锦标赛',
  ADVENTURE: '历练',
};

/** 三个 side：旧实现漏了 NPC */
export const CONTEST_SIDE_LABEL: Record<ContestSide, string> = {
  HOME: '我方',
  AWAY: '对方',
  NPC: '第三方',
};

export const VERDICT_LABEL: Record<ContestVerdict, string> = {
  AC: '通过',
  WA: '答案错误',
  TLE: '超时',
  SKIP: '跳过',
  UNFINISHED: '未完成',
};

/** 单次提交与 round.reason 只用 4 值子集 */
export const ROUND_REASON_LABEL: Record<RoundReason, string> = {
  AC: '通过',
  WA: '答案错误',
  TLE: '超时',
  UNFINISHED: '未完成',
};

export const TIEBREAK_LABEL: Record<string, string> = {
  REGULAR: '常规回合',
  SUDDEN_DEATH: '突然死亡',
  ENERGY: '精力余量',
  QUALITY: '出题质量',
  FRIENDLY: '友谊裁决',
};

/** 战报 RewardLine（与 PVP 的 PvpRewardLine 是两套独立体系） */
export const REWARD_LINE_LABEL: Record<string, string> = {
  first_clear_money: '首通奖金',
  first_clear_item: '首通道具',
  milestone_item: '里程碑道具',
  rank_bonus_money: '名次奖金',
};

export const PVP_REWARD_LINE_LABEL: Record<string, string> = {
  item: '道具',
  money: '金币',
  reputation: '声誉',
};

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  REGISTERING: '报名中',
  RUNNING: '进行中',
  FINISHED: '已结束',
  CANCELLED: '已取消',
};

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  PENDING: '待开赛',
  DONE: '已结束',
  BYE: '轮空',
};

export function tournamentStatusLabel(raw: string): string {
  return (TOURNAMENT_STATUS_LABEL as Record<string, string>)[raw] ?? '未知状态';
}

export function matchStatusLabel(raw: string): string {
  return (MATCH_STATUS_LABEL as Record<string, string>)[raw] ?? '未知状态';
}

export function verdictLabel(raw: string): string {
  return (VERDICT_LABEL as Record<string, string>)[raw] ?? '未知判定';
}

export function roundReasonLabel(raw: string): string {
  return (ROUND_REASON_LABEL as Record<string, string>)[raw] ?? '未知判定';
}

export function dimensionLabel(raw: string): string {
  return (DIMENSION_LABEL as Record<string, string>)[raw] ?? raw;
}

export function contestSideLabel(raw: string): string {
  return (CONTEST_SIDE_LABEL as Record<string, string>)[raw] ?? '未知一方';
}

export function tiebreakLabel(raw: string): string {
  return TIEBREAK_LABEL[raw] ?? '加赛裁决';
}

// ---------------------------------------------------------------------------
// 历练
// ---------------------------------------------------------------------------

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  duel: '对决',
  windfall: '机缘',
  trial: '试炼',
  chance: '奇遇',
  trouble: '麻烦',
  social: '人情',
};

export const ADVENTURE_STATUS_LABEL: Record<'PENDING' | 'RESOLVED', string> = {
  PENDING: '待抉择',
  RESOLVED: '已结算',
};

export function eventCategoryLabel(raw: string): string {
  return (EVENT_CATEGORY_LABEL as Record<string, string>)[raw] ?? '未知类型';
}

/**
 * 全库唯一两条不可重复事件（events.yaml repeatable: false）——
 * 必须显式标注，否则玩家会把「抽不到」当 bug（其余 38 条冷却中条目直接不进池）。
 */
export const EVENT_ONESHOT: Record<string, string> = {
  R7: '每名队长限一次',
  C2: '全服每周限量 3 次',
};

// ---------------------------------------------------------------------------
// 讲课
// ---------------------------------------------------------------------------

export const LECTURE_TIER_LABEL: Record<LectureTierId, string> = {
  beginner: '入门组',
  junior: '普及组',
  senior: '提高组',
  provincial: '省选组',
  national: '国家队集训队',
};

export function lectureTierLabel(raw: string): string {
  return (LECTURE_TIER_LABEL as Record<string, string>)[raw] ?? raw;
}

// ---------------------------------------------------------------------------
// 管理端（action/targetType 在类型层是自由字符串，必须有兜底文案）
// ---------------------------------------------------------------------------

export const ADMIN_ACTION_LABEL: Record<string, string> = {
  TOURNAMENT_CREATE: '创建赛事',
  TOURNAMENT_PRIZE_UPDATE: '调整赛事奖池',
  TOURNAMENT_START: '启动赛事',
  ANNOUNCEMENT_CREATE: '发布公告',
  USER_BAN: '封禁用户',
  USER_UNBAN: '解封用户',
};

export const ADMIN_TARGET_LABEL: Record<string, string> = {
  PVP_TOURNAMENT: '锦标赛',
  ANNOUNCEMENT: '公告',
  USER: '用户',
};

export function adminActionLabel(raw: string): string {
  return ADMIN_ACTION_LABEL[raw] ?? '管理操作';
}

export function adminTargetLabel(raw: string | null): string {
  if (raw === null || raw === '') return '—';
  return ADMIN_TARGET_LABEL[raw] ?? '其他对象';
}

// ---------------------------------------------------------------------------
// 通用格式化
// ---------------------------------------------------------------------------

/** 展示层 floor：能力值在库内是浮点累积值 */
export function floor(v: number): number {
  return Math.floor(v);
}

/** 心态四舍五入到整数点展示 */
export function round(v: number): number {
  return Math.round(v);
}

/** 带符号整数（增量展示） */
export function signed(v: number): string {
  const n = round(v);
  return n > 0 ? `+${n}` : String(n);
}
