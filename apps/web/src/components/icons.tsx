import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArrowLeft,
  Battery,
  BatteryCharging,
  BatteryWarning,
  Blocks,
  BookOpen,
  Boxes,
  Brain,
  Bug,
  CalendarClock,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  CircleX,
  Clover,
  Code,
  Coffee,
  Coins,
  Compass,
  Contact,
  Cpu,
  Dices,
  Dumbbell,
  FileSignature,
  Flame,
  Gauge,
  Gem,
  Gift,
  GitBranch,
  GraduationCap,
  Hand,
  Handshake,
  Heart,
  Hourglass,
  Keyboard,
  LayoutDashboard,
  LayoutTemplate,
  Lightbulb,
  Medal,
  Megaphone,
  Milk,
  Moon,
  Network,
  Notebook,
  PenLine,
  PenTool,
  Pi,
  Presentation,
  Rabbit,
  Repeat,
  RefreshCw,
  Route,
  Scale,
  School,
  ScrollText,
  Search,
  Settings,
  Shield,
  Sigma,
  Skull,
  Sparkles,
  Swords,
  Table,
  Tag,
  Target,
  Ticket,
  Timer,
  TreePine,
  TriangleAlert,
  Trophy,
  Type,
  UserRound,
  Users,
  UserSearch,
  Utensils,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react';

/**
 * 图标唯一真源（界面全程禁止 emoji）。
 * 映射轴：id 特化 > role 细分 > category 兜底。
 */

export type { LucideIcon };

/** 统一描边与默认尺寸的图标渲染（页面直接用 Lucide 组件时也应传 strokeWidth） */
export function Icon({
  icon: C,
  className = 'size-4',
  strokeWidth = 1.75,
}: {
  icon: LucideIcon;
  className?: string;
  strokeWidth?: number;
}): JSX.Element {
  return <C className={className} strokeWidth={strokeWidth} aria-hidden />;
}

// ---------------------------------------------------------------------------
// 导航
// ---------------------------------------------------------------------------

export const NAV_ICON = {
  overview: LayoutDashboard,
  students: Users,
  training: Dumbbell,
  backpack: Notebook,
  academy: GraduationCap,
  lecture: Presentation,
  problems: PenTool,
  adventure: Compass,
  story: ScrollText,
  pvp: Swords,
  admin: Shield,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

/** 六维与三能力：同时也是对应科目书籍的图标 */
export const DIMENSION_ICON: Record<string, LucideIcon> = {
  DS: Boxes,
  DP: GitBranch,
  MATH: Sigma,
  GRAPH: Network,
  GREEDY: Zap,
  STRING: Type,
  CODING: Code,
  THINKING: Brain,
  PROBLEM: PenTool,
};

export const BOOK_SUBJECT_ICON: Record<string, LucideIcon> = {
  ds: Boxes,
  dp: GitBranch,
  math: Sigma,
  graph: Network,
  greedy: Zap,
  string: Type,
  thinking: Brain,
  coding: Code,
  setting: PenTool,
};

export const ITEM_CATEGORY_ICON: Record<string, LucideIcon> = {
  nurture: Sparkles,
  book: BookOpen,
  functional: Wrench,
  contest: Trophy,
  quest: ScrollText,
  material: Boxes,
};

/** id 特化（优先级最高） */
export const ITEM_ICON: Record<string, LucideIcon> = {
  'advance-stone': Gem,
  'reroll-ticket': RefreshCw,
  'reroll-shard': RefreshCw,
  'direction-charm': Compass,
  'rename-card': PenLine,
  'calm-pill': Heart,
  'vigor-drink': Zap,
  'stamina-potion': Zap,
  'drumstick-bento': Utensils,
  'milk-tea': Milk,
  coffee: Coffee,
  'focus-engine': Brain,
  'vitality-core': Battery,
  firewall: Shield,
  'spare-cable': Shield,
  'circuit-board': Cpu,
  'tag-card': Tag,
  'entry-ticket': Ticket,
  'legend-box': Gift,
  'intel-slip': Search,
  'recruit-clue': UserSearch,
  'badge-legend': Medal,
  'color-shard': Sparkles,
  'double-card': Blocks,
  'protection-card': Shield,
  'energy-bar': BatteryCharging,
  'lucky-coin': Coins,
  'spotlight-pass': Megaphone,
  'trophy-champion': Trophy,
  'trophy-gold': Medal,
  'sponsor-contract': FileSignature,
  'coach-contact': Contact,
  'crypto-core': Gem,
  'old-note-page': ScrollText,
  'purple-book-voucher': Ticket,
  'lecture-handout': Presentation,
};

export function itemIcon(itemId: string, category?: string): LucideIcon {
  const direct = ITEM_ICON[itemId];
  if (direct) return direct;
  const book = /^book-([a-z]+)-/.exec(itemId);
  if (book) {
    const bySubject = BOOK_SUBJECT_ICON[book[1]!];
    if (bySubject) return bySubject;
  }
  return ITEM_CATEGORY_ICON[category ?? ''] ?? Boxes;
}

/** 道具是否有值得点亮的光效（灰档保持沉默，彩档走流动渐变） */
export function itemIsLit(rarity: string): boolean {
  return rarity !== 'GRAY' && rarity !== 'gray';
}

// ---------------------------------------------------------------------------
// 天赋
// ---------------------------------------------------------------------------

export const TALENT_FAMILY_ICON: Record<string, LucideIcon> = {
  memo: Archive,
  tabu: Table,
  sense: Sigma,
  construct: Blocks,
  hack: Scale,
  guess: Lightbulb,
  const: Gauge,
  heur: Dices,
  type: Keyboard,
  tmpl: LayoutTemplate,
  lect: Presentation,
  grind: Dumbbell,
  seg: TreePine,
  numth: Pi,
  dij: Route,
  greed: Rabbit,
  kmp: Repeat,
  zeron: Skull,
  oob: TriangleAlert,
  proc: Hourglass,
  clum: Hand,
  insom: Moon,
  wrong: Bug,
};

export function talentIcon(family: string | null, kind: string): LucideIcon {
  if (family) {
    const byFamily = TALENT_FAMILY_ICON[family];
    if (byFamily) return byFamily;
  }
  return kind === 'negative' ? Skull : Sparkles;
}

// ---------------------------------------------------------------------------
// 竞赛与判定
// ---------------------------------------------------------------------------

export const VERDICT_ICON: Record<string, LucideIcon> = {
  AC: CircleCheck,
  WA: CircleX,
  TLE: Timer,
  SKIP: BatteryWarning,
  UNFINISHED: CircleSlash,
};

export function verdictIcon(raw: string): LucideIcon {
  return VERDICT_ICON[raw] ?? CircleHelp;
}

export const VERDICT_CLS: Record<string, string> = {
  AC: 'text-good-400',
  WA: 'text-bad-400',
  TLE: 'text-warn-400',
  SKIP: 'text-fg-dim',
  UNFINISHED: 'text-fg-dim',
};

export function verdictCls(raw: string): string {
  return VERDICT_CLS[raw] ?? 'text-fg-dim';
}

// ---------------------------------------------------------------------------
// 历练事件六类
// ---------------------------------------------------------------------------

export const EVENT_CATEGORY_ICON: Record<string, LucideIcon> = {
  duel: Swords,
  windfall: Clover,
  trial: Target,
  chance: Compass,
  trouble: TriangleAlert,
  social: Handshake,
};

export function eventCategoryIcon(raw: string): LucideIcon {
  return EVENT_CATEGORY_ICON[raw] ?? Compass;
}

// ---------------------------------------------------------------------------
// 其余高频图标（避免各页重复 import lucide）
// ---------------------------------------------------------------------------

export const GLYPH = {
  money: Coins,
  reputation: Medal,
  stamina: Flame,
  energy: Battery,
  clock: CalendarClock,
  rank: Trophy,
  student: UserRound,
  school: School,
  arrowLeft: ArrowLeft,
  wallet: Wallet,
} satisfies Record<string, LucideIcon>;
