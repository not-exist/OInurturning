import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, fund, recruitStudent, apiCall, unwrap } from '../fixtures';

/** 讲课：达标必成功/强接分支/门槛不足拒单。 */
test.describe('讲课', () => {
  async function setupLectureStudent(request: Parameters<typeof apiCall>[0]) {
    const account = await registerUser(request, 'lec');
    await fund(account.username, { money: 50000 });
    const studentId = await recruitStudent(request, account.accessToken);
    const list = await apiCall(request, 'GET', '/api/students', account.accessToken);
    const students = unwrap<{ id: number; v: number }[]>(list.body, '学员列表');
    const v = students.find((s) => s.id === studentId)?.v ?? 0;
    return { account, studentId, v };
  }

  test('达标讲课必成功并记一条记录；V 在窗口内可强接', async ({ page, request }) => {
    const { account, v } = await setupLectureStudent(request);
    test.skip(v < 7, `学员 V=${v} 低于强接下限，跳过主流程（由拒单用例覆盖）`);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy/lecture');
    await expect(page.getByTestId('lecture-logs')).not.toBeVisible();
    await expect(page.getByText('暂无记录。')).toBeVisible();

    if (v < 15) {
      // 强接分支：勾选后开讲，结果成功或讲砸皆为合法结算
      await expect(page.getByTestId('lecture-force')).toBeVisible();
      await page.getByTestId('lecture-force').check();
      await page.getByTestId('lecture-teach').click();
      const logs = page.getByTestId('lecture-logs');
      await expect(logs).toBeVisible();
      await expect(logs.getByRole('listitem')).toHaveCount(1);
      await expect(logs).toContainText(/成功|讲砸/);
    } else {
      await page.getByTestId('lecture-teach').click();
      const logs = page.getByTestId('lecture-logs');
      await expect(logs).toBeVisible();
      await expect(logs.getByRole('listitem')).toHaveCount(1);
      await expect(logs).toContainText('成功');
    }
  });

  test('V 低于门槛下限时拒单并提示"讲课未能开始"', async ({ page, request }) => {
    const { account } = await setupLectureStudent(request);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy/lecture');
    // 国家队集训队门槛 V80：新招学员不可能达到（强接窗口 [72,80) 之外）
    await page.getByTestId('lecture-tier').selectOption('national');
    await expect(page.getByTestId('lecture-force')).not.toBeVisible();
    await page.getByTestId('lecture-teach').click();
    await expect(page.getByTestId('lecture-error')).toContainText('讲课未能开始');
  });
});
