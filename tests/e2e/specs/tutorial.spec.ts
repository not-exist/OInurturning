import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  registerUserRaw,
  loginViaUI,
  fund,
  apiCall,
  unwrap,
  pickRoster,
  resolveAdventureChoice,
  ADVENTURE_KEYCHAIN,
  DEFAULT_PASSWORD,
} from '../fixtures';

/**
 * 强制新手引导（10 步，真源 docs/data/tutorial.yaml）：
 * welcome → students → training → academy → recruit（在册 ≥4 即通过）
 * → lecture → adventure → story → shop → complete。
 *
 * 用例一律用 registerUserRaw 注册（registerUser 内部会 skip，直接把 completed 置 true）。
 * 锁定探针只打**真实存在的**端点（/api/shop/catalog、/api/training/logs、/api/pvp/tournaments）：
 * 打不存在的 /api/shop 会拿到 404 而不是 403，历史上正是它把「路由缺失」伪装成「引导锁」。
 */
test.describe('新手引导', () => {
  interface TutorialStepView {
    id: string;
    title: string;
    action: string;
  }
  interface TutorialStateView {
    step: number;
    completed: boolean;
    total: number;
    unlocked: string[];
    current: TutorialStepView | null;
    studentsOwned?: number;
  }

  async function tutorialState(request: APIRequestContext, token: string): Promise<TutorialStateView> {
    const res = await apiCall(request, 'GET', '/api/tutorial', token);
    return unwrap<TutorialStateView>(res.body, '读取引导状态');
  }

  /** 侧栏导航项（限定在 <nav> 内：StoryPage 内另有一个 data-tutorial="nav-story" 会撞名） */
  function navLink(page: Page, key: string) {
    return page.locator(`nav [data-tutorial="nav-${key}"]`);
  }

  /**
   * 服务端 autoAdvanceIfNeeded 是 fire-and-forget + 独立事务，前端靠 2s 轮询收敛，
   * 故这里自己轮询；返回 boolean 供「剧情需重试」这类场景判定。
   */
  async function waitForStep(
    request: APIRequestContext,
    token: string,
    id: string,
    timeout = 30_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await tutorialState(request, token);
      if (state.current?.id === id) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  async function expectStep(
    request: APIRequestContext,
    token: string,
    id: string,
    timeout = 30_000,
  ): Promise<void> {
    if (await waitForStep(request, token, id, timeout)) return;
    const state = await tutorialState(request, token);
    expect(state.current?.id ?? 'completed', `引导应推进到「${id}」（实际 ${JSON.stringify(state)}）`).toBe(id);
  }

  /** 锁定探针：引导未完成时受限端点一律 403 且 details.resource === 'tutorial' */
  async function expectLocked(request: APIRequestContext, token: string, path: string): Promise<void> {
    const res = await apiCall(request, 'GET', path, token);
    expect(res.status, `GET ${path} 应被引导锁挡下（403，不是 404）`).toBe(403);
    const body = res.body as { error?: { code?: string; details?: { resource?: string } } };
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.error?.details?.resource).toBe('tutorial');
  }

  test('新注册账号停在引导第一步，受限 API 一律 403 且标注 tutorial', async ({ request }) => {
    // registerUserRaw 不 skip：注册后引导必然未完成
    const account = await registerUserRaw(request, 'tut');
    const token = account.accessToken;

    const state = await tutorialState(request, token);
    expect(state.completed).toBe(false);
    expect(state.step).toBe(0);
    expect(state.total).toBe(10);
    expect(state.current?.id).toBe('welcome');
    // welcome 步只解锁总览：其余功能全锁
    expect(state.unlocked).toEqual(['overview']);

    await expectLocked(request, token, '/api/shop/catalog');
    await expectLocked(request, token, '/api/training/logs');
    await expectLocked(request, token, '/api/pvp/tournaments');
  });

  test('跳过引导后受限 API 放行（测试环境后门 /api/tutorial/skip）', async ({ request }) => {
    const account = await registerUserRaw(request, 'tut');
    const token = account.accessToken;
    await expectLocked(request, token, '/api/shop/catalog');

    const skip = await apiCall(request, 'POST', '/api/tutorial/skip', token);
    const skipped = unwrap<{ completed: boolean }>(skip.body, '跳过引导');
    expect(skipped.completed).toBe(true);

    // 同一端点：跳过后 200
    const res = await apiCall(request, 'GET', '/api/shop/catalog', token);
    expect(res.status).toBe(200);
    const after = await tutorialState(request, token);
    expect(after.completed).toBe(true);
    expect(after.unlocked).toEqual(['all']);
  });

  test('未完成时深链被挡回总览，锁定导航点击无效', async ({ page, request }) => {
    const account = await registerUserRaw(request, 'tut');
    await loginViaUI(page, account.username, DEFAULT_PASSWORD);

    // 守卫 fail-closed：pvp 不在 unlock 内，深链重定向回 /
    await page.goto('/pvp');
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('overview-page')).toBeVisible();

    // 锁定项带 aria-disabled：点击后仍停在 /
    const pvp = navLink(page, 'pvp');
    await expect(pvp).toHaveAttribute('aria-disabled', 'true');
    await pvp.click({ force: true });
    await expect(page).toHaveURL('/');
  });

  test('真实走完十步引导：逐步操作推进，全程不刷新页面', async ({ page, request }) => {
    test.setTimeout(180_000);
    const account = await registerUserRaw(request, 'tutwalk');
    const token = account.accessToken;
    // 招募价随在册人数递增（第 3 人 547 起、第 4 人 738 起，品质系数最高 ×5），
    // 历练分支亦有高额花费：一次注足，避免中途因金币不足卡步。
    await fund(account.username, { money: 200_000, items: ADVENTURE_KEYCHAIN });
    await loginViaUI(page, account.username, DEFAULT_PASSWORD);

    const nextBtn = page.locator('[data-tutorial="next-btn"]');

    // 1. welcome：唯一出口是引导卡的「下一步」
    await expectStep(request, token, 'welcome');
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();
    await expectStep(request, token, 'students');

    // 2. students：访问步遮罩只留侧栏学员入口这一个洞
    await navLink(page, 'students').click();
    await expect(page.getByTestId('students-page')).toBeVisible();
    await expectStep(request, token, 'training');

    // 3. training：选一名学员后开始基础训练
    await navLink(page, 'training').click();
    await expect(page.getByTestId('training-page')).toBeVisible();
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
    await expectStep(request, token, 'academy');

    // 4. academy：打开候选池即通过（visit_academy 只认 GET /api/academy/pool）
    await navLink(page, 'academy').click();
    await expect(page.getByTestId('academy-page')).toBeVisible();
    await expectStep(request, token, 'recruit');

    // 5. recruit：在册 ACTIVE ≥ 4 才通过 —— 从候选池里挑最便宜的两名各招募一次
    const poolRes = await apiCall(request, 'GET', '/api/academy/pool', token);
    const pool = unwrap<{ candidates: { tempId: string; price: number }[] }>(poolRes.body, '取候选池');
    const cheapest = [...pool.candidates]
      .sort((a, b) => a.price - b.price)
      .slice(0, 2)
      .map((c) => c.tempId);
    expect(cheapest, '候选池应至少有两名可招募').toHaveLength(2);
    for (const tempId of cheapest) {
      const card = page.locator(`[data-testid="candidate-card"][data-tempid="${tempId}"]`);
      await card.getByTestId('recruit-btn').click();
      // 招募成功后该候选从池中移除
      await expect(card).toHaveCount(0);
    }
    const roster = await apiCall(request, 'GET', '/api/students', token);
    expect(unwrap<{ id: number }[]>(roster.body, '学员列表')).toHaveLength(4);
    await expectStep(request, token, 'lecture');

    // 6. lecture：入门组门槛 V15、强接窗口 [7,15) —— 开局 GOOD 学员（V≈14）多半要勾「强接」
    await navLink(page, 'lecture').click();
    await expect(page.getByTestId('lecture-page')).toBeVisible();
    const students = unwrap<{ id: number; v: number }[]>(roster.body, '学员列表');
    const speaker = [...students].sort((a, b) => b.v - a.v)[0]!;
    await page.getByTestId('lecture-student').selectOption(String(speaker.id));
    const force = page.getByTestId('lecture-force');
    if (await force.isVisible()) await force.check();
    await page.getByTestId('lecture-teach').click();
    // 讲砸也推进（服务端 do_lecture 在写日志后无条件 autoAdvance），但拒单不会：据此断言未拒单
    await expect(page.getByTestId('lecture-logs').or(page.getByTestId('lecture-error'))).toBeVisible();
    await expect(page.getByTestId('lecture-error'), '讲课被拒单会导致本步无法推进').toHaveCount(0);
    await expect(page.getByTestId('lecture-logs').getByRole('listitem')).toHaveCount(1);
    await expectStep(request, token, 'adventure');

    // 7. adventure：恰好 3 人小队（在册 4 人 → 勾前 3 名）。
    // 前置条件：AdventurePage 用 useInventory（GET /api/items，路由键 backpack）读情报条持有数
    // （apps/web/src/features/adventure/AdventurePage.tsx:332）。本步 unlock 若不含 backpack，
    // 整页会直接报错、do_adventure 无法经 UI 触发（曾真实发生过，见 docs/data/tutorial.yaml）。
    const items = await apiCall(request, 'GET', '/api/items', token);
    expect(items.status, '历练页依赖背包接口：adventure 步的 unlock 必须包含 backpack').toBe(200);
    await navLink(page, 'adventure').click();
    await expect(page.getByTestId('adventure-page')).toBeVisible();
    await pickRoster(page, 'adventure-roster', 3);
    await page.getByTestId('adventure-draw').click();
    await expect(page.locator('[data-testid^="adventure-choice-"]').first()).toBeVisible();
    expect(await resolveAdventureChoice(page), '历练分支应可结算').toBe(true);
    await expectStep(request, token, 'story');

    // 8. story：4 人队伍；服务端只在通关（rank ≤ 8）时推进本步（story/service.ts:824），
    //    未通关按真实玩法重打。回放是页内替换（StoryPage.tsx:314 早退，URL 仍是 /story），
    //    故重试必须「跳过回放 → 返回」把页面切回来，点侧栏剧情是同址无效点击。
    await navLink(page, 'story').click();
    await expect(page.getByTestId('story-page')).toBeVisible();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await pickRoster(page, 'story-roster', 4);
      const enter = page.getByTestId('story-enter').first();
      await expect(enter).toBeEnabled();
      await enter.click();
      await expect(page.getByTestId('replay-skip')).toBeVisible();
      if (await waitForStep(request, token, 'shop', 25_000)) break;
      // 未通关时仍在 story 步（do_* 遮罩不拦点击），回放控件可点
      await page.getByTestId('replay-skip').click();
      const back = page.getByTestId('replay-back');
      await expect(back).toBeVisible();
      await back.click();
      await expect(page.getByTestId('story-page')).toBeVisible();
    }
    await expectStep(request, token, 'shop');

    // 9. shop：打开商城即通过（visit_shop）
    await navLink(page, 'shop').click();
    await expect(page.getByTestId('shop-card').first()).toBeVisible();
    await expectStep(request, token, 'complete');

    // 10. complete：末步按钮文案为「完成引导」
    await expect(nextBtn).toContainText('完成引导');
    await nextBtn.click();
    await expect.poll(async () => (await tutorialState(request, token)).completed, {
      timeout: 20_000,
    }).toBe(true);

    // 完成后：遮罩消失、侧栏不再有锁、受限端点不再 403
    await expect(nextBtn).toHaveCount(0);
    await expect(navLink(page, 'pvp')).not.toHaveAttribute('aria-disabled', 'true');
    const res = await apiCall(request, 'GET', '/api/shop/catalog', token);
    expect(res.status).toBe(200);
    const me = await apiCall(request, 'GET', '/api/users/me', token);
    const badges = unwrap<{ badges: string[] }>(me.body, '读取用户信息').badges;
    expect(badges).toContain('onboarding-done');
  });
});
