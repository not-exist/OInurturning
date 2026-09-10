import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, readAdminAccount } from '../fixtures';

/** 冒烟：新用户遍历全部页面无崩溃、无加载失败；管理员页可开。 */
test.describe('冒烟', () => {
  test('新用户所有页面均可渲染（空态）', async ({ page, request }) => {
    const account = await registerUser(request, 'smoke');
    await loginViaUI(page, account.username, account.password);

    const routes: [string, string][] = [
      ['/', '欢迎回来，教练'],
      ['/students', '名下还没有学员'],
      ['/training', '还没有学员'],
      ['/backpack', '背包空空如也'],
      ['/academy', '高级学院'],
      ['/academy/lecture', '还没有可以讲课的学员'],
      ['/problem-library', '还没有可以出题的学员'],
      ['/adventure', '还没有可以历练的学员'],
      ['/story', '还没有可以出战的学员'],
      ['/pvp', 'PVP 锦标赛'],
      ['/settings', '账户信息'],
    ];
    for (const [route, marker] of routes) {
      await page.goto(route);
      await expect(page.getByText(marker).first()).toBeVisible();
      await expect(page.getByText('加载失败')).not.toBeVisible();
    }
  });

  test('管理员可打开管理端', async ({ page }) => {
    const admin = await readAdminAccount();
    await loginViaUI(page, admin.username, admin.password);
    await page.goto('/admin');
    await expect(page.getByText('创建赛事')).toBeVisible();
    await expect(page.getByText('发布公告')).toBeVisible();
  });
});
