import { test, expect } from '@playwright/test';
import { API_URL, registerUser, loginViaUI, readAdminAccount, uniqueName } from '../fixtures';

/** 管理端：建赛/公告/用户查询/审计；普通玩家不可见。 */
test.describe('管理端', () => {
  test('管理员可建赛、发公告、查用户，操作写入审计', async ({ page, request }) => {
    const probe = await registerUser(request, 'adm-probe');
    const admin = await readAdminAccount();
    await loginViaUI(page, admin.username, admin.password);

    // 管理端入口仅管理员可见
    await expect(page.getByRole('link', { name: '管理端' })).toBeVisible();
    await page.goto('/admin');

    // 建赛（默认时间即未来 24/48h，奖池默认 {}）
    const tourName = uniqueName('e2e-admin-cup');
    await page.getByTestId('admin-t-name').fill(tourName);
    await page.getByTestId('admin-t-size').selectOption('8');
    await page.getByTestId('admin-t-submit').click();
    await expect(page.getByTestId('admin-tournaments')).toContainText(tourName);

    // 发公告
    const annTitle = uniqueName('e2e-公告');
    await page.getByTestId('admin-a-title').fill(annTitle);
    await page.getByTestId('admin-a-body').fill(' e2e 公告正文：锦标赛即将开赛。');
    await page.getByTestId('admin-a-submit').click();
    await expect(page.getByTestId('admin-announcements')).toContainText(annTitle);

    // 用户查询
    await page.getByTestId('admin-user-search').fill(probe.username);
    await expect(page.getByTestId('admin-users')).toContainText(probe.username);

    // 审计留痕（heading 的父级只是标题栏，表格在 section 内，须按 section 圈定）
    await expect(page.getByTestId('admin-audits-head')).toBeVisible();
    const auditSection = page.locator(
      'section',
      { has: page.getByRole('heading', { name: '审计日志' }) },
    );
    await expect(auditSection).toContainText('TOURNAMENT_CREATE');
    await expect(auditSection).toContainText('ANNOUNCEMENT_CREATE');
  });

  test('管理员可封禁/解封用户，封禁后用户 token 失效', async ({ page, request }) => {
    const probe = await registerUser(request, 'adm-ban');
    const admin = await readAdminAccount();
    await loginViaUI(page, admin.username, admin.password);
    await page.goto('/admin');

    // 封禁
    await page.getByTestId('admin-user-search').fill(probe.username);
    await page.getByTestId(`admin-ban-${probe.userId}`).click();
    await expect(page.getByTestId('admin-users')).toContainText('已封禁');
    // 封禁即时生效：旧 access token 访问被拒
    const me = await request.get(`${API_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${probe.accessToken}` },
    });
    expect(me.status()).toBe(401);

    // 解封
    await page.getByTestId(`admin-unban-${probe.userId}`).click();
    await expect(page.getByTestId('admin-users')).toContainText('正常');
    const meAfter = await request.get(`${API_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${probe.accessToken}` },
    });
    expect(meAfter.status()).toBe(200);
  });

  test('普通玩家访问管理端显示加载失败且无管理端入口', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'adm');
    await loginViaUI(page, account.username, account.password);
    await expect(page.getByRole('link', { name: '管理端' })).not.toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText('管理端数据加载失败。')).toBeVisible();
  });
});
