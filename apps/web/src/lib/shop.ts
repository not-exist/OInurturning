import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { ShopCatalogView, ShopBuyResult } from '@oinur/shared';

export function useShopCatalog() {
  return useQuery({
    queryKey: ['shop'],
    queryFn: () => apiFetch<ShopCatalogView>('/api/shop'),
    staleTime: 30_000,
  });
}

export function useBuyShopItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      apiFetch<ShopBuyResult>('/api/shop/buy', {
        method: 'POST',
        body: JSON.stringify({ itemId, quantity }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useShopLogs() {
  return useQuery({
    queryKey: ['shop-logs'],
    queryFn: () => apiFetch<{ itemId: string; quantity: number; dayKey: string; weekKey: string; createdAt: string }[]>('/api/shop/logs'),
    staleTime: 30_000,
  });
}
