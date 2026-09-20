import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginViaUI,
  fund,
  recruitStudent,
  apiCall,
  unwrap,
  uniqueName,
  backdateTournament,
  adminToken,
  rosterIds,
  pickRoster,
  setupTournamentPlayer,
} from '../fixtures';

interface BracketMatch {
  id: number;
  round: number;
  homeUserId: number | null;
  awayUserId: number | null;
  reportUrl: string | null;
}

/**
 * 战报与战斗回放：
 * - 排名赛并行回放：多面板同屏/暂停-继续/变速/跳过→结算→返回；
 * - 战报直达（?details=1 跳过回放）与非法战报 id 的错误态；
 * - PVP 对决战报：对阵卡「查看战报」→ Duel 回放 → 出题对决战报 → 返回 PVP。
 *
 * 约定：剧情 cspj:1 为 4 人团体排名赛；回放 1x 全长约数十秒，
 * 暂停/跳过断言不受自动播放竞速影响。
 */
test.describe('战报与战斗回放', () => {
  test.setTimeout(300_000);

  test('排名赛并行回放：4 面板同屏/暂停/变速/跳过→结算→返回剧情', async ({ page, request }) => {
    const account = await registerUser(request, 'rec');
    await fund(account.username, { money: 50000 });
    // 开局 2 人 + 招募 2 人 = 4 人剧情阵容
    await recruitStudent(request, account.accessToken);
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/story');
    await pickRoster(page, 'story-roster', 4);
    await page.getByTestId('story-enter').first().click();

    // 回放出现：并行视图专属标题证明走了多面板分支（而非单面板 fallback）
    await expect(page.getByTestId('replay-skip')).toBeVisible();
    await expect(page.getByText('Ranking Battle · Parallel View')).toBeVisible();

    // #48：题目卡弹窗的内部选项卡/内容点击不能被遮罩视为关闭操作。
    await expect(page.getByTestId('replay-question-board')).toBeVisible();
    await page.getByTestId('replay-question-card-0').click();
    const questionModal = page.getByTestId('replay-question-modal');
    await expect(questionModal).toBeVisible();
    // 选中态用语义属性断言（而非 Tailwind utility 名），换色不再需要改测试
    await questionModal.getByTestId('replay-question-tab-特性').click();
    await expect(questionModal).toBeVisible();
    await expect(questionModal.getByTestId('replay-question-tab-特性')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await questionModal.getByText('Problem Detail').click();
    await expect(questionModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(questionModal).toBeHidden();

    // 开场 BATTLE_START 全屏后切出 4 队员面板
    const panels = page.getByTestId('replay-member-panel');
    await expect(panels).toHaveCount(4);

    // 暂停→继续：按钮文案与状态徽双向翻转
    await page.getByTestId('replay-pause').click();
    await expect(page.getByTestId('replay-pause')).toHaveText('继续播放');
    await expect(page.getByText('已暂停')).toBeVisible();
    await page.getByTestId('replay-pause').click();
    await expect(page.getByTestId('replay-pause')).toHaveText('暂停');
    await expect(page.getByText('全员并行作战中')).toBeVisible();

    // 变速档位齐全且可切换（8x 选中态用 aria-pressed 表达）
    for (const speed of [1, 2, 4, 8]) {
      await expect(page.getByTestId(`replay-speed-${speed}x`)).toBeVisible();
    }
    await page.getByTestId('replay-speed-8x').click();
    await expect(page.getByTestId('replay-speed-8x')).toHaveAttribute('aria-pressed', 'true');

    // 跳过→结算面板→返回剧情（查看完整战报链路由 story.spec 覆盖）
    await page.getByTestId('replay-skip').click();
    await expect(page.getByText('本场战斗完成')).toBeVisible();
    await expect(page.getByTestId('replay-open-report')).toBeVisible();
    await page.getByTestId('replay-back').click();
    await expect(page.getByTestId('story-enter').first()).toBeVisible();
  });

  test('战报直达与错误态：details=1 跳过回放；非法 id 可重试', async ({ page, request }) => {
    const account = await registerUser(request, 'rec');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await recruitStudent(request, account.accessToken);
    const token = account.accessToken;
    const entered = await apiCall(request, 'POST', '/api/story/stages/cspj:1/enter', token, {
      roster: await rosterIds(request, token, 4),
      ngLevel: 0,
      idempotencyKey: uniqueName('rec-enter'),
    });
    const recordId = unwrap<{ replay: { recordId: string } }>(entered.body, '剧情首关').replay
      .recordId;
    await loginViaUI(page, account.username, account.password);

    // details=1：直接落战报，不经过回放
    await page.goto(`/records/${recordId}?details=1`);
    await expect(page.getByText('排名赛战报')).toBeVisible();
    await expect(page.getByTestId('replay-skip')).toHaveCount(0);
    await expect(page.getByText('结算')).toBeVisible();

    // 无参数：先回放，跳过后直达战报（路由入口无 onOpenReport/onReturn，不中转按钮）
    await page.goto(`/records/${recordId}`);
    await expect(page.getByTestId('replay-skip')).toBeVisible();
    await page.getByTestId('replay-skip').click();
    await expect(page.getByText('排名赛战报')).toBeVisible();
    await expect(page.getByTestId('replay-open-report')).toHaveCount(0);

    // 非法 id：回放与战报双双 404 → 回放失败态，可重试
    await page.goto('/records/e2e-no-such-record');
    await expect(page.getByText('战斗回放加载失败。')).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible();

    // 非法 id + details=1：战报失败态
    await page.goto('/records/e2e-no-such-record?details=1');
    await expect(page.getByText('战报不存在、已失效或无权访问。')).toBeVisible();
  });

  test('PVP 对决战报：对阵卡查看战报→Duel 回放→战报→返回 PVP', async ({ page, request }) => {
    // 8 人锦标赛编排（与 pvp.spec 同构；报名全部走 API，本测只覆盖战报链路）
    const token = await adminToken(request);
    const created = await apiCall(request, 'POST', '/api/admin/tournaments', token, {
      name: uniqueName('e2e-rec-cup'),
      size: 8,
      registerEndsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      autoStartAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      prizes: { champion: { money: 1000 } },
      config: {},
    });
    const tournamentId = unwrap<{ id: number }>(created.body, '建赛').id;

    const main = await setupTournamentPlayer(request, 'rec-pvp');
    const mainReg = await apiCall(
      request,
      'POST',
      `/api/pvp/tournaments/${tournamentId}/register`,
      main.accessToken,
      { studentIds: main.studentIds, problemEntryIds: [] },
    );
    unwrap(mainReg.body, `报名 ${main.username}`);
    for (let i = 0; i < 7; i += 1) {
      const rival = await setupTournamentPlayer(request, 'rec-pvp');
      const reg = await apiCall(
        request,
        'POST',
        `/api/pvp/tournaments/${tournamentId}/register`,
        rival.accessToken,
        { studentIds: rival.studentIds, problemEntryIds: [] },
      );
      unwrap(reg.body, `报名 ${rival.username}`);
    }

    await backdateTournament(tournamentId);
    const started = await apiCall(
      request,
      'POST',
      `/api/admin/pvp-tournaments/${tournamentId}/actions/start`,
      token,
    );
    unwrap(started.body, '开赛');

    // 主角第 1 轮场次：8 人满编无轮空，主角必打首轮；战报仅对阵双方可见
    const bracket = await apiCall(
      request,
      'GET',
      `/api/pvp/tournaments/${tournamentId}/bracket`,
      main.accessToken,
    );
    const mine = unwrap<BracketMatch[]>(bracket.body, '对阵表').find(
      (match) =>
        match.round === 1 && (match.homeUserId === main.userId || match.awayUserId === main.userId),
    );
    expect(mine).toBeDefined();
    expect(mine?.reportUrl).not.toBeNull();

    await loginViaUI(page, main.username, main.password);
    await page.goto('/pvp');
    await page.getByTestId('pvp-select').selectOption(String(tournamentId));
    await page.getByTestId(`pvp-match-${mine!.id}`).getByText('查看战报').click();
    await page.waitForURL(/\/records\/[^/]+/);

    // Duel 单面板回放：暂停→跳过→出题对决战报
    await expect(page.getByText('Duel Battle')).toBeVisible();
    await page.getByTestId('replay-pause').click();
    await expect(page.getByText('已暂停')).toBeVisible();
    await page.getByTestId('replay-skip').click();
    await expect(page.getByText('出题对决战报')).toBeVisible();
    await expect(page.getByText('结算')).toBeVisible();

    await page.getByTestId('record-back').click();
    await page.waitForURL('/pvp');
  });
});
