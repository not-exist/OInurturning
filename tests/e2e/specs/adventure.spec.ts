import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginViaUI,
  fund,
  recruitStudent,
  resolveAdventureChoice,
  ADVENTURE_KEYCHAIN,
} from '../fixtures';

/**
 * 历练：抽取→preview（接受/回避）→分支结算→记录。
 * 未激活情报时抽取必进 preview；分支随机，keychain+高额资金保证总有可用分支。
 */
test.describe('历练', () => {
  test('抽取→接受→分支结算→历练记录+1', async ({ page, request }) => {
    const account = await registerUser(request, 'adv');
    await fund(account.username, { money: 200000, items: ADVENTURE_KEYCHAIN });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/adventure');
    await page.getByTestId('adventure-draw').click();
    // 未激活情报：抽取后必出现 preview
    await expect(page.getByTestId('adventure-accept')).toBeVisible();
    await page.getByTestId('adventure-accept').click();

    const choices = page.locator('[data-testid^="adventure-choice-"]');
    await expect(choices.first()).toBeVisible();
    const resolved = await resolveAdventureChoice(page);
    expect(resolved).toBe(true);

    const logs = page.getByTestId('adventure-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
  });

  test('preview 阶段可回避：记一条"已回避"且不消耗分支', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'adv');
    await fund(account.username, { money: 200000, items: ADVENTURE_KEYCHAIN });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/adventure');
    await page.getByTestId('adventure-draw').click();
    await expect(page.getByTestId('adventure-avoid')).toBeVisible();
    await page.getByTestId('adventure-avoid').click();

    const logs = page.getByTestId('adventure-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
    await expect(logs).toContainText('已回避');
  });
});
