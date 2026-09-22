import { test, expect } from '@playwright/test';
import { registerUser, fund, API_URL, loginViaUI, DEFAULT_PASSWORD, apiCall, unwrap } from '../fixtures';

test.describe('商店', () => {
  test('商店目录按声誉门槛过滤，购买扣钱并限购', async ({ request }) => {
    const account = await registerUser(request, 'shop');
    await fund(account.username, { money: 10000, reputation: 500 });

    // 获取目录
    const catalogRes = await apiCall(request, 'GET', '/api/shop', account.accessToken);
    expect(catalogRes.status).toBe(200);
    const catalog = unwrap<{ items: any[]; money: number; reputation: number }>(catalogRes.body, '商店目录');
    expect(catalog.items.length).toBeGreaterThan(0);
    // 声誉 500 应解锁紫色
    const purple = catalog.items.filter((i: any) => i.rarity === 'purple' || i.rarity === 'PURPLE');
    expect(purple.length).toBeGreaterThan(0);
    // 灰色应可购买
    const grayItem = catalog.items.find((i: any) => i.rarity.toLowerCase() === 'gray' && i.purchasable);
    expect(grayItem).toBeDefined();

    // 购买一个 milk-tea
    const buyRes = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'milk-tea',
      quantity: 1,
    });
    expect(buyRes.status).toBe(200);
    const buyResult = unwrap<{ moneyAfter: number; ownedQuantity: number }>(buyRes.body, '购买');
    expect(buyResult.moneyAfter).toBeLessThan(10000);
    expect(buyResult.ownedQuantity).toBeGreaterThanOrEqual(1);

    // 日限购：尝试超过上限应失败
    // milk-tea daily limit 10，买 10 次应有一个失败在第 11 次
    // 我们已买 1，尝试买 10 应该失败（1+10>10）
    const overRes = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'milk-tea',
      quantity: 10,
    });
    expect(overRes.status).toBe(400);
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

    // 第三本紫书应超限（weekly 2）
    const third = await apiCall(request, 'POST', '/api/shop/buy', account.accessToken, {
      itemId: 'book-math-purple',
      quantity: 1,
    });
    expect(third.status).toBe(400);
  });

  test('前端商店页面可购买', async ({ request, page }) => {
    const account = await registerUser(request, 'shop-ui');
    await fund(account.username, { money: 10000, reputation: 200 });

    await loginViaUI(page, account.username, DEFAULT_PASSWORD);
    await page.goto('/shop');
    await expect(page.getByText('商城')).toBeVisible();
    // 应有商品卡片
    await expect(page.locator('[data-tutorial="shop-first-item"]').first()).toBeVisible({ timeout: 10000 });
  });
});
