import type { JSX } from 'react';
import type { AbilityKey, DimensionKey, QualityTier, StudentView } from '@oinur/shared';
import { TriangleAlert } from 'lucide-react';
import type { TalentDefView } from '../../lib/hooks';
import {
  DIMENSION_LABEL,
  PURIFY_CHAINS,
  QUALITY_LABEL,
  TALENT_KIND_LABEL,
  floor,
  round,
  signed,
  talentFamilyLabel,
  talentStatLabel,
} from '../../lib/labels';
import {
  QUALITY_MATERIAL,
  RARITY_BORDER,
  RARITY_GLOW,
  RARITY_ICON,
  normRarity,
  rarityLabel,
} from '../../lib/rarity';
import { Chip, Meter } from '../../components/ui';
import { Icon, talentIcon } from '../../components/icons';

/**
 * 学员视觉语言（列表卡 / 档案 / 悬浮详情共用）：
 * 六维雷达（自绘 SVG）、心态双向条（0 / 归位锚点 B / −6 焦虑反噬）、体力 5 格、天赋槽。
 * 品质档一律走 QUALITY_MATERIAL 材质层级，不复用稀有度色相。
 */

type StatField =
  | 'ds'
  | 'dp'
  | 'math'
  | 'graph'
  | 'greedy'
  | 'str'
  | 'code'
  | 'thinking'
  | 'setting';

export const SIX_DIMS: { key: DimensionKey; field: StatField }[] = [
  { key: 'DS', field: 'ds' },
  { key: 'DP', field: 'dp' },
  { key: 'MATH', field: 'math' },
  { key: 'GRAPH', field: 'graph' },
  { key: 'GREEDY', field: 'greedy' },
  { key: 'STRING', field: 'str' },
];

export const ABILITY_ROWS: { field: StatField; key: AbilityKey }[] = [
  { field: 'code', key: 'CODING' },
  { field: 'thinking', key: 'THINKING' },
  { field: 'setting', key: 'PROBLEM' },
];

/** 天赋效果模式（flat=定值 / percent=百分比）——labels.ts 暂无此表，随学员视觉就近维护 */
export const TALENT_MODE_LABEL: Record<string, string> = {
  flat: '定值',
  percent: '百分比',
};

// ---------------------------------------------------------------------------
// 心态（−10…+10 双向条）
// ---------------------------------------------------------------------------

const MINDSET_MIN = -10;
const MINDSET_SPAN = 20;
/** m ≤ −6 进入焦虑反噬（student.md §5.3） */
export const ANXIETY_THRESHOLD = -6;

function clampMindset(v: number): number {
  return Math.max(MINDSET_MIN, Math.min(MINDSET_MIN + MINDSET_SPAN, v));
}

function mindsetX(v: number): number {
  return ((clampMindset(v) - MINDSET_MIN) / MINDSET_SPAN) * 100;
}

/**
 * 个人归位锚点 B = clamp(1 + Σ[mindset flat 天赋], −10, +10)（student.md §5.1）。
 * 每日 04:00 心态向 B 回移 1 点；无相关天赋时为 +1。
 */
export function mindsetBaseline(talents: string[], defs: Map<string, TalentDefView>): number {
  let sum = 0;
  for (const id of talents) {
    for (const effect of defs.get(id)?.effects ?? []) {
      if (effect.stat === 'mindset' && effect.mode === 'flat') sum += effect.value;
    }
  }
  return clampMindset(1 + sum);
}

export function MindsetBar({
  value,
  baseline,
  compact = false,
}: {
  value: number;
  baseline: number;
  compact?: boolean;
}): JSX.Element {
  const v = round(value);
  const danger = v <= ANXIETY_THRESHOLD;
  const pos = mindsetX(v);
  return (
    <div className="w-full">
      <div
        className="relative h-2 w-full bg-ink-700"
        title={`心态 ${signed(v)} · 归位锚点 ${signed(baseline)} · 低于 ${ANXIETY_THRESHOLD} 进入焦虑反噬`}
      >
        <span
          aria-hidden
          className={`absolute inset-y-0 ${v >= 0 ? 'bg-cyber-400/80' : 'bg-bad-400/80'}`}
          style={v >= 0 ? { left: '50%', width: `${pos - 50}%` } : { left: `${pos}%`, width: `${50 - pos}%` }}
        />
        {/* 0 警戒线 */}
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-fg-faint" />
        {/* 个人归位锚点 B */}
        <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-arc-400" style={{ left: `${mindsetX(baseline)}%` }} />
        {/* −6 焦虑反噬阈值 */}
        <span
          aria-hidden
          className={`absolute -inset-y-1 w-px ${danger ? 'bg-bad-400' : 'bg-bad-400/45'}`}
          style={{ left: `${mindsetX(ANXIETY_THRESHOLD)}%` }}
        />
      </div>
      {!compact && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-fg-faint">
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-2.5 w-px bg-fg-faint" />0 警戒线
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-2.5 w-0.5 bg-arc-400" />
            归位锚点 {signed(baseline)}
          </span>
          <span className={`flex items-center gap-1 ${danger ? 'text-bad-400' : ''}`}>
            <span aria-hidden className="h-2.5 w-px bg-bad-400" />
            {ANXIETY_THRESHOLD} 焦虑反噬
          </span>
        </div>
      )}
      {danger && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-bad-400">
          <Icon icon={TriangleAlert} className="size-3" />
          已进入焦虑反噬：做题时专注持续流失
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 体力（5 格 + staminaRegen 回充节奏）
// ---------------------------------------------------------------------------

/** 单点回充间隔（分钟）= 45 × 50 / stamina_regen（student.md §7） */
export function staminaIntervalMin(regen: number): number {
  return Math.round((45 * 50) / Math.max(1, regen));
}

export function StaminaCells({ stamina, className = '' }: { stamina: number; className?: string }): JSX.Element {
  const value = Math.max(0, Math.min(5, stamina));
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={`体力 ${floor(value)}/5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} aria-hidden className="relative block h-2 w-4 border border-ink-500/80 bg-ink-850">
            <span
              className="absolute inset-y-0 left-0 bg-warn-400/80 transition-[width] duration-500"
              style={{ width: `${fill * 100}%` }}
            />
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 六维雷达（自绘，不引图表库）
// ---------------------------------------------------------------------------

const RADAR_R = 34;
/** 六维条 / 雷达共用：中前期按 30 起量，成长后跟最高维走，封顶 100 */
export function statScale(values: number[]): number {
  return Math.min(100, Math.max(30, ...values));
}

const RADAR_SHORT: Record<(typeof SIX_DIMS)[number]['key'], string> = {
  DS: '数据',
  DP: '动态',
  MATH: '数学',
  GRAPH: '图论',
  GREEDY: '贪心',
  STRING: '字符',
};

/** 百分比效果值（带符号，负值用真减号） */
function signedPercent(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;
}

function radarXY(index: number, ratio: number): [number, number] {
  const angle = ((index * 60 - 90) * Math.PI) / 180;
  return [50 + Math.cos(angle) * RADAR_R * ratio, 50 + Math.sin(angle) * RADAR_R * ratio];
}

function radarRing(ratio: number): string {
  return SIX_DIMS.map((_, i) => radarXY(i, ratio).map((n) => n.toFixed(1)).join(',')).join(' ');
}

function radarLabel(s: StudentView): string {
  return SIX_DIMS.map((d) => `${DIMENSION_LABEL[d.key]} ${floor(s[d.field])}`).join('、');
}

export function RadarChart({
  s,
  size = 96,
  className = '',
}: {
  s: StudentView;
  size?: number;
  className?: string;
}): JSX.Element {
  // 量程随学员成长动态变化（下限 30）：按 100 归一化会让中前期学员的雷达缩成一个点
  const values = SIX_DIMS.map((d) => s[d.field]);
  const scale = statScale(values);
  const ratios = values.map((v) => Math.max(0, Math.min(1, v / scale)));
  return (
    <svg
      viewBox="-12 -10 124 120"
      width={size}
      height={size}
      role="img"
      aria-label={`六维雷达：${radarLabel(s)}`}
      className={`shrink-0 ${className}`}
    >
      <polygon points={radarRing(1)} className="fill-cyber-400/[0.04] stroke-ink-500" strokeWidth={0.6} />
      <polygon points={radarRing(0.5)} className="fill-none stroke-ink-600" strokeWidth={0.4} />
      {SIX_DIMS.map((dim, i) => {
        const [x, y] = radarXY(i, 1);
        return (
          <line key={dim.key} x1={50} y1={50} x2={x} y2={y} className="stroke-ink-600" strokeWidth={0.4} />
        );
      })}
      <polygon
        points={ratios.map((r, i) => radarXY(i, r).map((n) => n.toFixed(1)).join(',')).join(' ')}
        className="fill-cyber-400/15 stroke-cyber-400"
        strokeWidth={1}
        strokeLinejoin="round"
      />
      {ratios.map((r, i) => {
        const [x, y] = radarXY(i, r);
        return <circle key={SIX_DIMS[i].key} cx={x} cy={y} r={1.3} className="fill-cyber-300" />;
      })}
      {SIX_DIMS.map((dim, i) => {
        const [x, y] = radarXY(i, 1.32);
        return (
          <text
            key={dim.key}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-fg-dim"
            fontSize={7}
          >
            {RADAR_SHORT[dim.key]}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 品质档（材质层级，不复用稀有度色相）
// ---------------------------------------------------------------------------

export function QualityBadge({ tier, className = '' }: { tier: QualityTier; className?: string }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 text-[11px] text-fg-muted ${QUALITY_MATERIAL[tier]} ${className}`}
    >
      {QUALITY_LABEL[tier]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 天赋槽
// ---------------------------------------------------------------------------

export function TalentSlot({ def }: { def: TalentDefView }): JSX.Element {
  const rarity = normRarity(def.rarity);
  const purifying = def.family !== null && PURIFY_CHAINS.has(def.family);
  return (
    <div className="flex gap-3 border border-ink-600 bg-ink-850/40 px-3 py-2.5">
      <span
        className={`grid size-10 shrink-0 place-items-center border bg-ink-900/70 ${RARITY_BORDER[rarity]} ${RARITY_GLOW[rarity]} ${
          rarity === 'RAINBOW' ? 'animate-rainbow-halo' : ''
        }`}
      >
        <Icon icon={talentIcon(def.family, def.kind)} className={`size-4 ${RARITY_ICON[rarity]}`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-fg">{def.name}</span>
          <Chip>{rarityLabel(def.rarity)}</Chip>
          <Chip>{TALENT_KIND_LABEL[def.kind]}</Chip>
          <Chip>{talentFamilyLabel(def.family)}</Chip>
          {purifying && (
            <Chip className="border-rarity-yellow/50 text-rarity-yellow">
              {rarity === 'YELLOW' ? '净化链 · 终点' : '净化链 · 可炼至黄级'}
            </Chip>
          )}
        </div>
        <p className="mt-1 text-xs text-fg-muted">{def.description}</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
          {def.effects.map((effect, i) => (
            <li key={`${effect.stat}-${i}`} className="text-[11px] text-fg-dim">
              {talentStatLabel(effect.stat)}
              <span className="ml-1 text-fg-faint">{TALENT_MODE_LABEL[effect.mode] ?? '修正'}</span>
              <span className="ml-1.5 font-mono text-fg">
                {effect.mode === 'percent' ? signedPercent(effect.value) : signed(effect.value)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 悬浮详情（列表 / 总览用：迷你雷达 + 六维 + 天赋 + 体力）
// ---------------------------------------------------------------------------

export function StudentHover({
  s,
  defs,
}: {
  s: StudentView;
  defs: Map<string, TalentDefView>;
}): JSX.Element {
  const baseline = mindsetBaseline(s.talents, defs);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-fg">{s.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <QualityBadge tier={s.qualityTier} />
        </span>
      </div>
      <div className="flex gap-3">
        <RadarChart s={s} size={84} />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
          {SIX_DIMS.map((dim) => (
            <span key={dim.key} className="flex items-baseline justify-between gap-1 text-fg-dim">
              <span className="truncate">{DIMENSION_LABEL[dim.key]}</span>
              <span className="font-mono text-fg">{floor(s[dim.field])}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1 border-t border-ink-600/70 pt-2 text-[11px] text-fg-dim">
        <div className="flex items-center justify-between gap-2">
          <span>体力</span>
          <span className="flex items-center gap-1.5">
            <StaminaCells stamina={s.stamina} />
            <span className="font-mono text-fg-muted">{floor(s.stamina)}/5</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>精力</span>
          <span className="font-mono text-fg-muted">
            {floor(s.energy)}/{floor(s.energyMax)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>心态</span>
          <span className="flex w-24 items-center gap-1.5">
            <MindsetBar value={s.mindset} baseline={baseline} compact />
            <span className="w-6 shrink-0 text-right font-mono text-fg-muted">{signed(round(s.mindset))}</span>
          </span>
        </div>
      </div>
      {s.talents.length > 0 && (
        <ul className="space-y-1 border-t border-ink-600/70 pt-2">
          {s.talents.map((id) => {
            const def = defs.get(id);
            return (
              <li key={id} className="flex items-center gap-1.5 text-[11px]">
                <Icon
                  icon={talentIcon(def?.family ?? null, def?.kind ?? 'positive')}
                  className={`size-3.5 ${def ? RARITY_ICON[def.rarity] : 'text-fg-dim'}`}
                />
                <span className={def ? 'text-fg-muted' : 'text-fg-faint'}>{def?.name ?? '未知天赋'}</span>
                {def !== undefined && (
                  <span className="ml-auto font-mono text-[10px] text-fg-faint">
                    {rarityLabel(def.rarity)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 六维迷你条（列表卡）
// ---------------------------------------------------------------------------

export function DimBars({ s, className = '' }: { s: StudentView; className?: string }): JSX.Element {
  const scale = statScale(SIX_DIMS.map((d) => s[d.field]));
  return (
    <div className={`grid grid-cols-2 gap-x-3 gap-y-1.5 ${className}`}>
      {SIX_DIMS.map((dim) => (
        <div key={dim.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-1 text-[10px]">
            <span className="truncate text-fg-faint">{DIMENSION_LABEL[dim.key]}</span>
            <span className="font-mono text-fg-muted">{floor(s[dim.field])}</span>
          </div>
          <Meter value={s[dim.field]} max={scale} className="bg-cyber-400/70" trackClassName="bg-ink-700/80" />
        </div>
      ))}
    </div>
  );
}
