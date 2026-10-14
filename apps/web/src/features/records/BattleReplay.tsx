import type { JSX } from 'react';
import { Swords } from 'lucide-react';
import { Icon } from '../../components/icons';
import { hasMemberIndex, type ReplayViewProps } from './shared/replay';
import { RankingParallelReplay } from './ranking/RankingParallelReplay';
import { DuelReplay } from './duel/DuelReplay';

/** 战斗等待屏：剧情进入 / 历练结算 / 战报路由三处共用 */
export function BattleWaiting({
  label = '服务端正在模拟战斗，获取回放中…',
}: {
  label?: string;
}): JSX.Element {
  return (
    <div className="mx-auto flex min-h-[360px] max-w-3xl items-center justify-center">
      <section className="panel panel-corners w-full px-6 py-12 text-center">
        <span className="relative mx-auto flex size-12 items-center justify-center">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-ink-600 border-t-cyber-400" />
          <Icon icon={Swords} className="size-5 text-cyber-400" />
        </span>
        <h1 className="mt-5 text-xl font-semibold">正在准备战斗</h1>
        <p className="mt-2 text-sm text-fg-muted">{label}</p>
        <p className="mt-1 text-xs text-fg-faint">回放送达后自动开始转播。</p>
      </section>
    </div>
  );
}

/** 回放入口：排名赛并行视图 / 单面板转播二选一，原样转发外部回调 */
export function BattleReplay({
  replay,
  onOpenReport,
  onReturn,
  onFinished,
}: ReplayViewProps): JSX.Element {
  if (replay.events.length === 0) {
    return (
      <section className="panel px-5 py-8 text-center text-sm text-fg-muted">
        本场没有可播放的回放事件。
      </section>
    );
  }
  if (replay.format === 'RANKING' && hasMemberIndex(replay)) {
    return (
      <RankingParallelReplay
        replay={replay}
        onOpenReport={onOpenReport}
        onReturn={onReturn}
        onFinished={onFinished}
      />
    );
  }
  return (
    <DuelReplay
      replay={replay}
      onOpenReport={onOpenReport}
      onReturn={onReturn}
      onFinished={onFinished}
    />
  );
}
