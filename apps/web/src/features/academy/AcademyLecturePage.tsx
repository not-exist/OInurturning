import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import { GraduationCap, Timer } from 'lucide-react';
import { ApiCallError, apiErrorMessage } from '../../lib/api';
import {
  useLectureLogs,
  useLectureTiers,
  useStudents,
  useTeachLecture,
} from '../../lib/hooks';
import type { StudentView } from '@oinur/shared';
import type { LectureResultView, LectureTierView } from '../../lib/hooks';
import { lectureGrowthStatLabel, lectureTierLabel, signed, signedTrim, type LectureTierId } from '../../lib/labels';
import { Icon, NAV_ICON } from '../../components/icons';
import {
  Btn,
  Card,
  Chip,
  Empty,
  ErrorNote,
  InlineLoader,
  Meter,
  Numeral,
  PageHeader,
  Panel,
} from '../../components/ui';

/** 强接下限 = 门槛 − 8（apps/api/src/modules/academy/lecture.ts:144），窗口 = [门槛−8, 门槛) */
const FORCE_FLOOR_GAP = 8;
const STAMINA_COST = 2;
/** 思维超出要求多少点后成长归零（economy.yaml → lecture.growth.match_span） */
const THINKING_MATCH_SPAN = 20;
const DAILY_LIMIT = '每日 3 场 · 同一学员 2 场';

/** 服务端 STATE_CONFLICT 的 reason → 人话（无映射时退回通用文案） */
const LECTURE_CONFLICT_TEXT: Record<string, string> = {
  'daily lecture limit reached': '今日讲课次数已达上限',
  'student daily lecture limit reached': '该学员今日讲课次数已达上限',
  'teaching value below forced-taking floor': '能力值低于强接下限，无法承接该档位',
  'force flag required below threshold': '未达门槛：请先勾选强接',
};

export function AcademyLecturePage(): JSX.Element {
  const students = useStudents();
  const tiers = useLectureTiers();
  const logs = useLectureLogs();
  const teach = useTeachLecture();
  const [studentId, setStudentId] = useState<number>();
  const [tier, setTier] = useState<LectureTierId>('beginner');
  const [force, setForce] = useState(false);

  if (students.isPending || tiers.isPending || logs.isPending) {
    return <InlineLoader>正在整理讲课名册…</InlineLoader>;
  }
  if (
    students.isError ||
    tiers.isError ||
    logs.isError ||
    !students.data ||
    !tiers.data ||
    !logs.data
  ) {
    return (
      <ErrorNote
        onRetry={() => {
          void students.refetch();
          void tiers.refetch();
          void logs.refetch();
        }}
      >
        讲课数据读取中断：{apiErrorMessage(students.error ?? tiers.error ?? logs.error)}
      </ErrorNote>
    );
  }

  const selectedStudentId = studentId ?? students.data[0]?.id;
  const selectedStudent = students.data.find((student) => student.id === selectedStudentId);
  const selectedTier = tiers.data.find((entry) => entry.id === tier) ?? tiers.data[0];
  const canForce =
    selectedStudent !== undefined &&
    selectedTier !== undefined &&
    withinForceWindow(selectedStudent.v, selectedTier.threshold);

  return (
    <div data-testid="lecture-page" className="space-y-5">
      <PageHeader
        eyebrow="讲课"
        title="讲课"
        description="带学员承接不同层级的训练营课程：达标直讲稳拿全额，未达标可强接，但讲砸不发钱还倒扣声誉。讲与学员思维相当的课还能带出成长——出题与思维小幅上涨；讲远低于自己水平的课几乎没有收获。"
        actions={<ActionLinkBack />}
      />

      {students.data.length === 0 && (
        <Empty
          icon={GraduationCap}
          title="还没有可以讲课的学员"
          action={
            <Link
              to="/academy"
              className="inline-flex items-center gap-1.5 border border-cyber-400/60 bg-cyber-400/15 px-3 py-1.5 text-sm font-medium text-cyber-300 hover:bg-cyber-400/25"
            >
              前往高级学院招募
            </Link>
          }
        >
          学员要练出足够的综合能力（V），才能站上更高档位的讲台。
        </Empty>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-5">
          <Panel
            title="讲座档位"
            eyebrow="档位"
            bodyClassName="p-4 space-y-4"
            actions={
              <Chip icon={Timer}>
                体力消耗 {STAMINA_COST} · {DAILY_LIMIT}
              </Chip>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-2 block text-fg-dim">主讲学员</span>
                <select
                  data-testid="lecture-student"
                  className="w-full border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-fg outline-none transition-colors focus-visible:border-cyber-400/70 [&>option]:bg-ink-900"
                  value={selectedStudentId ?? ''}
                  onChange={(event) => setStudentId(Number(event.target.value))}
                >
                  {students.data.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.name} · V {student.v} · 体力 {Math.floor(student.stamina)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm" data-tutorial="lecture-tier">
                <span className="mb-2 block text-fg-dim">受众档位</span>
                <select
                  data-testid="lecture-tier"
                  className="w-full border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-fg outline-none transition-colors focus-visible:border-cyber-400/70 [&>option]:bg-ink-900"
                  value={tier}
                  onChange={(event) => {
                    setTier(event.target.value as LectureTierId);
                    setForce(false);
                  }}
                >
                  {tiers.data.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {lectureTierLabel(entry.id)} · 门槛 V{entry.threshold}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <ul className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {tiers.data.map((entry) => (
                <li key={entry.id}>
                  <TierCard
                    entry={entry}
                    active={entry.id === tier}
                    onPick={() => {
                      setTier(entry.id);
                      setForce(false);
                    }}
                  />
                </li>
              ))}
            </ul>

            {selectedTier !== undefined && (
              <div className="border border-ink-600/70 bg-ink-850/40 p-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">能力比对</p>
                    <p className="mt-1 text-sm text-fg-muted">
                      <span className="text-fg">{selectedStudent?.name ?? '暂无学员'}</span>
                      <span className="ml-2">
                        综合能力 V <Numeral value={selectedStudent?.v ?? 0} /> / 门槛 V{' '}
                        {selectedTier.threshold}
                      </span>
                    </p>
                  </div>
                  {selectedStudent !== undefined && <StandingBadge student={selectedStudent} tier={selectedTier} />}
                </div>
                <Meter
                  value={Math.min(selectedStudent?.v ?? 0, selectedTier.threshold)}
                  max={selectedTier.threshold}
                  className={standingFill(selectedStudent?.v ?? 0, selectedTier.threshold)}
                  trackClassName="bg-ink-700 mt-3"
                />
                <p className="mt-2 text-[11px] text-fg-faint">
                  {standingNote(selectedStudent?.v ?? 0, selectedTier.threshold)}
                </p>
                {selectedStudent !== undefined && (
                  <p
                    data-testid="lecture-thinking-match"
                    className={`mt-1.5 text-[11px] ${
                      selectedStudent.thinking < selectedTier.thinkingReq
                        ? 'text-warn-400'
                        : 'text-fg-faint'
                    }`}
                  >
                    思维 <Numeral value={Math.floor(selectedStudent.thinking)} /> / 本场要求{' '}
                    {selectedTier.thinkingReq}
                    <span className="mx-1.5 text-ink-500">·</span>
                    {thinkingNote(selectedStudent.thinking, selectedTier.thinkingReq)}
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel title="授课台" eyebrow="授课台" bodyClassName="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-muted">
                {selectedStudent !== undefined && selectedTier !== undefined ? (
                  <>
                    由 <span className="text-fg">{selectedStudent.name}</span> 主讲
                    <span className="mx-1.5 text-ink-500">/</span>
                    {lectureTierLabel(selectedTier.id)}
                    <span className="mx-1.5 text-ink-500">/</span>
                    基础报酬 {selectedTier.baseMoney} 金 · {selectedTier.baseReputation} 声誉
                  </>
                ) : (
                  '先选择主讲学员与受众档位。'
                )}
              </p>
              <Btn
                data-testid="lecture-teach"
                variant="primary"
                disabled={
                  selectedStudentId === undefined || selectedTier === undefined || teach.isPending
                }
                onClick={() =>
                  selectedStudentId !== undefined &&
                  teach.mutate({ studentId: selectedStudentId, tier, force: force && canForce })
                }
              >
                <Icon icon={NAV_ICON.lecture} className="size-3.5" />
                {teach.isPending ? '结算中…' : '开始讲课'}
              </Btn>
            </div>

            {canForce && (
              <label className="mt-4 flex items-start gap-2 border-t border-ink-600/60 pt-3 text-sm text-warn-400">
                <input
                  data-testid="lecture-force"
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-warn-400"
                  checked={force}
                  onChange={(event) => setForce(event.target.checked)}
                />
                <span>
                  强接此档位
                  <span className="ml-2 text-fg-dim">
                    成功按 60% 结算；讲砸不发钱、倒扣声誉，学员心态 −2
                    {selectedStudent !== undefined &&
                      selectedTier !== undefined &&
                      selectedStudent.thinking < selectedTier.thinkingReq &&
                      '；思维不足，讲砸还会掉出题与思维'}
                  </span>
                </span>
              </label>
            )}

            {teach.isError && (
              <div data-testid="lecture-error" className="mt-3">
                <ErrorNote>讲课未能开始：{lectureErrorText(teach.error)}</ErrorNote>
              </div>
            )}

            {teach.isSuccess && teach.data !== undefined && (
              <ResultStrip
                result={teach.data}
                studentName={students.data.find((s) => s.id === teach.data?.studentId)?.name ?? '学员'}
              />
            )}
          </Panel>
        </div>

        <Panel title="讲课记录" eyebrow="记录" bodyClassName="p-4">
          {logs.data.length === 0 ? (
            <p className="border border-dashed border-ink-600 bg-ink-850/40 px-4 py-8 text-center text-sm text-fg-dim">
              暂无记录。
            </p>
          ) : (
            <ul data-testid="lecture-logs" className="space-y-2">
              {logs.data.map((entry) => (
                <LectureLogItem
                  key={entry.id}
                  entry={entry}
                  studentName={students.data.find((s) => s.id === entry.studentId)?.name ?? '未知学员'}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ActionLinkBack(): JSX.Element {
  return (
    <Link
      to="/academy"
      className="inline-flex items-center gap-1.5 border border-ink-600 px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-ink-500 hover:text-fg"
    >
      <Icon icon={NAV_ICON.academy} className="size-3.5" />
      高级学院
    </Link>
  );
}

function TierCard({
  entry,
  active,
  onPick,
}: {
  entry: LectureTierView;
  active: boolean;
  onPick: () => void;
}): JSX.Element {
  return (
    <Card
      as="button"
      aria-pressed={active}
      onClick={onPick}
      className={`w-full px-3 py-2 text-left ${active ? 'border-cyber-400/70 bg-cyber-400/10' : ''}`}
    >
      <span className="block text-xs text-fg-muted">{lectureTierLabel(entry.id)}</span>
      <span className="numeral mt-0.5 block text-lg text-fg">V {entry.threshold}</span>
      <span className="mt-0.5 block text-[11px] text-fg-faint">
        基础金 {entry.baseMoney} · 声誉 {entry.baseReputation} · 思维 {entry.thinkingReq}
      </span>
      <span className={`mt-1 block text-[11px] ${entry.available ? 'text-good-400' : 'text-fg-faint'}`}>
        {entry.available ? '有学员可承接' : '暂无学员够格'}
      </span>
    </Card>
  );
}

function withinForceWindow(v: number, threshold: number): boolean {
  return v >= threshold - FORCE_FLOOR_GAP && v < threshold;
}

function standingFill(v: number, threshold: number): string {
  if (v >= threshold) return 'bg-good-400';
  if (v >= threshold - FORCE_FLOOR_GAP) return 'bg-warn-400';
  return 'bg-bad-400';
}

function standingNote(v: number, threshold: number): string {
  if (v >= threshold) {
    return `高于门槛每 5 点追加 20% 报酬（上限 +100%）；当前 V ${v}，门槛 V ${threshold}。`;
  }
  if (v >= threshold - FORCE_FLOOR_GAP) {
    return `处于强接窗口（V ≥ ${threshold - FORCE_FLOOR_GAP}）：勾选强接后成功按 60% 结算，讲砸不发钱并倒扣声誉。`;
  }
  return `低于强接下限 V ${threshold - FORCE_FLOOR_GAP}，无法承接该档位。`;
}

/** 讲课成长的匹配提示（issue #56；判定读思维能力本身，与 V 门槛解耦） */
function thinkingNote(thinking: number, req: number): string {
  if (thinking >= req + THINKING_MATCH_SPAN) {
    return '思维远高于要求：这堂课对他几乎没有新东西，成长归零';
  }
  if (thinking >= req) {
    return '思维与要求匹配：本课成长最高（出题或思维小幅上涨）';
  }
  return '思维不足：成长打折；若强接讲砸，出题与思维会小幅回落';
}

function StandingBadge({ student, tier }: { student: StudentView; tier: LectureTierView }): JSX.Element {
  if (student.v >= tier.threshold) {
    return (
      <span className="border border-good-400/50 bg-good-400/10 px-2 py-1 text-xs text-good-400">
        达标 · 可直讲
      </span>
    );
  }
  if (withinForceWindow(student.v, tier.threshold)) {
    return (
      <span className="border border-warn-400/50 bg-warn-400/10 px-2 py-1 text-xs text-warn-400">
        需强接 · 有讲砸风险
      </span>
    );
  }
  return (
    <span className="border border-bad-400/50 bg-bad-400/10 px-2 py-1 text-xs text-bad-400">
      能力不足 · 低于强接下限
    </span>
  );
}

function ResultStrip({
  result,
  studentName,
}: {
  result: LectureResultView;
  studentName: string;
}): JSX.Element {
  const ok = result.success;
  return (
    <div
      className={`animate-rise mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border px-3 py-2.5 text-sm ${
        ok ? 'border-cyber-500/50 bg-cyber-400/10' : 'border-warn-400/50 bg-warn-400/10'
      }`}
    >
      <span
        className={`font-display text-base font-semibold tracking-wide ${ok ? 'text-cyber-300' : 'text-warn-400'}`}
      >
        {ok ? '成功' : '讲砸'}
      </span>
      <span className="text-fg-muted">
        {studentName}
        <span className="mx-1.5 text-ink-500">/</span>
        {lectureTierLabel(result.tier)}
        {result.forced && <span className="ml-1.5 text-warn-400">强接</span>}
      </span>
      <span className="tnum text-fg-dim">
        授课值 V {result.teachingValue} / 门槛 {result.threshold}
      </span>
      <span className={`tnum ${result.money > 0 ? 'text-good-400' : 'text-fg-dim'}`}>
        金 {signed(result.money)}
      </span>
      <span className={`tnum ${result.reputation >= 0 ? 'text-good-400' : 'text-bad-400'}`}>
        声誉 {signed(result.reputation)}
      </span>
      {result.staminaAfter !== null && <span className="tnum text-fg-dim">体力 {result.staminaAfter}</span>}
      <span
        data-testid="lecture-gains"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-ink-600/50 pt-2 text-[11px] text-fg-dim"
      >
        <span className="eyebrow">成长</span>
        {result.gains.length === 0 ? (
          <span>{growthEmptyText(result)}</span>
        ) : (
          result.gains.map((gain) => (
            <span key={gain.stat} className={`tnum ${gain.amount < 0 ? 'text-bad-400' : 'text-arc-300'}`}>
              {lectureGrowthStatLabel(gain.stat)} {signedTrim(gain.amount)}
            </span>
          ))
        )}
      </span>
    </div>
  );
}

/** 无成长时的解释文案：区分「讲砸」与「思维远超要求」两种原因 */
function growthEmptyText(result: LectureResultView): string {
  if (!result.success) {
    return result.thinkingDeficit ? '讲砸且思维不足：属性回落已在上方计' : '讲砸：本场无成长';
  }
  return '思维远超该档要求：这堂课对他没有新东西';
}

function LectureLogItem({
  entry,
  studentName,
}: {
  entry: LectureResultView;
  studentName: string;
}): JSX.Element {
  return (
    <li className="panel relative px-3 py-2.5 text-sm">
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[2px] ${entry.success ? 'bg-cyber-400/70' : 'bg-warn-400/70'}`}
      />
      <div className="flex items-center justify-between gap-3">
        <span className={`font-medium ${entry.success ? 'text-cyber-300' : 'text-warn-400'}`}>
          {entry.success ? '成功' : '讲砸'}
        </span>
        <time className="text-[11px] text-fg-faint" dateTime={entry.createdAt}>
          {fmtTime(entry.createdAt)}
        </time>
      </div>
      <p className="mt-1 truncate text-xs text-fg-muted">
        {studentName}
        <span className="mx-1.5 text-ink-500">/</span>
        {lectureTierLabel(entry.tier)}
        {entry.forced && <span className="ml-1.5 text-warn-400">强接</span>}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-dim">
        <span className="tnum">
          V {entry.teachingValue} / 门槛 {entry.threshold}
        </span>
        <span className={`tnum ${entry.money > 0 ? 'text-good-400' : ''}`}>金 {signed(entry.money)}</span>
        <span className={`tnum ${entry.reputation < 0 ? 'text-bad-400' : ''}`}>
          声誉 {signed(entry.reputation)}
        </span>
        {entry.gains.map((gain) => (
          <span
            key={gain.stat}
            data-testid="lecture-log-gain"
            className={`tnum ${gain.amount < 0 ? 'text-bad-400' : 'text-arc-300'}`}
          >
            {lectureGrowthStatLabel(gain.stat)} {signedTrim(gain.amount)}
          </span>
        ))}
      </p>
    </li>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function lectureErrorText(e: unknown): string {
  if (e instanceof ApiCallError) {
    if (e.code === 'INSUFFICIENT_RESOURCE') return `体力不足（需 ${STAMINA_COST} 点），稍等恢复或使用体力药水`;
    const details = e.details;
    if (typeof details === 'object' && details !== null && 'reason' in details) {
      const reason = (details as { reason?: unknown }).reason;
      if (typeof reason === 'string') {
        const mapped = LECTURE_CONFLICT_TEXT[reason];
        if (mapped !== undefined) return mapped;
      }
    }
  }
  return apiErrorMessage(e);
}
