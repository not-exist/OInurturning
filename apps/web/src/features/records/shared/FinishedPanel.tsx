import type { JSX } from 'react';
import { Sparkles, Swords } from 'lucide-react';
import type { BattleReplay } from '@oinur/shared';
import { GLYPH, Icon } from '../../../components/icons';
import { Numeral } from '../../../components/ui';
import type { FinishEvent } from './replay';
import { growthText, rewardLineText, useItemName } from './rewards';

/** 名次色阶：冠军电光青，其余按名次明度递进（不借稀有度六色） */
function rankTone(rank: number | undefined): string {
  if (rank === 1) return 'text-cyber-300';
  if (rank !== undefined && rank <= 3) return 'text-cyber-500';
  return 'text-fg-muted';
}

function winnerText(finish: FinishEvent): string {
  if (finish.winnerSide === 'DRAW') return '双方握手言和';
  return finish.winnerSide === 'HOME' ? '我方拿下本场' : '对手拿下本场';
}

/** 终局结算：名次 / 比分 / 奖励与实战成长（转播的最终裁决位） */
export function FinishedPanel({
  finish,
  format,
}: {
  finish: FinishEvent | undefined;
  format: BattleReplay['format'];
}): JSX.Element {
  const itemName = useItemName();
  if (finish === undefined) {
    return <p className="text-sm text-bad-400">回放缺少最终结果事件。</p>;
  }

  return (
    <div className="animate-rise space-y-3">
      <div className="panel-corners relative border border-cyber-500/40 bg-cyber-400/5 px-5 py-6 text-center">
        {format === 'RANKING' ? (
          <>
            <p className="eyebrow">最终名次</p>
            <p className="mt-2 flex items-baseline justify-center gap-2">
              <Numeral value={finish.rank ?? '—'} className={`text-5xl ${rankTone(finish.rank)}`} />
              <span className="text-sm text-fg-dim">/ {finish.participantCount ?? '—'} 支队伍</span>
            </p>
            <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-fg-muted">
              <span>
                总分 <span className="tnum font-semibold text-fg">{finish.totalScore ?? 0}</span>
              </span>
              <span className={finish.pass ? 'text-good-400' : 'text-warn-400'}>
                <Icon icon={GLYPH.rank} className="mr-1 inline size-3.5" />
                {finish.pass ? '达成通关线' : '未达通关线'}
              </span>
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">最终比分</p>
            <p className="mt-2 flex items-center justify-center gap-4">
              <span className="tnum text-4xl font-semibold text-fg">{finish.homeScore ?? 0}</span>
              <Icon icon={Swords} className="size-5 text-fg-faint" />
              <span className="tnum text-4xl font-semibold text-fg">{finish.awayScore ?? 0}</span>
            </p>
            <p className="mt-3 text-sm text-fg-muted">{winnerText(finish)}</p>
          </>
        )}
      </div>

      {(finish.rewards.length > 0 || finish.growth.length > 0) && (
        <div className="border border-ink-600/70 bg-ink-850/50 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted">奖励与成长</h3>
          <ul className="space-y-1.5 text-xs">
            {finish.rewards.map((reward, index) => (
              <li key={`${reward.type}-${index}`} className="flex items-center gap-2 text-fg-muted">
                <Icon icon={GLYPH.money} className="size-3.5 shrink-0 text-warn-400" />
                {rewardLineText(reward, itemName)}
              </li>
            ))}
            {finish.growth.map((growth, index) => (
              <li
                key={`${growth.attr}-${index}`}
                className="flex items-center gap-2 text-good-400"
              >
                <Icon icon={Sparkles} className="size-3.5 shrink-0" />
                实战成长 · {growthText(growth)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
