import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund } from '../fixtures';

/** 高级学院：候选池展示/招募/手动刷新/金币不足。 */
test.describe('高级学院', () => {
  test('候选池展示 5 人并可招募，招募后学员出现在学员页', async ({ page, request }) => {
    const account = await registerUser(request, 'acad');
    await fund(account.username, { money: 50000 });
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy');
    const cards = page.getByTestId('candidate-card');
    await expect(cards).toHaveCount(5);
    // 候选卡展示九维数值与招募价
    await expect(cards.first().getByTestId('recruit-btn')).toContainText('招募（');

    await cards.first().getByTestId('recruit-btn').click();
    await expect(cards).toHaveCount(4);

    await page.goto('/students');
    // 开局包自带 2 学员 + 本测招募 1 人
    await expect(page.getByTestId('student-card')).toHaveCount(3);
  });

  test('手动刷新重建候选池（5 人）', async ({ page, request }) => {
    const account = await registerUser(request, 'acad');
    await fund(account.username, { money: 50000 });
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy');
    const cards = page.getByTestId('candidate-card');
    await expect(cards).toHaveCount(5);
    await cards.first().getByTestId('recruit-btn').click();
    await expect(cards).toHaveCount(4);

    await page.getByTestId('refresh-pool').click();
    await expect(cards).toHaveCount(5);
  });

  test('金币不足时招募被拒并提示"金币不足"', async ({ page, request }) => {
    const account = await registerUser(request, 'acad');
    // 开局包自带 1000 金：显式清零以覆盖“金币不足”分支
    await fund(account.username, { money: 0 });
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy');
    const cards = page.getByTestId('candidate-card');
    await expect(cards).toHaveCount(5);
    await cards.first().getByTestId('recruit-btn').click();
    await expect(page.getByTestId('pool-msg')).toHaveText('金币不足');
    // 招募失败不消耗候选位
    await expect(cards).toHaveCount(5);
  });
});
