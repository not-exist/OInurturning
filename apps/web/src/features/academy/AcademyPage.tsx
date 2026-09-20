import { useEffect, useRef, useState, type JSX } from 'react';
import { RefreshCw, UserSearch } from 'lucide-react';
import { ApiCallError, apiErrorMessage } from '../../lib/api';
import { useAcademyPool, useNow, useRecruit, useRefreshPool } from '../../lib/hooks';
import type { CandidatePayload, PoolView } from '../../lib/hooks';
import { SEX_LABEL, floor } from '../../lib/labels';
import { QUALITY_HINT } from '../../lib/rarity';
import { GLYPH, Icon } from '../../components/icons';
import {
  ActionLink,
  Btn,
  Card,
  Empty,
  ErrorNote,
  HoverCard,
  InlineLoader,
  Meter,
  Numeral,
  PageHeader,
  Panel,
} from '../../components/ui';

/** 免费刷新间隔（economy.recruitment.manual_refresh.free_interval_hours；服务端权威，此处仅展示倒计时） */
const FREE_REFRESH_HOURS = 24;
const HOUR_MS = 3_600_000;
/** 候选池容量（服务端 POOL_SIZE） */
const POOL_SIZE = 5;

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
  if (q.isLoading) return <InlineLoader>正在唤醒候选池…</InlineLoader>;
  if (q.isError || !q.data) {
    return (
      <ErrorNote onRetry={() => void q.refetch()}>
        候选池读取中断：{apiErrorMessage(q.error)}
      </ErrorNote>
    );
  }
  return <AcademyBody pool={q.data} />;
}

function AcademyBody({ pool }: { pool: PoolView }): JSX.Element {
  const refresh = useRefreshPool();
  const now = useNow();
  const [msg, setMsg] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  // ⚠️ 重掷守卫：tempId 是位置编号（c0..c4），整池重掷后编号复用 —— 沿用旧响应里的
  // tempId 会静默招到另一个人（扣款、落库、HTTP 200 全都正常）。generatedAt 一变即提示。
  const lastGeneratedAt = useRef(pool.generatedAt);
  useEffect(() => {
    if (lastGeneratedAt.current === pool.generatedAt) return;
    lastGeneratedAt.current = pool.generatedAt;
    setRotated(true);
  }, [pool.generatedAt]);

  const generatedAt = new Date(pool.generatedAt).getTime();
  const freeLeftMs = Math.max(0, generatedAt + FREE_REFRESH_HOURS * HOUR_MS - now);
  const freeReady = freeLeftMs === 0;
  const cyclePct = Math.min(100, Math.max(0, ((now - generatedAt) / (FREE_REFRESH_HOURS * HOUR_MS)) * 100));

  return (
    <div data-testid="academy-page" className="space-y-5">
      <PageHeader
        eyebrow="ACADEMY · RECRUIT"
        title="高级学院"
        description="候选档案的隐性档位不可见：气质判读与招募费是仅有的线索，招募费越高越值得下注。"
        actions={<ActionLink to="/academy/lecture">前往讲课台</ActionLink>}
      />

      <Panel bodyClassName="grid gap-4 p-4 sm:grid-cols-3 sm:gap-6">
        <div>
          <p className="eyebrow">免费重掷</p>
          <p className={`mt-1 font-display text-xl ${freeReady ? 'text-cyber-300' : 'text-fg'}`}>
            {freeReady ? '已就绪' : fmtRemaining(freeLeftMs)}
          </p>
          <Meter
            value={freeReady ? 100 : cyclePct}
            max={100}
            className={freeReady ? 'bg-cyber-400' : 'bg-ink-500'}
            trackClassName="bg-ink-700 mt-2"
          />
          <p className="mt-1.5 text-[11px] text-fg-faint">
            候选池每 {FREE_REFRESH_HOURS} 小时整池重掷一次，重掷后回到 {POOL_SIZE} 人
          </p>
        </div>

        <div>
          <p className="eyebrow">候选席位</p>
          <p className="mt-1 font-display text-xl text-fg">
            <Numeral value={pool.candidates.length} />
            <span className="text-fg-dim"> / {POOL_SIZE}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-faint">
            <Icon icon={GLYPH.student} className="size-3" />
            招募后席位不再补人，刷新才会重建
          </p>
        </div>

        <div>
          <p className="eyebrow">手动重掷</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="font-display text-xl text-fg">
              <Numeral value={pool.refreshPrice} />
              <span className="text-fg-dim"> 金</span>
            </p>
            <Btn
              data-testid="refresh-pool"
              variant="ghost"
              disabled={refresh.isPending}
              title="立即重建候选池：费用随今日刷新次数上浮，日界 04:00 归零"
              onClick={() => refresh.mutate(undefined, { onError: (e) => setMsg(errText(e)) })}
            >
              <Icon icon={RefreshCw} className={`size-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
              {refresh.isPending ? '重掷中…' : '立即刷新'}
            </Btn>
          </div>
          <p className="mt-1.5 text-[11px] text-fg-faint">今日已刷新 {pool.refreshesToday} 次</p>
        </div>
      </Panel>

      {rotated && (
        <p
          data-testid="pool-rotated"
          className="animate-rise flex items-center gap-2 border border-warn-400/50 bg-warn-400/10 px-3 py-2 text-sm text-warn-400"
        >
          <Icon icon={RefreshCw} className="size-3.5" />
          候选池已刷新，请重新确认候选人再招募。
        </p>
      )}

      {msg !== null && (
        <div data-testid="pool-msg">
          <ErrorNote>{msg}</ErrorNote>
        </div>
      )}

      {pool.candidates.length === 0 ? (
        <Empty
          icon={UserSearch}
          title="候选池暂时没有学员"
          action={
            <Btn
              variant="primary"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(undefined, { onError: (e) => setMsg(errText(e)) })}
            >
              花 {pool.refreshPrice} 金重建候选池
            </Btn>
          }
        >
          可以等下一次免费重掷，或立刻花金币重建候选池。
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pool.candidates.map((c, index) => (
            <li key={c.tempId} className="flex">
              <CandidateCard
                c={c}
                index={index}
                onError={setMsg}
                onRecruited={() => {
                  setMsg(null);
                  setRotated(false);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 招募前品质档与天赋一律隐性（student.md §3.6）：候选卡只有气质、九维精确值与招募费。
 * 气质沿用服务端 `hint`（三档口径），色调只是气质梯度，不是品质档材质。
 */
const HINT_TONE: Record<string, { bar: string; badge: string; dot: string; note: string }> = {
  [QUALITY_HINT.COMMON]: {
    bar: 'bg-ink-500',
    badge: 'border-ink-600 text-fg-muted',
    dot: 'bg-fg-faint',
    note: '档案初检读不出锋芒。值不值得，只有招募之后才知道。',
  },
  [QUALITY_HINT.ELITE]: {
    bar: 'bg-cyber-500/70',
    badge: 'border-cyber-500/50 bg-cyber-400/10 text-cyber-300',
    dot: 'bg-cyber-400',
    note: '录影里有几场漂亮的翻盘。至少是块好料。',
  },
  [QUALITY_HINT.GENIUS]: {
    bar: 'bg-arc-400/80',
    badge: 'border-arc-400/60 bg-arc-400/10 text-arc-300',
    dot: 'bg-arc-400 animate-pulse-dot',
    note: '举手投足已是顶尖做派。这种胚子不会常有。',
  },
};

function CandidateCard({
  c,
  index,
  onError,
  onRecruited,
}: {
  c: CandidatePayload;
  index: number;
  onError: (err: string | null) => void;
  onRecruited: () => void;
}): JSX.Element {
  const recruit = useRecruit();
  const tone = HINT_TONE[c.hint] ?? HINT_TONE[QUALITY_HINT.COMMON]!;
  return (
    <Card data-testid="candidate-card" data-tempid={c.tempId} className="flex w-full flex-col">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[2px] ${tone.bar}`} />

      <div className="flex items-start justify-between gap-3 border-b border-ink-600/60 px-4 py-3">
        <div className="min-w-0">
          <p className="eyebrow">候选档案 {String(index + 1).padStart(2, '0')}</p>
          <h3 className="mt-0.5 truncate font-display text-lg tracking-wide text-fg">{c.name}</h3>
          <p className="mt-0.5 text-[11px] text-fg-faint">{SEX_LABEL[c.sex]} · 招募前档位未知</p>
        </div>
        <HoverCard
          width="w-64"
          content={
            <span className="block">
              <span className="eyebrow block">气质判读</span>
              <span className="mt-1 block text-xs text-fg-muted">{tone.note}</span>
              <span className="mt-2 block text-[11px] text-fg-faint">
                气质只是三档粗判，真实档位与天赋在招募落定后才会公开。
              </span>
            </span>
          }
        >
          <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] ${tone.badge}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
            {c.hint}
          </span>
        </HoverCard>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-1 px-4 py-3">
        {attrRows(c).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-fg-dim">{label}</span>
            <span className="tnum text-fg">{floor(value)}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-ink-600/60 px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-fg-dim">招募费</span>
          <span className="text-fg">
            <Numeral value={c.price} /> 金
          </span>
        </div>
        <Btn
          data-testid="recruit-btn"
          variant="primary"
          className="w-full"
          disabled={recruit.isPending}
          title="招募费随在营学员数浮动，以实际扣款为准"
          onClick={() =>
            recruit.mutate(c.tempId, {
              onSuccess: onRecruited,
              onError: (e) => onError(errText(e)),
            })
          }
        >
          {recruit.isPending ? '签约中…' : `招募（${c.price} 金）`}
        </Btn>
      </div>
    </Card>
  );
}

/** e2e 契约：短名标签必须与数字相邻（fixtures.ts 的 candidateVProxy 用正则抓九个数字反推 V） */
function attrRows(c: CandidatePayload): [string, number][] {
  return [
    ['数据', c.attrs.ds],
    ['动态', c.attrs.dp],
    ['数学', c.attrs.math],
    ['图论', c.attrs.graph],
    ['贪心', c.attrs.greedy],
    ['字符串', c.attrs.str],
    ['代码', c.attrs.code],
    ['思维', c.attrs.thinking],
    ['出题', c.attrs.setting],
  ];
}

function errText(e: unknown): string {
  if (e instanceof ApiCallError && e.code === 'INSUFFICIENT_RESOURCE') return '金币不足';
  return apiErrorMessage(e);
}
