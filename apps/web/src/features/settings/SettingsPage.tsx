import { useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import { apiFetch, ApiCallError } from '../../lib/api';
import type { MeView } from '@oinur/shared';
import { Icon } from '../../components/icons';
import { Btn, ErrorNote, KeyVal, PageHeader, Panel, RollingNumber } from '../../components/ui';
import { reputationTitle } from '../../lib/rarity';
import { ROLE_LABEL } from '../../lib/labels';

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
    // STATE_CONFLICT＝尚有进行中的 PVP 赛事（护栏见 api auth/service.ts deactivate）：
    // 此时物理删除会让该赛事对所有剩余选手卡死，故先拒绝，等赛事结束再注销。
    onError: (e) =>
      setMsg(
        e instanceof ApiCallError && e.code === 'STATE_CONFLICT'
          ? '注销失败：你还有进行中的 PVP 赛事，请等赛事结束后再注销'
          : '注销失败：密码确认不符',
      ),
  });

  if (meQ.isPending) return <p className="text-fg-dim">读取账户信息…</p>;
  if (meQ.isError || !meQ.data) return <ErrorNote onRetry={() => void meQ.refetch()}>账户信息读取失败。</ErrorNote>;
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
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Coach Profile" title="用户设置" />

      <section data-testid="settings-me" className="panel panel-corners mb-5 p-4">
        <p className="eyebrow mb-1">Account</p>
        <h2 className="mb-4 text-sm font-semibold">账户信息</h2>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center border border-cyber-500/60 bg-cyber-400/10 text-cyber-300">
            <Icon icon={UserRound} className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{me.username}</p>
            <p className="text-xs text-fg-dim">
              {ROLE_LABEL[me.role]} · {reputationTitle(me.reputation)}
            </p>
          </div>
          <div className="ml-auto flex gap-6">
            <div className="text-right">
              <p className="eyebrow">金币</p>
              <p className="numeral text-xl text-warn-400">
                <RollingNumber value={me.money} />
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">声誉</p>
              <p className="numeral text-xl text-cyber-300">
                <RollingNumber value={me.reputation} />
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <KeyVal k="账户 ID">{me.id}</KeyVal>
          <KeyVal k="账号角色">{ROLE_LABEL[me.role]}</KeyVal>
          <KeyVal k="注册时间">{new Date(me.createdAt).toLocaleString()}</KeyVal>
          <KeyVal k="上次登录">
            {me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : '—'}
          </KeyVal>
          <KeyVal k="金钱 / 声誉">
            {me.money} / {me.reputation}
          </KeyVal>
          <KeyVal k="已获徽章">{me.badges.length > 0 ? me.badges.length : '—'}</KeyVal>
        </div>
      </section>

      <Panel
        eyebrow="Security"
        title="修改密码"
        className="mb-5"
        bodyClassName="p-4"
        actions={<Icon icon={KeyRound} className="size-4 text-fg-faint" />}
      >
        <form onSubmit={onChange} className="space-y-3 text-sm">
          <label className="block">
            <span className="eyebrow mb-1 block">当前密码</span>
            <input
              data-testid="pwd-old"
              name="oldPassword"
              type="password"
              required
              placeholder="当前密码"
              className="w-full border border-ink-600 bg-ink-850/80 px-3 py-2 focus:border-cyber-400/70"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow mb-1 block">新密码</span>
              <input
                data-testid="pwd-new"
                name="newPassword"
                type="password"
                required
                minLength={8}
                maxLength={72}
                placeholder="新密码（8–72 位）"
                className="w-full border border-ink-600 bg-ink-850/80 px-3 py-2 focus:border-cyber-400/70"
              />
            </label>
            <label className="block">
              <span className="eyebrow mb-1 block">确认新密码</span>
              <input
                data-testid="pwd-confirm"
                name="confirm"
                type="password"
                required
                placeholder="确认新密码"
                className="w-full border border-ink-600 bg-ink-850/80 px-3 py-2 focus:border-cyber-400/70"
              />
            </label>
          </div>
          <Btn data-testid="pwd-save" type="submit" variant="primary" disabled={changePwd.isPending}>
            保存并重新登录
          </Btn>
        </form>
      </Panel>

      <section className="panel border-bad-400/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon icon={ShieldAlert} className="size-4 text-bad-400" />
          <h2 className="text-sm font-semibold text-bad-400">危险区 · 注销账户</h2>
        </div>
        <p className="mb-3 text-xs text-fg-dim">
          注销即物理删除：学员、道具、战报与全部进度不可恢复，用户名会被释放、可被他人重新注册。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              confirm(
                '确认注销账户？该操作不可恢复，将立即删除全部数据（学员/道具/战报/进度），且用户名会被释放、可被他人重新注册！',
              )
            )
              deactivate.mutate(String(new FormData(e.currentTarget).get('password')));
          }}
          className="flex flex-wrap gap-2 text-sm"
        >
          <input
            data-testid="deactivate-password"
            name="password"
            type="password"
            required
            placeholder="输入密码确认注销"
            className="min-w-[12rem] flex-1 border border-ink-600 bg-ink-850/80 px-3 py-2 focus:border-bad-400/70"
          />
          <Btn data-testid="deactivate-submit" type="submit" variant="danger" disabled={deactivate.isPending}>
            <Icon icon={Trash2} className="size-3.5" />
            注销账户
          </Btn>
        </form>
      </section>

      {msg && (
        <p data-testid="settings-msg" className="mt-4 text-sm text-bad-400">
          {msg}
        </p>
      )}
    </div>
  );
}
