import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginViaUI,
  fund,
  recruitStudent,
  backdateTournament,
  adminToken,
  apiCall,
  unwrap,
  uniqueName,
  rosterIds,
  pickRoster,
  type TestAccount,
} from '../fixtures';

/** 赛事默认 rosterSize（config 未指定时为 3）。 */
const DEFAULT_ROSTER_SIZE = 3;

/**
 * PVP 锦标赛全周期（8 人编排）：
 * 建赛→主玩家 UI 报名→其余 7 人 API 报名→回拨开赛→对阵公示→冠军 UI 领奖。
 */
test.describe('PVP 锦标赛', () => {
  test.setTimeout(300_000);

  async function setupPlayer(
    request: Parameters<typeof apiCall>[0],
    prefix: string,
  ): Promise<TestAccount & { studentIds: number[] }> {
    const account = await registerUser(request, prefix);
    await fund(account.username, { money: 50000, items: { 'entry-ticket': 1 } });
    // 开局 2 人 + 招募 1 人 = 3 人阵容
    await recruitStudent(request, account.accessToken);
    const studentIds = await rosterIds(request, account.accessToken, DEFAULT_ROSTER_SIZE);
    return { ...account, studentIds };
  }

  test('8 人满编开赛并决出冠军，冠军可领取奖池', async ({ page, request }) => {
    const token = await adminToken(request);
    const name = uniqueName('e2e-pvp-cup');
    const created = await apiCall(request, 'POST', '/api/admin/tournaments', token, {
      name,
      size: 8,
      registerEndsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      autoStartAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      prizes: { champion: { money: 1000 } },
      config: {},
    });
    const tournamentId = unwrap<{ id: number }>(created.body, '建赛').id;

    // 主玩家走 UI 报名（覆盖报名表单）；其余 7 人走 API（速度）
    const main = await setupPlayer(request, 'pvp');
    await loginViaUI(page, main.username, main.password);
    await page.goto('/pvp');
    await page.getByTestId('pvp-select').selectOption(String(tournamentId));
    await pickRoster(page, 'pvp-roster', DEFAULT_ROSTER_SIZE);
    await page.getByTestId('pvp-register').click();
    await expect(page.getByTestId('pvp-registered')).toBeVisible();
    // 报名后展示完整阵容名单
    const rosterLine = await page.getByTestId('pvp-roster-list').innerText();
    expect(rosterLine.split('、').length).toBe(DEFAULT_ROSTER_SIZE);

    const others: (TestAccount & { studentIds: number[] })[] = [];
    for (let i = 0; i < 7; i += 1) {
      const Brain = await setupPlayer(request, 'pvp');
      const reg = await apiCall(
        request,
        'POST',
        `/api/pvp/tournaments/${tournamentId}/register`,
        Brain.accessToken,
        { studentIds: Brain.studentIds, problemEntryIds: [] },
      );
      unwrap(reg.body, `报名 ${Brain.username}`);
      others.push(Brain);
    }

    // 回拨时间窗后由管理员开赛
    await backdateTournament(tournamentId);
    const started = await apiCall(
      request,
      'POST',
      `/api/admin/pvp-tournaments/${tournamentId}/actions/start`,
      token,
    );
    unwrap(started.body, '开赛');

    // 对阵与奖励公示可见（7 场=8 进制单败）
    await page.reload();
    await page.getByTestId('pvp-select').selectOption(String(tournamentId));
    await expect(page.getByText('对阵结果')).toBeVisible();
    await expect(page.getByText('赛事奖励公示')).toBeVisible();
    await expect(page.getByText('第 1 轮')).toBeVisible();
    await expect(page.getByText('第 3 轮')).toBeVisible();

    // 找出冠军并以其身份领奖
    const rewards = await apiCall(
      request,
      'GET',
      `/api/pvp/tournaments/${tournamentId}/rewards`,
      main.accessToken,
    );
    const grants = unwrap<{ userId: number; rank: number }[]>(rewards.body, '奖励公示');
    const championGrant = grants.find((g) => g.rank === 1);
    expect(championGrant).toBeDefined();
    const champion = [main, ...others].find((p) => p.userId === championGrant?.userId);
    expect(champion).toBeDefined();

    await loginViaUI(page, champion!.username, champion!.password);
    await page.goto('/pvp');
    await page.getByTestId('pvp-select').selectOption(String(tournamentId));
    await page.getByTestId('pvp-claim').click();
    await expect(page.getByText('已领取')).toBeVisible();
  });
});
