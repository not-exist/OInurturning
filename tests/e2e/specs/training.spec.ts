import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent, apiCall, unwrap } from '../fixtures';

/** 训练中心：基础/定向/专项三条链路。 */
test.describe('训练中心', () => {
  test('基础训练：选人→开训→"训练完成"面板展示增益与花费', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'train');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-run').click();
    const result = page.getByTestId('train-result');
    await expect(result).toContainText('训练完成');
    await expect(result).toContainText('消耗');
    await expect(result).toContainText('剩余体力');
  });

  test('定向训练：选维+选书开训成功并可结算', async ({ page, request }) => {
    const account = await registerUser(request, 'train');
    await fund(account.username, { money: 50000, items: { 'book-ds-green': 2 } });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-tab-directed').click();
    await page.getByTestId('train-dim-DS').click();
    await page.getByTestId('train-book').selectOption('book-ds-green');
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
  });

  test('专项训练：无题时提示且按钮禁用；有题后可选题开训', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'train');
    await fund(account.username, { money: 50000 });
    const studentId = await recruitStudent(request, account.accessToken);

    // 先验证空题库分支
    await loginViaUI(page, account.username, account.password);
    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-tab-specialized').click();
    await expect(page.getByText('暂无可用预制题')).toBeVisible();
    await expect(page.getByTestId('train-run')).toBeDisabled();

    // 经 API 造一道题，再走 UI 专项
    const created = await apiCall(request, 'POST', '/api/problem-library', account.accessToken, {
      studentId,
      dimension: 'DS',
    });
    unwrap<{ id: number }>(created.body, '出题');
    await page.reload();
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-tab-specialized').click();
    await page.getByRole('radio', { name: /Q \d+/ }).first().check();
    await expect(page.getByTestId('train-run')).toBeEnabled();
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
  });
});
