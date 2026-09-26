import { Navigate, Outlet, useLocation } from 'react-router';
import type { JSX } from 'react';
import { useTutorial, ROUTE_KEY_MAP, isRouteUnlocked } from '../lib/tutorial';
import { useAuthStore } from '../lib/auth-store';
import { ActionLink, ErrorNote, InlineLoader } from '../components/ui';
import { ApiCallError, apiErrorMessage } from '../lib/api';

/** 最长前缀匹配：'/academy/lecture' 优先于 '/academy'；未登记路径返回 null */
function routeKeyFor(path: string): string | null {
  const sorted = Object.entries(ROUTE_KEY_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [route, key] of sorted) {
    if (path === route || path.startsWith(`${route}/`)) return key;
  }
  return null;
}

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

  // fail-closed：进度取不到就不放行 —— 放行等于引导期整站（含 pvp/管理端）越权可见
  if (tutorial.isError || !tutorial.data) {
    // 登录态失效重试无意义，补一个重新登录入口；5xx/网络错误维持仅重试
    const authError =
      tutorial.error instanceof ApiCallError &&
      (tutorial.error.code === 'UNAUTHENTICATED' || tutorial.error.code === 'TOKEN_EXPIRED');
    return (
      <div className="p-8">
        <ErrorNote onRetry={() => void tutorial.refetch()}>
          引导进度读取失败：{apiErrorMessage(tutorial.error)}
        </ErrorNote>
        {authError && (
          <div className="mt-3">
            <ActionLink to="/login">重新登录</ActionLink>
          </div>
        )}
      </div>
    );
  }

  if (tutorial.data.completed) return <Outlet />;
  if (me?.role === 'ADMIN') return <Outlet />;

  const routeKey = routeKeyFor(location.pathname);
  // 未命中映射的路径（新增页面漏登记 / 手输地址）一律视为锁定，不再默认当成 overview 放行
  if (routeKey === null) return <Navigate to="/" replace />;
  // overview 是引导期常驻入口（服务端每一步的 unlock 都含它）
  if (routeKey === 'overview') return <Outlet />;
  if (isRouteUnlocked(tutorial.data.unlocked, routeKey)) return <Outlet />;

  // 未解锁，跳转到总览并提示
  return <Navigate to="/" replace />;
}
