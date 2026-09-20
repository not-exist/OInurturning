import type { JSX } from 'react';
import { Trophy } from 'lucide-react';
import { Btn, Chip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PVP_REWARD_LINE_LABEL } from '../../lib/labels';
import type { PvpRewardGrantView, PvpRewardLine } from '../../lib/hooks';

function rewardText(reward: PvpRewardLine, itemName: (itemId: string) => string): string {
  const label = PVP_REWARD_LINE_LABEL[reward.type];
  return reward.type === 'item'
    ? `${label} · ${itemName(reward.itemId)} ×${reward.count}`
    : `${label} +${reward.amount}`;
}

function grantOwner(userId: number, meId: number | undefined, meName: string | undefined): string {
  if (meId !== undefined && userId === meId) return meName ?? '我的队伍';
  return `选手 #${userId}`;
}

/** 赛事奖励公示：名次榜单 + 领取（只有自己的份额可领取） */
export function RewardBoard({
  grants,
  meId,
  meName,
  claimedGrantId,
  itemName,
  onClaim,
  pending,
}: {
  grants: PvpRewardGrantView[];
  meId: number | undefined;
  meName: string | undefined;
  /** 刚领取成功的公示 id（领取后 /me 未就绪也能立即显示已领取） */
  claimedGrantId?: number;
  itemName: (itemId: string) => string;
  onClaim: () => void;
  pending: boolean;
}): JSX.Element {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">赛事奖励公示</h2>
        <span className="text-[11px] text-fg-dim">按最终名次发放，到账后可领取</span>
      </div>
      <ul className="divide-y divide-ink-600/60 border-y border-ink-600/60">
        {grants.map((grant) => {
          const mine =
            grant.claimable || grant.id === claimedGrantId || (meId !== undefined && grant.userId === meId);
          return (
            <li
              key={grant.id}
              className={`flex flex-wrap items-center justify-between gap-3 py-3 ${
                mine ? 'bg-cyber-400/5' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Icon
                    icon={Trophy}
                    className={`size-3.5 shrink-0 ${grant.rank === 1 ? 'text-cyber-300' : 'text-fg-faint'}`}
                  />
                  <span className="numeral tnum text-lg text-cyber-300">{grant.rank}</span>
                  <span className="text-xs text-fg-dim">名</span>
                  <span className="truncate text-sm text-fg">
                    {grantOwner(grant.userId, meId, meName)}
                  </span>
                  {mine && <Chip>我的份额</Chip>}
                </p>
                <p className="mt-1 text-[11px] text-fg-dim">
                  {grant.rewards.length === 0
                    ? '本名次无奖励'
                    : grant.rewards.map((reward) => rewardText(reward, itemName)).join(' · ')}
                </p>
              </div>
              {mine && grant.claimedAt !== null ? (
                <span className="shrink-0 text-xs font-medium text-good-400">已领取</span>
              ) : grant.claimable ? (
                <Btn
                  variant="primary"
                  size="sm"
                  data-testid="pvp-claim"
                  disabled={pending}
                  onClick={onClaim}
                >
                  {pending ? '领取中…' : '领取奖励'}
                </Btn>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
