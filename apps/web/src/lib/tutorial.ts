import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

export interface TutorialStepDef {
  id: string;
  title: string;
  desc: string;
  target: string | null;
  unlock: string[];
  action: string;
  reward?: { money?: number; reputation?: number; item?: string; count?: number; badge?: string };
}

export interface TutorialStateView {
  step: number;
  completed: boolean;
  total: number;
  steps: TutorialStepDef[];
  unlocked: string[];
  current: TutorialStepDef | null;
  /** 招募步（action=do_recruit）：当前在册学员数 */
  studentsOwned?: number;
  /** 招募步：达成即自动通过的在册人数要求 */
  studentsRequired?: number;
}

export function useTutorial() {
  return useQuery({
    queryKey: ['tutorial'],
    queryFn: () => apiFetch<TutorialStateView>('/api/tutorial'),
    staleTime: 10_000,
    // 行为步由服务端 autoAdvanceIfNeeded 推进（训练/讲课/历练/剧情/访问学员与候选池、商城…），
    // 前端拿不到这些写入的完成信号，故未完成时每 2s 轮询一次；完成后停止。
    refetchInterval: (query) => (query.state.data?.completed === true ? false : 2000),
  });
}

export function useAdvanceTutorial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: number) =>
      apiFetch<TutorialStateView>('/api/tutorial/advance', {
        method: 'POST',
        body: JSON.stringify({ step }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutorial'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useCompleteTutorial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<TutorialStateView>('/api/tutorial/complete', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutorial'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function isRouteUnlocked(unlocked: string[], routeKey: string): boolean {
  if (unlocked.includes('all')) return true;
  return unlocked.includes(routeKey);
}

export const ROUTE_KEY_MAP: Record<string, string> = {
  '/': 'overview',
  '/students': 'students',
  '/training': 'training',
  '/backpack': 'backpack',
  '/academy': 'academy',
  '/academy/lecture': 'lecture',
  '/adventure': 'adventure',
  '/story': 'story',
  '/records': 'story',
  '/shop': 'shop',
  '/problem-library': 'problem-library',
  '/pvp': 'pvp',
  '/settings': 'overview',
};
