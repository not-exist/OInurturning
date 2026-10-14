import { useState, type JSX } from 'react';
import type { ShopItemView } from '@oinur/shared';
import { useShopCatalog, useBuyShopItem } from '../../lib/shop';
import { apiErrorMessage } from '../../lib/api';
import { Btn, Chip, ErrorNote, InlineLoader, Empty, Meter, Modal, Numeral, PageHeader, Card } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ShoppingBag, Coins, Lock } from 'lucide-react';
import { rarityText, RARITY_BORDER, normRarity } from '../../lib/rarity';

function RarityBadge({ rarity }: { rarity: string }) {
  return <span className={`text-[11px] font-medium ${rarityText(rarity)}`}>{rarity.toLowerCase()}</span>;
}

export function ShopPage(): JSX.Element {
  const catalog = useShopCatalog();
  const buy = useBuyShopItem();
  const [filter, setFilter] = useState<'all' | string>('all');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<ShopItemView | null>(null);

  if (catalog.isLoading) return <InlineLoader>正在加载商店…</InlineLoader>;
  if (catalog.isError) return <ErrorNote onRetry={() => catalog.refetch()}>商店加载失败：{apiErrorMessage(catalog.error)}</ErrorNote>;
  const data = catalog.data!;
  const categories = Array.from(new Set(data.items.map((i) => i.category))).sort();

  const filtered = filter === 'all' ? data.items : data.items.filter((i) => i.category === filter || i.rarity === filter);

  const getQty = (id: string) => qty[id] ?? 1;
  const setQtyFor = (id: string, v: number) => setQty((prev) => ({ ...prev, [id]: Math.max(1, Math.min(99, v)) }));

  /** 本次可买上限：日限/周限/金币三者取最小，0 表示买不动（限购用尽或钱不够一件） */
  const maxQtyOf = (item: ShopItemView): number =>
    Math.max(
      0,
      Math.min(99, item.dailyRemaining ?? 99, item.weeklyRemaining ?? 99, Math.floor(data.money / item.price)),
    );
  /** 展示用数量：夹在上限内，但下限 1（上限为 0 时按钮会禁用，不必显示 0 件） */
  const qtyOf = (item: ShopItemView) => Math.min(getQty(item.itemId), Math.max(1, maxQtyOf(item)));

  const totalOf = (item: ShopItemView) => item.price * qtyOf(item);
  const blockReason = (item: ShopItemView): string | null => {
    if (!item.purchasable) return item.reason ?? '不可购买';
    if ((item.dailyRemaining ?? 99) === 0 || (item.weeklyRemaining ?? 99) === 0) return '已达限购上限';
    if (maxQtyOf(item) < 1) return '金币不足';
    return null;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="商城"
        eyebrow="补给站"
        description={`金币 ${data.money} · 声誉 ${data.reputation} · 限购每日 04:00 刷新`}
        actions={
          <div className="flex items-center gap-2">
            <Chip icon={Coins}>金币 {data.money}</Chip>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        <Btn variant={filter === 'all' ? 'primary' : 'ghost'} size="sm" onClick={() => setFilter('all')}>
          全部
        </Btn>
        {categories.map((c) => (
          <Btn key={c} variant={filter === c ? 'primary' : 'ghost'} size="sm" onClick={() => setFilter(c)}>
            {c}
          </Btn>
        ))}
        {['gray', 'yellow', 'green', 'blue', 'purple', 'colorful'].map((r) => (
          <Btn key={r} variant={filter === r ? 'primary' : 'ghost'} size="sm" onClick={() => setFilter(r)} className={rarityText(r)}>
            {r}
          </Btn>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={ShoppingBag} title="暂无商品">该分类下没有可售道具</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const norm = normRarity(item.rarity);
            const blocked = blockReason(item);
            const q = qtyOf(item);
            return (
              <Card
                key={item.itemId}
                data-testid="shop-card"
                data-itemid={item.itemId}
                className={`p-3 ${RARITY_BORDER[norm]} ${blocked !== null ? 'opacity-75' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-fg">{item.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <RarityBadge rarity={item.rarity} />
                      <span className="text-[11px] text-fg-faint">{item.category}</span>
                      {item.ownedQuantity > 0 && <Chip>已拥有 {item.ownedQuantity}</Chip>}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-medium text-cyber-300">
                    <Icon icon={Coins} className="size-3.5" />
                    <Numeral value={item.price} />
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-xs text-fg-dim">{item.description}</p>
                {item.effectDesc && <p className="mt-1 text-[11px] text-fg-faint">效果：{item.effectDesc}</p>}

                <div className="mt-2 space-y-1.5 text-[11px]">
                  {item.reputationRequired > 0 && (
                    <div className={`inline-flex items-center gap-1 border px-1.5 py-0.5 ${data.reputation >= item.reputationRequired ? 'border-good-400/30 bg-good-400/10 text-good-400' : 'border-warn-400/30 bg-warn-400/10 text-warn-400'}`}>
                      <Icon icon={Lock} className="size-3" />
                      声誉 {item.reputationRequired}
                    </div>
                  )}
                  {item.dailyLimit !== null && (
                    <div className="flex items-center gap-2 text-fg-dim">
                      <span className="shrink-0">日限</span>
                      <Meter
                        value={item.dailyRemaining ?? 0}
                        max={item.dailyLimit}
                        className="bg-cyber-400/70"
                        trackClassName="w-20 bg-ink-700"
                      />
                      <span className="tnum text-fg-faint">
                        {item.dailyRemaining ?? 0}/{item.dailyLimit}
                      </span>
                    </div>
                  )}
                  {item.weeklyLimit !== null && (
                    <div className="flex items-center gap-2 text-fg-dim">
                      <span className="shrink-0">周限</span>
                      <Meter
                        value={item.weeklyRemaining ?? 0}
                        max={item.weeklyLimit}
                        className="bg-cyber-400/70"
                        trackClassName="w-20 bg-ink-700"
                      />
                      <span className="tnum text-fg-faint">
                        {item.weeklyRemaining ?? 0}/{item.weeklyLimit}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => setQtyFor(item.itemId, q - 1)} disabled={q <= 1}>
                      -
                    </Btn>
                    <span className="w-8 text-center text-xs tnum">{q}</span>
                    <Btn size="sm" variant="ghost" onClick={() => setQtyFor(item.itemId, q + 1)} disabled={q >= maxQtyOf(item)}>
                      +
                    </Btn>
                  </div>
                  <Btn
                    variant={blocked !== null ? 'ghost' : 'primary'}
                    size="sm"
                    disabled={blocked !== null || buy.isPending}
                    onClick={() => setConfirming(item)}
                    data-testid="shop-buy"
                  >
                    <Icon icon={blocked !== null ? Lock : ShoppingBag} className="size-3.5" />
                    {blocked ?? `购买 ${totalOf(item)}`}
                  </Btn>
                </div>

                {blocked !== null && <p className="mt-2 text-[11px] text-warn-400">{blocked}</p>}
              </Card>
            );
          })}
        </div>
      )}

      {confirming !== null && (
        <Modal
          open
          testId="shop-buy-modal"
          onClose={() => setConfirming(null)}
          eyebrow="购买确认"
          title={`购买「${confirming.name}」`}
          width="max-w-md"
        >
          <div className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between border-b border-ink-600/70 pb-2">
              <span className="text-fg-dim">单价</span>
              <span className="tnum text-fg">
                <Numeral value={confirming.price} /> 金
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-fg-dim">数量</span>
              <span className="tnum text-fg">{qtyOf(confirming)} 件</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-fg-dim">合计</span>
              <span className="tnum text-cyber-300">
                <Numeral value={totalOf(confirming)} /> 金
              </span>
            </div>
            <p className="text-[11px] text-fg-faint">限购额度在下单时结算；成交后不可撤销。</p>

            {buy.isError && <ErrorNote>购买失败：{apiErrorMessage(buy.error)}</ErrorNote>}

            <div className="flex justify-end gap-2 pt-1">
              <Btn onClick={() => setConfirming(null)} disabled={buy.isPending}>
                取消
              </Btn>
              <Btn
                variant="primary"
                data-testid="shop-buy-confirm"
                disabled={buy.isPending || blockReason(confirming) !== null}
                onClick={() => {
                  const item = confirming;
                  // 幂等键在一次确认内固定：react-query 的重试（QueryClient retry=1）会带同一把 key
                  // 重发，服务端据此重放而不是再扣一次钱。
                  const key = crypto.randomUUID();
                  buy.mutate(
                    { itemId: item.itemId, quantity: qtyOf(item), idempotencyKey: key },
                    {
                      onSuccess: () => {
                        setQty((prev) => ({ ...prev, [item.itemId]: 1 }));
                        setConfirming(null);
                      },
                    },
                  );
                }}
              >
                {buy.isPending ? '购买中…' : `确认购买（${totalOf(confirming)} 金）`}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {buy.isError && confirming === null && (
        <ErrorNote>购买失败：{apiErrorMessage(buy.error)}</ErrorNote>
      )}
    </div>
  );
}
