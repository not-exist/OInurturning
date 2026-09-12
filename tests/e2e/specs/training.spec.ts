import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent, apiCall, unwrap } from '../fixtures';

/** 训练中心：基础/定向/专项三条链路。 */
test.describe('训练中心', () => {
  test('基础训练：选人→开训→"训练完成"面板展示增益与花费', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'train');
    await fund(account.username, { money: 50000 });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-run').click();
    const result = page.getByTestId('train-result');
    await expect(result).toContainText('训练完成');
    await expect(result).toContainText('消耗');
    await expect(result).toContainText('剩余体力');
  });

  test('定向训练：选维+选书开训成功并可结算', async ({ page, request }) => {
    const account = await registerUser(request, 'train');
    await fund(account.username, { money: 50000, items: { 'book-ds-green': 2 } });
    await recruitStudent(request, account.accessToken);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-tab-directed').click();
    await page.getByTestId('train-dim-DS').click();
    await page.getByTestId('train-book').selectOption('book-ds-green');
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
  });

  test('专项训练：无题时提示且按钮禁用；有题后可选题开训', async ({
    page,
    request,
  }) => {
    const account = await registerUser(request, 'train');
    await fund(account.username, { money: 50000 });
    const studentId = await recruitStudent(request, account.accessToken);

    // 先验证空题库分支
    await loginViaUI(page, account.username, account.password);
    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-tab-specialized').click();
    await expect(page.getByText('暂无可用预制题')).toBeVisible();
    await expect(page.getByTestId('train-run')).toBeDisabled();

    // 经 API 造一道题，再走 UI 专项
    const created = await apiCall(request, 'POST', '/api/problem-library', account.accessToken, {
      studentId,
      dimension: 'DS',
    });
    unwrap<{ id: number }>(created.body, '出题');
    await page.reload();
    await page.getByTestId('train-student').first().click();
    await page.getByTestId('train-tab-specialized').click();
    await page.getByRole('radio', { name: /Q \d+/ }).first().check();
    await expect(page.getByTestId('train-run')).toBeEnabled();
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
  });

  test('训练记录 API：落库字段完整且游标翻页正确', async ({ request }) => {
    const account = await registerUser(request, 'trainlog');
    await fund(account.username, { money: 50000 });
    // 开局包 2 学员：取首名做 3 次基础训练（体力 5→2）
    const list = await apiCall(request, 'GET', '/api/students', account.accessToken);
    const students = unwrap<{ id: number; name: string }[]>(list.body, '学员列表');
    expect(students).toHaveLength(2);
    const trainee = students[0];
    for (let i = 0; i < 3; i += 1) {
      const r = await apiCall(request, 'POST', '/api/training/basic', account.accessToken, {
        studentId: trainee.id,
      });
      const data = unwrap<{ logId: number }>(r.body, `第${i + 1}次训练`);
      expect(data.logId).toBeGreaterThan(0);
    }
    // 第一页 limit=2：倒序 + 游标非空
    const p1 = await apiCall(
      request,
      'GET',
      `/api/training/logs?studentId=${trainee.id}&limit=2`,
      account.accessToken,
    );
    const page1 = unwrap<
      {
        items: {
          id: number;
          studentName: string;
          kind: string;
          dim: string;
          delta: number;
          cost: number;
        }[];
        nextCursor: number | null;
      }
    >(p1.body, '记录第1页');
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.items[0].id).toBeGreaterThan(page1.items[1].id);
    expect(page1.items[0].kind).toBe('basic');
    expect(page1.items[0].studentName).toBe(trainee.name);
    expect(typeof page1.items[0].delta).toBe('number');
    // 第二页：剩余 1 条，游标耗尽
    const p2 = await apiCall(
      request,
      'GET',
      `/api/training/logs?studentId=${trainee.id}&limit=2&cursor=${page1.nextCursor}`,
      account.accessToken,
    );
    const page2 = unwrap<{ items: unknown[]; nextCursor: number | null }>(p2.body, '记录第2页');
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    // 非法游标 400
    const bad = await apiCall(request, 'GET', '/api/training/logs?cursor=abc', account.accessToken);
    expect(bad.status).toBe(400);
  });

  test('训练记录 UI：开训后记录区出现条目，类型筛选可用', async ({ page, request }) => {
    const account = await registerUser(request, 'trainlog');
    await fund(account.username, { money: 50000 });
    await loginViaUI(page, account.username, account.password);

    await page.goto('/training');
    await page.getByTestId('train-student').first().click();
    await expect(page.getByText('暂无训练记录')).toBeVisible();
    await page.getByTestId('train-run').click();
    await expect(page.getByTestId('train-result')).toContainText('训练完成');
    const list = page.getByTestId('train-log-list');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('基础');
    // 切到定向筛选：基础记录被滤掉
    await page.getByTestId('train-log-kind').selectOption('directed');
    await expect(page.getByText('暂无训练记录')).toBeVisible();
  });
});
