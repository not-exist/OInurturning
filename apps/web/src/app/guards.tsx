import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { tryRefresh } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';

export function RequireAuth() {
  const { me, booted, setMe, setBooted } = useAuthStore();
  useEffect(() => {
    if (booted) return;
    void tryRefresh().then((ok) => {
      if (!ok) setMe(null);
      setBooted(true);
    });
  }, [booted, setBooted, setMe]);
  if (!booted)
    return (
      <div className="grid min-h-screen place-items-center text-neutral-500">连接服务器中…</div>
    );
  return me ? <Outlet /> : <Navigate to="/login" replace />;
}
