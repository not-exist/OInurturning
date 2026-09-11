import { useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch, setAccessToken, ApiCallError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import type { MeView } from '@oinur/shared';

export function LoginPage(): JSX.Element {
  const nav = useNavigate();
  const setMe = useAuthStore((s) => s.setMe);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const d = await apiFetch<{ accessToken: string; me: MeView }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAccessToken(d.accessToken);
      setMe(d.me);
      nav('/');
    } catch (e2) {
      setErr(
        e2 instanceof ApiCallError && e2.code === 'INVALID_CREDENTIALS'
          ? '用户名或密码错误'
          : '登录失败，请稍后再试',
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-center text-2xl font-bold">OInurturning</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
        <input
          data-testid="login-username"
          className="rounded border px-3 py-2"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          data-testid="login-password"
          className="rounded border px-3 py-2"
          type="password"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <p data-testid="auth-error" className="text-sm text-red-600">{err}</p>}
        <button
          data-testid="login-submit"
          className="rounded bg-neutral-900 py-2 font-medium text-white hover:bg-neutral-700"
          type="submit"
        >
          登录
        </button>
        <p className="text-center text-sm text-neutral-500">
          没有账号？
          <Link className="text-blue-600 underline" to="/register">
            注册
          </Link>
        </p>
      </form>
    </div>
  );
}
