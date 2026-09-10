import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent } from '../fixtures';

/** 出题题库：出题/删除/资源不足。 */
test.describe('出题题库', () => {
  test('出题成功后计数+1并出现题目行，可删除', async ({ page, request }) => {
    const account = await registerUser(request, 'prob');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/problem-library');
    await expect(page.getByTestId('problem-count')).toHaveText('0/120');
    await expect(page.getByText('题库还是空的')).toBeVisible();

    await page.getByTestId('problem-create').click();
    const rows = page.getByTestId('problem-row');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('problem-count')).toHaveText('1/120');
    await expect(rows.first()).toContainText(/Q \d+/);

    await rows.first().getByTestId('problem-delete').click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('problem-count')).toHaveText('0/120');
  });

  test('单人每日限出 2 道：第 3 次被拒，换学员可继续', async ({ page, request }) => {
    const account = await registerUser(request, 'prob');
    await fund(account.username, { money: 50000 });
    const firstId = await recruitStudent(request, account.accessToken);
    const secondId = await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/problem-library');
    await page.getByTestId('problem-student').selectOption(String(firstId));
    await page.getByTestId('problem-create').click();
    await page.getByTestId('problem-create').click();
    await expect(page.getByTestId('problem-count')).toHaveText('2/120');

    await page.getByTestId('problem-create').click();
    await expect(page.getByTestId('problem-error')).toContainText('本日出题次数已达上限');

    // 上限按学员计：换人出题成功，且上一次报错随新 mutation 发起而消失
    await page.getByTestId('problem-student').selectOption(String(secondId));
    await page.getByTestId('problem-create').click();
    await expect(page.getByTestId('problem-count')).toHaveText('3/120');
    await expect(page.getByTestId('problem-error')).not.toBeVisible();
  });

  test('金币不足时出题被拒并提示"体力或金币不足"', async ({ page, request }) => {
    const account = await registerUser(request, 'prob');
    await fund(account.username, { money: 0 });
    // 先注资招募再清零，构造"有学员、无金币"状态
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await fund(account.username, { money: 0 });
    await loginViaUI(page, account.username, account.password);

    await page.goto('/problem-library');
    await page.getByTestId('problem-create').click();
    await expect(page.getByTestId('problem-error')).toContainText('体力或金币不足');
  });
});
