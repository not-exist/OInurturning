import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  registerUserRaw,
  loginViaUI,
  fund,
  apiCall,
  unwrap,
  pickRoster,
  ADVENTURE_KEYCHAIN,
  DEFAULT_PASSWORD,
} from '../fixtures';

/**
 * 强制新手引导（13 步，真源 docs/data/tutorial.yaml）：
 * welcome → students → training-pick（选学员，点卡片即推进）→ training → academy → recruit（在册 ≥4 即通过）
 * → lecture-enter（点侧栏「讲课」即推进）→ lecture-pick（看档位，点「下一步」推进）
 * → lecture-force（勾「强接」即推进，未渲染则点「下一步」）→ lecture（点「开始讲课」）
 * → story-enter（点侧栏「剧情模式」即推进）→ story-pick（勾 4 人，点「下一步」推进）
 * → story（末步：点第一关「进入」开打，进关即判引导完成）。
 * （历练不设引导：入口随 recruit 步的 unlock 一并放行，但不强制走一遍；末步 unlock 为 all，
 *   故打完第一关前商城/PVP 等已全部放开。）
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

  /** 侧栏导航项（限定在 <nav> 内：即便页内出现同名 data-tutorial，也只取侧栏那个） */
  function navLink(page: Page, key: string) {
    return page.locator(`nav [data-tutorial="nav-${key}"]`);
  }

  /**
   * 服务端 autoAdvanceIfNeeded 是 fire-and-forget + 独立事务，前端靠 2s 轮询收敛，
   * 故这里自己轮询（expectStep 内部复用）。
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
    expect(state.total).toBe(13);
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
    await expectStep(request, token, 'training-pick');

    // 3. training-pick：先高亮第一张学员卡，点它即推进（「下一步」是锚点缺失时的兜底）
    await navLink(page, 'training').click();
    await expect(page.getByTestId('training-page')).toBeVisible();
    await page.getByTestId('train-student').first().click();
    await expectStep(request, token, 'training');

    // 4. training：选一名学员后开始基础训练。
    //    刻意练最后一名：讲课要 2 点、历练各 1 点，把消耗摊在不同学员身上，
    //    剧情步（唯一可能需要重打的一步）才有体力余量。
    await page.getByTestId('train-student').last().click();
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
    await expectStep(request, token, 'academy');

    // 5. academy：打开候选池即通过（visit_academy 只认 GET /api/academy/pool）
    await navLink(page, 'academy').click();
    await expect(page.getByTestId('academy-page')).toBeVisible();
    await expectStep(request, token, 'recruit');

    // 6. recruit：在册 ACTIVE ≥ 4 才通过 —— 从候选池里挑最便宜的两名各招募一次
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
    await expectStep(request, token, 'lecture-enter');

    // 7. lecture-enter：招募结束玩家还停在学院页，而讲课档位锚点在 /academy/lecture ——
    //    没有这一步引导时目标不在 DOM，聚光圈直接消失、只剩整屏暗场（真 bug）。
    await navLink(page, 'lecture').click();
    await expectStep(request, token, 'lecture-pick');

    // 8. lecture-pick：档位步只让人看 —— 点档位不推进（advance_on_target_click: false），
    //    出口是引导卡上的「下一步」，点完才进讲课步高亮「开始讲课」。
    await expect(page.getByTestId('lecture-page')).toBeVisible();
    await page.locator("[data-tutorial='next-btn']").click();
    await expectStep(request, token, 'lecture-force');

    // 9. lecture-force：入门组门槛 V15、强接窗口 [7,15) —— 开局 GOOD 学员（V≈14）多半要勾「强接」。
    //    不勾会被服务端拒单（lecture.ts:176）而拒单不推进本步。该行未渲染说明默认学员已达标，
    //    此时锚点缺失、退化为整屏暗场，出口是引导卡上的「下一步」。
    const force = page.getByTestId('lecture-force');
    if (await force.isVisible()) {
      await force.check();
    } else {
      await page.locator("[data-tutorial='next-btn']").click();
    }
    await expectStep(request, token, 'lecture');

    // 10. lecture：高亮「开始讲课」。do_* 步遮罩不拦点击，故此刻还能改选 V 最高的学员提高成功率
    const students = unwrap<{ id: number; v: number }[]>(roster.body, '学员列表');
    const speaker = [...students].sort((a, b) => b.v - a.v)[0]!;
    await page.getByTestId('lecture-student').selectOption(String(speaker.id));
    await page.getByTestId('lecture-teach').click();
    // 讲砸也推进（服务端 do_lecture 在写日志后无条件 autoAdvance），但拒单不会：据此断言未拒单
    await expect(page.getByTestId('lecture-logs').or(page.getByTestId('lecture-error'))).toBeVisible();
    await expect(page.getByTestId('lecture-error'), '讲课被拒单会导致本步无法推进').toHaveCount(0);
    await expect(page.getByTestId('lecture-logs').getByRole('listitem')).toHaveCount(1);
    await expectStep(request, token, 'story');

    // 11. story-enter：点侧栏「剧情模式」即推进
    await navLink(page, 'story').click();
    await expect(page.getByTestId('story-page')).toBeVisible();
    await expectStep(request, token, 'story-pick');

    // 12. story-pick：勾满 4 人。勾选不推进（advance_on_target_click: false），出口是「下一步」
    await pickRoster(page, 'story-roster', 4);
    await page.locator("[data-tutorial='next-btn']").click();
    await expectStep(request, token, 'story');

    // 13. story（末步）：点第一关「进入」开打 —— 进关即判完成：不再等通关，也不再有后续卡片
    const enter = page.getByTestId('story-enter').first();
    await expect(enter).toBeEnabled();
    await enter.click();
    await expect(page.getByTestId('replay-skip')).toBeVisible();
    await expect
      .poll(async () => (await tutorialState(request, token)).completed, { timeout: 20_000 })
      .toBe(true);

    // 完成后：遮罩消失、侧栏不再有锁、受限端点不再 403
    await expect(page.getByTestId('tutorial-card')).toHaveCount(0);
    await expect(navLink(page, 'pvp')).not.toHaveAttribute('aria-disabled', 'true');
    const res = await apiCall(request, 'GET', '/api/shop/catalog', token);
    expect(res.status).toBe(200);
    const me = await apiCall(request, 'GET', '/api/users/me', token);
    const badges = unwrap<{ badges: string[] }>(me.body, '读取用户信息').badges;
    expect(badges).toContain('onboarding-done');
  });

  /**
   * 遮罩/聚光圈回归：十步走查只断言步骤推进，不关心「用户看得到指示」。
   * 深页锚点（training-student / training-basic / recruit / lecture）在矮视口下目标首屏不可见，
   * 历史实现会把洞口 clamp 到视口后判空 → 只剩整屏暗场、零指示（真 bug）。
   * viewport 必须在 describe 级用 test.use 固定：滚动是步骤激活时的一次性动作，
   * 页面加载完再 resize 不会重放。
   */
  test.describe('引导高亮', () => {
    test.use({ viewport: { width: 1280, height: 600 } });

    test('训练两段引导：先聚光学员卡，点掉后聚光训练按钮', async ({ page, request }) => {
      const account = await registerUserRaw(request, 'tutspot');
      const token = account.accessToken;
      await loginViaUI(page, account.username, DEFAULT_PASSWORD);

      await expectStep(request, token, 'welcome');
      await page.locator('[data-tutorial="next-btn"]').click();
      await expectStep(request, token, 'students');
      await navLink(page, 'students').click();
      await expectStep(request, token, 'training-pick');
      await navLink(page, 'training').click();
      await expect(page.getByTestId('training-page')).toBeVisible();

      // 第一段：学员卡必须被滚进视口并聚光
      await expect(page.getByTestId('tutorial-spotlight'), '选学员步应高亮第一张学员卡').toBeVisible();
      const student = await page.locator("[data-tutorial='training-student']").boundingBox();
      expect(student, '学员卡锚点应已挂载').not.toBeNull();
      expect(student!.y, '学员卡应被滚进视口').toBeGreaterThanOrEqual(0);
      expect(student!.y + student!.height, '学员卡应完整落在视口内').toBeLessThanOrEqual(600);

      // 点学员卡即推进到训练步（纯前端状态，服务端感知不到，只能由点击驱动）
      await page.locator("[data-tutorial='training-student']").click();
      await expectStep(request, token, 'training');

      // 第二段：聚光切到「开始基础训练」，引导卡仍留在视口内
      await expect(page.getByTestId('tutorial-spotlight'), '训练步应高亮「开始基础训练」').toBeVisible();
      const run = await page.locator("[data-tutorial='training-basic']").boundingBox();
      expect(run, '训练按钮锚点应已挂载').not.toBeNull();
      expect(run!.y, '训练按钮应被滚进视口').toBeGreaterThanOrEqual(0);
      expect(run!.y + run!.height, '训练按钮应完整落在视口内').toBeLessThanOrEqual(600);
      const card = await page.getByTestId('tutorial-card').boundingBox();
      expect(card!.y + card!.height, '引导卡应留在视口内').toBeLessThanOrEqual(600);
    });
  });
});
