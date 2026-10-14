import { test, expect, type APIRequestContext } from '@playwright/test';
import { registerUser, fund, loginViaUI, DEFAULT_PASSWORD, apiCall, unwrap } from '../fixtures';

/** 错误信封形状：apps/api/src/middlewares/errorHandler.ts:11 → { ok:false, error:{ code, message, details } } */
interface ErrorEnvelope {
  ok: false;
  error?: { code?: string; message?: string; details?: { resource?: string; reason?: string } };
}

/** 取失败响应的 details，用于区分限购类型（daily_limit / weekly_limit / money / reputation）。 */
function errorDetails(body: unknown): { resource?: string; reason?: string } {
  return (body as ErrorEnvelope).error?.details ?? {};
}

interface CatalogItem {
  itemId: string;
  name: string;
  rarity: string;
  price: number;
  ownedQuantity: number;
  reputationRequired: number;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  weeklyLimit: number | null;
  weeklyRemaining: number | null;
  purchasable: boolean;
  reason: string | null;
}

async function catalogOf(request: APIRequestContext, token: string): Promise<CatalogItem[]> {
  const res = await apiCall(request, 'GET', '/api/shop/catalog', token);
  expect(res.status).toBe(200);
  return unwrap<{ items: CatalogItem[] }>(res.body, '商店目录').items;
}

test.describe('商店', () => {
  test('商店目录按声誉门槛过滤，购买扣钱并限购', async ({ request }) => {
    const account = await registerUser(request, 'shop');
    await fund(account.username, { money: 10000, reputation: 500 });

    // 获取目录（后端只注册了 /api/shop/catalog，见 apps/api/src/modules/shop/router.ts:12）
    const items = await catalogOf(request, account.accessToken);
    expect(items.length).toBeGreaterThan(0);
    // 声誉 500 应解锁紫色（reputation_gates.purple = 350）
    const purple = items.filter((i) => i.rarity.toLowerCase() === 'purple');
    expect(purple.length).toBeGreaterThan(0);
    for (const item of purple) {
      expect(item.reputationRequired).toBeLessThanOrEqual(500);
      expect(item.purchasable).toBe(true);
    }
    // 灰色应可购买
    const grayItem = items.find((i) => i.rarity.toLowerCase() === 'gray' && i.purchasable);
    expect(grayItem).toBeDefined();

    // 购买一个 milk-tea（单价 20）
    const buyRes = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'milk-tea',
      quantity: 1,
    });
    expect(buyRes.status).toBe(200);
    const buyResult = unwrap<{ moneyAfter: number; ownedQuantity: number }>(buyRes.body, '购买');
    expect(buyResult.moneyAfter).toBeLessThan(10000);
    expect(buyResult.ownedQuantity).toBeGreaterThanOrEqual(1);

    // 日限购：milk-tea daily limit 10，已买 1，再买 10 → 1+10>10 应失败
    const overRes = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'milk-tea',
      quantity: 10,
    });
    expect(overRes.status).toBe(400);
    expect(errorDetails(overRes.body).resource).toBe('daily_limit');
  });

  test('并发购买同一限购商品，只有日限量成功', async ({ request }) => {
    const account = await registerUser(request, 'shop-conc');
    // stamina-potion：单价 320、日限 2（docs/data/shop.yaml daily_limits）
    await fund(account.username, { money: 20000, reputation: 500 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
          itemId: 'stamina-potion',
          quantity: 1,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    const failed = results.filter((r) => r.status !== 200);
    // 服务端用事务 + users 行锁（apps/api/src/modules/shop/service.ts:163）串行化，恰好 2 笔成交
    expect(ok).toHaveLength(2);
    expect(failed).toHaveLength(8);
    for (const res of failed) {
      expect(res.status).toBe(400);
      expect(errorDetails(res.body).resource).toBe('daily_limit');
    }

    const items = await catalogOf(request, account.accessToken);
    const potion = items.find((i) => i.itemId === 'stamina-potion');
    expect(potion).toBeDefined();
    expect(potion!.ownedQuantity).toBe(2);
    expect(potion!.dailyLimit).toBe(2);
    expect(potion!.dailyRemaining).toBe(0);
  });

  test('书类按稀有度共享周限额', async ({ request }) => {
    const account = await registerUser(request, 'shop2');
    await fund(account.username, { money: 20000, reputation: 1000 });

    // 买一本紫书
    const first = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'book-ds-purple',
      quantity: 1,
    });
    expect(first.status).toBe(200);

    // 再买另一本紫书
    const second = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'book-dp-purple',
      quantity: 1,
    });
    expect(second.status).toBe(200);

    // 第三本紫书应超限（weekly_limits.book-purple = 2，按稀有度聚合而非按单品计数）
    const third = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'book-math-purple',
      quantity: 1,
    });
    expect(third.status).toBe(400);
    expect(errorDetails(third.body).resource).toBe('weekly_limit');

    // 目录里每本紫书的周余额都归零（book-math-purple 自己一件没买过）
    const items = await catalogOf(request, account.accessToken);
    const purpleBooks = items.filter(
      (i) => i.itemId.startsWith('book-') && i.rarity.toLowerCase() === 'purple',
    );
    expect(purpleBooks.length).toBeGreaterThanOrEqual(3);
    for (const book of purpleBooks) {
      expect(book.weeklyLimit).toBe(2);
      expect(book.weeklyRemaining).toBe(0);
      expect(book.purchasable).toBe(false);
    }
  });

  test('购买日志 limit 非法返回 400 而非 500', async ({ request }) => {
    const account = await registerUser(request, 'shop-logs');

    const bad = await apiCall(request, 'GET', '/api/shop/logs?limit=abc', account.accessToken);
    expect(bad.status).toBe(400);

    const good = await apiCall(request, 'GET', '/api/shop/logs?limit=5', account.accessToken);
    expect(good.status).toBe(200);
  });

  test('前端商店页面可购买', async ({ request, page }) => {
    const account = await registerUser(request, 'shop-ui');
    await fund(account.username, { money: 10000, reputation: 200 });

    await loginViaUI(page, account.username, DEFAULT_PASSWORD);
    await page.goto('/shop');
    await expect(page.getByText('商城')).toBeVisible();
    // 商品卡片（apps/web/src/features/shop/ShopPage.tsx:89 data-testid="shop-card"）
    const firstCard = page.getByTestId('shop-card').first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    const itemId = await firstCard.getAttribute('data-itemid');
    expect(itemId).toBeTruthy();

    // 走真实购买链路：shop-buy → shop-buy-modal → shop-buy-confirm
    await firstCard.getByTestId('shop-buy').click();
    await expect(page.getByTestId('shop-buy-modal')).toBeVisible();
    await page.getByTestId('shop-buy-confirm').click();
    await expect(page.getByTestId('shop-buy-modal')).toBeHidden({ timeout: 20000 });

    const items = await catalogOf(request, account.accessToken);
    const bought = items.find((i) => i.itemId === itemId);
    expect(bought).toBeDefined();
    expect(bought!.ownedQuantity).toBeGreaterThanOrEqual(1);
  });
});
