import { useEffect, useState, useRef, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { Btn, Panel } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ArrowRight, Check, X, Sparkles } from 'lucide-react';
import { useAdvanceTutorial, useCompleteTutorial, useTutorial } from '../../lib/tutorial';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TutorialOverlay(): JSX.Element | null {
  const { data: state } = useTutorial();
  const advance = useAdvanceTutorial();
  const complete = useCompleteTutorial();
  const navigate = useNavigate();
  const [rect, setRect] = useState<Rect | null>(null);
  const tickRef = useRef<number | null>(null);

  const cur = state?.current;
  const completed = state?.completed;
  const total = state?.total ?? 0;
  const stepIdx = state?.step ?? 0;

  // 轮询目标位置，支持响应式与滚动
  useEffect(() => {
    if (!cur || completed) {
      setRect(null);
      return;
    }
    const update = () => {
      const r = getTargetRect(cur.target);
      setRect(r);
    };
    update();
    const id = window.setInterval(update, 200);
    const onScroll = () => update();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
    };
  }, [cur, completed]);

  if (!state || completed || !cur) return null;

  const isLast = stepIdx === total - 1;
  const progressPct = Math.round(((stepIdx + 1) / total) * 100);

  const handleNext = async () => {
    // 如果目标是导航，先尝试导航到对应路由
    const targetToRoute: Record<string, string> = {
      "[data-tutorial='nav-students']": '/students',
      "[data-tutorial='training-basic']": '/training',
      "[data-tutorial='nav-academy']": '/academy',
      "[data-tutorial='lecture-tier']": '/academy/lecture',
      "[data-tutorial='nav-adventure']": '/adventure',
      "[data-tutorial='nav-story']": '/story',
      "[data-tutorial='nav-shop']": '/shop',
    };
    const route = cur.target ? targetToRoute[cur.target] : null;
    if (route && cur.action === 'none') {
      // 纯导航步骤，点击后直接推进
      if (!isLast) {
        await advance.mutateAsync(stepIdx + 1);
      } else {
        await complete.mutateAsync();
      }
      if (route) navigate(route);
      return;
    }
    // 对于需要用户操作的步骤，如果 action 为 none，允许手动推进
    if (cur.action === 'none') {
      if (!isLast) {
        await advance.mutateAsync(stepIdx + 1);
      } else {
        await complete.mutateAsync();
      }
    }
    // 否则等待 autoAdvanceIfNeeded 自动推进，按钮展示为提示
  };

  const canManualAdvance = cur.action === 'none';

  // 计算卡片位置：尽量在目标下方，若空间不足则上方或居中
  let cardStyle: React.CSSProperties = {};
  if (rect) {
    const margin = 12;
    const cardWidth = 360;
    let top = rect.top + rect.height + margin;
    let left = rect.left;
    // 防止溢出右边界
    if (left + cardWidth > window.innerWidth - 16) {
      left = window.innerWidth - cardWidth - 16;
    }
    if (left < 16) left = 16;
    // 若下方空间不足，放到上方
    if (top + 200 > window.innerHeight - 16) {
      top = rect.top - 200 - margin;
      if (top < 16) top = 16;
    }
    cardStyle = { position: 'fixed', top, left, width: cardWidth, zIndex: 60 };
  } else {
    // 居中模态
    cardStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(420px, calc(100vw - 32px))',
      zIndex: 60,
    };
  }

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-[1px]" aria-hidden />

      {/* 聚光切口 */}
      {rect && (
        <div
          className="pointer-events-none fixed z-[51] border-2 border-cyber-400/80 shadow-[0_0_0_9999px_rgba(5,7,11,0.7),0_0_24px_-4px_var(--color-cyber-400)]"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            borderRadius: 2,
          }}
        />
      )}

      {/* 引导卡 */}
      <div style={cardStyle} className="animate-rise">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Icon icon={Sparkles} className="size-4 text-cyber-300" />
              {cur.title}
            </span>
          }
          eyebrow={`引导 ${stepIdx + 1} / ${total} · ${progressPct}%`}
          corners
          className="border-cyber-400/40 bg-ink-900/95 shadow-[0_20px_60px_-20px_#000]"
        >
          <div className="space-y-4">
            <div className="h-1 w-full bg-ink-700">
              <div className="h-full bg-cyber-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>

            <p className="text-sm leading-relaxed text-fg-muted">{cur.desc}</p>

            {cur.reward && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                {cur.reward.money && <span className="border border-cyber-400/30 bg-cyber-400/10 px-2 py-0.5 text-cyber-300">+{cur.reward.money} 金币</span>}
                {cur.reward.reputation && <span className="border border-arc-400/30 bg-arc-400/10 px-2 py-0.5 text-arc-300">+{cur.reward.reputation} 声誉</span>}
                {cur.reward.item && <span className="border border-ink-500 bg-ink-800 px-2 py-0.5 text-fg-muted">{cur.reward.item} x{cur.reward.count ?? 1}</span>}
                {cur.reward.badge && <span className="border border-warn-400/30 bg-warn-400/10 px-2 py-0.5 text-warn-400">{cur.reward.badge}</span>}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-fg-faint">
                {cur.action !== 'none' ? `完成「${cur.action}」自动进入下一步` : '按指引体验功能'}
              </span>
              <div className="flex gap-2">
                {canManualAdvance ? (
                  <Btn
                    variant="primary"
                    size="sm"
                    onClick={() => void handleNext()}
                    disabled={advance.isPending || complete.isPending}
                    data-tutorial="next-btn"
                  >
                    {isLast ? (
                      <>
                        <Icon icon={Check} className="size-3.5" /> 完成引导
                      </>
                    ) : (
                      <>
                        下一步 <Icon icon={ArrowRight} className="size-3.5" />
                      </>
                    )}
                  </Btn>
                ) : (
                  <span className="inline-flex items-center gap-1.5 border border-ink-600 bg-ink-800/70 px-2.5 py-1 text-xs text-fg-dim">
                    等待操作完成…
                  </span>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function TutorialProgressBar(): JSX.Element | null {
  const { data: state } = useTutorial();
  if (!state || state.completed) return null;
  const pct = Math.round(((state.step + 1) / state.total) * 100);
  return (
    <div className="sticky top-[var(--hud-h,3rem)] z-20 -mx-4 border-b border-cyber-400/20 bg-ink-900/80 px-4 py-1.5 backdrop-blur sm:-mx-6">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="flex items-center gap-2 text-fg-muted">
          <Icon icon={Sparkles} className="size-3 text-cyber-300" />
          新手引导 {state.step + 1}/{state.total}
        </span>
        <span className="text-fg-faint">{state.current?.title}</span>
        <span className="hidden items-center gap-2 sm:flex">
          <span className="h-1 w-24 bg-ink-700">
            <span className="block h-full bg-cyber-400" style={{ width: `${pct}%` }} />
          </span>
          <span className="tnum text-cyber-300">{pct}%</span>
        </span>
      </div>
    </div>
  );
}
