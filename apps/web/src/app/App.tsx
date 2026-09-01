import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, setAccessToken } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';

const TABS = [
  { to: '/', label: '总览' },
  { to: '/students', label: '学员管理' },
  { to: '/training', label: '训练中心' },
  { to: '/backpack', label: '背包' },
  { to: '/academy', label: '高级学院' },
  { to: '/adventure', label: '历练', soon: true },
  { to: '/story', label: '剧情模式' },
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
      <div className="flex flex-1 flex-col md:flex-row">
        <nav className="flex w-full shrink-0 gap-1 overflow-x-auto border-b bg-white p-2 text-sm md:block md:w-44 md:border-r md:border-b-0">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end
              className={({ isActive }) =>
                `shrink-0 rounded px-3 py-2 md:block ${isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'} ${'soon' in t && t.soon ? 'text-neutral-400' : ''}`
              }
            >
              {t.label}
              {'soon' in t && t.soon ? '（建设中）' : ''}
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `shrink-0 rounded px-3 py-2 md:block ${isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'}`
            }
          >
            用户设置
          </NavLink>
        </nav>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
