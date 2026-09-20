import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import type { JSX } from 'react';
import { tryRefresh } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { InlineLoader } from '../components/ui';

export function RequireAuth(): JSX.Element {
  const { me, booted, setMe, setBooted } = useAuthStore();
  useEffect(() => {
    if (booted) return;
    void tryRefresh().then((ok) => {
      if (!ok) setMe(null);
      setBooted(true);
    });
  }, [booted, setBooted, setMe]);
  if (!booted) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="space-y-3 text-center">
          <p className="eyebrow">OINURTURNING</p>
          <InlineLoader>正在接入指挥中心…</InlineLoader>
        </div>
      </div>
    );
  }
  return me ? <Outlet /> : <Navigate to="/login" replace />;
}

/**
 * 管理端守卫：非管理员直连 /admin 显示统一失败文案（不做「请申请权限」之类的引导文案——
 * 管理员入口只在侧栏对 ADMIN 渲染，直连本就不该成功）。
 */
export function RequireAdmin(): JSX.Element {
  const me = useAuthStore((s) => s.me);
  if (me?.role !== 'ADMIN') {
    return <p className="text-sm text-bad-400">管理端数据加载失败。</p>;
  }
  return <Outlet />;
}
