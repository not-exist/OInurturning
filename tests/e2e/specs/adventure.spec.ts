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
 * 历练：无情报直抽→分支结算→记录；情报激活→preview（接受/回避）。
 * 无情报时抽取直接揭示分支（不经过 preview）；preview 仅在激活 intel-slip 后出现。
 * 分支随机，keychain+高额资金保证总有可用分支。
 */
test.describe('历练', () => {
  test('无情报直抽→分支结算→历练记录+1', async ({ page, request }) => {
    const account = await registerUser(request, 'adv');
    await fund(account.username, { money: 200000, items: ADVENTURE_KEYCHAIN });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/adventure');
    await page.getByTestId('adventure-draw').click();

    // 无情报：分支直接可见，不出现 preview 接受/回避按钮
    const choices = page.locator('[data-testid^="adventure-choice-"]');
    await expect(choices.first()).toBeVisible();
    await expect(page.getByTestId('adventure-accept')).toHaveCount(0);
    const resolved = await resolveAdventureChoice(page);
    expect(resolved).toBe(true);

    const logs = page.getByTestId('adventure-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
  });

  test('情报激活后 preview，可回避：记一条"已回避"', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'adv');
    await fund(account.username, {
      money: 200000,
      items: { ...ADVENTURE_KEYCHAIN, 'intel-slip': 1 },
    });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/adventure');
    await page.getByTestId('adventure-intel').click();
    await expect(page.getByTestId('adventure-intel')).toContainText('情报已激活');
    await page.getByTestId('adventure-draw').click();

    await expect(page.getByTestId('adventure-avoid')).toBeVisible();
    await page.getByTestId('adventure-avoid').click();

    const logs = page.getByTestId('adventure-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
    await expect(logs).toContainText('已回避');
  });

  test('情报激活后 preview，接受→分支结算→记录+1', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'adv');
    await fund(account.username, {
      money: 200000,
      items: { ...ADVENTURE_KEYCHAIN, 'intel-slip': 1 },
    });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/adventure');
    await page.getByTestId('adventure-intel').click();
    await expect(page.getByTestId('adventure-intel')).toContainText('情报已激活');
    await page.getByTestId('adventure-draw').click();

    await expect(page.getByTestId('adventure-accept')).toBeVisible();
    await page.getByTestId('adventure-accept').click();

    const choices = page.locator('[data-testid^="adventure-choice-"]');
    await expect(choices.first()).toBeVisible();
    expect(await resolveAdventureChoice(page)).toBe(true);

    const logs = page.getByTestId('adventure-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
  });
});
