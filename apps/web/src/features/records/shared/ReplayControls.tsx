import type { JSX } from 'react';
import { ArrowLeft, FileText, Pause, Play, SkipForward } from 'lucide-react';
import { Btn } from '../../../components/ui';
import { Icon } from '../../../components/icons';
import { SPEEDS, type ReplaySpeed } from './replay';

/** 转播控制台：暂停/继续、跳过、倍速（选中态用 aria-pressed 表达语义）、战报与返回 */
export function ReplayControls({
  finished,
  paused,
  speed,
  recordId,
  onTogglePause,
  onSkip,
  onSpeedChange,
  onOpenReport,
  onReturn,
}: {
  finished: boolean;
  paused: boolean;
  speed: ReplaySpeed;
  recordId: string;
  onTogglePause: () => void;
  onSkip: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onOpenReport?: (recordId: string) => void;
  onReturn?: () => void;
}): JSX.Element {
  return (
    <section className="panel flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          size="sm"
          data-testid="replay-pause"
          aria-pressed={paused}
          disabled={finished}
          onClick={onTogglePause}
        >
          <Icon icon={paused ? Play : Pause} className="size-3.5" />
          {paused ? '继续播放' : '暂停'}
        </Btn>
        {!finished && (
          <Btn size="sm" data-testid="replay-skip" onClick={onSkip}>
            <Icon icon={SkipForward} className="size-3.5" />
            跳过回放
          </Btn>
        )}
        <div className="ml-2 flex items-center gap-1.5">
          <span className="text-[11px] text-fg-dim">倍速</span>
          <div className="flex border border-ink-600" role="group" aria-label="回放倍速">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`replay-speed-${value}x`}
                aria-pressed={speed === value}
                onClick={() => onSpeedChange(value)}
                className={`tnum px-2.5 py-1 text-xs transition-colors ${
                  speed === value
                    ? 'bg-cyber-400/20 font-semibold text-cyber-300'
                    : 'text-fg-dim hover:bg-ink-700/60 hover:text-fg'
                }`}
              >
                {value}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {finished && (onOpenReport !== undefined || onReturn !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {onOpenReport !== undefined && (
            <Btn
              size="sm"
              variant="primary"
              data-testid="replay-open-report"
              onClick={() => onOpenReport(recordId)}
            >
              <Icon icon={FileText} className="size-3.5" />
              查看完整战报
            </Btn>
          )}
          {onReturn !== undefined && (
            <Btn size="sm" data-testid="replay-back" onClick={onReturn}>
              <Icon icon={ArrowLeft} className="size-3.5" />
              返回
            </Btn>
          )}
        </div>
      )}
    </section>
  );
}
