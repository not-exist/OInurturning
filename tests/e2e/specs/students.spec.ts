import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent, parseV } from '../fixtures';

/** 学员管理：列表/档案/改名/开除。 */
test.describe('学员管理', () => {
  test('学员列表展示 V 值，点进档案可见九维与天赋区', async ({ page, request }) => {
    const account = await registerUser(request, 'stu');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/students');
    const cards = page.getByTestId('student-card');
    await expect(cards).toHaveCount(1);
    const text = (await cards.first().innerText()) ?? '';
    expect(parseV(text)).not.toBeNull();

    await cards.first().click();
    await page.waitForURL(/\/students\/\d+/);
    await expect(page.getByText('九维能力')).toBeVisible();
    await expect(page.getByRole('heading', { name: '天赋' })).toBeVisible();
  });

  test('改名消耗改名卡并即时生效', async ({ page, request }) => {
    const account = await registerUser(request, 'stu');
    await fund(account.username, { money: 50000, items: { 'rename-card': 2 } });
    const studentId = await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto(`/students/${studentId}`);
    await expect(page.getByTestId('rename-toggle')).toContainText('拥有 2 张改名卡');
    await page.getByTestId('rename-toggle').click();
    await page.getByTestId('rename-input').fill('E2E改名侠');
    await page.getByTestId('rename-save').click();
    await expect(page.getByRole('heading', { name: 'E2E改名侠' })).toBeVisible();
    await expect(page.getByTestId('rename-toggle')).toContainText('拥有 1 张改名卡');
  });

  test('无改名卡时改名按钮禁用', async ({ page, request }) => {
    const account = await registerUser(request, 'stu');
    await fund(account.username, { money: 50000 });
    const studentId = await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto(`/students/${studentId}`);
    await expect(page.getByTestId('rename-toggle')).toBeDisabled();
  });

  test('开除学员需二次确认，确认后回到列表且人数减一', async ({ page, request }) => {
    const account = await registerUser(request, 'stu');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    const secondId = await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto(`/students/${secondId}`);
    await page.getByTestId('dismiss-open').click();
    await expect(page.getByTestId('dismiss-confirm')).toBeVisible();
    await page.getByTestId('dismiss-confirm').click();
    await page.waitForURL('/students');
    await expect(page.getByTestId('student-card')).toHaveCount(1);
  });
});
