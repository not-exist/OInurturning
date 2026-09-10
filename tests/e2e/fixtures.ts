import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';

const execFileAsync = promisify(execFile);

export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'mysql://oinur:oinur@127.0.0.1:3306/oinur_e2e';
export const E2E_JWT_SECRET =
  process.env.E2E_JWT_SECRET ?? 'e2e-jwt-secret-0123456789abcdef-change-me';

export const DEFAULT_PASSWORD = 'E2ePlayer1234!';

/** 每个 spec 独立命名空间：避免不同文件间的用户名/赛事名冲突。 */
let counter = 0;
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface TestAccount {
  username: string;
  password: string;
  accessToken: string;
  userId: number;
}

/** 经 API 注册（快；UI 注册流程由 auth.spec.ts 覆盖）。用户名须 ≥3 字符。 */
export async function registerUser(
  request: APIRequestContext,
  prefix = 'e2e',
  password: string = DEFAULT_PASSWORD,
): Promise<TestAccount> {
  const username = uniqueName(prefix);
  const res = await request.post(`${API_URL}/api/auth/register`, {
    data: { username, password },
  });
  if (!res.ok()) throw new Error(`注册 ${username} 失败：${res.status()} ${await res.text()}`);
  const body = (await res.json()) as {
    ok: boolean;
    data: { accessToken: string; me: { id: number; username: string } };
  };
  return {
    username,
    password,
    accessToken: body.data.accessToken,
    userId: body.data.me.id,
  };
}

export async function loginUser(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { username, password },
  });
  if (!res.ok()) throw new Error(`登录 ${username} 失败：${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { ok: boolean; data: { accessToken: string } };
  return body.data.accessToken;
}

/** 带 Authorization 头的 API 调用（JSON 信封 ok 断言由调用方处理）。 */
export async function apiCall(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token?: string,
  data?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    data,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status(), body };
}

/** 经 UI 登录（覆盖真实登录链路；断言 Salt 后落在 / 首页）。 */
export async function loginViaUI(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-username').fill(username);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL('/');
}

export interface FundOptions {
  money?: number;
  reputation?: number;
  items?: Record<string, number>;
}

/**
 * 注资（DB 直写，见 apps/api/src/scripts/e2e-seed.ts 文件头注释的背景说明）。
 * 要求从仓库根运行（CI：pnpm e2e；本地同）。
 */
export async function fund(username: string, opts: FundOptions): Promise<void> {
  const args = ['-C', 'apps/api', 'e2e:seed', 'fund', username];
  if (opts.money !== undefined) args.push('--money', String(opts.money));
  if (opts.reputation !== undefined) args.push('--reputation', String(opts.reputation));
  for (const [itemId, qty] of Object.entries(opts.items ?? {})) {
    args.push('--item', `${itemId}=${qty}`);
  }
  await execFileAsync('pnpm', args, {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: E2E_DATABASE_URL, JWT_SECRET: E2E_JWT_SECRET },
  });
}

/** 回拨赛事时间窗（串行：spec 内按需调用）。 */
export async function backdateTournament(tournamentId: number): Promise<void> {
  await execFileAsync('pnpm', ['-C', 'apps/api', 'e2e:seed', 'backdate-tournament', String(tournamentId)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: E2E_DATABASE_URL, JWT_SECRET: E2E_JWT_SECRET },
  });
}

export interface AdminAccount {
  username: string;
  password: string;
}

/** 读取 globalSetup 写入的管理员账号。 */
export async function readAdminAccount(): Promise<AdminAccount> {
  const raw = await readFile(path.resolve(process.cwd(), 'tests/e2e/.auth/admin.json'), 'utf8');
  return JSON.parse(raw) as AdminAccount;
}

/** 以管理员身份拿 token（走登录接口，顺带校验管理员链路）。 */
export async function adminToken(request: APIRequestContext): Promise<string> {
  const admin = await readAdminAccount();
  return loginUser(request, admin.username, admin.password);
}

/**
 * 历练"万能钥匙"道具篮：覆盖 events.yaml 全部 requires_item 取值
 * （direction-charm / firewall / milk-tea / spare-cable），外加历练/培养常用品。
 * 配合高额 money（覆盖 cost_money ≤ 8000），保证任何随机事件都有可选分支。
 */
export const ADVENTURE_KEYCHAIN: Record<string, number> = {
  'direction-charm': 2,
  firewall: 2,
  'milk-tea': 3,
  'spare-cable': 2,
};

/** 旅程/专项 spec 的标准玩家启动包。 */
export const STARTER_KIT: Record<string, number> = {
  ...ADVENTURE_KEYCHAIN,
  'entry-ticket': 2,
  'rename-card': 1,
  'stamina-potion': 2,
  'calm-pill': 2,
  coffee: 1,
  'book-ds-green': 2,
  'book-ds-gray': 2,
};

/** 从学员卡片文本解析 V 值（卡片展示 "V = 12" / "V 12" 字样）。 */
export function parseV(cardText: string): number | null {
  const match = /V\s*=?\s*(\d+)/.exec(cardText);
  return match ? Number(match[1]) : null;
}

export interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code?: string; message?: string };
}

export function unwrap<T>(body: unknown, what: string): T {
  const env = body as Envelope<T>;
  if (!env || env.ok !== true) {
    throw new Error(`${what} 失败：${JSON.stringify(body)}`);
  }
  return env.data;
}

/**
 * 从候选卡片文本估算 V（展示值为 floor 后的整数，估算与真值至多差 1，
 * 只用于"选全场最高 V"这类排序场景，不做门槛判定）。
 */
export function candidateVProxy(cardText: string): number {
  const num = (label: string): number => {
    const match = new RegExp(`${label}\\s+(\\d+)`).exec(cardText);
    return match ? Number(match[1]) : 0;
  };
  const dims = ['数据', '动态', '数学', '图论', '贪心', '字符串'].map(num);
  const dimAvg = Math.floor(dims.reduce((a, b) => a + b, 0) / 6);
  return Math.floor((num('代码') + num('思维') + dimAvg) / 3);
}

/**
 * 依次点击启用的历练分支，结算失败则换下一个；返回是否结算成功。
 * （分支随机：keychain+高额资金保证总有可用分支，energy 不足等个案靠换分支兜底。）
 */
export async function resolveAdventureChoice(page: Page): Promise<boolean> {
  const selector = '[data-testid^="adventure-choice-"]';
  const count = await page.locator(selector).count();
  for (let i = 0; i < count; i += 1) {
    const choice = page.locator(selector).nth(i);
    if (await choice.isDisabled()) continue;
    await choice.click();
    try {
      await page.waitForSelector(selector, { state: 'detached', timeout: 8000 });
      return true;
    } catch {
      // 选项仍在：若出现结算报错则试下一个分支，否则再等一轮
      if (await page.getByTestId('adventure-choose-error').isVisible()) continue;
      try {
        await page.waitForSelector(selector, { state: 'detached', timeout: 8000 });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

/** 经 API 招募一名学员（返回 studentId；调用方须已注资）。 */
export async function recruitStudent(
  request: APIRequestContext,
  token: string,
  candidateIndex = 0,
): Promise<number> {
  const pool = await apiCall(request, 'GET', '/api/academy/pool', token);
  const view = unwrap<{ candidates: { tempId: string }[] }>(pool.body, '取招募池');
  const candidate = view.candidates[candidateIndex];
  if (!candidate) throw new Error(`招募池第 ${candidateIndex} 位无候选人`);
  const reg = await apiCall(request, 'POST', '/api/academy/recruit', token, {
    tempId: candidate.tempId,
  });
  return unwrap<{ id: number }>(reg.body, '招募').id;
}
