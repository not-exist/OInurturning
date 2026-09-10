import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerUser,
  loginViaUI,
  fund,
  apiCall,
  unwrap,
  type TestAccount,
} from '../fixtures';

/**
 * 讲课：达标直讲必成功 / 强接窗口成功或讲砸皆合法 / 低于强接下限拒单。
 * 各分支对学员 V 有确定性要求，故 setup 阶段经 API 按 V 定向招募，
 * 避免随机招募导致的跳过（旧版 V<7 时 skip 约 19% 的运行）。
 */
test.describe('讲课', () => {
  interface CandidateAttrs {
    ds: number;
    dp: number;
    math: number;
    graph: number;
    greedy: number;
    str: number;
    code: number;
    thinking: number;
  }
  interface Candidate {
    tempId: string;
    attrs: CandidateAttrs;
  }

  /** 与 shared.computeV 同公式：floor((code+thinking+floor(六维和/6))/3)。 */
  function vOfAttrs(a: CandidateAttrs): number {
    const dimAvg = Math.floor((a.ds + a.dp + a.math + a.graph + a.greedy + a.str) / 6);
    return Math.floor((a.code + a.thinking + dimAvg) / 3);
  }

  async function poolOf(request: APIRequestContext, token: string): Promise<Candidate[]> {
    const res = await apiCall(request, 'GET', '/api/academy/pool', token);
    return unwrap<{ candidates: Candidate[] }>(res.body, '取招募池').candidates;
  }

  async function recruitTempId(
    request: APIRequestContext,
    token: string,
    tempId: string,
  ): Promise<number> {
    const res = await apiCall(request, 'POST', '/api/academy/recruit', token, { tempId });
    return unwrap<{ id: number }>(res.body, '招募').id;
  }

  async function studentV(
    request: APIRequestContext,
    token: string,
    studentId: number,
  ): Promise<number> {
    const res = await apiCall(request, 'GET', '/api/students', token);
    const students = unwrap<{ id: number; v: number }[]>(res.body, '学员列表');
    return students.find((s) => s.id === studentId)?.v ?? 0;
  }

  /** 扫池直至出现 V≥15 候选并招募（单池 5 人命中约 76%，10 池≈100%）。 */
  async function recruitAtLeast(
    request: APIRequestContext,
    account: TestAccount,
    threshold: number,
  ): Promise<number> {
    for (let round = 0; round < 10; round += 1) {
      const candidates = await poolOf(request, account.accessToken);
      const hit = candidates.find((c) => vOfAttrs(c.attrs) >= threshold);
      if (hit) return recruitTempId(request, account.accessToken, hit.tempId);
      const refreshed = await apiCall(request, 'POST', '/api/academy/refresh', account.accessToken);
      unwrap(refreshed.body, '刷新招募池');
    }
    throw new Error(`10 轮扫池未出现 V≥${threshold} 候选`);
  }

  /** 逐个招募直至 V 落入 [lo, hi)（单抽命中约 64%，8 人≈100%）。 */
  async function recruitInWindow(
    request: APIRequestContext,
    account: TestAccount,
    lo: number,
    hi: number,
  ): Promise<number> {
    for (let round = 0; round < 8; round += 1) {
      let candidates = await poolOf(request, account.accessToken);
      if (candidates.length === 0) {
        const refreshed = await apiCall(request, 'POST', '/api/academy/refresh', account.accessToken);
        candidates = unwrap<{ candidates: Candidate[] }>(refreshed.body, '刷新招募池').candidates;
      }
      const id = await recruitTempId(request, account.accessToken, candidates[0]!.tempId);
      const v = await studentV(request, account.accessToken, id);
      if (v >= lo && v < hi) return id;
    }
    throw new Error(`8 次招募未出现 V∈[${lo},${hi}) 学员`);
  }

  test('达标直讲必成功并记一条记录', async ({ page, request }) => {
    const account = await registerUser(request, 'lec');
    await fund(account.username, { money: 50000 });
    const studentId = await recruitAtLeast(request, account, 15);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy/lecture');
    await expect(page.getByTestId('lecture-logs')).not.toBeVisible();
    await expect(page.getByText('暂无记录。')).toBeVisible();

    await page.getByTestId('lecture-student').selectOption(String(studentId));
    await expect(page.getByTestId('lecture-force')).not.toBeVisible();
    await page.getByTestId('lecture-teach').click();
    const logs = page.getByTestId('lecture-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
    await expect(logs).toContainText('成功');
  });

  test('V 在强接窗口内可强接，结果成功或讲砸皆合法', async ({ page, request }) => {
    const account = await registerUser(request, 'lec');
    await fund(account.username, { money: 50000 });
    const studentId = await recruitInWindow(request, account, 7, 15);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy/lecture');
    await page.getByTestId('lecture-student').selectOption(String(studentId));
    await expect(page.getByTestId('lecture-force')).toBeVisible();
    await page.getByTestId('lecture-force').check();
    await page.getByTestId('lecture-teach').click();
    const logs = page.getByTestId('lecture-logs');
    await expect(logs).toBeVisible();
    await expect(logs.getByRole('listitem')).toHaveCount(1);
    await expect(logs).toContainText(/成功|讲砸/);
  });

  test('V 低于强接下限时拒单并提示"讲课未能开始"', async ({ page, request }) => {
    const account = await registerUser(request, 'lec');
    await fund(account.username, { money: 50000 });
    // 国家队集训队门槛 V80、强接下限 V72：新招学员 V 上限约 43，恒在窗口之下，单抽即确定性拒单
    const candidates = await poolOf(request, account.accessToken);
    const studentId = await recruitTempId(request, account.accessToken, candidates[0]!.tempId);
    await loginViaUI(page, account.username, account.password);

    await page.goto('/academy/lecture');
    await page.getByTestId('lecture-student').selectOption(String(studentId));
    await page.getByTestId('lecture-tier').selectOption('national');
    await expect(page.getByTestId('lecture-force')).not.toBeVisible();
    await page.getByTestId('lecture-teach').click();
    await expect(page.getByTestId('lecture-error')).toContainText('讲课未能开始');
  });
});
