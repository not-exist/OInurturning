import { test, expect } from '@playwright/test';
import { uniqueName, DEFAULT_PASSWORD, finishTutorial } from '../fixtures';

/** 认证链路：注册/登录/登出/未登录拦截（页面级）。 */
test.describe('认证', () => {
  test('注册成功后自动登录并进入首页', async ({ page }) => {
    const username = uniqueName('auth-reg');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');
    await expect(page.getByText('欢迎回来，教练')).toBeVisible();
    await expect(page.getByTestId('logout-btn')).toBeVisible();
  });

  test('刷新页面后使用 refresh Cookie 恢复登录态', async ({ page }) => {
    const username = uniqueName('auth-reload');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');

    // access token 仅存内存；此处必须通过 HttpOnly refresh Cookie 重建会话。
    await page.reload();
    await expect(page).toHaveURL('/');
    await expect(page.getByText(username)).toBeVisible();
    await expect(page.getByTestId('logout-btn')).toBeVisible();
  });

  test('重复注册同一用户名提示"用户名已被占用"', async ({ page, request }) => {
    const username = uniqueName('auth-dup');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');
    // UI 注册的账号停在引导第 1 步（遮罩会拦点击）：本用例要点头部登出，先完成引导
    await finishTutorial(request, username, DEFAULT_PASSWORD);
    await page.reload();

    await page.getByTestId('logout-btn').click();
    await page.waitForURL('/login');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('用户名已被占用');
  });

  test('错误密码登录提示"用户名或密码错误"', async ({ page, request }) => {
    const username = uniqueName('auth-bad');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');
    // 同上：本用例要登出，先完成引导
    await finishTutorial(request, username, DEFAULT_PASSWORD);
    await page.reload();
    await page.getByTestId('logout-btn').click();
    await page.waitForURL('/login');

    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill('WrongPass1234!');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('用户名或密码错误');

    // 正确密码可登录
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL('/');
  });

  test('未登录访问受保护页面被重定向到 /login', async ({ page }) => {
    await page.goto('/students');
    await page.waitForURL('/login');
    await page.goto('/settings');
    await page.waitForURL('/login');
  });

  test('登出后回到登录页且无法再进首页', async ({ page, request }) => {
    const username = uniqueName('auth-out');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');
    // 同上：本用例要登出，先完成引导
    await finishTutorial(request, username, DEFAULT_PASSWORD);
    await page.reload();
    await page.getByTestId('logout-btn').click();
    await page.waitForURL('/login');
    await page.goto('/');
    await page.waitForURL('/login');
  });
});
