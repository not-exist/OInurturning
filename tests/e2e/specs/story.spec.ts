import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent } from '../fixtures';

/** 剧情模式：进关→战报→返回；锁定关禁用。 */
test.describe('剧情模式', () => {
  test('进入 CSP-J 首关后跳转战报页，战报可分享、可返回', async ({ page, request }) => {
    const account = await registerUser(request, 'story');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/story');
    await expect(page.getByTestId('story-enter').first()).toBeEnabled();
    await page.getByTestId('story-enter').first().click();

    await page.waitForURL(/\/records\/\d+/);
    await expect(page.getByText('排名赛战报')).toBeVisible();
    // 通过与否皆为合法结算：只断言报告结构完整
    await expect(page.getByText('结算')).toBeVisible();
    await expect(page.getByTestId('record-share')).toBeVisible();

    await page.getByTestId('record-share').click();
    // 分享失败也不打断浏览：仍在战报页
    await expect(page).toHaveURL(/\/records\/[^/]+/);
    await expect(page.getByText('排名赛战报')).toBeVisible();

    await page.getByTestId('record-back').click();
    await page.waitForURL('/story');
  });

  test('未解锁关卡的进入按钮禁用', async ({ page, request }) => {
    const account = await registerUser(request, 'story');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/story');
    const enters = page.getByTestId('story-enter');
    await expect(enters.first()).toBeEnabled();
    // 第二关在首关通关前锁定（线性解锁）
    await expect(enters.nth(1)).toBeDisabled();
    await expect(page.getByText('未解锁').first()).toBeVisible();
  });
});
