import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginViaUI,
  fund,
  recruitStudent,
  apiCall,
  unwrap,
  uniqueName,
  ADVENTURE_KEYCHAIN,
} from '../fixtures';

/** 总览：开局包快照展示 + 开局任务 5 步 + 徽章领取幂等。 */
test.describe('总览与开局任务', () => {
  test('新用户总览展示开局包快照', async ({ page, request }) => {
    const account = await registerUser(request, 'ov');
    await loginViaUI(page, account.username, account.password);

    await page.goto('/');
    await expect(page.getByTestId('overview-page')).toBeVisible();
    await expect(page.getByTestId('overview-wallet')).toContainText('金币 1000');
    await expect(page.getByTestId('overview-wallet')).toContainText('声誉 10');
    await expect(page.getByText('我的学员（2）')).toBeVisible();
    await expect(page.getByTestId('checklist-progress')).toHaveText('0/5');
    await expect(page.getByText('当前候选 5 人')).toBeVisible();
    await expect(page.getByTestId('checklist-claim')).toBeDisabled();
  });

  test('做完 5 步开局任务后可领取徽章（重复领取幂等）', async ({ page, request }) => {
    const account = await registerUser(request, 'ov');
    await fund(account.username, {
      money: 200000,
      items: { ...ADVENTURE_KEYCHAIN, 'stamina-potion': 2 },
    });
    const token = account.accessToken;
    const list = await apiCall(request, 'GET', '/api/students', token);
    const students = unwrap<{ id: number; qualityTier: string }[]>(list.body, '学员列表');
    expect(students).toHaveLength(2);
    // GOOD（V≈14）做剧情+训练+讲课，另一人只做历练
    const good = students.find((s) => s.qualityTier === 'GOOD') ?? students[0];
    const other = students.find((s) => s.id !== good.id) ?? students[1];

    // 1) 剧情：GOOD 打 cspj:1（NPC 均值 8 取前 8，单次≈99%；至多 3 次，重查进度确认通关）
    let cleared = false;
    for (let attempt = 0; attempt < 3 && !cleared; attempt += 1) {
      const entered = await apiCall(request, 'POST', '/api/story/stages/cspj:1/enter', token, {
        roster: [good.id],
        ngLevel: 0,
        idempotencyKey: uniqueName('ov-story'),
      });
      unwrap(entered.body, `剧情首关第${attempt + 1}次`);
      const progress = await apiCall(request, 'GET', '/api/story/progress', token);
      const rows = unwrap<{ stageKey: string; clearCount: number }[]>(progress.body, '剧情进度');
      cleared = (rows.find((r) => r.stageKey === 'cspj:1')?.clearCount ?? 0) > 0;
    }
    expect(cleared).toBe(true);
    // 回体（剧情至多耗 3，药水 +3 保证后续训练 1 + 讲课 2 够用）
    const potion = await apiCall(request, 'POST', '/api/items/use', token, {
      itemId: 'stamina-potion',
      studentId: good.id,
    });
    unwrap(potion.body, '体力药水');
    // 2) 训练：GOOD 基础 1 次
    const trained = await apiCall(request, 'POST', '/api/training/basic', token, {
      studentId: good.id,
    });
    unwrap(trained.body, '基础训练');
    // 3) 讲课：GOOD 入门组强接（V 远高于 7 的强制下限；成败都落 log）
    const lectured = await apiCall(request, 'POST', '/api/academy/lectures', token, {
      studentId: good.id,
      tier: 'beginner',
      force: true,
    });
    unwrap(lectured.body, '讲课');
    // 4) 历练：另一人直抽 tier1 后逐个试可用分支直到 RESOLVED
    const drawn = await apiCall(request, 'POST', '/api/adventures/draw', token, {
      studentId: other.id,
      tier: 1,
    });
    const adventure = unwrap<{
      id: number;
      event: { choices: { index: number; available: boolean }[] | null };
    }>(drawn.body, '历练抽卡');
    let completed = false;
    for (const choice of adventure.event.choices ?? []) {
      if (!choice.available) continue;
      const resolved = await apiCall(
        request,
        'POST',
        `/api/adventures/${adventure.id}/choice`,
        token,
        {
          optionIndex: choice.index,
        },
      );
      if (
        resolved.status === 200 &&
        unwrap<{ completed: boolean }>(resolved.body, '历练分支').completed
      ) {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
    // 5) 招募第 3 名学员
    await recruitStudent(request, token);

    const ov = await apiCall(request, 'GET', '/api/overview', token);
    const data = unwrap<{
      checklist: { doneCount: number; total: number; claimed: boolean; rewardBadge: string };
    }>(ov.body, '总览');
    expect(data.checklist.doneCount).toBe(5);
    expect(data.checklist.claimed).toBe(false);

    await loginViaUI(page, account.username, account.password);
    await page.goto('/');
    await expect(page.getByTestId('checklist-progress')).toHaveText('5/5');
    await page.getByTestId('checklist-claim').click();
    await expect(page.getByText(/领取成功/)).toBeVisible();
    // 刷新后保持已领取态；重复领取走幂等（already，不报错）
    await page.reload();
    await expect(page.getByText(`已领取：${data.checklist.rewardBadge}`)).toBeVisible();
    const again = await apiCall(request, 'POST', '/api/overview/checklist/claim', token);
    const againData = unwrap<{ claimed: boolean; already: boolean }>(again.body, '重复领取');
    expect(againData.already).toBe(true);
  });
});
