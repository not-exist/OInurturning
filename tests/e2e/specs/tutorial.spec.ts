import { test, expect } from '@playwright/test';
import { registerUser, loginViaUI, API_URL, DEFAULT_PASSWORD } from '../fixtures';

test.describe('新手引导', () => {
  test('新用户应收到引导状态，完成后解锁全部', async ({ request, page }) => {
    const account = await registerUser(request, 'tut');
    // 新用户引导未完成
    const res = await request.get(`${API_URL}/api/tutorial`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.completed).toBe(false);
    expect(body.data.total).toBeGreaterThanOrEqual(9);
    expect(body.data.current).toBeDefined();

    // 未完成时访问受限 API 应被 FORBIDDEN
    const shopRes = await request.get(`${API_URL}/api/shop`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    expect(shopRes.status()).toBe(403);
    const shopBody = await shopRes.json();
    expect(shopBody.error?.code ?? shopBody.code).toBe('FORBIDDEN');

    // 跳过引导
    const skipRes = await request.post(`${API_URL}/api/tutorial/skip`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    expect(skipRes.ok()).toBeTruthy();
    const skipBody = await skipRes.json();
    expect(skipBody.data.completed).toBe(true);

    // 跳过后可访问商店
    const shopOk = await request.get(`${API_URL}/api/shop`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    expect(shopOk.ok()).toBeTruthy();

    // 前端应显示引导完成，不再有 overlay
    await loginViaUI(page, account.username, DEFAULT_PASSWORD);
    await expect(page.locator('[data-tutorial="nav-shop"]')).toBeVisible();
    // 引导完成后不应有遮罩
    await expect(page.locator('text=新手引导')).toHaveCount(0);
  });

  test('引导步骤按顺序推进，自动触发', async ({ request }) => {
    const account = await registerUser(request, 'tut2', DEFAULT_PASSWORD);
    // 先重置为未完成？registerUser 已跳过，我们需要新号不跳过
    // 直接用 API 注册不带跳过
    const username = `tut-seq-${Date.now()}`;
    const res = await request.post(`${API_URL}/api/auth/register`, {
      data: { username, password: DEFAULT_PASSWORD },
    });
    const body = await res.json();
    const token = body.data.accessToken as string;

    // 初始 step 0
    const init = await request.get(`${API_URL}/api/tutorial`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const initBody = await init.json();
    expect(initBody.data.step).toBe(0);

    // 访问 students 触发 visit_students
    await request.get(`${API_URL}/api/students`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 稍等自动推进
    await new Promise((r) => setTimeout(r, 500));
    const afterStudents = await request.get(`${API_URL}/api/tutorial`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterBody = await afterStudents.json();
    // 如果当前步骤是 visit_students，应该已推进到 2
    // 由于 welcome 是 none，需要手动推进到 students，然后 visit_students 自动
    // 我们手动推进 welcome
    await request.post(`${API_URL}/api/tutorial/advance`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { step: 1 },
    });
    // 再次访问 students
    await request.get(`${API_URL}/api/students`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await new Promise((r) => setTimeout(r, 500));
    const after = await request.get(`${API_URL}/api/tutorial`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterData = await after.json();
    // 应该至少推进到 training
    expect(afterData.data.step).toBeGreaterThanOrEqual(2);
  });
});
