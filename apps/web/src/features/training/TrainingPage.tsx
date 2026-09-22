import { useState, type JSX } from 'react';
import { BookOpen, CircleCheck, Dumbbell, PenTool, Sparkles } from 'lucide-react';
import type { DimensionKey, StudentView } from '@oinur/shared';
import { apiErrorMessage } from '../../lib/api';
import {
  DIMENSION_LABEL,
  QUALITY_LABEL,
  TRAINING_KIND_LABEL,
  floor,
  round,
  talentStatLabel,
  type TrainingKind,
} from '../../lib/labels';
import { QUALITY_MATERIAL, rarityChip, rarityLabel } from '../../lib/rarity';
import { DIMENSION_ICON, Icon, type LucideIcon } from '../../components/icons';
import {
  ActionLink,
  Btn,
  Card,
  Chip,
  Empty,
  ErrorNote,
  InlineLoader,
  KeyVal,
  Meter,
  Numeral,
  PageHeader,
  Panel,
} from '../../components/ui';
import {
  useBasicTrain,
  useDirectedTrain,
  useInventory,
  useProblemLibrary,
  useSpecializedTrain,
  useStudents,
  useTrainingLogs,
  type ProblemView,
  type TrainingLogView,
  type TrainingResult,
} from '../../lib/hooks';
import { StaminaCells, statScale } from '../students/StudentVisuals';

type Tab = TrainingKind;

const TABS: Tab[] = ['basic', 'directed', 'specialized'];

const KIND_ICON: Record<Tab, LucideIcon> = {
  basic: Dumbbell,
  directed: BookOpen,
  specialized: PenTool,
};

/** 三条链路各自的收益说明与消耗（训练费随在营学员数上浮，不在此硬编码金额） */
const MODULE_BLURB: Record<Tab, string> = {
  basic: '随机提升六维之一，涨点平稳，适合日常打底。',
  directed: '自选一维专攻短板；携带对应六维书可放大本次收益。',
  specialized: '消耗一道预制题练真题手感，题目稀有度越高收益越大。',
};

const MODULE_COST: Record<Tab, string> = {
  basic: '1 体力 + 训练费',
  directed: '1 体力 + 训练费 + 六维书×1（可选）',
  specialized: '1 体力 + 训练费 + 预制题×1',
};

const DIM_ORDER: DimensionKey[] = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'];

/** 六维 → 学员视图字段（string 维在库内记作 str） */
const DIM_FIELD: Record<DimensionKey, keyof StudentView> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'str',
};

/** 六维 → 六维书 subject 键（定向训练耗材；与后端 DIM_META.bookSubject 一致） */
const DIM_BOOK: Record<DimensionKey, string> = {
  DS: 'ds',
  DP: 'dp',
  MATH: 'math',
  GRAPH: 'graph',
  GREEDY: 'greedy',
  STRING: 'string',
};

export function TrainingPage(): JSX.Element {
  const studentsQ = useStudents();
  const inv = useInventory();
  const problems = useProblemLibrary();
  const basic = useBasicTrain();
  const directed = useDirectedTrain();
  const specialized = useSpecializedTrain();

  const [studentId, setStudentId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('basic');
  const [dim, setDim] = useState<DimensionKey>('DS');
  const [bookItemId, setBookItemId] = useState('');
  const [problemId, setProblemId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<(TrainingResult & { studentName: string; kind: Tab }) | null>(null);

  if (studentsQ.isPending) return <InlineLoader>读取学员名册…</InlineLoader>;
  if (studentsQ.isError || studentsQ.data === undefined) {
    return (
      <ErrorNote onRetry={() => void studentsQ.refetch()}>
        学员名册读取失败：{apiErrorMessage(studentsQ.error)}
      </ErrorNote>
    );
  }

  const students = studentsQ.data;
  const chosen = students.find((s) => s.id === studentId) ?? null;
  const dimBooks = (inv.data ?? []).filter((i) => i.itemId.startsWith(`book-${DIM_BOOK[dim]}-`));
  const selectable = problems.data ?? [];
  const pending = basic.isPending || directed.isPending || specialized.isPending;
  const noStamina = chosen !== null && floor(chosen.stamina) < 1;
  const runDisabled = pending || chosen === null || noStamina || (tab === 'specialized' && problemId === null);

  function showResult(r: TrainingResult, s: StudentView, kind: Tab): void {
    setResult({ ...r, studentName: s.name, kind });
    setMsg(null);
  }

  function fail(e: unknown): void {
    setMsg(apiErrorMessage(e));
  }

  function run(): void {
    if (chosen === null || runDisabled) return;
    if (tab === 'basic') {
      basic.mutate(chosen.id, { onSuccess: (r) => showResult(r, chosen, 'basic'), onError: fail });
    } else if (tab === 'directed') {
      const book = bookItemId === '' ? undefined : bookItemId;
      directed.mutate(
        { studentId: chosen.id, dim, ...(book !== undefined ? { bookItemId: book } : {}) },
        { onSuccess: (r) => showResult(r, chosen, 'directed'), onError: fail },
      );
    } else if (problemId !== null) {
      specialized.mutate(
        { studentId: chosen.id, problemId },
        { onSuccess: (r) => showResult(r, chosen, 'specialized'), onError: fail },
      );
    }
  }

  return (
    <div data-testid="training-page" className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="培养"
        title="训练"
        description="六维能力靠真比赛与训练一起长：基础打底、定向补短板、专项练真题。每次训练固定消耗 1 点体力与训练费，费用随在营学员数上浮。"
      />

      <Panel
        title="选择学员"
        eyebrow="训练对象"
        actions={<span className="text-xs text-fg-dim">在营 {students.length} 名</span>}
      >
        {students.length === 0 ? (
          <Empty
            icon={Dumbbell}
            title="还没有可以训练的学员"
            action={<ActionLink to="/academy">前往高级学院招募</ActionLink>}
          >
            先去招募一名学员，再回来安排训练计划。
          </Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {students.map((s) => (
              <Card
                key={s.id}
                as="button"
                data-testid="train-student"
                data-student-id={s.id}
                selected={studentId === s.id}
                onClick={() => setStudentId(s.id)}
                className={`min-w-40 flex-1 space-y-2 p-3 text-left ${QUALITY_MATERIAL[s.qualityTier]}`}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{s.name}</span>
                  <Numeral value={`V ${s.v}`} className="shrink-0 text-xs text-fg-dim" />
                </span>
                <StaminaCells stamina={s.stamina} />
                <span className="text-[11px] text-fg-faint">
                  {QUALITY_LABEL[s.qualityTier]} · 精力 {floor(s.energy)}/{floor(s.energyMax)}
                </span>
              </Card>
            ))}
          </div>
        )}
      </Panel>

      <div className={chosen !== null ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]' : ''}>
        <Panel bodyClassName="p-0">
          <div className="flex flex-wrap gap-1 border-b border-ink-600/70 p-2">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`train-tab-${t}`}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={`flex cursor-pointer items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t
                    ? 'border-cyber-400/70 bg-cyber-400/15 text-cyber-300'
                    : 'border-ink-600 text-fg-dim hover:border-ink-500 hover:text-fg'
                }`}
              >
                <Icon icon={KIND_ICON[t]} className="size-3.5" />
                {TRAINING_KIND_LABEL[t]}训练
              </button>
            ))}
          </div>

          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center border border-cyber-500/50 bg-cyber-400/10 text-cyber-300">
                <Icon icon={KIND_ICON[tab]} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{TRAINING_KIND_LABEL[tab]}训练</p>
                <p className="mt-0.5 text-xs text-fg-muted">{MODULE_BLURB[tab]}</p>
              </div>
              <Chip className="ml-auto">{MODULE_COST[tab]}</Chip>
            </div>

            {tab === 'basic' && (
              <p className="border border-ink-600/70 bg-ink-850/50 px-3 py-2 text-xs text-fg-dim">
                {chosen !== null
                  ? `随机命中 ${chosen.name} 的六维之一，命中维度越低涨得越多；还有小概率额外触达代码 / 思维与稀有成长。`
                  : '随机命中所选学员的六维之一，命中维度越低涨得越多；还有小概率额外触达代码 / 思维与稀有成长。'}
              </p>
            )}

            {tab === 'directed' && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {DIM_ORDER.map((d) => (
                    <button
                      key={d}
                      type="button"
                      data-testid={`train-dim-${d}`}
                      aria-pressed={dim === d}
                      onClick={() => {
                        setDim(d);
                        setBookItemId('');
                      }}
                      className={`flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 text-xs transition-colors ${
                        dim === d
                          ? 'border-cyber-400/70 bg-cyber-400/15 text-cyber-300'
                          : 'border-ink-600 text-fg-dim hover:border-ink-500 hover:text-fg'
                      }`}
                    >
                      <Icon icon={DIMENSION_ICON[d]} className="size-3.5" />
                      {DIMENSION_LABEL[d]}
                      {chosen !== null && (
                        <span className="tnum text-[10px] text-fg-faint">
                          {floor(chosen[DIM_FIELD[d]] as number)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <label className="block">
                  <span className="eyebrow mb-1 block">训练用书</span>
                  <select
                    data-testid="train-book"
                    className="w-full max-w-md px-3 py-2 text-sm"
                    value={bookItemId}
                    onChange={(e) => setBookItemId(e.target.value)}
                  >
                    <option value="">不携带书（基础倍率）</option>
                    {dimBooks.map((b) => (
                      <option key={b.itemId} value={b.itemId}>
                        {b.name}（{rarityLabel(b.rarity)}）×{b.quantity}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-fg-dim">
                    {dimBooks.length === 0
                      ? `背包里没有${DIMENSION_LABEL[dim]}六维书，本次按基础倍率结算。`
                      : '六维书只提供本次训练的收益倍率，稀有度越高倍率越大，不占用每周书籍额度。'}
                  </span>
                </label>
              </div>
            )}

            {tab === 'specialized' && (
              <div className="space-y-2">
                {problems.isPending ? (
                  <InlineLoader>读取题库…</InlineLoader>
                ) : selectable.length === 0 ? (
                  <p className="border border-dashed border-ink-600 px-3 py-4 text-center text-xs text-fg-dim">
                    暂无可用预制题（先去「出题题库」出一道，或在历练、剧情里收取样例题）。
                  </p>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {selectable.map((p) => (
                      <ProblemOption
                        key={p.id}
                        problem={p}
                        selected={problemId === p.id}
                        onSelect={() => setProblemId(p.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {msg !== null && (
              <div data-testid="train-msg">
                <ErrorNote>{msg}</ErrorNote>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-ink-600/60 pt-3">
              <Btn data-testid="train-run" variant="primary" disabled={runDisabled} onClick={run}>
                <Icon icon={KIND_ICON[tab]} className="size-3.5" />
                {pending ? '训练中…' : `开始${TRAINING_KIND_LABEL[tab]}训练`}
              </Btn>
              {chosen === null ? (
                <span className="text-xs text-fg-dim">先选择一名学员</span>
              ) : noStamina ? (
                <span className="text-xs text-warn-400">
                  {chosen.name} 体力不足（{floor(chosen.stamina)}/5），先休息或使用体力道具。
                </span>
              ) : (
                <span className="text-xs text-fg-dim">
                  {chosen.name} 当前体力 {floor(chosen.stamina)}/5
                </span>
              )}
            </div>
          </div>
        </Panel>

        {chosen !== null && (
          <Panel eyebrow="训练对象" title={chosen.name} bodyClassName="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {DIM_ORDER.map((d) => {
                const v = floor(chosen[DIM_FIELD[d]] as number);
                return (
                  <div key={d}>
                    <div className="flex items-baseline justify-between gap-1 text-[11px]">
                      <span className="text-fg-dim">{DIMENSION_LABEL[d]}</span>
                      <span className="tnum text-fg">{v}</span>
                    </div>
                    <Meter
                      value={v}
                      max={statScale(DIM_ORDER.map((dimKey) => chosen[DIM_FIELD[dimKey]] as number))}
                      className="bg-cyber-500/70"
                    />
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5 border-t border-ink-600/60 pt-3">
              <KeyVal k="体力">
                <StaminaCells stamina={chosen.stamina} />
              </KeyVal>
              <KeyVal k="精力">
                {floor(chosen.energy)}/{floor(chosen.energyMax)}
              </KeyVal>
              <KeyVal k="专注上限">{floor(chosen.focusCap)}</KeyVal>
              <KeyVal k="心态">{round(chosen.mindset)}</KeyVal>
              <KeyVal k="综合评定 V">{chosen.v}</KeyVal>
            </div>
          </Panel>
        )}
      </div>

      {result !== null && (
        <section
          data-testid="train-result"
          className="panel panel-corners animate-rise border-good-400/40 bg-good-400/5 p-4"
        >
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Icon icon={CircleCheck} className="size-4 text-good-400" />
              <h3 className="text-sm font-semibold text-good-400">训练完成</h3>
              <Chip>{TRAINING_KIND_LABEL[result.kind]}训练</Chip>
            </div>
            <Btn size="sm" variant="subtle" onClick={() => setResult(null)}>
              收起
            </Btn>
          </header>

          <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <div>
              <p className="eyebrow">
                {result.studentName} · {DIMENSION_LABEL[result.dim]}
              </p>
              <Numeral
                value={`+${trim(result.delta)}`}
                className="block text-5xl leading-none font-bold text-good-400"
              />
            </div>
            <div className="space-y-2">
              {result.rareGains.map((g) => (
                <p key={g.stat} className="flex items-center gap-2 text-xs">
                  <Icon icon={Sparkles} className="size-3.5 text-arc-300" />
                  <span className="text-fg-muted">稀有成长 · {talentStatLabel(g.stat)}</span>
                  <Numeral value={`+${trim(g.amount)}`} className="text-arc-300" />
                </p>
              ))}
              <KeyVal k="消耗">{result.cost} 金</KeyVal>
              <KeyVal k="剩余体力">{floor(result.staminaAfter)}/5</KeyVal>
              <Meter value={result.staminaAfter} max={5} className="bg-good-400" />
            </div>
          </div>
        </section>
      )}

      <TrainingLogsSection studentId={studentId} />
    </div>
  );
}

/** 专项训练预制题选项（原生 radio；可访问名必须含 `Q N`） */
function ProblemOption({
  problem,
  selected,
  onSelect,
}: {
  problem: ProblemView;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 border px-2 py-1.5 text-xs transition-colors ${
        selected ? 'border-cyber-400/70 bg-cyber-400/10' : 'border-ink-600 hover:border-ink-500'
      }`}
    >
      <input type="radio" name="train-problem" checked={selected} onChange={onSelect} />
      <span className="min-w-0 flex-1 truncate text-fg-muted">{problem.name}</span>
      <span className={`border px-1.5 py-0.5 ${rarityChip(problem.rarity)}`}>{rarityLabel(problem.rarity)}</span>
      <span className="shrink-0 text-fg-dim">{DIMENSION_LABEL[problem.dominantDim]}</span>
      <span className="numeral shrink-0 text-fg">Q {problem.quality}</span>
    </label>
  );
}

/** 训练记录：筛选类型 + 游标翻页 */
function TrainingLogsSection({ studentId }: { studentId: number | null }): JSX.Element {
  const [kind, setKind] = useState<'' | TrainingKind>('');
  return (
    <Panel
      eyebrow="训练记录"
      title={studentId === null ? '全部训练记录' : '该学员的训练记录'}
      actions={
        <select
          data-testid="train-log-kind"
          className="px-2 py-1 text-xs"
          value={kind}
          onChange={(e) => setKind(e.target.value as '' | TrainingKind)}
        >
          <option value="">全部类型</option>
          <option value="basic">{TRAINING_KIND_LABEL.basic}</option>
          <option value="directed">{TRAINING_KIND_LABEL.directed}</option>
          <option value="specialized">{TRAINING_KIND_LABEL.specialized}</option>
        </select>
      }
    >
      <LogsList
        key={`${studentId ?? 'all'}-${kind}`}
        studentId={studentId}
        kind={kind === '' ? undefined : kind}
      />
    </Panel>
  );
}

function LogsList({
  studentId,
  kind,
}: {
  studentId: number | null;
  kind: TrainingKind | undefined;
}): JSX.Element {
  const [prev, setPrev] = useState<TrainingLogView[]>([]);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const q = useTrainingLogs({
    studentId: studentId ?? undefined,
    kind,
    limit: 10,
    cursor,
  });
  // 翻页请求进行中时只展示已累积页，避免占位旧数据重复
  const current = q.data?.items ?? [];
  const items = cursor === undefined ? current : [...prev, ...(q.isFetching ? [] : current)];
  const nextCursor = q.data?.nextCursor ?? null;

  function more(): void {
    const d = q.data;
    if (d === undefined || d.nextCursor === null) return;
    setPrev((p) => [...p, ...d.items]);
    setCursor(d.nextCursor);
  }

  if (q.isPending) return <InlineLoader>读取训练记录…</InlineLoader>;
  if (q.isError) {
    return (
      <ErrorNote onRetry={() => void q.refetch()}>训练记录读取失败：{apiErrorMessage(q.error)}</ErrorNote>
    );
  }
  if (items.length === 0) return <Empty icon={Dumbbell} title="暂无训练记录" />;

  return (
    <div>
      <ul data-testid="train-log-list" className="divide-y divide-ink-600/60">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-xs">
            <span className="text-sm font-medium text-fg">{t.studentName}</span>
            <span className="border border-ink-600 bg-ink-800/70 px-1.5 py-0.5 text-fg-muted">
              {TRAINING_KIND_LABEL[t.kind]}
            </span>
            <span className="text-cyber-300">{DIMENSION_LABEL[t.dim]}</span>
            <span className="numeral text-good-400">+{trim(t.delta)}</span>
            <span className="text-fg-dim">
              耗 {t.cost} 金 · 体力 {floor(t.staminaAfter)}/5
            </span>
            {t.rareGains.map((g) => (
              <span key={g.stat} className="text-arc-300">
                稀有 {talentStatLabel(g.stat)} +{trim(g.amount)}
              </span>
            ))}
            <span className="ml-auto text-fg-faint">{new Date(t.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {q.isFetching && <p className="mt-2 text-xs text-fg-dim">继续读取…</p>}
      {!q.isFetching && nextCursor !== null && (
        <Btn data-testid="train-log-more" size="sm" className="mt-3" onClick={more}>
          加载更多
        </Btn>
      )}
    </div>
  );
}

/** 增益展示：最多两位小数，去掉尾随零 */
function trim(v: number): number {
  return round(v * 100) / 100;
}
