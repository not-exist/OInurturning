import type { JSX, ReactNode } from 'react';
import { Network, type LucideIcon } from 'lucide-react';
import { Icon } from '../../components/icons';

export interface AuthBullet {
  icon: LucideIcon;
  title: string;
  desc: string;
}

/** 认证页外壳：左侧氛围板（品牌 + 卖点列表 + 状态行）+ 右侧表单（移动端纵排）。 */
export function AuthFrame({
  eyebrow,
  title,
  bullets,
  statusLines,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  bullets: AuthBullet[];
  statusLines?: string[];
  children: ReactNode;
  footer: ReactNode;
}): JSX.Element {
  return (
    <div className="grid min-h-screen place-items-center p-4 lg:p-8">
      <div className="grid w-full max-w-4xl border border-ink-600/80 bg-ink-900/60 backdrop-blur lg:grid-cols-[1.05fr_1fr]">
        {/* 氛围板 */}
        <div className="relative flex flex-col overflow-hidden border-b border-ink-600/70 p-8 lg:border-r lg:border-b-0">
          <span className="scanlines" aria-hidden />
          <div className="relative flex-1">
            <span className="flex size-10 items-center justify-center border border-cyber-500/60 bg-cyber-400/10 text-cyber-300">
              <Icon icon={Network} className="size-5" />
            </span>
            <p className="mt-6 font-display text-3xl font-bold tracking-[0.08em]">
              OINUR
              <span className="rainbow-text">TURNING</span>
            </p>
            <p className="mt-2 text-sm text-fg-muted">
              OI 训练营经营模拟 —— 招募学员、训练历练、组队打比赛、讲课变现。
            </p>

            <ul className="mt-8 space-y-4">
              {bullets.map((bullet) => (
                <li key={bullet.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-ink-600 bg-ink-800/70 text-cyber-400">
                    <Icon icon={bullet.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{bullet.title}</span>
                    <span className="block text-xs text-fg-dim">{bullet.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {statusLines !== undefined && (
            <div className="relative mt-8 space-y-1 border-t border-ink-600/70 pt-3">
              {statusLines.map((line) => (
                <p key={line} className="flex items-center gap-2 font-mono text-[11px] text-fg-faint">
                  <span className="size-1 animate-pulse-dot rounded-full bg-good-400" aria-hidden />
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* 表单 */}
        <div className="p-8">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1 mb-6 text-xl font-semibold">{title}</h1>
          {children}
          <p className="mt-6 text-center text-sm text-fg-dim">{footer}</p>
        </div>
      </div>
    </div>
  );
}

/** 表单字段：标签 + 输入（testid 直接落在 input 上，e2e 依赖）。 */
export function Field({
  testId,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
}: {
  testId: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      <input
        data-testid={testId}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-ink-600 bg-ink-850/80 px-3 py-2 text-sm text-fg transition-colors placeholder:text-fg-faint focus:border-cyber-400/70"
      />
    </label>
  );
}
