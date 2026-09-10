import { useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ContestRecordView, ContestReport, RewardLine } from '@oinur/shared';
import { useContestRecord } from '../../lib/hooks';

const BACK_TARGET: Record<ContestRecordView['type'], { to: string; label: string }> = {
  STORY: { to: '/story', label: '返回剧情' },
  ADVENTURE: { to: '/adventure', label: '返回历练' },
  PVP: { to: '/pvp', label: '返回 PVP' },
};

export function RecordReportPage(): JSX.Element {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const query = useContestRecord(recordId);
  const [copied, setCopied] = useState(false);

  if (query.isPending) return <p className="text-neutral-500">加载战报…</p>;
  if (query.isError || query.data === undefined) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>战报不存在、已失效或无权访问。</p>
        <button className="rounded border px-3 py-1 text-xs" onClick={() => void query.refetch()}>
          重试
        </button>
      </div>
    );
  }

  const record = query.data;
  const report = record.report;
  const back = BACK_TARGET[record.type] ?? BACK_TARGET.STORY;

  async function share(): Promise<void> {
    const text = buildShareText(record);
    const shareData = { title: 'OInurturning 战报', text };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setCopied(true);
      } else {
        await copyText(text);
        setCopied(true);
      }
    } catch {
      // 用户取消分享或复制失败，不打断浏览
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Contest Report
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {report.format === 'RANKING' ? '排名赛战报' : '出题对决战报'}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {record.stageKey ?? record.type} · {record.createdAt}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {copied && <span className="text-xs text-green-700">分享文案已复制 ✓</span>}
          <button
            type="button"
            className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60"
            onClick={() => void share()}
          >
            分享战报
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
            onClick={() => navigate(back.to)}
          >
            {back.label}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-b pb-4 text-xs text-neutral-500">
        <span>Engine {report.engineVersion}</span>
        <span>RNG {report.rngVersion}</span>
        <span>Seed {report.seed}</span>
        <span>Snapshot {report.snapshotHash}</span>
      </div>

      {report.format === 'RANKING' ? (
        <RankingReport report={report} />
      ) : (
        <DuelReport report={report} />
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">结算</h2>
        <div className="rounded border border-neutral-200 bg-white px-4 py-3 text-sm">
          {report.rewards.length === 0 && report.growth.length === 0 ? (
            <p className="text-neutral-500">本场无额外奖励。</p>
          ) : (
            <div className="space-y-2">
              {report.rewards.map((reward, index) => (
                <p key={`${reward.type}-${index}`}>{rewardLineText(reward)}</p>
              ))}
              {report.growth.map((growth, index) => (
                <p key={`${growth.attr}-${index}`}>
                  实战成长：{growth.attr} +{growth.delta}
                  {growth.sourceProblem ? `（${growth.sourceProblem}）` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function rewardLineText(reward: RewardLine): string {
  switch (reward.type) {
    case 'first_clear_money':
      return `首通奖金：金币 +${reward.amount}`;
    case 'first_clear_item':
      return `首通道具：${reward.itemId} ×${reward.count}`;
    case 'milestone_item':
      return `章节里程碑：${reward.itemId} ×${reward.count}`;
    case 'rank_bonus_money':
      return `名次奖金（#${reward.rank}）：金币 +${reward.amount}`;
  }
}

/** 生成可粘贴/分享的战报文案（不依赖登录态外链，纯文本摘要） */
function buildShareText(record: ContestRecordView): string {
  const report = record.report;
  const title = report.format === 'RANKING' ? '【OI 战报·排名赛】' : '【OI 战报·出题对决】';
  const when = new Date(record.createdAt).toLocaleString();
  const where = record.stageKey ?? record.type;
  const id = record.id;
  const url =
    typeof window !== 'undefined' ? `${window.location.origin}/records/${id}` : `/records/${id}`;

  const lines: string[] = [title];
  if (report.format === 'RANKING') {
    const player = report.participants[0]?.participant.displayName ?? '我方';
    const standing = report.standings.find((entry) => entry.participantIndex === 0);
    const rank = standing?.rank ?? '-';
    const total = standing?.totalScore ?? 0;
    const count = report.standings.length;
    lines.push(`${where} · ${when}`);
    lines.push(
      `${player} 出战：最终第 ${rank} 名 / ${count} 人，总分 ${total}，${report.pass ? '达成通关线 ✅' : '未达通关线 ❌'}`,
    );
    const playerAttempts = report.participants[0]?.attempts ?? [];
    const ac = playerAttempts.filter((attempt) => attempt.verdict === 'AC').length;
    const skipped = playerAttempts.filter((attempt) => attempt.verdict === 'SKIP').length;
    const unfinished = playerAttempts.filter((attempt) => attempt.verdict === 'UNFINISHED').length;
    const detail = [`AC ${ac}`];
    if (skipped > 0) detail.push(`跳过 ${skipped}`);
    if (unfinished > 0) detail.push(`未完成 ${unfinished}`);
    lines.push(`答题：${detail.join(' / ')}`);
  } else {
    const winner = report.winnerSide === 'HOME' ? '主场' : '客场';
    lines.push(`${where} · ${when}`);
    lines.push(`对决结果：主场 ${report.scores.home} : ${report.scores.away} 客场 · ${winner}胜`);
    const rounds = report.rounds
      .map(
        (round) =>
          `第${round.roundNo}局 ${round.setterSide}出题→${round.answererSide}：${round.reason}（+${round.scoreAwarded}）`,
      )
      .join('；');
    lines.push(`对局：${rounds}`);
  }

  const rewardCount = record.summary?.rewards?.length ?? report.rewards.length;
  if (rewardCount > 0) {
    const rewardsText = (record.summary?.rewards ?? report.rewards)
      .map((reward) => rewardLineText(reward))
      .join('；');
    lines.push(`奖励：${rewardsText}`);
  }
  lines.push('');
  lines.push(
    `Engine ${report.engineVersion} · RNG ${report.rngVersion} · Seed ${report.seed} · Snapshot ${report.snapshotHash}`,
  );
  lines.push(`完整战报：${url}`);
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

function RankingReport({
  report,
}: {
  report: Extract<ContestReport, { format: 'RANKING' }>;
}): JSX.Element {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric
          label="排名"
          value={`#${report.standings.find((standing) => standing.participantIndex === 0)?.rank ?? '-'}`}
        />
        <Metric
          label="总分"
          value={String(
            report.standings.find((standing) => standing.participantIndex === 0)?.totalScore ?? 0,
          )}
        />
        <Metric label="参赛人数" value={String(report.participants.length)} />
        <Metric label="结果" value={report.pass ? '通过' : '未通过'} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">排名</h2>
        <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">名次</th>
                <th className="px-4 py-3">选手</th>
                <th className="px-4 py-3">分数</th>
              </tr>
            </thead>
            <tbody>
              {report.standings.map((standing) => (
                <tr key={standing.participantIndex} className="border-b last:border-b-0">
                  <td className="px-4 py-3">{standing.rank}</td>
                  <td className="px-4 py-3">
                    {report.participants[standing.participantIndex]?.participant.displayName ?? '-'}
                  </td>
                  <td className="px-4 py-3">{standing.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">答题时间线</h2>
        <div className="space-y-3">
          {report.participants.map((timeline) => (
            <div
              key={timeline.participant.displayName}
              className="overflow-x-auto rounded border border-neutral-200 bg-white"
            >
              <div className="border-b px-4 py-3 font-medium">
                {timeline.participant.displayName}
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-neutral-50 text-xs text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">题目</th>
                    <th className="px-4 py-2">结果</th>
                    <th className="px-4 py-2">用时</th>
                    <th className="px-4 py-2">精力</th>
                    <th className="px-4 py-2">心态</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.attempts.map((attempt) => (
                    <tr key={attempt.problemInstanceId} className="border-b last:border-b-0">
                      <td className="px-4 py-2">{attempt.problemInstanceId}</td>
                      <td className="px-4 py-2">{attempt.verdict}</td>
                      <td className="px-4 py-2">{Math.ceil(attempt.minutesUsed)} min</td>
                      <td className="px-4 py-2">-{attempt.energyCost}</td>
                      <td className="px-4 py-2">
                        {attempt.mindsetDelta > 0 ? '+' : ''}
                        {attempt.mindsetDelta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function DuelReport({
  report,
}: {
  report: Extract<ContestReport, { format: 'DUEL' }>;
}): JSX.Element {
  return (
    <section>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="主场" value={String(report.scores.home)} />
        <Metric label="客场" value={String(report.scores.away)} />
        <Metric label="结果" value={report.winnerSide} />
      </div>
      <div className="mt-6 overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3">局</th>
              <th className="px-4 py-3">出题方</th>
              <th className="px-4 py-3">答题方</th>
              <th className="px-4 py-3">结果</th>
              <th className="px-4 py-3">得分</th>
            </tr>
          </thead>
          <tbody>
            {report.rounds.map((round) => (
              <tr key={round.roundNo} className="border-b last:border-b-0">
                <td className="px-4 py-3">{round.roundNo}</td>
                <td className="px-4 py-3">{round.setterSide}</td>
                <td className="px-4 py-3">{round.answererSide}</td>
                <td className="px-4 py-3">{round.reason}</td>
                <td className="px-4 py-3">
                  {round.scoreAwardedTo} +{round.scoreAwarded}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded border border-neutral-200 bg-white px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
