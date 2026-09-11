import { useEffect, useState, type JSX } from 'react';
import { ApiCallError, apiErrorMessage } from '../../lib/api';
import {
  QUALITY_LABEL,
  SEX_LABEL,
  floor,
  rarityBadge,
  useAcademyPool,
  useRecruit,
  useRefreshPool,
} from '../../lib/hooks';
import type { CandidatePayload, PoolView } from '../../lib/hooks';
import { Empty } from '../../components/ui';

const FREE_REFRESH_HOURS = 24; // 免费刷新间隔（economy.yaml；服务器权威，此处仅展示倒计时）
const HOUR_MS = 3_600_000;

function fmtRemaining(ms: number): string {
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.floor((ms % HOUR_MS) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

export function AcademyPage(): JSX.Element {
  const q = useAcademyPool();
  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        正在刷新招募候选池…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>招募池加载失败：{apiErrorMessage(q.error)}</p>
        <button className="rounded border px-3 py-1 text-xs" onClick={() => void q.refetch()}>
          重试
        </button>
      </div>
    );
  }
  return <AcademyBody pool={q.data} />;
}

function AcademyBody({ pool }: { pool: PoolView }): JSX.Element {
  const refresh = useRefreshPool();
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const freeAt = new Date(pool.generatedAt).getTime() + FREE_REFRESH_HOURS * HOUR_MS;
  const freeLeftMs = Math.max(0, freeAt - now);
  const freeReady = freeLeftMs === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">高级学院</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-500">
            {freeReady ? '免费刷新已就绪' : `免费刷新时间 ${fmtRemaining(freeLeftMs)}`}
          </span>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-60"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(undefined, { onError: (e) => setMsg(errText(e)) })}
            data-testid="refresh-pool"
            title="手动刷新消耗金币"
          >
            刷新（{pool.refreshPrice} 金）
          </button>
        </div>
      </div>

      {msg && (
        <p data-testid="pool-msg" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {msg}
        </p>
      )}

      {pool.candidates.length === 0 ? (
        <Empty icon="🧑‍💻" title="候选池暂时没有学员">
          可以稍后等免费刷新，或立即花金币手动刷新。
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pool.candidates.map((c) => (
            <CandidateCard key={c.tempId} c={c} onError={setMsg} />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  c,
  onError,
}: {
  c: CandidatePayload;
  onError: (err: string | null) => void;
}): JSX.Element {
  const recruit = useRecruit();
  return (
    <div data-testid="candidate-card" data-tempid={c.tempId} className="rounded border bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">
          {c.name} <span className="text-xs text-neutral-400">{SEX_LABEL[c.sex]}</span>
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${qualityBadge(c.qualityTier)}`}>
          {QUALITY_LABEL[c.qualityTier]}
        </span>
      </div>
      <p className="mb-2 text-xs text-neutral-500">{c.hint}</p>
      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-neutral-500">
        {Object.entries(attrRows(c)).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span>{k}</span>
            <span className="tabular-nums">{floor(v)}</span>
          </div>
        ))}
      </div>
      <p className="mb-3 text-xs text-neutral-400">
        天赋：{c.talents.length > 0 ? c.talents.map((t) => t.talentId).join(', ') : '无'}
      </p>
      <button
        data-testid="recruit-btn"
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60"
        disabled={recruit.isPending}
        onClick={() =>
          recruit.mutate(c.tempId, {
            onSuccess: () => onError(null),
            onError: (e) => onError(errText(e)),
          })
        }
      >
        招募（{c.price} 金）
      </button>
    </div>
  );
}

function attrRows(c: CandidatePayload): Record<string, number> {
  return {
    数据: c.attrs.ds,
    动态: c.attrs.dp,
    数学: c.attrs.math,
    图论: c.attrs.graph,
    贪心: c.attrs.greedy,
    字符串: c.attrs.str,
    代码: c.attrs.code,
    思维: c.attrs.thinking,
    出题: c.attrs.setting,
  };
}

function qualityBadge(t: CandidatePayload['qualityTier']): string {
  switch (t) {
    case 'COMMON':
      return rarityBadge('GRAY');
    case 'GOOD':
      return rarityBadge('YELLOW');
    case 'ELITE':
      return rarityBadge('GREEN');
    case 'GENIUS':
      return rarityBadge('PURPLE');
    default:
      return rarityBadge('GRAY');
  }
}

function errText(e: unknown): string {
  if (e instanceof ApiCallError && e.code === 'INSUFFICIENT_RESOURCE') return '金币不足';
  return apiErrorMessage(e);
}
