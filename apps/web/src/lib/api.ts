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

export { tryRefresh };
