import { Link } from 'react-router';
import type { ReactNode } from 'react';
import type { JSX } from 'react';

/** 行内加载条（页面顶部/卡片内小段加载提示） */
export function InlineLoader({ children = '加载中…' }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-500">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
      <span>{children}</span>
    </div>
  );
}

/** 空态插图文本（带操作提示的空列表） */
export function Empty({
  icon = '🗂️',
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded border border-dashed bg-white px-6 py-10 text-center">
      <div className="mb-2 text-3xl" aria-hidden>
        {icon}
      </div>
      <p className="font-medium text-neutral-600">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** 页内链接动作（主要 CTA 的链接形态） */
export function ActionLink({ to, children }: { to: string; children: ReactNode }): JSX.Element {
  return (
    <Link to={to} className="inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white">
      {children}
    </Link>
  );
}
