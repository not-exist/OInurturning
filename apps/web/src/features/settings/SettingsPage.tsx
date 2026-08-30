import { useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiCallError } from '../../lib/api';
import type { MeView } from '@oinur/shared';

export function SettingsPage(): JSX.Element {
  const qc = useQueryClient();
  const nav = useNavigate();
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<MeView>('/api/users/me') });
  const [msg, setMsg] = useState<string | null>(null);

  const changePwd = useMutation({
    mutationFn: (body: { oldPassword: string; newPassword: string }) =>
      apiFetch('/api/auth/password', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.clear();
      nav('/login');
    },
    onError: (e) => setMsg(e instanceof ApiCallError ? '旧密码错误' : '操作失败'),
  });

  const deactivate = useMutation({
    mutationFn: (password: string) =>
      apiFetch('/api/auth/deactivate', { method: 'POST', body: JSON.stringify({ password }) }),
    onSuccess: () => {
      qc.clear();
      nav('/login');
    },
    onError: () => setMsg('注销失败：密码确认不符'),
  });

  if (meQ.isLoading) return <p className="text-neutral-500">加载中…</p>;
  if (meQ.isError || !meQ.data) return <p className="text-red-600">加载失败</p>;
  const me = meQ.data;

  function onChange(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) {
      setMsg('两次新密码不一致');
      return;
    }
    changePwd.mutate({
      oldPassword: String(f.get('oldPassword')),
      newPassword: String(f.get('newPassword')),
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">账户信息</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-neutral-500">用户 ID</dt>
          <dd>{me.id}</dd>
          <dt className="text-neutral-500">用户名</dt>
          <dd>{me.username}</dd>
          <dt className="text-neutral-500">注册时间</dt>
          <dd>{new Date(me.createdAt).toLocaleString()}</dd>
          <dt className="text-neutral-500">上次登录</dt>
          <dd>{me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : '—'}</dd>
          <dt className="text-neutral-500">金钱 / 声誉</dt>
          <dd>
            {me.money} / {me.reputation}
          </dd>
        </dl>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">修改密码</h2>
        <form onSubmit={onChange} className="space-y-2 text-sm">
          <input
            name="oldPassword"
            type="password"
            required
            placeholder="当前密码"
            className="w-full rounded border px-3 py-2"
          />
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            maxLength={72}
            placeholder="新密码（8–72 位）"
            className="w-full rounded border px-3 py-2"
          />
          <input
            name="confirm"
            type="password"
            required
            placeholder="确认新密码"
            className="w-full rounded border px-3 py-2"
          />
          <button className="rounded bg-neutral-900 px-4 py-2 text-white">保存</button>
        </form>
      </section>

      <section className="rounded border border-red-200 bg-red-50 p-4">
        <h2 className="mb-2 font-semibold text-red-700">危险区</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (confirm('确认注销账户？该操作不可恢复，将删除全部数据！'))
              deactivate.mutate(String(new FormData(e.currentTarget).get('password')));
          }}
          className="flex gap-2 text-sm"
        >
          <input
            name="password"
            type="password"
            required
            placeholder="输入密码确认注销"
            className="flex-1 rounded border px-3 py-2"
          />
          <button className="rounded bg-red-600 px-4 py-2 text-white">注销账户</button>
        </form>
      </section>

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
