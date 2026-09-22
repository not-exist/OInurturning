import { useState, type JSX } from 'react';
import { useShopCatalog, useBuyShopItem } from '../../lib/shop';
import { Btn, Chip, ErrorNote, InlineLoader, Empty, Numeral, PageHeader, Card } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ShoppingBag, Coins, Lock, Clock } from 'lucide-react';
import { rarityText, RARITY_BORDER, normRarity } from '../../lib/rarity';

function RarityBadge({ rarity }: { rarity: string }) {
  return <span className={`text-[11px] font-medium ${rarityText(rarity)}`}>{rarity.toLowerCase()}</span>;
}

export function ShopPage(): JSX.Element {
  const catalog = useShopCatalog();
  const buy = useBuyShopItem();
  const [filter, setFilter] = useState<'all' | string>('all');
  const [qty, setQty] = useState<Record<string, number>>({});

  if (catalog.isLoading) return <InlineLoader>正在加载商店…</InlineLoader>;
  if (catalog.isError) return <ErrorNote onRetry={() => catalog.refetch()}>商店加载失败：{(catalog.error as Error).message}</ErrorNote>;
  const data = catalog.data!;
  const categories = Array.from(new Set(data.items.map((i) => i.category))).sort();

  const filtered = filter === 'all' ? data.items : data.items.filter((i) => i.category === filter || i.rarity === filter);

  const getQty = (id: string) => qty[id] ?? 1;
  const setQtyFor = (id: string, v: number) => setQty((prev) => ({ ...prev, [id]: Math.max(1, Math.min(99, v)) }));

  return (
    <div className="space-y-5" data-tutorial="shop-page">
      <PageHeader
        title="商城"
        eyebrow="SUPPLY"
        description={`金币 ${data.money} · 声誉 ${data.reputation} · 今日已消费 ${data.todaySpent}`}
        actions={
          <div className="flex items-center gap-2">
            <Chip icon={Coins}>金币 {data.money}</Chip>
            <Chip icon={Clock}>今日消费 {data.todaySpent}</Chip>
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
        {['gray', 'yellow', 'green', 'blue', 'purple'].map((r) => (
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
            const locked = !item.purchasable;
            const norm = normRarity(item.rarity);
            return (
              <Card
                key={item.itemId}
                className={`p-3 ${RARITY_BORDER[norm]} ${locked ? 'opacity-75' : ''}`}
                data-tutorial={item.itemId === filtered[0]?.itemId ? 'shop-first-item' : undefined}
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

                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {item.reputationRequired > 0 && (
                    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 ${data.reputation >= item.reputationRequired ? 'border-good-400/30 bg-good-400/10 text-good-400' : 'border-warn-400/30 bg-warn-400/10 text-warn-400'}`}>
                      <Icon icon={Lock} className="size-3" />
                      声誉 {item.reputationRequired}
                    </span>
                  )}
                  {item.dailyLimit !== null && (
                    <span className="border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-fg-dim">
                      日限 {item.dailyRemaining}/{item.dailyLimit}
                    </span>
                  )}
                  {item.weeklyLimit !== null && (
                    <span className="border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-fg-dim">
                      周限 {item.weeklyRemaining}/{item.weeklyLimit}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => setQtyFor(item.itemId, getQty(item.itemId) - 1)} disabled={getQty(item.itemId) <= 1}>
                      -
                    </Btn>
                    <span className="w-8 text-center text-xs tnum">{getQty(item.itemId)}</span>
                    <Btn size="sm" variant="ghost" onClick={() => setQtyFor(item.itemId, getQty(item.itemId) + 1)} disabled={getQty(item.itemId) >= 99}>
                      +
                    </Btn>
                  </div>
                  <Btn
                    variant={locked ? 'ghost' : 'primary'}
                    size="sm"
                    disabled={locked || buy.isPending}
                    onClick={() => void buy.mutateAsync({ itemId: item.itemId, quantity: getQty(item.itemId) })}
                    data-tutorial={item.itemId === filtered[0]?.itemId ? 'shop-buy' : undefined}
                  >
                    <Icon icon={locked ? Lock : ShoppingBag} className="size-3.5" />
                    {locked ? (item.reason ?? '不可购买') : `购买 ${item.price * getQty(item.itemId)}`}
                  </Btn>
                </div>

                {locked && item.reason && <p className="mt-2 text-[11px] text-warn-400">{item.reason}</p>}
              </Card>
            );
          })}
        </div>
      )}

      {buy.isError && (
        <ErrorNote>购买失败：{(buy.error as Error).message}</ErrorNote>
      )}
    </div>
  );
}
