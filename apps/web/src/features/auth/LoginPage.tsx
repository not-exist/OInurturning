import { useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Compass, Swords, Users } from 'lucide-react';
import { apiFetch, setAccessToken, ApiCallError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import type { MeView } from '@oinur/shared';
import { Icon } from '../../components/icons';
import { Btn, InlineLoader } from '../../components/ui';
import { AuthFrame, Field } from './AuthFrame';

export function LoginPage(): JSX.Element {
  const nav = useNavigate();
  const setMe = useAuthStore((s) => s.setMe);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const d = await apiFetch<{ accessToken: string; me: MeView }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAccessToken(d.accessToken);
      setMe(d.me);
      nav('/');
    } catch (e2) {
      //  文案与 ERROR_TEXT.INVALID_CREDENTIALS 有意并存：e2e 断言的是这一版页面文案
      setErr(
        e2 instanceof ApiCallError && e2.code === 'INVALID_CREDENTIALS'
          ? '用户名或密码错误'
          : '登录失败，请稍后再试',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="登录"
      title="回到指挥中心"
      bullets={[
        { icon: Users, title: '招募与培养', desc: '从气质判断潜力，靠训练与历练把学员送上赛场。' },
        { icon: Swords, title: '组队参赛', desc: '排名赛并行作战，出题对决 2N 局，胜负由引擎权威结算。' },
        { icon: Compass, title: '挂机也在进步', desc: '现实时间驱动：体力自动回充，离线也在积累。' },
      ]}
      statusLines={['引擎就绪 · 服务端权威结算', '赛季：8 章 / 33 关 / 8 档赛事']}
      footer={
        <>
          没有账号？
          <Link className="ml-1 text-cyber-300 underline decoration-cyber-500/50" to="/register">
            创建训练营
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <Field
          testId="login-username"
          label="教练代号"
          placeholder="用户名"
          value={username}
          onChange={setUsername}
          autoComplete="username"
        />
        <Field
          testId="login-password"
          label="通行密钥"
          type="password"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {err && (
          <p data-testid="auth-error" className="text-sm text-bad-400">
            {err}
          </p>
        )}
        <Btn
          data-testid="login-submit"
          type="submit"
          variant="primary"
          disabled={busy}
          className="w-full py-2"
        >
          {busy ? <InlineLoader>登录中…</InlineLoader> : <>登录 <Icon icon={ArrowRight} className="size-4" /></>}
        </Btn>
      </form>
    </AuthFrame>
  );
}
