import { useNavigate, useParams } from 'react-router';
import type { ContestReport } from '@oinur/shared';
import { useContestRecord } from '../../lib/hooks';

export function RecordReportPage() {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const query = useContestRecord(recordId);

  if (query.isPending) return <p className="text-neutral-500">加载战报…</p>;
  if (query.isError || query.data === undefined)
    return <p className="text-red-600">战报不存在或无权访问。</p>;

  const record = query.data;
  const report = record.report;

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
        <button
          type="button"
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
          onClick={() => navigate('/story')}
        >
          返回剧情
        </button>
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
                <p key={`${reward.type}-${index}`}>
                  {reward.type === 'first_clear_money' || reward.type === 'rank_bonus_money'
                    ? `金币 +${reward.amount}`
                    : `${reward.itemId} ×${reward.count}`}
                </p>
              ))}
              {report.growth.map((growth, index) => (
                <p key={`${growth.attr}-${index}`}>
                  {growth.attr} +{growth.delta}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function RankingReport({ report }: { report: Extract<ContestReport, { format: 'RANKING' }> }) {
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

function DuelReport({ report }: { report: Extract<ContestReport, { format: 'DUEL' }> }) {
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
