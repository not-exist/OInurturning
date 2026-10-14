import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent, apiCall, unwrap } from '../fixtures';

/** 背包：使用道具/不可用态/改名卡跳转。 */
test.describe('背包', () => {
  test('使用奶茶：选学员→确认→数量减一', async ({ page, request }) => {
    const account = await registerUser(request, 'item');
    // 开局包自带奶茶×2，合计×5
    await fund(account.username, { money: 50000, items: { 'milk-tea': 3 } });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/backpack');
    const row = page.locator('[data-testid="inventory-row"][data-itemid="milk-tea"]');
    await expect(row).toContainText('×5');
    await row.getByTestId('item-use').click();
    await expect(page.getByTestId('item-picker')).toBeVisible();
    // 默认已选中第一名学员
    await page.getByTestId('item-use-confirm').click();
    await expect(page.getByTestId('item-picker')).not.toBeVisible();
    await expect(row).toContainText('×4');
  });

  test('报名券等非直用道具显示"暂不可用"', async ({ page, request }) => {
    const account = await registerUser(request, 'item');
    await fund(account.username, { money: 50000, items: { 'entry-ticket': 1 } });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/backpack');
    const row = page.locator('[data-testid="inventory-row"][data-itemid="entry-ticket"]');
    await expect(row).toContainText('暂不可用');
  });

  test('改名卡行提供"去学员页改名"跳转', async ({ page, request }) => {
    const account = await registerUser(request, 'item');
    await fund(account.username, { money: 50000, items: { 'rename-card': 1 } });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/backpack');
    const row = page.locator('[data-testid="inventory-row"][data-itemid="rename-card"]');
    await row.getByText('去学员页改名').click();
    await page.waitForURL('/students');
  });

  test('名下无学员时使用道具：选择器提示先招募且确认禁用', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'item');
    await fund(account.username, { money: 0, items: { 'milk-tea': 1 } });
    // 开局包自带 2 学员：先经 API 全部开除，还原“名下无学员”前置
    const list = await apiCall(request, 'GET', '/api/students', account.accessToken);
    for (const s of unwrap<{ id: number }[]>(list.body, '学员列表')) {
      const dismissed = await apiCall(request, 'POST', `/api/students/${s.id}/dismiss`, account.accessToken);
      unwrap(dismissed.body, `开除学员 ${s.id}`);
    }
    await loginViaUI(page, account.username, account.password);

    await page.goto('/backpack');
    const row = page.locator('[data-testid="inventory-row"][data-itemid="milk-tea"]');
    await row.getByTestId('item-use').click();
    await expect(page.getByText('暂无可选学员，请先招募学员。')).toBeVisible();
    await expect(page.getByTestId('item-use-confirm')).toBeDisabled();
  });
});
