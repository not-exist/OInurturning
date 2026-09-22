import { Navigate, Outlet, useLocation } from 'react-router';
import type { JSX } from 'react';
import { useTutorial, ROUTE_KEY_MAP, isRouteUnlocked } from '../lib/tutorial';
import { useAuthStore } from '../lib/auth-store';
import { InlineLoader } from '../components/ui';

export function RequireTutorial(): JSX.Element {
  const { me } = useAuthStore();
  const tutorial = useTutorial();
  const location = useLocation();

  if (tutorial.isLoading) {
    return (
      <div className="grid place-items-center p-8">
        <InlineLoader>读取引导进度…</InlineLoader>
      </div>
    );
  }

  if (!tutorial.data || tutorial.data.completed) return <Outlet />;
  if (me?.role === 'ADMIN') return <Outlet />;

  const path = location.pathname;
  // 找到最匹配的 route key
  let routeKey = 'overview';
  // 精确匹配优先
  for (const [route, key] of Object.entries(ROUTE_KEY_MAP)) {
    if (path === route || path.startsWith(route + '/')) {
      if (route.length > (ROUTE_KEY_MAP[routeKey] ? 0 : 0)) {
        // 实际上按最长前缀匹配
        routeKey = key;
      }
    }
  }
  // 更准确：按路径长度排序
  const sorted = Object.entries(ROUTE_KEY_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [route, key] of sorted) {
    if (path === route || path.startsWith(route + '/') || (route === '/' && path === '/')) {
      routeKey = key;
      break;
    }
  }

  const unlocked = tutorial.data.unlocked;
  if (isRouteUnlocked(unlocked, routeKey) || routeKey === 'overview') {
    return <Outlet />;
  }

  // 未解锁，跳转到总览并提示
  return <Navigate to="/" replace />;
}
