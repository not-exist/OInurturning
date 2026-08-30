import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, setAccessToken } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';

const TABS = [
  { to: '/', label: '总览' },
  { to: '/students', label: '学员管理', soon: true },
  { to: '/backpack', label: '背包', soon: true },
  { to: '/academy', label: '高级学院', soon: true },
  { to: '/adventure', label: '历练', soon: true },
  { to: '/story', label: '剧情模式', soon: true },
  { to: '/pvp', label: 'PVP', soon: true },
] as const;

export function Layout() {
  const { me, setMe } = useAuthStore();
  const nav = useNavigate();
  const qc = useQueryClient();

  async function logout(): Promise<void> {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setMe(null);
      qc.clear();
      nav('/login');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <span className="font-bold">OInurturning</span>
        <div className="flex items-center gap-3 text-sm">
          {me && <span className="text-neutral-500">{me.username}</span>}
          <button onClick={() => void logout()} className="underline">
            登出
          </button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="w-44 shrink-0 border-r bg-white p-2 text-sm">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'} ${'soon' in t && t.soon ? 'text-neutral-400' : ''}`
              }
            >
              {t.label}
              {'soon' in t && t.soon ? '（建设中）' : ''}
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'}`
            }
          >
            用户设置
          </NavLink>
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
