import type { JSX, ReactNode } from 'react';
import { verdictCls, verdictIcon, Icon } from '../../../components/icons';
import { verdictLabel } from '../../../lib/labels';

/** 转播数据格：小标签 + 巨型等宽数字 */
export function Metric({
  label,
  value,
  tone = 'text-fg',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
}): JSX.Element {
  return (
    <div className="border border-ink-600/70 bg-ink-850/50 px-3 py-2">
      <p className="text-[11px] text-fg-dim">{label}</p>
      <p className={`numeral tnum mt-0.5 text-lg ${tone}`}>{value}</p>
    </div>
  );
}

/** 判定徽章：AC 青绿 / WA 红 / TLE 琥珀 / UNFINISHED·SKIP 灰（图标 + 中文，绝不落裸 key） */
export function VerdictBadge({
  verdict,
  className = '',
}: {
  verdict: string;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 border border-ink-600/70 bg-ink-900/60 px-1.5 py-0.5 text-[11px] font-medium ${verdictCls(verdict)} ${className}`}
    >
      <Icon icon={verdictIcon(verdict)} className="size-3" />
      {verdictLabel(verdict)}
    </span>
  );
}

const STATUS_CLS = {
  live: 'border-cyber-400/50 bg-cyber-400/10 text-cyber-300',
  paused: 'border-warn-400/50 bg-warn-400/10 text-warn-400',
  done: 'border-ink-600 bg-ink-850/70 text-fg-dim',
} as const;

/** 转播状态徽：进行中 / 已暂停 / 战斗结束（语义状态，供读屏播报） */
export function ReplayStatus({
  finished,
  paused,
  runningLabel,
}: {
  finished: boolean;
  paused: boolean;
  runningLabel: string;
}): JSX.Element {
  const label = finished ? '战斗结束' : paused ? '已暂停' : runningLabel;
  const tone = finished ? STATUS_CLS.done : paused ? STATUS_CLS.paused : STATUS_CLS.live;
  return (
    <span
      role="status"
      aria-atomic="true"
      className={`inline-flex shrink-0 items-center gap-1.5 border px-2 py-1 font-mono text-[11px] tracking-wider ${tone}`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full bg-current ${finished || paused ? '' : 'animate-pulse-dot'}`}
      />
      {label}
    </span>
  );
}
