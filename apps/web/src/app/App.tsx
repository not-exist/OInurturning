import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { LogOut, Sparkles } from 'lucide-react';
import { apiFetch, setAccessToken } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useOverview } from '../lib/hooks';
import { nextReputationTitle, reputationTitle } from '../lib/rarity';
import { Icon, NAV_ICON, type LucideIcon } from '../components/icons';
import { RollingNumber } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '指挥中心',
    items: [{ to: '/', label: '总览', icon: NAV_ICON.overview, end: true }],
  },
  {
    title: '培养',
    items: [
      { to: '/students', label: '学员管理', icon: NAV_ICON.students },
      { to: '/training', label: '训练中心', icon: NAV_ICON.training },
      { to: '/backpack', label: '背包', icon: NAV_ICON.backpack },
      { to: '/problem-library', label: '出题题库', icon: NAV_ICON.problems },
    ],
  },
  {
    title: '学院',
    items: [
      { to: '/academy', label: '高级学院', icon: NAV_ICON.academy, end: true },
      { to: '/academy/lecture', label: '讲课', icon: NAV_ICON.lecture },
    ],
  },
  {
    title: '征程',
    items: [
      { to: '/adventure', label: '历练', icon: NAV_ICON.adventure },
      { to: '/story', label: '剧情模式', icon: NAV_ICON.story },
      { to: '/pvp', label: 'PVP', icon: NAV_ICON.pvp },
    ],
  },
];

export function Layout(): JSX.Element {
  const { me, setMe } = useAuthStore();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const overview = useOverview();

  const adminGroup: NavGroup = {
    title: '系统',
    items: [
      { to: '/settings', label: '用户设置', icon: NAV_ICON.settings },
      ...(me?.role === 'ADMIN'
        ? [{ to: '/admin', label: '管理端', icon: NAV_ICON.admin }]
        : []),
    ],
  };

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

  const reputation = me?.reputation ?? 0;
  const nextTitle = nextReputationTitle(reputation);
  const stamina = overview.data?.students.items.reduce((sum, s) => sum + Math.floor(s.stamina), 0);
  const staminaMax = (overview.data?.students.items.length ?? 0) * 5;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* 侧栏：品牌 + 分组导航 */}
      <aside className="shrink-0 border-b border-ink-600/70 bg-ink-900/60 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2.5 px-4 py-3 lg:py-5">
          <span className="relative flex size-8 items-center justify-center border border-cyber-500/60 bg-cyber-400/10 text-cyber-300">
            <Icon icon={Sparkles} className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-bold tracking-[0.12em]">
              OINURTURNING
            </span>
            <span className="block truncate text-[10px] tracking-[0.2em] text-fg-faint">
              训练营指挥中心
            </span>
          </span>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:block lg:space-y-4 lg:overflow-visible lg:px-3 lg:pb-6">
          {[...NAV_GROUPS, adminGroup].map((group) => (
            <div key={group.title} className="shrink-0 lg:shrink">
              <p className="eyebrow hidden px-2 pb-1.5 lg:block">{group.title}</p>
              <ul className="flex gap-1 lg:block lg:space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `relative flex shrink-0 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-cyber-400/10 text-cyber-300'
                            : 'text-fg-dim hover:bg-ink-700/60 hover:text-fg'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            aria-hidden
                            className={`absolute inset-y-0 left-0 w-[2px] ${
                              isActive ? 'bg-cyber-400' : 'bg-transparent'
                            }`}
                          />
                          <Icon icon={item.icon} className="size-4 shrink-0" />
                          {item.label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部 HUD：常驻资源条 */}
        <header
          data-testid="hud"
          className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-ink-600/70 bg-ink-950/80 px-4 py-2 backdrop-blur"
        >
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <HudStat label="金币">
              <RollingNumber value={overview.data?.me.money ?? me?.money ?? 0} />
            </HudStat>
            <HudStat label="声誉">
              <RollingNumber value={reputation} />
              <span className="ml-1.5 text-[10px] text-fg-faint">
                {reputationTitle(reputation)}
                {nextTitle !== null ? ` · 距${nextTitle.label} ${nextTitle.gap}` : ''}
              </span>
            </HudStat>
            <HudStat label="学员">
              <span className="tnum">
                {overview.data?.students.total ?? '—'}
              </span>
            </HudStat>
            <HudStat label="体力">
              <span className="tnum">
                {stamina === undefined ? '—' : `${stamina}/${staminaMax}`}
              </span>
            </HudStat>
          </dl>

          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-good-400" aria-hidden />
              {me?.username}
            </span>
            <button
              data-testid="logout-btn"
              onClick={() => void logout()}
              className="flex cursor-pointer items-center gap-1 border border-ink-600 px-2 py-1 text-fg-dim transition-colors hover:border-ink-500 hover:text-fg"
            >
              <Icon icon={LogOut} className="size-3.5" />
              登出
            </button>
          </div>
        </header>

        {/* 路由内容：以 pathname 为 key 播放一次入场动画 */}
        <main key={pathname} className="animate-rise min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function HudStat({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[10px] tracking-[0.14em] text-fg-faint uppercase">{label}</dt>
      <dd className="font-display text-sm text-fg">{children}</dd>
    </div>
  );
}
