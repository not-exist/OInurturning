import { useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Coins, UserPlus } from 'lucide-react';
import { apiFetch, setAccessToken, ApiCallError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import type { MeView } from '@oinur/shared';
import { Icon } from '../../components/icons';
import { Btn, InlineLoader } from '../../components/ui';
import { AuthFrame, Field } from './AuthFrame';

export function RegisterPage(): JSX.Element {
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
      const d = await apiFetch<{ accessToken: string; me: MeView }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAccessToken(d.accessToken);
      setMe(d.me);
      nav('/');
    } catch (e2) {
      // ⚠️ 文案与 ERROR_TEXT 有意并存：e2e 断言的是这一版页面文案
      setErr(
        e2 instanceof ApiCallError && e2.code === 'ALREADY_EXISTS'
          ? '用户名已被占用'
          : '注册失败，请稍后再试',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="New Coach"
      title="开办你的训练营"
      bullets={[
        { icon: Coins, title: '开局资源', desc: '2500 金 + 2 名学员（1 良好 1 普通）+ 2 杯奶茶。' },
        { icon: UserPlus, title: '第一步：招到第 3 人', desc: '三名学员才够组队出战，剧情与历练都在等你。' },
        { icon: ArrowRight, title: '一条主线走到 IOI', desc: '8 章 33 关、8 档赛事，全通解锁 NG+ 与传奇教练勋章。' },
      ]}
      statusLines={['NEW COACH · 注册即发放开局包']}
      footer={
        <>
          已有账号？
          <Link className="ml-1 text-cyber-300 underline decoration-cyber-500/50" to="/login">
            直接登录
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <Field
          testId="register-username"
          label="教练代号"
          placeholder="用户名"
          value={username}
          onChange={setUsername}
          autoComplete="username"
        />
        <Field
          testId="register-password"
          label="通行密钥"
          type="password"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        {err && (
          <p data-testid="auth-error" className="text-sm text-bad-400">
            {err}
          </p>
        )}
        <Btn
          data-testid="register-submit"
          type="submit"
          variant="primary"
          disabled={busy}
          className="w-full py-2"
        >
          {busy ? (
            <InlineLoader>创建中…</InlineLoader>
          ) : (
            <>
              开办训练营 <Icon icon={ArrowRight} className="size-4" />
            </>
          )}
        </Btn>
      </form>
    </AuthFrame>
  );
}
