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
 * 强制新手引导（14 步，真源 docs/data/tutorial.yaml）：
 * welcome → students（visit，点侧栏「学员管理」）→ training-enter（点侧栏「训练中心」即推进）
 * → training-pick（点第一张学员卡即推进）→ training（开始基础训练）→ academy（visit，点侧栏「高级学院」）
 * → recruit（在册 ≥4 即通过；唯一 block_outside_click: false 的步）→ lecture-enter（点侧栏「讲课」即推进）
 * → lecture-pick（看档位，点「下一步」推进）→ lecture-force（勾「强接」即推进，未渲染则点「下一步」）
 * → lecture（点「开始讲课」）→ story-enter（点侧栏「剧情模式」即推进）→ story-pick（勾 4 人，点「下一步」推进）
 * → story（末步：点第一关「进入」开打，进关即判引导完成）。
 *
 * 遮罩口径：有高亮（洞口可见）即拦洞外点击（block_outside_click 缺省 true），
 * 仅 recruit 步显式放行——进该步时买不起任何候选，玩家必须能离页赚钱再回来。
 *
 * 用例一律用 registerUserRaw 注册（registerUser 内部会 skip，直接把 completed 置 true）。
 * 锁定探针只打**真实存在的**端点（/api/shop/catalog、/api/training/logs、/api/pvp/tournaments）：
 * 打不存在的端点会拿到 404 而不是 403，历史上正是它把「路由缺失」伪装成「引导锁」。
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

  /** 负向断言：留出在途请求的落地时间后，引导必须仍停在该步 */
  async function expectStepStays(request: APIRequestContext, token: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = await tutorialState(request, token);
    expect(state.current?.id ?? 'completed', `洞外点击不应推进引导（应停在「${id}」）`).toBe(id);
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
    expect(state.total).toBe(14);
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

  test('真实走完十四步引导：逐步操作推进，全程不刷新页面', async ({ page, request }) => {
    test.setTimeout(180_000);
    const account = await registerUserRaw(request, 'tutwalk');
    const token = account.accessToken;
    // 一次注足：招募价随在册人数递增（第 3 人 547 起，品质系数最高 ×5），
    // 避免中途因金币不足卡步。
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
    await expectStep(request, token, 'training-enter');

    // 3. training-enter：点侧栏「训练中心」即推进（点目标 = 手动 advance + 导航）
    await navLink(page, 'training').click();
    await expect(page.getByTestId('training-page')).toBeVisible();
    await expectStep(request, token, 'training-pick');

    // 4. training-pick：拦截下唯一可点的学员卡是聚光的第 1 张，点它即推进
    await page.getByTestId('train-student').first().click();
    await expectStep(request, token, 'training');

    // 5. training：洞口就是「开始基础训练」（选人已在上一完成），点它完成训练
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
    await expectStep(request, token, 'academy');

    // 6. academy：打开候选池即通过（visit_academy 只认 GET /api/academy/pool）
    await navLink(page, 'academy').click();
    await expect(page.getByTestId('academy-page')).toBeVisible();
    await expectStep(request, token, 'recruit');

    // 7. recruit：唯一放行洞外点击的步（block_outside_click: false）——
    //    点非聚光位的候选卡也必须能点中，正是这一例外的不变量（若被误拦，这里的
    //    hit-target 检查会一直失败直到超时）。挑最便宜的两名各招募一次，避开品质随机价差。
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

    // 8. lecture-enter：招募结束玩家还停在学院页，而讲课档位锚点在 /academy/lecture ——
    //    没有这一步引导时目标不在 DOM，聚光圈直接消失、只剩整屏暗场（真 bug）。
    await navLink(page, 'lecture').click();
    await expectStep(request, token, 'lecture-pick');

    // 9. lecture-pick：档位步只让人看 —— 点档位不推进（advance_on_target_click: false），
    //    出口是引导卡上的「下一步」，点完才进讲课步高亮「开始讲课」。
    await expect(page.getByTestId('lecture-page')).toBeVisible();
    await nextBtn.click();
    await expectStep(request, token, 'lecture-force');

    // 10. lecture-force：默认主讲是开局 GOOD 学员（V≈14），beginner 门槛 V15，多半要勾「强接」。
    //     不勾会被服务端拒单（拒单不推进本步）。该行未渲染说明默认学员已达标，
    //     此时锚点缺失、退化为整屏暗场，出口是引导卡上的「下一步」。
    const force = page.getByTestId('lecture-force');
    if (await force.isVisible()) {
      await force.check();
    } else {
      await nextBtn.click();
    }
    await expectStep(request, token, 'lecture');

    // 11. lecture：洞口就是「开始讲课」。拦截下无法换主讲（select 会被遮罩吃掉），
    //     主讲即页面默认选中的第一名学员——与 lecture-force 步判定强接的是同一人。
    await page.getByTestId('lecture-teach').click();
    // 讲砸也推进（服务端 do_lecture 在写日志后无条件 autoAdvance），但拒单不会：据此断言未拒单
    await expect(page.getByTestId('lecture-logs').or(page.getByTestId('lecture-error'))).toBeVisible();
    await expect(page.getByTestId('lecture-error'), '讲课被拒单会导致本步无法推进').toHaveCount(0);
    await expect(page.getByTestId('lecture-logs').getByRole('listitem')).toHaveCount(1);
    await expectStep(request, token, 'story-enter');

    // 12. story-enter：点侧栏「剧情模式」即推进
    await navLink(page, 'story').click();
    await expect(page.getByTestId('story-page')).toBeVisible();
    await expectStep(request, token, 'story-pick');

    // 13. story-pick：勾满 4 人（勾选在 story-roster 洞口内）。勾选不推进，出口是「下一步」
    await pickRoster(page, 'story-roster', 4);
    await nextBtn.click();
    await expectStep(request, token, 'story');

    // 14. story（末步）：点第一关「进入」开打 —— 进关即判完成：不再等通关，也不再有后续卡片
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
   * 遮罩/聚光圈回归：走查只断言步骤推进，不关心「用户看得到指示」与「洞外是否真的点不动」。
   * 本组断言三件事：
   * 1. 深页锚点（training-student / training-basic）在矮视口下必须被滚进视口并聚光
   *    （历史实现会把洞口 clamp 到视口后判空 → 只剩整屏暗场、零指示，真 bug）；
   * 2. 有高亮即拦洞外点击：点洞外 UI（force）不导航、不推进；
   * 3. 洞内目标可点：点聚光元素照常完成操作并推进。
   * viewport 必须在 describe 级用 test.use 固定：滚动是步骤激活时的一次性动作，
   * 页面加载完再 resize 不会重放。
   */
  test.describe('引导高亮与拦截', () => {
    test.use({ viewport: { width: 1280, height: 600 } });

    test('训练三段引导：逐步聚光，洞外点击无效，洞内目标可点', async ({ page, request }) => {
      const account = await registerUserRaw(request, 'tutspot');
      const token = account.accessToken;
      await loginViaUI(page, account.username, DEFAULT_PASSWORD);

      const nextBtn = page.locator('[data-tutorial="next-btn"]');

      await expectStep(request, token, 'welcome');
      await nextBtn.click();
      await expectStep(request, token, 'students');

      // students：聚光侧栏「学员管理」
      await expect(page.getByTestId('tutorial-spotlight'), '学员步应聚光侧栏入口').toBeVisible();
      await navLink(page, 'students').click();
      await expect(page.getByTestId('students-page')).toBeVisible();
      await expectStep(request, token, 'training-enter');

      // training-enter：聚光侧栏「训练中心」；洞外的「总览」点了不动（不导航、不推进）
      await expect(page.getByTestId('tutorial-spotlight'), '应高亮「训练中心」入口').toBeVisible();
      await navLink(page, 'overview').click({ force: true });
      await expect(page, '洞外点击不得导航').toHaveURL('/students');
      await expectStepStays(request, token, 'training-enter');
      await navLink(page, 'training').click();
      await expect(page.getByTestId('training-page')).toBeVisible();
      await expectStep(request, token, 'training-pick');

      // training-pick：第一张学员卡必须被滚进视口并聚光；洞外点击无效
      await expect(page.getByTestId('tutorial-spotlight'), '选学员步应高亮第一张学员卡').toBeVisible();
      const student = await page.locator("[data-tutorial='training-student']").boundingBox();
      expect(student, '学员卡锚点应已挂载').not.toBeNull();
      expect(student!.y, '学员卡应被滚进视口').toBeGreaterThanOrEqual(0);
      expect(student!.y + student!.height, '学员卡应完整落在视口内').toBeLessThanOrEqual(600);
      await navLink(page, 'overview').click({ force: true });
      await expect(page, '洞外点击不得导航').toHaveURL('/training');
      await expectStepStays(request, token, 'training-pick');

      // 点学员卡（洞内）即推进（纯前端状态，服务端感知不到，只能由点击驱动）
      await page.locator("[data-tutorial='training-student']").click();
      await expectStep(request, token, 'training');

      // training：聚光切到「开始基础训练」，引导卡仍留在视口内；洞外点击无效，洞内可点并完成训练
      await expect(page.getByTestId('tutorial-spotlight'), '训练步应高亮「开始基础训练」').toBeVisible();
      const run = await page.locator("[data-tutorial='training-basic']").boundingBox();
      expect(run, '训练按钮锚点应已挂载').not.toBeNull();
      expect(run!.y, '训练按钮应被滚进视口').toBeGreaterThanOrEqual(0);
      expect(run!.y + run!.height, '训练按钮应完整落在视口内').toBeLessThanOrEqual(600);
      const card = await page.getByTestId('tutorial-card').boundingBox();
      expect(card!.y + card!.height, '引导卡应留在视口内').toBeLessThanOrEqual(600);
      await navLink(page, 'overview').click({ force: true });
      await expect(page, '洞外点击不得导航').toHaveURL('/training');
      await expectStepStays(request, token, 'training');
      await page.getByTestId('train-run').click();
      await expect(page.getByTestId('train-result')).toContainText('训练完成');
      await expectStep(request, token, 'academy');
    });
  });
});
