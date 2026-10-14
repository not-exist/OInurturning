import { useEffect, useState, type JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Share2 } from 'lucide-react';
import type { ContestRecordView } from '@oinur/shared';
import { Btn, ErrorNote, PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { CONTEST_FORMAT_LABEL, CONTEST_RECORD_TYPE_LABEL, tierLabel } from '../../lib/labels';
import { useContestRecord, useContestReplay } from '../../lib/hooks';
import { BattleReplay, BattleWaiting } from './BattleReplay';
import { growthText, rewardLineText, useItemName } from './shared/rewards';
import { RankingReport, teamName } from './ranking/RankingReport';
import { DuelReport } from './duel/DuelReport';

const BACK_TARGET: Record<ContestRecordView['type'], { to: string; label: string }> = {
  STORY: { to: '/story', label: '返回剧情' },
  ADVENTURE: { to: '/adventure', label: '返回历练' },
  PVP: { to: '/pvp', label: '返回 PVP' },
};

/** 关卡行：stageKey（如 cspj:1）翻成「CSP-J 第 1 关」；无法解析时只显示记录类型 */
function stageLine(record: ContestRecordView): string {
  const typeLabel = CONTEST_RECORD_TYPE_LABEL[record.type] ?? '对局';
  if (record.stageKey === null) return typeLabel;
  const [tier, stage] = record.stageKey.split(':');
  if (tier === undefined || stage === undefined) return typeLabel;
  return `${typeLabel} · ${tierLabel(tier)} 第 ${stage} 关`;
}

/** 分享文案：纯文本摘要，不含任何调试元数据 */
function buildShareText(record: ContestRecordView): string {
  const report = record.report;
  const lines = [
    report.format === 'RANKING' ? '【OI 战报 · 排名赛】' : '【OI 战报 · 出题对决】',
    `${stageLine(record)} · ${new Date(record.createdAt).toLocaleString()}`,
  ];
  if (report.format === 'RANKING') {
    const standing = report.standings.find((entry) => entry.teamIndex === 0);
    const playerTeam = report.teams[0];
    lines.push(
      `${playerTeam === undefined ? '我方' : teamName(playerTeam)} 出战：第 ${standing?.rank ?? '—'} 名 / ${report.teams.length} 支队伍 · 总分 ${standing?.totalScore ?? 0} · ${report.pass ? '达成通关线' : '未达通关线'}`,
    );
  } else {
    const winner =
      report.winnerSide === 'HOME' ? '我方胜' : report.winnerSide === 'AWAY' ? '对手胜' : '平局';
    lines.push(`比分 ${report.scores.home} : ${report.scores.away} · ${winner}`);
  }
  const url =
    typeof window === 'undefined'
      ? `/records/${record.id}`
      : `${window.location.origin}/records/${record.id}`;
  lines.push('', `完整战报：${url}`);
  return lines.join('\n');
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

/** 调试元数据只进折叠区，不上主视 */
function TechDetails({ record }: { record: ContestRecordView }): JSX.Element {
  const report = record.report;
  return (
    <details className="panel px-4 py-2.5 text-xs">
      <summary className="cursor-pointer text-fg-dim">技术详情</summary>
      <dl className="mt-2 grid gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-faint">回放记录</dt>
          <dd className="truncate text-fg-muted">{record.id}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-faint">战报版本</dt>
          <dd className="tnum text-fg-muted">{report.reportVersion}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-faint">引擎版本</dt>
          <dd className="truncate text-fg-muted">{report.engineVersion}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-faint">随机源</dt>
          <dd className="truncate text-fg-muted">{report.rngVersion}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-faint">随机种子</dt>
          <dd className="tnum text-fg-muted">{report.seed}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-faint">快照校验</dt>
          <dd className="tnum truncate text-fg-muted">{report.snapshotHash}</dd>
        </div>
      </dl>
    </details>
  );
}

export function RecordReportPage(): JSX.Element {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const detailsOnly = searchParams.get('details') === '1';
  const query = useContestRecord(recordId);
  const replayQuery = useContestReplay(recordId, !detailsOnly);
  const [replayFinished, setReplayFinished] = useState(detailsOnly);
  const [shared, setShared] = useState(false);
  const itemName = useItemName();

  useEffect(() => {
    setReplayFinished(detailsOnly);
    setShared(false);
  }, [detailsOnly, recordId]);

  if (query.isPending || (!detailsOnly && replayQuery.isPending)) {
    return <BattleWaiting label={detailsOnly ? '正在取回完整战报…' : '服务端正在传回战斗回放…'} />;
  }

  if (
    query.isError ||
    query.data === undefined ||
    (!detailsOnly && (replayQuery.isError || replayQuery.data === undefined))
  ) {
    const replayFailed = !detailsOnly && replayQuery.isError;
    return (
      <div className="mx-auto max-w-3xl space-y-3 py-10">
        <h1 className="text-xl font-semibold">战报不可用</h1>
        <ErrorNote
          onRetry={() => {
            void query.refetch();
            if (!detailsOnly) void replayQuery.refetch();
          }}
        >
          {replayFailed ? '战斗回放加载失败。' : '战报不存在、已失效或无权访问。'}
        </ErrorNote>
      </div>
    );
  }

  if (!detailsOnly && !replayFinished && replayQuery.data !== undefined) {
    return <BattleReplay replay={replayQuery.data} onFinished={() => setReplayFinished(true)} />;
  }

  const record = query.data;
  const report = record.report;
  const back = BACK_TARGET[record.type] ?? BACK_TARGET.STORY;
  const rewards = record.rewards.length > 0 ? record.rewards : report.rewards;
  const growth = report.growth;

  async function share(): Promise<void> {
    try {
      await copyText(buildShareText(record));
      setShared(true);
    } catch {
      // 分享失败不打断浏览
      setShared(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow={`${CONTEST_RECORD_TYPE_LABEL[record.type]} · ${CONTEST_FORMAT_LABEL[report.format]}`}
        title={report.format === 'RANKING' ? '排名赛战报' : '出题对决战报'}
        description={`${stageLine(record)} · ${new Date(record.createdAt).toLocaleString()}`}
        actions={
          <>
            {shared && <span className="text-xs text-good-400">分享文案已复制</span>}
            <Btn variant="primary" data-testid="record-share" onClick={() => void share()}>
              <Icon icon={Share2} className="size-3.5" />
              分享战报
            </Btn>
            <Btn data-testid="record-back" onClick={() => navigate(back.to)}>
              <Icon icon={ArrowLeft} className="size-3.5" />
              {back.label}
            </Btn>
          </>
        }
      />

      <TechDetails record={record} />

      {report.format === 'RANKING' ? (
        <RankingReport report={report} />
      ) : (
        <DuelReport report={report} />
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">结算</h2>
        {rewards.length === 0 && growth.length === 0 ? (
          <p className="panel px-4 py-3 text-sm text-fg-dim">本场无额外奖励。</p>
        ) : (
          <ul className="panel divide-y divide-ink-600/50 px-4 py-1">
            {rewards.map((reward, index) => (
              <li
                key={`${reward.type}-${index}`}
                className="flex items-center gap-2 py-2 text-sm text-fg-muted"
              >
                {rewardLineText(reward, itemName)}
              </li>
            ))}
            {growth.map((entry, index) => (
              <li key={`${entry.attr}-${index}`} className="py-2 text-sm text-good-400">
                实战成长 · {growthText(entry)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
