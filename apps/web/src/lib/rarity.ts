import type { ProblemSeverity, ProblemTier, QualityTier, Rarity } from '@oinur/shared';
// 前端一律只从 zod-free 子路径取运行时值：经 barrel 会连带把 config 的 zod schema 打进浏览器包
import { RARITIES } from '@oinur/shared/enums';
import { TIER_ORDER } from './labels';

/**
 * 稀有度 / 严重度 / 难度 / 品质档的视觉语言（全局唯一真源）。
 *
 * 四套体系各自独立，混用即 bug：
 * - 稀有度（灰黄绿蓝紫彩）：道具与天赋。灰 = 廉价/有瑕疵（负面），彩 = 传说且全服稀缺。
 * - 严重度（red<yellow<blue<purple<black<colorful）：**仅**题目特性，语义是「毒性递增」，
 *   red 是最轻且最高频的一档（不是危险告警）；最高两档也不全是负面。
 * - 难度（8 档赛事 tier）：同一色相明度递进 + 章节序号，不借稀有度六色。
 * - 品质档（普通/良好/精英/天才）：材质层级（素面→细描→内发光→动态光晕），不复用色相。
 */

// ---------------------------------------------------------------------------
// 稀有度
// ---------------------------------------------------------------------------

/**
 * wire 双轨归一：items/adventures/pvp 返回配置小写（colorful），
 * talents/problems 经 toRarity() 返回大写（RAINBOW）。两者都收敛到共享 Rarity。
 */
export function normRarity(r: string): Rarity {
  const up = String(r).toUpperCase().replace('COLORFUL', 'RAINBOW');
  return (RARITIES as readonly string[]).includes(up) ? (up as Rarity) : 'GRAY';
}

export const RARITY_LABEL: Record<Rarity, string> = {
  GRAY: '灰',
  YELLOW: '黄',
  GREEN: '绿',
  BLUE: '蓝',
  PURPLE: '紫',
  RAINBOW: '彩',
};

export const RARITY_ORDER: Record<Rarity, number> = {
  GRAY: 0,
  YELLOW: 1,
  GREEN: 2,
  BLUE: 3,
  PURPLE: 4,
  RAINBOW: 5,
};

/** 文字着色：彩档走流动渐变 */
export const RARITY_TEXT: Record<Rarity, string> = {
  GRAY: 'text-rarity-gray',
  YELLOW: 'text-rarity-yellow',
  GREEN: 'text-rarity-green',
  BLUE: 'text-rarity-blue',
  PURPLE: 'text-rarity-purple',
  RAINBOW: 'rainbow-text',
};

export const RARITY_BORDER: Record<Rarity, string> = {
  GRAY: 'border-rarity-gray/45',
  YELLOW: 'border-rarity-yellow/45',
  GREEN: 'border-rarity-green/45',
  BLUE: 'border-rarity-blue/45',
  PURPLE: 'border-rarity-purple/50',
  RAINBOW: 'border-rarity-colorful/60',
};

export const RARITY_FILL: Record<Rarity, string> = {
  GRAY: 'bg-rarity-gray/10',
  YELLOW: 'bg-rarity-yellow/10',
  GREEN: 'bg-rarity-green/10',
  BLUE: 'bg-rarity-blue/10',
  PURPLE: 'bg-rarity-purple/12',
  RAINBOW: 'bg-rarity-colorful/12',
};

/** 图标光效（稀有度是画面唯一高饱和光源） */
export const RARITY_GLOW: Record<Rarity, string> = {
  GRAY: '',
  YELLOW: 'shadow-[0_0_20px_-2px_var(--color-rarity-yellow)]',
  GREEN: 'shadow-[0_0_22px_-2px_var(--color-rarity-green)]',
  BLUE: 'shadow-[0_0_26px_-1px_var(--color-rarity-blue)]',
  PURPLE: 'shadow-[0_0_32px_0_var(--color-rarity-purple)]',
  RAINBOW: 'shadow-[0_0_36px_0_var(--color-rarity-colorful)]',
};

/** 徽章：1px 描边 + 透明底 + 稀有度色文字 */
export function rarityChip(r: string): string {
  const k = normRarity(r);
  return `border ${RARITY_BORDER[k]} ${RARITY_FILL[k]} ${RARITY_TEXT[k]}`;
}

/** 稀有度文字着色（容错：wire 上双轨大小写皆可） */
export function rarityText(r: string): string {
  return RARITY_TEXT[normRarity(r)];
}

/** 稀有度中文名（容错） */
export function rarityLabel(r: string): string {
  return RARITY_LABEL[normRarity(r)];
}

// ---------------------------------------------------------------------------
// 题目特性严重度（毒性阶梯，Ⅰ–Ⅵ 刻度；与「提交判定错误态」空间分离）
// ---------------------------------------------------------------------------

export const SEVERITY_ORDER: ProblemSeverity[] = [
  'red',
  'yellow',
  'blue',
  'purple',
  'black',
  'colorful',
];

export const SEVERITY_NUMERAL: Record<ProblemSeverity, string> = {
  red: 'Ⅰ',
  yellow: 'Ⅱ',
  blue: 'Ⅲ',
  purple: 'Ⅳ',
  black: 'Ⅴ',
  colorful: 'Ⅵ',
};

export const SEVERITY_LABEL: Record<ProblemSeverity, string> = {
  red: '轻微',
  yellow: '中等',
  blue: '棘手',
  purple: '凶险',
  black: '致命',
  colorful: '异变',
};

export const SEVERITY_CLS: Record<ProblemSeverity, string> = {
  red: 'border-sev-red/60 text-sev-red',
  yellow: 'border-sev-yellow/60 text-sev-yellow',
  blue: 'border-sev-blue/60 text-sev-blue',
  purple: 'border-sev-purple/60 text-sev-purple',
  black: 'border-fg-dim/50 text-fg-muted bg-ink-950/60',
  colorful: 'border-sev-colorful/60 text-sev-colorful',
};

export function isSeverity(v: string): v is ProblemSeverity {
  return (SEVERITY_ORDER as string[]).includes(v);
}

// ---------------------------------------------------------------------------
// 难度 8 档（赛事 tier）—— 中文名见 labels.ts 的 TIER_LABEL
// ---------------------------------------------------------------------------

/** 同一色相 8 级明度递进：阶梯进程用「亮度」而非「色相」表达 */
export const TIER_TEXT: Record<ProblemTier, string> = {
  cspj: 'text-tier-cspj',
  csps: 'text-tier-csps',
  noip: 'text-tier-noip',
  province: 'text-tier-province',
  noi: 'text-tier-noi',
  ctt: 'text-tier-ctt',
  cts: 'text-tier-cts',
  ioi: 'text-tier-ioi',
};

export const TIER_BORDER: Record<ProblemTier, string> = {
  cspj: 'border-tier-cspj/60',
  csps: 'border-tier-csps/60',
  noip: 'border-tier-noip/60',
  province: 'border-tier-province/60',
  noi: 'border-tier-noi/60',
  ctt: 'border-tier-ctt/60',
  cts: 'border-tier-cts/60',
  ioi: 'border-tier-ioi/70',
};

export function isTier(v: string): v is ProblemTier {
  return TIER_ORDER.includes(v as ProblemTier);
}

// ---------------------------------------------------------------------------
// 招募品质档 = 材质层级（不复用稀有度色相；中文名见 labels.ts）
// ---------------------------------------------------------------------------

export const QUALITY_MATERIAL: Record<QualityTier, string> = {
  COMMON: 'mat-common',
  GOOD: 'mat-good',
  ELITE: 'mat-elite',
  GENIUS: 'mat-genius',
};

/** 招募**前**的品质档必须隐性：候选卡只显示三档气质 */
export const QUALITY_HINT: Record<QualityTier, string> = {
  COMMON: '气质普通',
  GOOD: '气质普通',
  ELITE: '身手不凡',
  GENIUS: '锋芒毕露',
};

// ---------------------------------------------------------------------------
// 出题质量评级（映射回统一六色序列展示：gameplay.md §5.2）
// ---------------------------------------------------------------------------

export const QUALITY_BANDS: { min: number; label: string; rarity: Rarity }[] = [
  { min: 95, label: '传世', rarity: 'RAINBOW' },
  { min: 85, label: '杰作', rarity: 'PURPLE' },
  { min: 70, label: '优秀', rarity: 'BLUE' },
  { min: 50, label: '良好', rarity: 'GREEN' },
  { min: 30, label: '合格', rarity: 'YELLOW' },
  { min: 0, label: '习作', rarity: 'GRAY' },
];

export function qualityBand(q: number): { label: string; rarity: Rarity } {
  return QUALITY_BANDS.find((b) => q >= b.min) ?? QUALITY_BANDS[QUALITY_BANDS.length - 1]!;
}

// ---------------------------------------------------------------------------
// 声誉称号（student.md §9 刻度：<300 默默无闻 / ≥300 小有名气 / ≥1000 知名教练 /
// ≥2500 名家 / ≥4500 大师 / ≥6500 传奇）
// ---------------------------------------------------------------------------

export const REPUTATION_TITLES: { min: number; label: string }[] = [
  { min: 6500, label: '传奇' },
  { min: 4500, label: '大师' },
  { min: 2500, label: '名家' },
  { min: 1000, label: '知名教练' },
  { min: 300, label: '小有名气' },
  { min: 0, label: '默默无闻' },
];

export function reputationTitle(reputation: number): string {
  return (
    REPUTATION_TITLES.find((t) => reputation >= t.min) ?? REPUTATION_TITLES[REPUTATION_TITLES.length - 1]!
  ).label;
}

/** 下一级称号与还差多少声誉（已封顶返回 null） */
export function nextReputationTitle(reputation: number): { label: string; gap: number } | null {
  const next = [...REPUTATION_TITLES].reverse().find((t) => t.min > reputation);
  return next ? { label: next.label, gap: next.min - reputation } : null;
}
