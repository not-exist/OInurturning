import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent, pickRoster } from '../fixtures';

/** 剧情模式：进关→战报→返回；锁定关禁用。剧情为 4 人团体赛。 */
test.describe('剧情模式', () => {
  test('进入 CSP-J 首关后跳转战报页，战报可分享、可返回', async ({ page, request }) => {
    const account = await registerUser(request, 'story');
    await fund(account.username, { money: 50000 });
    // 开局 2 人 + 招募 2 人 = 4 人阵容
    await recruitStudent(request, account.accessToken);
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/story');
    await pickRoster(page, 'story-roster', 4);
    await expect(page.getByTestId('story-enter').first()).toBeEnabled();
    await page.getByTestId('story-enter').first().click();

    // 进入后先展示战斗回放：跳过回放 → 查看完整战报 → 跳转 /records/{id}
    // 战报 id 为 cuid 字符串（非数字），用 [^/]+ 匹配
    await expect(page.getByTestId('replay-skip')).toBeVisible();
    await page.getByTestId('replay-skip').click();
    await expect(page.getByTestId('replay-open-report')).toBeVisible();
    await page.getByTestId('replay-open-report').click();
    await page.waitForURL(/\/records\/[^/]+/);
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
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/story');
    await pickRoster(page, 'story-roster', 4);
    const enters = page.getByTestId('story-enter');
    await expect(enters.first()).toBeEnabled();
    // 第二关在首关通关前锁定（线性解锁）
    await expect(enters.nth(1)).toBeDisabled();
    await expect(page.getByText('未解锁').first()).toBeVisible();
  });

  test('未选满 4 人时进入按钮禁用', async ({ page, request }) => {
    const account = await registerUser(request, 'story');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/story');
    const enter = page.getByTestId('story-enter').first();
    await expect(enter).toBeDisabled();
    await pickRoster(page, 'story-roster', 3);
    await expect(enter).toBeDisabled();
    await pickRoster(page, 'story-roster', 4);
    await expect(enter).toBeEnabled();
  });
});
