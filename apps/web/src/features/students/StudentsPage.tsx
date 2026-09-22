import { useMemo, type JSX } from 'react';
import { Link } from 'react-router';
import type { StudentView } from '@oinur/shared';
import { useStudents, useTalentDefs, type TalentDefView } from '../../lib/hooks';
import { floor, round, signed } from '../../lib/labels';
import { QUALITY_MATERIAL, RARITY_ICON } from '../../lib/rarity';
import { ActionLink, ErrorNote, Empty, HoverCard, InlineLoader, Meter, Numeral } from '../../components/ui';
import { Icon, talentIcon } from '../../components/icons';
import { Users, TriangleAlert } from 'lucide-react';
import {
  ANXIETY_THRESHOLD,
  DimBars,
  MindsetBar,
  QualityBadge,
  StaminaCells,
  StudentHover,
  mindsetBaseline,
} from './StudentVisuals';

/** 学员名册：角色卡列表（品质材质 + V 巨型数字 + 六维迷你条 + 心态/体力/精力概览）。 */
export function StudentsPage(): JSX.Element {
  const q = useStudents();
  const talentsQ = useTalentDefs();
  const defs = useMemo(
    () => new Map<string, TalentDefView>((talentsQ.data ?? []).map((t) => [t.id, t])),
    [talentsQ.data],
  );

  if (q.isLoading) return <InlineLoader>学员名册读取中…</InlineLoader>;
  if (q.isError || !q.data) {
    return <ErrorNote onRetry={() => void q.refetch()}>学员数据读取失败：请稍后重试。</ErrorNote>;
  }
  const students = q.data;

  return (
    <div className="space-y-5" data-testid="students-page" data-tutorial="students-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">在营名册</p>
          <h1 className="text-2xl font-semibold tracking-tight">学员管理</h1>
          <p className="mt-1 text-sm text-fg-muted">
            共 {students.length} 名在营学员 · 品质档决定开除代价与培养上限
          </p>
        </div>
        <ActionLink to="/academy">前往高级学院招募</ActionLink>
      </header>

      {students.length === 0 ? (
        <Empty icon={Users} title="名下还没有学员" action={<ActionLink to="/academy">前往高级学院招募</ActionLink>}>
          招募第一名学员，从 CSP-J 起步冲击 IOI。
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {students.map((s) => (
            <StudentCard key={s.id} s={s} defs={defs} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentCard({ s, defs }: { s: StudentView; defs: Map<string, TalentDefView> }): JSX.Element {
  const baseline = mindsetBaseline(s.talents, defs);
  const mindset = round(s.mindset);
  return (
    <Link
      to={`/students/${s.id}`}
      data-testid="student-card"
      className={`block cursor-pointer border p-3.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-cyber-400/50 ${QUALITY_MATERIAL[s.qualityTier]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{s.name}</p>
        </div>
        <QualityBadge tier={s.qualityTier} className="shrink-0" />
      </div>

      <div className="mt-3">
        <HoverCard content={<StudentHover s={s} defs={defs} />} width="w-80">
          <span className="inline-flex items-baseline gap-2">
            <span className="eyebrow">V</span>{' '}
            <Numeral value={floor(s.v)} className="text-3xl text-fg" />
          </span>
        </HoverCard>
      </div>

      <p className="mt-3">
        <span className="eyebrow">六维</span>
      </p>
      <DimBars s={s} className="mt-1.5" />

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-dim">
        <span className="shrink-0 text-fg-faint">天赋</span>
        {s.talents.length === 0 ? (
          <span className="text-fg-faint">暂无</span>
        ) : (
          <>
            {s.talents.slice(0, 5).map((id) => {
              const def = defs.get(id);
              return (
                <Icon
                  key={id}
                  icon={talentIcon(def?.family ?? null, def?.kind ?? 'positive')}
                  className={`size-3.5 ${def ? RARITY_ICON[def.rarity] : 'text-fg-dim'}`}
                />
              );
            })}
            {s.talents.length > 5 && (
              <span className="font-mono text-[10px] text-fg-faint">+{s.talents.length - 5}</span>
            )}
          </>
        )}
      </div>

      <div className="mt-2.5 space-y-1.5 border-t border-ink-600/60 pt-2.5 text-[11px] text-fg-dim">
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0">心态</span>
          <span className="min-w-0 flex-1">
            <MindsetBar value={s.mindset} baseline={baseline} compact />
          </span>
          <span className="w-7 shrink-0 text-right font-mono text-fg-muted">{signed(s.mindset)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0">体力</span>
          <StaminaCells stamina={s.stamina} />
          <span className="ml-auto font-mono text-fg-muted">{floor(s.stamina)}/5</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0">精力</span>
          <span className="min-w-0 flex-1">
            <Meter value={s.energy} max={s.energyMax} className="bg-good-400/80" />
          </span>
          <span className="shrink-0 font-mono text-fg-muted">
            {floor(s.energy)}/{floor(s.energyMax)}
          </span>
        </div>
        {mindset <= ANXIETY_THRESHOLD && (
          <p className="flex items-center gap-1 text-bad-400">
            <Icon icon={TriangleAlert} className="size-3" />
            焦虑反噬：专注持续流失
          </p>
        )}
      </div>
    </Link>
  );
}
