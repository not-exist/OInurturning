import { useState, type JSX } from 'react';
import { PenTool, Trash2 } from 'lucide-react';
import type { DimensionKey } from '@oinur/shared';
import { ApiCallError, apiErrorMessage } from '../../lib/api';
import {
  DIMENSION_LABEL,
  PROBLEM_LIBRARY_CAP,
  floor,
  traitInfo,
  type TraitInfo,
} from '../../lib/labels';
import {
  RARITY_GLOW,
  SEVERITY_CLS,
  SEVERITY_NUMERAL,
  normRarity,
  qualityBand,
  rarityChip,
  rarityLabel,
  rarityText,
} from '../../lib/rarity';
import { DIMENSION_ICON, Icon } from '../../components/icons';
import {
  ActionLink,
  Btn,
  Chip,
  Empty,
  ErrorNote,
  HoverCard,
  InlineLoader,
  PageHeader,
  Panel,
} from '../../components/ui';
import {
  useCreateProblem,
  useDeleteProblem,
  useProblemLibrary,
  useStudents,
  type ProblemView,
} from '../../lib/hooks';

const DIMENSIONS: DimensionKey[] = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'];

export function ProblemLibraryPage(): JSX.Element {
  const students = useStudents();
  const library = useProblemLibrary();
  const create = useCreateProblem();
  const remove = useDeleteProblem();
  const [studentId, setStudentId] = useState<number>();
  const [dimension, setDimension] = useState<DimensionKey>('DS');

  if (students.isPending || library.isPending) return <InlineLoader>读取题库数据…</InlineLoader>;
  if (students.isError || library.isError || students.data === undefined || library.data === undefined) {
    return (
      <ErrorNote
        onRetry={() => {
          void students.refetch();
          void library.refetch();
        }}
      >
        题库数据读取失败：{apiErrorMessage(students.error ?? library.error)}
      </ErrorNote>
    );
  }

  const roster = students.data;
  const problems = library.data;
  const authorId = studentId ?? roster[0]?.id;
  const author = roster.find((s) => s.id === authorId);
  const full = problems.length >= PROBLEM_LIBRARY_CAP;
  const errorText =
    create.error !== null
      ? createErrorText(create.error, full)
      : remove.error !== null
        ? removeErrorText(remove.error)
        : null;

  return (
    <div data-testid="problem-library-page" className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="出题工坊"
        title="出题题库"
        description="把学员的出题能力转成能训练、能携带、能入赛的预制题。质量越高越值钱，特性越毒越能给对手上强度。"
      />

      <Panel
        eyebrow="工作台"
        title="创作一道新题"
        actions={<span className="text-xs text-fg-dim">消耗 1 体力与出题费（费用随在营学员数上浮）</span>}
      >
        {roster.length === 0 ? (
          <Empty
            icon={PenTool}
            title="还没有可以出题的学员"
            action={<ActionLink to="/academy">前往高级学院招募</ActionLink>}
          >
            出题依赖学员的出题能力（九维之一），先去招募并培养一名学员。
          </Empty>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow mb-1 block">出题学员</span>
                <select
                  data-testid="problem-student"
                  className="w-full px-3 py-2 text-sm"
                  value={authorId ?? ''}
                  onChange={(e) => setStudentId(Number(e.target.value))}
                >
                  {roster.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · 出题 {floor(s.setting)} · 体力 {floor(s.stamina)}/5
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="eyebrow mb-1 block">主考维度</span>
                <select
                  data-testid="problem-dimension"
                  className="w-full px-3 py-2 text-sm"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value as DimensionKey)}
                >
                  {DIMENSIONS.map((d) => (
                    <option key={d} value={d}>
                      {DIMENSION_LABEL[d]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-ink-600/60 pt-3">
              <Btn
                data-testid="problem-create"
                variant="primary"
                disabled={authorId === undefined || create.isPending || full}
                onClick={() => {
                  if (authorId === undefined) return;
                  create.mutate({ studentId: authorId, dimension });
                }}
              >
                <Icon icon={PenTool} className="size-3.5" />
                {create.isPending ? '评测中…' : '开始出题'}
              </Btn>
              {author !== undefined && (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Chip>{author.name}</Chip>
                  <Chip>出题 {floor(author.setting)}</Chip>
                  <Chip>思维 {floor(author.thinking)}</Chip>
                  <Chip>体力 {floor(author.stamina)}/5</Chip>
                </span>
              )}
              <span className="text-xs text-fg-dim">
                {full
                  ? `题库已满（${PROBLEM_LIBRARY_CAP}/${PROBLEM_LIBRARY_CAP}），先消耗或删除一些题目。`
                  : '每名学员每日出题次数有限；质量取决于出题能力、主考维度与思维能力。'}
              </span>
            </div>

            {errorText !== null && (
              <p
                data-testid="problem-error"
                className="border border-bad-400/40 bg-bad-400/10 px-3 py-2 text-sm text-bad-400"
              >
                {errorText}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="题库"
        title="我的预制题"
        actions={
          <span className="flex items-baseline gap-2">
            <span className="eyebrow">容量</span>
            <span data-testid="problem-count" className="numeral text-sm text-fg">
              {problems.length}/{PROBLEM_LIBRARY_CAP}
            </span>
          </span>
        }
      >
        {problems.length === 0 ? (
          <Empty icon={PenTool} title="题库还是空的">
            用学员的出题能力创作第一道预制题。质量 70 以上的题适合对决携带，优良以上适合专项训练。
          </Empty>
        ) : (
          <ul className="space-y-2">
            {problems.map((p) => (
              <ProblemRow
                key={p.id}
                problem={p}
                deleting={remove.isPending}
                onDelete={() => remove.mutate(p.id)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** 题目卡：稀有度光源 + 质量评级 + 特性严重度刻度（Ⅰ–Ⅵ） */
function ProblemRow({
  problem,
  deleting,
  onDelete,
}: {
  problem: ProblemView;
  deleting: boolean;
  onDelete: () => void;
}): JSX.Element {
  const norm = normRarity(problem.rarity);
  const band = qualityBand(problem.quality);
  const trait = problem.traitId === null ? null : traitInfo(problem.traitId);

  return (
    <li data-testid="problem-row" className="panel flex flex-wrap items-center gap-3 p-3">
      <span className={`grid size-10 shrink-0 place-items-center border ${rarityChip(norm)} ${RARITY_GLOW[norm]}`}>
        <Icon icon={DIMENSION_ICON[problem.dominantDim]} className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <HoverCard content={<ProblemDetail problem={problem} />} width="w-80">
            <span className="text-sm font-semibold text-fg underline decoration-ink-500 decoration-dotted underline-offset-4">
              {problem.name}
            </span>
          </HoverCard>
          <span className={`border px-1.5 py-0.5 text-[11px] ${rarityChip(norm)}`}>{rarityLabel(norm)}</span>
          <span className={`border px-1.5 py-0.5 text-[11px] ${rarityChip(band.rarity)}`}>{band.label}</span>
          {trait !== null && <SeverityTag info={trait} />}
          {problem.traitId !== null && trait === null && <Chip>特殊特性</Chip>}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-dim">
          <span className="inline-flex items-center gap-1">
            <Icon icon={DIMENSION_ICON[problem.dominantDim]} className="size-3" />
            主考 {DIMENSION_LABEL[problem.dominantDim]}
          </span>
          <span className="numeral text-fg">Q {problem.quality}</span>
          <span className={rarityText(band.rarity)}>{band.label}</span>
        </p>
      </div>

      <Btn data-testid="problem-delete" size="sm" variant="danger" disabled={deleting} onClick={onDelete}>
        <Icon icon={Trash2} className="size-3.5" />
        删除
      </Btn>
    </li>
  );
}

/** 特性：罗马数字刻度 + 色相描边（毒性递增，不做灾难告警） */
function SeverityTag({ info }: { info: TraitInfo }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] ${SEVERITY_CLS[info.severity]}`}
      title={info.effect}
    >
      <span className="numeral">{SEVERITY_NUMERAL[info.severity]}</span>
      {info.name}
    </span>
  );
}

/** 悬浮详情：主考维度 / 质量评级 / 特性（严重度 + 风味文本）/ 当前状态 */
function ProblemDetail({ problem }: { problem: ProblemView }): JSX.Element {
  const band = qualityBand(problem.quality);
  const trait = problem.traitId === null ? null : traitInfo(problem.traitId);

  return (
    <span className="block space-y-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{problem.name}</span>
        <span className={`border px-1.5 py-0.5 text-[11px] ${rarityChip(problem.rarity)}`}>
          {rarityLabel(problem.rarity)}
        </span>
      </span>

      <span className="block space-y-1 text-[11px]">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-fg-dim">主考维度</span>
          <span className="text-fg">{DIMENSION_LABEL[problem.dominantDim]}</span>
        </span>
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-fg-dim">质量评级</span>
          <span className={rarityText(band.rarity)}>
            {band.label} · <span className="numeral">Q {problem.quality}</span>
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-fg-dim">当前状态</span>
          <span className="text-fg">{problem.consumedAt === null ? '可训练 / 可携带' : '已消耗'}</span>
        </span>
      </span>

      <span className="block border-t border-ink-600/60 pt-2">
        {trait !== null ? (
          <span className="block space-y-1">
            <SeverityTag info={trait} />
            <span className="block text-[11px] text-fg-muted">{trait.effect}</span>
          </span>
        ) : (
          <span className="block text-[11px] text-fg-dim">无附加特性：判定按标准规则结算。</span>
        )}
      </span>
    </span>
  );
}

/** 出题失败的人话分支（STATE_CONFLICT 既可能是日限，也可能是全库容量） */
function createErrorText(e: unknown, full: boolean): string {
  if (e instanceof ApiCallError) {
    if (e.code === 'STATE_CONFLICT') {
      return full
        ? `题库已满（上限 ${PROBLEM_LIBRARY_CAP} 道），先消耗或删除一些题目。`
        : '本日出题次数已达上限，换一名学员或等次日再来。';
    }
    if (e.code === 'INSUFFICIENT_RESOURCE') return '体力或金币不足，无法开始出题。';
  }
  return `出题失败：${apiErrorMessage(e)}`;
}

function removeErrorText(e: unknown): string {
  if (e instanceof ApiCallError) {
    if (e.code === 'STATE_CONFLICT') return '这道题已经被消耗，无法删除。';
    if (e.code === 'NOT_FOUND') return '这道题已经不存在了。';
  }
  return `删除失败：${apiErrorMessage(e)}`;
}
