import { useEffect, useRef, useState, type JSX } from 'react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { Btn, Meter, Panel } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useAdvanceTutorial, useCompleteTutorial, useTutorial, useTutorialVisitStepSync } from '../../lib/tutorial';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 四周留白：目标元素与洞口之间留 8px，避免洞口贴着目标边缘 */
const SPOTLIGHT_PAD = 8;
/** 目标尚未挂载时最多跟随 ~2s（60fps 计）；超时后交由 2s 轮询的新 state 重新触发测量 */
const MAX_MISS_FRAMES = 120;

/** 行为步的提示文案：禁止把 action 名（英文枚举）直出给用户 */
const ACTION_HINT: Record<string, string> = {
  visit_students: '打开学员管理页面即可',
  do_training: '完成一次训练即可',
  visit_academy: '打开高级学院的候选池即可',
  do_lecture: '完成一次讲课即可',
  do_adventure: '完成一次历练即可',
  do_story: '通关一关剧情即可',
  visit_shop: '打开商城页面即可',
};

function getTargetRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

interface Hole {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** 目标矩形 → 视口内的洞口；目标不可见（未挂载/滚出视口）时返回 null */
function computeHole(rect: Rect | null): Hole | null {
  if (rect === null) return null;
  const hole: Hole = {
    top: Math.max(0, rect.top - SPOTLIGHT_PAD),
    left: Math.max(0, rect.left - SPOTLIGHT_PAD),
    right: Math.min(window.innerWidth, rect.left + rect.width + SPOTLIGHT_PAD),
    bottom: Math.min(window.innerHeight, rect.top + rect.height + SPOTLIGHT_PAD),
  };
  if (hole.right <= hole.left || hole.bottom <= hole.top) return null;
  return hole;
}

/**
 * 四块遮罩面板：围绕洞口拼出暗场，洞口本身不渲染任何东西 ——
 * 目标元素由此真正可点击（旧实现的单块 `inset-0` 遮罩会把整页点击都吞掉）。
 * 宽或高为 0 的面板不渲染，避免出现零面积的可点击层。
 * `blocking` 为 false 时面板只做暗场（不参与命中测试），见 TutorialOverlay 内的说明。
 */
function MaskPanels({ hole, blocking }: { hole: Hole; blocking: boolean }): JSX.Element {
  const { innerWidth, innerHeight } = window;
  const middle = { top: hole.top, height: hole.bottom - hole.top };
  const cls = `fixed z-50 bg-ink-950/70 backdrop-blur-[1px]${blocking ? '' : ' pointer-events-none'}`;
  return (
    <>
      {hole.top > 0 && (
        <div aria-hidden className={cls} style={{ top: 0, left: 0, right: 0, height: hole.top }} />
      )}
      {hole.bottom < innerHeight && (
        <div aria-hidden className={cls} style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
      )}
      {hole.left > 0 && <div aria-hidden className={cls} style={{ ...middle, left: 0, width: hole.left }} />}
      {hole.right < innerWidth && (
        <div aria-hidden className={cls} style={{ ...middle, left: hole.right, right: 0 }} />
      )}
    </>
  );
}

function recruitHint(owned: number | undefined, required: number | undefined): string {
  if (owned === undefined || required === undefined) return '招募学员以补齐小队';
  const missing = Math.max(0, required - owned);
  if (missing === 0) return '小队人数已达标，正在结算…';
  return `还需招募 ${missing} 名学员（达 ${required} 人在册自动通过）`;
}

export function TutorialOverlay(): JSX.Element | null {
  const { data: state } = useTutorial();
  const advance = useAdvanceTutorial();
  const complete = useCompleteTutorial();
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // 访问步（visit_*）进入时失效目标页的查询，避免命中新鲜缓存而不发请求
  useTutorialVisitStepSync();

  const cur = state?.current;
  const completed = state?.completed;
  const total = state?.total ?? 0;
  const stepIdx = state?.step ?? 0;

  // 测量目标矩形：rAF 节流 + ResizeObserver（布局变化）+ 滚动/缩放；目标未挂载时跟随若干帧。
  useEffect(() => {
    if (!cur || completed) {
      setRect(null);
      return undefined;
    }
    let frame: number | null = null;
    let misses = 0;
    const measure = (): void => {
      frame = null;
      const r = getTargetRect(cur.target);
      setRect((prev) => (sameRect(prev, r) ? prev : r));
      if (r === null && cur.target !== null && misses < MAX_MISS_FRAMES) {
        misses += 1;
        frame = requestAnimationFrame(measure);
      }
    };
    const schedule = (): void => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [cur, completed]);

  const visible = state !== undefined && !completed && cur !== null;

  // 进入引导 / 步骤切换时把焦点移入引导卡；依赖步骤序号而非 state 对象，轮询重取不会抢焦点。
  useEffect(() => {
    if (!visible) return;
    cardRef.current?.focus();
  }, [visible, stepIdx]);

  if (!state || completed || !cur) return null;

  const isLast = stepIdx === total - 1;
  const progressPct = Math.round(((stepIdx + 1) / total) * 100);
  const hole = computeHole(rect);
  const actionPending = cur.action !== 'none';
  // 遮罩是否拦点击：只有「访问即完成」的步骤（visit_*）与纯展示步可以拦。
  // do_* 步骤要在页内做连续操作（选学员→开始训练、选档位→开始讲课、组队→抽事件、进关…），
  // 洞口只盖得住目标元素，拦点击会把真正要点的按钮挡在洞外，直接把引导卡死。
  const blocking = !actionPending || cur.action.startsWith('visit_');
  const actionHint =
    cur.action === 'do_recruit'
      ? recruitHint(state.studentsOwned, state.studentsRequired)
      : (ACTION_HINT[cur.action] ?? (actionPending ? '完成当前指引操作后自动进入下一步' : '按指引体验功能'));

  const handleNext = async () => {
    // 行为步（action !== 'none'）由服务端 autoAdvanceIfNeeded 推进，这里只处理纯展示步。
    if (actionPending) return;
    if (!isLast) await advance.mutateAsync(stepIdx + 1);
    else await complete.mutateAsync();
  };

  // Tab 环：焦点在卡内时循环于卡片可操作元素与洞口目标之间，保证键盘也能触达被聚光的控件。
  const handleTab = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const root = event.currentTarget;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const target = cur.target === null ? null : document.querySelector<HTMLElement>(cur.target);
    if (target !== null) focusables.push(target);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (!root.contains(active) && active !== target) return;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
      {/* 遮罩：有洞口时四块面板围出可点击区域；无 target 的步骤整屏遮罩，卡片上的按钮即唯一出口 */}
      {hole !== null ? (
        <MaskPanels hole={hole} blocking={blocking} />
      ) : (
        <div
          aria-hidden
          className={`fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-[1px] ${
            // 洞口算不出来（目标未挂载 / 已滚出视口）说明用户还得先去别处操作，
            // 此时只有无 target 的纯展示步可以拦点击
            cur.target === null && blocking ? '' : 'pointer-events-none'
          }`}
        />
      )}

      {/* 聚光切口：只做描边，不参与命中测试 */}
      {hole !== null && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[51] border-2 border-cyber-400/80 shadow-[0_0_24px_-4px_var(--color-cyber-400)]"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.right - hole.left,
            height: hole.bottom - hole.top,
            borderRadius: 2,
          }}
        />
      )}

      {/* 引导卡 */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`新手引导：${cur.title}`}
        tabIndex={-1}
        onKeyDown={handleTab}
        style={cardStyle}
        className={`animate-rise outline-none ${actionPending ? 'pointer-events-none' : 'pointer-events-auto'}`}
      >
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
            <Meter value={stepIdx + 1} max={total} className="bg-cyber-400" />

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
              <span className="text-[11px] text-fg-faint">{actionHint}</span>
              <div className="flex gap-2">
                {actionPending ? (
                  <span className="inline-flex items-center gap-1.5 border border-ink-600 bg-ink-800/70 px-2.5 py-1 text-xs text-fg-dim">
                    等待操作完成…
                  </span>
                ) : (
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
        <div className="hidden items-center gap-2 sm:flex">
          <span className="w-24">
            <Meter value={state.step + 1} max={state.total} className="bg-cyber-400" />
          </span>
          <span className="tnum text-cyber-300">{pct}%</span>
        </div>
      </div>
    </div>
  );
}
