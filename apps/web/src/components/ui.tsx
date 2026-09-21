import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type JSX,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { Inbox, X, type LucideIcon } from 'lucide-react';
import { Icon } from './icons';

/**
 * 共享 UI 基元（设计语言的唯一词汇表）。
 * 页面只组合这些基元，不再各写一套灰阶 Tailwind；语义类见 styles/app.css。
 */

// ---------------------------------------------------------------------------
// 容器
// ---------------------------------------------------------------------------

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
  corners = false,
  id,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  corners?: boolean;
  id?: string;
}): JSX.Element {
  return (
    <section id={id} className={`panel ${corners ? 'panel-corners' : ''} ${className}`}>
      {(title !== undefined || actions !== undefined) && (
        <header className="panel-hd">
          <div className="min-w-0">
            {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
            {title !== undefined && (
              <h2 className="truncate text-sm font-semibold tracking-wide">{title}</h2>
            )}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** 可点击卡片：hover 抬升 + 强调色描边，激活态用 aria-selected/aria-current 表达 */
export function Card({
  children,
  className = '',
  selected = false,
  as = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  selected?: boolean;
} & React.HTMLAttributes<HTMLElement> & { as?: 'div' | 'button' | 'label' }): JSX.Element {
  const Cmp = as;
  return (
    <Cmp
      className={`panel transition-[border-color,transform,box-shadow] duration-200 ${
        as === 'button' || as === 'label' ? 'cursor-pointer hover:-translate-y-px' : ''
      } ${
        selected
          ? 'border-cyber-400/70 shadow-[0_0_24px_-12px_var(--color-cyber-400)]'
          : 'hover:border-ink-500'
      } ${className}`}
      {...rest}
    >
      {children}
    </Cmp>
  );
}

/** 页头：超大标题 + 说明行 + 右侧动作 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow !== undefined && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary:
    'border-cyber-400/60 bg-cyber-400/15 text-cyber-300 hover:bg-cyber-400/25 hover:text-cyber-300',
  ghost: 'border-ink-600 bg-transparent text-fg-muted hover:border-ink-500 hover:text-fg',
  danger: 'border-bad-400/50 bg-bad-400/10 text-bad-400 hover:bg-bad-400/20',
  subtle: 'border-transparent bg-ink-700/70 text-fg-muted hover:bg-ink-600 hover:text-fg',
};

export function Btn({
  variant = 'ghost',
  size = 'md',
  className = '',
  children,
  ...rest
}: { variant?: BtnVariant; size?: 'sm' | 'md' } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:border-ink-600 disabled:bg-ink-800/50 disabled:text-fg-faint disabled:opacity-100 disabled:hover:bg-ink-800/50 disabled:hover:text-fg-faint ${
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      } ${BTN_VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ActionLink({
  to,
  children,
  variant = 'primary',
}: {
  to: string;
  children: ReactNode;
  variant?: BtnVariant;
}): JSX.Element {
  return (
    <Link
      to={to}
      className={`inline-flex cursor-pointer items-center gap-1.5 border px-3 py-1.5 text-sm font-medium transition-colors ${
        variant === 'primary'
          ? 'border-cyber-400/60 bg-cyber-400/15 text-cyber-300 hover:bg-cyber-400/25'
          : 'border-ink-600 text-fg-muted hover:border-ink-500 hover:text-fg'
      }`}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// 展示碎片
// ---------------------------------------------------------------------------

/** 小标签（用途分类、状态、来源） */
export function Chip({
  children,
  className = '',
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 border border-ink-600 bg-ink-800/70 px-1.5 py-0.5 text-[11px] text-fg-muted ${className}`}
    >
      {icon !== undefined && <Icon icon={icon} className="size-3" />}
      {children}
    </span>
  );
}

/** 数值条：稀有度/严重度/难度色由调用方通过 className 注入 */
export function Meter({
  value,
  max,
  className = '',
  trackClassName = 'bg-ink-700',
}: {
  value: number;
  max: number;
  className?: string;
  trackClassName?: string;
}): JSX.Element {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`relative h-1.5 w-full overflow-hidden ${trackClassName}`}>
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${className}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** 键值行（HUD、详情、结算面板通用） */
export function KeyVal({
  k,
  children,
  className = '',
}: {
  k: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-xs ${className}`}>
      <span className="text-fg-dim">{k}</span>
      <span className="tnum text-right text-fg">{children}</span>
    </div>
  );
}

/** 巨型数字（V 值 / 排名 / 金币等冲击力位） */
export function Numeral({
  value,
  className = '',
  suffix,
}: {
  value: ReactNode;
  className?: string;
  suffix?: ReactNode;
}): JSX.Element {
  return (
    <span className={`numeral ${className}`}>
      {value}
      {suffix !== undefined && <span className="ml-0.5 text-[0.5em] text-fg-dim">{suffix}</span>}
    </span>
  );
}

/**
 * 数字滚动：值变化时在 ~420ms 内插值到新值（HUD 金币/声誉）。
 * prefers-reduced-motion 下直接落定（样式层已降级动画，这里同步短路）。
 */
export function RollingNumber({ value, className = '' }: { value: number; className?: string }): JSX.Element {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return undefined;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      fromRef.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 420);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(from + (value - from) * eased);
      setShown(next);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value]);

  return <span className={`tnum ${className}`}>{shown}</span>;
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

export function InlineLoader({ children = '加载中…' }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-dim">
      <span className="inline-block size-3 animate-spin rounded-full border-2 border-ink-500 border-t-cyber-400" />
      <span>{children}</span>
    </div>
  );
}

/** 空态：图标取 Lucide 组件（界面零 emoji） */
export function Empty({
  icon = Inbox,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="panel panel-corners empty-briefing">
      <span className="mx-auto mb-3 grid size-12 place-items-center border border-cyber-500/40 bg-cyber-400/10 text-cyber-300/70">
        <Icon icon={icon} className="size-6" />
      </span>
      <p className="font-medium text-fg">{title}</p>
      {children !== undefined && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-fg-dim">{children}</p>
      )}
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-bad-400/40 bg-bad-400/10 px-3 py-2 text-sm text-bad-400">
      <span>{children}</span>
      {onRetry !== undefined && (
        <Btn size="sm" onClick={onRetry}>
          重试
        </Btn>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 悬浮详情（全局统一实现：道具 / 题目 / 天赋 / 学员 / 事件）
// ---------------------------------------------------------------------------

/**
 * 悬浮卡：hover 或键盘聚焦即展开，纯 CSS 定位（无 portal、无 JS 状态）。
 * 需要父级不裁剪（避免 overflow-hidden 容器内使用）。
 */
export function HoverCard({
  children,
  content,
  width = 'w-72',
  className = '',
}: {
  children: ReactNode;
  content: ReactNode;
  width?: string;
  className?: string;
}): JSX.Element {
  return (
    <span className={`group/hc relative inline-flex ${className}`} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full left-0 z-40 mt-2 ${width} origin-top scale-95 border border-ink-500 bg-ink-900/95 p-3 text-left opacity-0 shadow-[0_20px_50px_-20px_#000] backdrop-blur transition-[opacity,transform] duration-150 group-hover/hc:scale-100 group-hover/hc:opacity-100 group-focus-within/hc:scale-100 group-focus-within/hc:opacity-100`}
      >
        {content}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// 模态（Esc 关闭 + 初始聚焦 + 遮罩点击关闭；焦点回到触发元素）
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  width = 'max-w-2xl',
  testId,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  width?: string;
  testId?: string;
  headerExtra?: ReactNode;
}): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener('keydown', onKeyDown);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        data-testid={testId}
        tabIndex={-1}
        className={`animate-rise max-h-[85vh] w-full ${width} overflow-auto border border-ink-500 bg-ink-900 shadow-[0_30px_80px_-30px_#000] outline-none`}
      >
        {title !== undefined && (
          <header className="panel-hd sticky top-0 z-10 bg-ink-900/95 backdrop-blur">
            <div className="min-w-0">
              {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
              <h2 id={titleId} className="truncate text-sm font-semibold">
                {title}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {headerExtra}
              <Btn size="sm" variant="subtle" onClick={onClose} aria-label="关闭">
                <Icon icon={X} className="size-3.5" />
              </Btn>
            </div>
          </header>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}