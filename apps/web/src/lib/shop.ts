import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { ShopCatalogView, ShopBuyResult } from '@oinur/shared';

export function useShopCatalog() {
  return useQuery({
    queryKey: ['shop'],
    queryFn: () => apiFetch<ShopCatalogView>('/api/shop/catalog'),
    staleTime: 30_000,
  });
}

export function useBuyShopItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      quantity,
      idempotencyKey,
    }: {
      itemId: string;
      quantity: number;
      /** 同一次确认内固定；重试（网络超时后重发）带同一把 key，服务端重放而非重复扣款 */
      idempotencyKey?: string;
    }) =>
      apiFetch<ShopBuyResult>('/api/shop/buy', {
        method: 'POST',
        body: JSON.stringify({ itemId, quantity }),
        ...(idempotencyKey === undefined ? {} : { headers: { 'Idempotency-Key': idempotencyKey } }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}
