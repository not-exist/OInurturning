import { test, expect } from '@playwright/test';
import { uniqueName, DEFAULT_PASSWORD, loginViaUI, registerUser } from '../fixtures';

/** 用户设置：账户信息/改密/注销。 */
test.describe('用户设置', () => {
  test('账户信息展示用户名与资产', async ({ page, request }) => {
    const account = await registerUser(request, 'set');
    await loginViaUI(page, account.username, account.password);
    await page.goto('/settings');
    await expect(page.getByTestId('settings-me')).toContainText(account.username);
    await expect(page.getByTestId('settings-me')).toContainText('金钱 / 声誉');
  });

  test('两次新密码不一致时拒绝并提示', async ({ page, request }) => {
    const account = await registerUser(request, 'set');
    await loginViaUI(page, account.username, account.password);
    await page.goto('/settings');
    await page.getByTestId('pwd-old').fill(account.password);
    await page.getByTestId('pwd-new').fill('NewPass1234!');
    await page.getByTestId('pwd-confirm').fill('Mismatch1234!');
    await page.getByTestId('pwd-save').click();
    await expect(page.getByTestId('settings-msg')).toHaveText('两次新密码不一致');
  });

  test('修改密码成功后跳登录页，新密码可登、旧密码失效', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'set');
    await loginViaUI(page, account.username, account.password);
    await page.goto('/settings');
    await page.getByTestId('pwd-old').fill(account.password);
    await page.getByTestId('pwd-new').fill('NewPass1234!');
    await page.getByTestId('pwd-confirm').fill('NewPass1234!');
    await page.getByTestId('pwd-save').click();
    await page.waitForURL('/login');

    // 旧密码失效
    await page.getByTestId('login-username').fill(account.username);
    await page.getByTestId('login-password').fill(account.password);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('用户名或密码错误');

    // 新密码可登
    await page.getByTestId('login-username').fill(account.username);
    await page.getByTestId('login-password').fill('NewPass1234!');
    await page.getByTestId('login-submit').click();
    await page.waitForURL('/');
  });

  test('注销确认密码错误时拒绝', async ({ page, request }) => {
    const account = await registerUser(request, 'set');
    await loginViaUI(page, account.username, account.password);
    await page.goto('/settings');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('deactivate-password').fill('WrongPass1234!');
    await page.getByTestId('deactivate-submit').click();
    await expect(page.getByTestId('settings-msg')).toHaveText('注销失败：密码确认不符');
  });

  test('注销成功后账号彻底失效', async ({ page }) => {
    const username = uniqueName('set-gone');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');

    await page.goto('/settings');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('deactivate-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('deactivate-submit').click();
    await page.waitForURL('/login');

    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('用户名或密码错误');
  });
});
