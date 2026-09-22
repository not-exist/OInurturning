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
}

export function useTutorial() {
  return useQuery({
    queryKey: ['tutorial'],
    queryFn: () => apiFetch<TutorialStateView>('/api/tutorial'),
    staleTime: 10_000,
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

export function useSkipTutorial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<TutorialStateView>('/api/tutorial/skip', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutorial'] });
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
  '/shop': 'shop',
  '/problem-library': 'backpack',
  '/pvp': 'pvp',
  '/settings': 'overview',
};
