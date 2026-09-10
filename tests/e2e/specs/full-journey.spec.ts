import { test, expect, type Page } from '@playwright/test';
import {
  uniqueName,
  DEFAULT_PASSWORD,
  STARTER_KIT,
  loginViaUI,
  loginUser,
  registerUser,
  fund,
  recruitStudent,
  apiCall,
  unwrap,
  backdateTournament,
  adminToken,
  candidateVProxy,
  resolveAdventureChoice,
  type TestAccount,
} from '../fixtures';

/**
 * 完整玩家旅程（旗舰 e2e）：注册→招募→训练→剧情→出题→讲课→历练→背包→改名→
 * PVP（8 人）→改密→注销，一气呵成。
 *
 * 体力账（学员初始 5，上限 5）：基础训练 1 → 定向 1 → 剧情 cspj:1 → 出题 1 →
 * 体力药水 +3 → 讲课 2 → 历练 tier1。PVP 报名无体力门槛。
 * 注资说明见 apps/api/src/scripts/e2e-seed.ts 文件头（新用户 0 金且无商城，UI 内无解）。
 */
test.describe('完整玩家旅程', () => {
  test.setTimeout(600_000);

  /** 在当前候选池中招募 V 估算最高的一名（讲课门槛友好）。 */
  async function recruitBest(page: Page): Promise<void> {
    const cards = page.getByTestId('candidate-card');
    const count = await cards.count();
    let bestIdx = 0;
    let bestV = -1;
    for (let i = 0; i < count; i += 1) {
      const text = (await cards.nth(i).innerText()) ?? '';
      const v = candidateVProxy(text);
      if (v > bestV) {
        bestV = v;
        bestIdx = i;
      }
    }
    await cards.nth(bestIdx).getByTestId('recruit-btn').click();
  }

  test('注册→招募→训练→剧情→出题→讲课→历练→背包→改名→PVP→改密→注销', async ({
    page,
    request,
  }) => {
    // —— 1. 注册 ——
    const username = uniqueName('journey');
    await page.goto('/register');
    await page.getByTestId('register-username').fill(username);
    await page.getByTestId('register-password').fill(DEFAULT_PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL('/');
    await fund(username, { money: 200000, items: STARTER_KIT });
    const token = await loginUser(request, username, DEFAULT_PASSWORD);
    const meRes = await apiCall(request, 'GET', '/api/users/me', token);
    const meId = unwrap<{ id: number }>(meRes.body, 'me').id;

    // —— 2. 招募两名（每池选 V 最高）——
    await page.goto('/academy');
    const cards = page.getByTestId('candidate-card');
    await expect(cards).toHaveCount(5);
    await recruitBest(page);
    await expect(cards).toHaveCount(4);
    await page.getByTestId('refresh-pool').click();
    await expect(cards).toHaveCount(5);
    await recruitBest(page);
    await page.goto('/students');
    await expect(page.getByTestId('student-card')).toHaveCount(2);

    const list = await apiCall(request, 'GET', '/api/students', token);
    const students = unwrap<{ id: number; v: number; name: string }[]>(list.body, '学员列表');
    const best = [...students].sort((a, b) => b.v - a.v)[0];
    expect(best).toBeDefined();

    // —— 3. 基础训练 ——
    await page.goto('/training');
    await page.getByTestId('train-student').filter({ hasText: best.name }).click();
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');

    // —— 4. 定向训练（DS+绿书）——
    await page.getByTestId('train-tab-directed').click();
    await page.getByTestId('train-dim-DS').click();
    await page.getByTestId('train-book').selectOption('book-ds-green');
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');

    // —— 5. 剧情首关→战报→返回 ——
    await page.goto('/story');
    await page.getByTestId('story-student').selectOption(String(best.id));
    await page.getByTestId('story-enter').first().click();
    await page.waitForURL(/\/records\/\d+/);
    await expect(page.getByText('排名赛战报')).toBeVisible();
    await page.getByTestId('record-back').click();
    await page.waitForURL('/story');

    // —— 6. 出题 ——
    await page.goto('/problem-library');
    await page.getByTestId('problem-student').selectOption(String(best.id));
    await page.getByTestId('problem-create').click();
    await expect(page.getByTestId('problem-row')).toHaveCount(1);

    // —— 7. 体力药水回体 ——
    await page.goto('/backpack');
    const potion = page.locator('[data-testid="inventory-row"][data-itemid="stamina-potion"]');
    await potion.getByTestId('item-use').click();
    await page.getByTestId('item-use-confirm').click();
    await expect(page.getByTestId('item-picker')).not.toBeVisible();

    // —— 8. 讲课（按真 V 分支）——
    await page.goto('/academy/lecture');
    await page.getByTestId('lecture-student').selectOption(String(best.id));
    if (best.v >= 15) {
      await page.getByTestId('lecture-teach').click();
      await expect(page.getByTestId('lecture-logs')).toContainText('成功');
    } else if (best.v >= 7) {
      await page.getByTestId('lecture-force').check();
      await page.getByTestId('lecture-teach').click();
      await expect(page.getByTestId('lecture-logs')).toContainText(/成功|讲砸/);
    } else {
      await page.getByTestId('lecture-teach').click();
      await expect(page.getByTestId('lecture-error')).toContainText('讲课未能开始');
    }

    // —— 9. 历练 ——
    await page.goto('/adventure');
    await page.getByTestId('adventure-student').selectOption(String(best.id));
    await page.getByTestId('adventure-draw').click();
    await expect(page.getByTestId('adventure-accept')).toBeVisible();
    await page.getByTestId('adventure-accept').click();
    await expect(page.locator('[data-testid^="adventure-choice-"]').first()).toBeVisible();
    expect(await resolveAdventureChoice(page)).toBe(true);
    await expect(page.getByTestId('adventure-logs').getByRole('listitem')).toHaveCount(1);

    // —— 10. 奶茶 ——
    await page.goto('/backpack');
    const tea = page.locator('[data-testid="inventory-row"][data-itemid="milk-tea"]');
    await expect(tea).toContainText('×3');
    await tea.getByTestId('item-use').click();
    await page.getByTestId('item-use-confirm').click();
    await expect(tea).toContainText('×2');

    // —— 11. 改名 ——
    await page.goto(`/students/${best.id}`);
    await page.getByTestId('rename-toggle').click();
    await page.getByTestId('rename-input').fill('旅程之星');
    await page.getByTestId('rename-save').click();
    await expect(page.getByRole('heading', { name: '旅程之星' })).toBeVisible();

    // —— 12. PVP（8 人，主角+7 陪练）——
    const admin = await adminToken(request);
    const created = await apiCall(request, 'POST', '/api/admin/tournaments', admin, {
      name: uniqueName('journey-cup'),
      size: 8,
      registerEndsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      autoStartAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      prizes: { champion: { money: 1000 } },
      config: {},
    });
    const tournamentId = unwrap<{ id: number }>(created.body, '建赛').id;
    const contenders: TestAccount[] = [
      { username, password: DEFAULT_PASSWORD, accessToken: token, userId: meId },
    ];
    const mainReg = await apiCall(
      request,
      'POST',
      `/api/pvp/tournaments/${tournamentId}/register`,
      token,
      { studentId: best.id, problemEntryIds: [] },
    );
    unwrap(mainReg.body, '主角报名');
    for (let i = 0; i < 7; i += 1) {
      const Brain = await registerUser(request, 'journey-rival');
      await fund(Brain.username, { money: 50000, items: { 'entry-ticket': 1 } });
      const studentId = await recruitStudent(request, Brain.accessToken);
      const reg = await apiCall(
        request,
        'POST',
        `/api/pvp/tournaments/${tournamentId}/register`,
        Brain.accessToken,
        { studentId, problemEntryIds: [] },
      );
      unwrap(reg.body, `报名 ${Brain.username}`);
      contenders.push(Brain);
    }
    await backdateTournament(tournamentId);
    const started = await apiCall(
      request,
      'POST',
      `/api/admin/pvp-tournaments/${tournamentId}/actions/start`,
      admin,
    );
    unwrap(started.body, '开赛');
    const rewards = await apiCall(
      request,
      'GET',
      `/api/pvp/tournaments/${tournamentId}/rewards`,
      token,
    );
    const championGrant = unwrap<{ userId: number; rank: number }[]>(rewards.body, '奖励公示').find(
      (g) => g.rank === 1,
    );
    expect(championGrant).toBeDefined();
    const champion = contenders.find((p) => p.userId === championGrant?.userId);
    expect(champion).toBeDefined();
    await loginViaUI(page, champion!.username, champion!.password);
    await page.goto('/pvp');
    await page.getByTestId('pvp-select').selectOption(String(tournamentId));
    await page.getByTestId('pvp-claim').click();
    await expect(page.getByText('已领取')).toBeVisible();
    await loginViaUI(page, username, DEFAULT_PASSWORD);

    // —— 13. 改密 ——
    await page.goto('/settings');
    await page.getByTestId('pwd-old').fill(DEFAULT_PASSWORD);
    await page.getByTestId('pwd-new').fill('JourneyNew1234!');
    await page.getByTestId('pwd-confirm').fill('JourneyNew1234!');
    await page.getByTestId('pwd-save').click();
    await page.waitForURL('/login');
    await loginViaUI(page, username, 'JourneyNew1234!');

    // —— 14. 注销 ——
    await page.goto('/settings');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('deactivate-password').fill('JourneyNew1234!');
    await page.getByTestId('deactivate-submit').click();
    await page.waitForURL('/login');
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill('JourneyNew1234!');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('用户名或密码错误');
  });
});
