import type { StudentView } from '@oinur/shared';
import { getConfig } from '../../config/loader.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getPool } from '../academy/service.js';
import { listLectureLogs, type LectureResultView } from '../academy/lecture.js';
import { listAdventureLogs, type AdventureLogView } from '../adventure/service.js';
import { listAnnouncements, type AnnouncementView } from '../admin/service.js';
import { listRecentContestRecords, type ContestRecordSummary } from '../contest/repository.js';
import { getStoryOverview } from '../story/service.js';
import { listStudents } from '../students/service.js';
import { listTrainingLogs, type TrainingLogView } from '../training/service.js';

/**
 * 总览聚合（GET /api/overview，纯读）：
 * 把首页所需的钱/声誉、学员 TOP5（settle 投影）、剧情进度、招募池速览、
 * 最近动态（训练/讲课/历练/战报各 5 条）、公告（3 条）、新手 checklist 一次返回，
 * 避免前端 N+1。唯一写可能：招募池懒创建（getPool 语义，注册已预建池，常规路径纯读）。
 */

// ---------------------------------------------------------------------------
// 新手 checklist（派生判定，无新表：以各类记录存在性为准）
// ---------------------------------------------------------------------------

/** checklist 全完成奖励徽章（User.badges 字符串，无 FK，纯展示） */
export const CHECKLIST_REWARD_BADGE = 'rookie-done';

export type ChecklistStepId = 'train' | 'lecture' | 'adventure' | 'story' | 'recruit3';

export interface ChecklistStepView {
  id: ChecklistStepId;
  label: string;
  hint: string;
  done: boolean;
}

export interface ChecklistView {
  steps: ChecklistStepView[];
  doneCount: number;
  total: number;
  /** rookie-done 是否已领取 */
  claimed: boolean;
  rewardBadge: typeof CHECKLIST_REWARD_BADGE;
}

const CHECKLIST_DEFS: { id: ChecklistStepId; label: string; hint: string }[] = [
  { id: 'train', label: '完成一次训练', hint: '前往训练中心' },
  { id: 'lecture', label: '完成一次讲课', hint: '前往讲课' },
  { id: 'adventure', label: '完成一次历练', hint: '前往历练' },
  { id: 'story', label: '通关一个剧情关卡', hint: '前往剧情模式' },
  { id: 'recruit3', label: '拥有 3 名学员', hint: '前往高级学院招募' },
];

type StepCounts = Record<ChecklistStepId, boolean>;

async function deriveSteps(
  db: Pick<typeof prisma, 'trainingLog' | 'lectureLog' | 'adventureLog' | 'storyProgress' | 'student'>,
  userId: number,
): Promise<StepCounts> {
  const [train, lecture, adventure, story, active] = await Promise.all([
    db.trainingLog.count({ where: { userId } }),
    db.lectureLog.count({ where: { userId } }),
    db.adventureLog.count({ where: { userId, status: 'RESOLVED' } }),
    db.storyProgress.count({ where: { userId, clearCount: { gt: 0 } } }),
    db.student.count({ where: { userId, status: 'ACTIVE' } }),
  ]);
  return {
    train: train > 0,
    lecture: lecture > 0,
    adventure: adventure > 0,
    story: story > 0,
    recruit3: active >= 3,
  };
}

function toChecklistView(done: StepCounts, claimed: boolean): ChecklistView {
  const steps = CHECKLIST_DEFS.map((def) => ({ ...def, done: done[def.id] }));
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: steps.length,
    claimed,
    rewardBadge: CHECKLIST_REWARD_BADGE,
  };
}

// ---------------------------------------------------------------------------
// 总览聚合
// ---------------------------------------------------------------------------

export interface OverviewStoryView {
  clearedStages: number;
  totalStages: number;
  nextStage: { stageKey: string; name: string; chapter: string } | null;
}

export interface OverviewPoolView {
  count: number;
  refreshPrice: number;
  /** 下次免费刷新的 ISO 时间（generatedAt + free_interval_hours） */
  freeRefreshAt: string;
}

export interface OverviewRecentView {
  training: TrainingLogView[];
  lectures: LectureResultView[];
  adventures: AdventureLogView[];
  contests: ContestRecordSummary[];
}

export interface OverviewView {
  me: { money: number; reputation: number; onboardedAt: string | null };
  students: { total: number; items: StudentView[] };
  story: OverviewStoryView;
  pool: OverviewPoolView;
  recent: OverviewRecentView;
  announcements: AnnouncementView[];
  checklist: ChecklistView;
}

const RECENT_LIMIT = 5;
const OVERVIEW_STUDENTS = 5;

function freeIntervalHours(): number {
  const config = getConfig();
  if (!config) throw new Error('[overview] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行');
  return config.economy.recruitment.manual_refresh.free_interval_hours;
}

export async function getOverview(userId: number): Promise<OverviewView> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [students, storyOverview, pool, training, lectures, adventures, contests, announcements, done] =
    await Promise.all([
      listStudents(userId),
      getStoryOverview(userId, 0),
      getPool(userId),
      listTrainingLogs(userId, { limit: RECENT_LIMIT }),
      listLectureLogs(userId, RECENT_LIMIT),
      listAdventureLogs(userId, RECENT_LIMIT),
      listRecentContestRecords(userId, RECENT_LIMIT),
      listAnnouncements(3),
      deriveSteps(prisma, userId),
    ]);

  const stages = storyOverview.chapters.flatMap((chapter) =>
    chapter.stages.map((stage) => ({ ...stage, chapter: chapter.chapter })),
  );
  const next = stages.find((stage) => stage.unlocked && !stage.cleared) ?? null;
  const freeRefreshAt = new Date(
    new Date(pool.generatedAt).getTime() + freeIntervalHours() * 3_600_000,
  ).toISOString();
  const badges = Array.isArray(user.badges) ? (user.badges as string[]) : [];

  return {
    me: {
      money: user.money,
      reputation: user.reputation,
      onboardedAt: user.onboardedAt ? user.onboardedAt.toISOString() : null,
    },
    students: {
      total: students.length,
      items: [...students].sort((a, b) => b.v - a.v).slice(0, OVERVIEW_STUDENTS),
    },
    story: {
      clearedStages: stages.filter((stage) => stage.cleared).length,
      totalStages: stages.length,
      nextStage: next ? { stageKey: next.stageKey, name: next.name ?? next.stageKey, chapter: next.chapter } : null,
    },
    pool: { count: pool.candidates.length, refreshPrice: pool.refreshPrice, freeRefreshAt },
    recent: { training: training.items, lectures, adventures, contests },
    announcements,
    checklist: toChecklistView(done, badges.includes(CHECKLIST_REWARD_BADGE)),
  };
}

// ---------------------------------------------------------------------------
// checklist 领奖（POST /api/overview/checklist/claim，幂等 200）
// ---------------------------------------------------------------------------

export interface ClaimResult {
  claimed: boolean;
  /** 重复领取（徽章已在）：仍 200，前端据此不弹重复提示 */
  already: boolean;
  badge: typeof CHECKLIST_REWARD_BADGE;
}

export async function claimChecklistReward(userId: number): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const badges = Array.isArray(user.badges) ? [...(user.badges as string[])] : [];
    if (badges.includes(CHECKLIST_REWARD_BADGE)) {
      return { claimed: true, already: true, badge: CHECKLIST_REWARD_BADGE };
    }
    // 事务内重算步骤：以提交瞬间为准（防读后开除学员/并发完成等竞态）
    const done = await deriveSteps(tx, userId);
    if (!Object.values(done).every(Boolean)) {
      throw new ApiError('STATE_CONFLICT', { resource: 'checklist', reason: 'steps incomplete' });
    }
    badges.push(CHECKLIST_REWARD_BADGE);
    await tx.user.update({ where: { id: userId }, data: { badges } });
    return { claimed: true, already: false, badge: CHECKLIST_REWARD_BADGE };
  });
}
