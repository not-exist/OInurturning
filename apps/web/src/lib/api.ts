import type { ApiEnvelope, MeView } from '@oinur/shared';
import { useAuthStore } from './auth-store';

let accessToken: string | null = null;
export function setAccessToken(t: string | null): void {
  accessToken = t;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ||= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const body = (await res.json()) as ApiEnvelope<{ accessToken: string; me: MeView }>;
      if (!body.ok) return false;
      accessToken = body.data.accessToken;
      useAuthStore.getState().setMe(body.data.me);
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export class ApiCallError extends Error {
  constructor(
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doCall = () =>
    fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });

  let res = await doCall();
  let body = (await res.json()) as ApiEnvelope<T>;

  if (!body.ok && body.error.code === 'TOKEN_EXPIRED' && (await tryRefresh())) {
    res = await doCall();
    body = (await res.json()) as ApiEnvelope<T>;
  }
  if (!body.ok) throw new ApiCallError(body.error.code, body.error.details);
  return body.data;
}

/** 常见错误码 → 中文人话（供页面 inline 报错展示）。API 统一信封内 code 见 shared ERROR_CODES。 */
const ERROR_TEXT: Record<string, string> = {
  UNAUTHENTICATED: '登录已失效，请重新登录',
  FORBIDDEN: '没有权限执行该操作',
  NOT_FOUND: '目标不存在或已被移除',
  VALIDATION_FAILED: '提交的数据有误',
  INSUFFICIENT_RESOURCE: '资源不足（金币/体力/道具等）',
  STATE_CONFLICT: '当前状态不允许该操作，请刷新后重试',
  ALREADY_EXISTS: '已存在，请勿重复操作',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  INTERNAL: '服务器开小差了，请稍后再试',
  TOKEN_EXPIRED: '登录已过期，请重新登录',
  INVALID_CREDENTIALS: '账号或密码错误',
};

export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiCallError) return ERROR_TEXT[e.code] ?? e.code;
  return '网络异常，请检查连接后重试';
}

/** 后端字段校验详情 → 简洁中文（details 结构以服务端为准，逐字段拼接） */
export function apiErrorDetails(e: unknown): string | null {
  if (!(e instanceof ApiCallError)) return null;
  const details = e.details;
  if (details === null || details === undefined || typeof details !== 'object') return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) parts.push(`${key}: ${value}`);
    else if (typeof value === 'number') parts.push(`${key}: ${value}`);
  }
  return parts.length > 0 ? parts.join('；') : null;
}

export { tryRefresh };
