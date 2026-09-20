import { useState, type FormEvent, type JSX, type ReactNode } from 'react';
import {
  useAdminAnnouncements,
  useAdminAudits,
  useAdminTournaments,
  useAdminUsers,
  useCreateAnnouncement,
  useCreateTournament,
  useSetUserBan,
  type AuditView,
  type TournamentView,
  type UserAdminView,
} from '../../lib/hooks';
import {
  adminActionLabel,
  adminTargetLabel,
  ROLE_LABEL,
  tournamentStatusLabel,
} from '../../lib/labels';
import { Btn, Empty, PageHeader, Panel } from '../../components/ui';
import { Icon } from '../../components/icons';
import { Ban, Megaphone, ShieldCheck, Trophy, UserRound } from 'lucide-react';

function futureDate(hours: number): string {
  const date = new Date(Date.now() + hours * 3_600_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const INPUT_CLS =
  'w-full border border-ink-600 bg-ink-850/80 px-3 py-2 text-sm text-fg transition-colors placeholder:text-fg-faint focus:border-cyber-400/70';

export function AdminPage(): JSX.Element {
  const tournaments = useAdminTournaments();
  const announcements = useAdminAnnouncements();
  const audits = useAdminAudits();
  const [query, setQuery] = useState('');
  const users = useAdminUsers(query);

  if (tournaments.isPending || announcements.isPending || audits.isPending || users.isPending) {
    return <p className="text-fg-dim">读取管理端数据…</p>;
  }
  if (
    tournaments.isError ||
    announcements.isError ||
    audits.isError ||
    users.isError ||
    !tournaments.data ||
    !announcements.data ||
    !audits.data ||
    !users.data
  ) {
    return <p className="text-bad-400">管理端数据加载失败。</p>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Operations"
        title="管理端"
        description="赛事编排、公告发布、用户处置与审计留痕。"
      />

      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        <TournamentForm />
        <AnnouncementForm />
      </div>

      <Section title="赛事" icon={Trophy} extra={`${tournaments.data.length} 场`}>
        <TournamentTable items={tournaments.data} />
      </Section>

      <Section title="用户查询" icon={UserRound}>
        <input
          className={`${INPUT_CLS} mb-3 md:max-w-sm`}
          data-testid="admin-user-search"
          placeholder="按用户名搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <UserTable users={users.data} />
      </Section>

      <Section title="公告" icon={Megaphone}>
        <ul data-testid="admin-announcements" className="border border-ink-600 bg-ink-850/40">
          {announcements.data.map((announcement) => (
            <li key={announcement.id} className="border-b border-ink-600/60 px-3 py-3 text-sm last:border-b-0">
              <p className="font-medium">{announcement.title}</p>
              <p className="mt-1 text-fg-muted whitespace-pre-wrap">{announcement.body}</p>
              <p className="mt-1 font-mono text-[11px] text-fg-faint">
                {new Date(announcement.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
          {announcements.data.length === 0 && (
            <li className="px-3 py-4 text-sm text-fg-dim">暂无公告。</li>
          )}
        </ul>
      </Section>

      <Section title="审计日志" icon={ShieldCheck}>
        <AuditTable items={audits.data} />
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  extra,
  children,
}: {
  title: string;
  icon: typeof Trophy;
  extra?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-ink-600/70 pb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon icon={icon} className="size-4 text-cyber-400" />
          {title}
        </h2>
        {extra !== undefined && <span className="text-xs text-fg-dim">{extra}</span>}
      </div>
      {children}
    </section>
  );
}

function TournamentForm(): JSX.Element {
  const create = useCreateTournament();
  const [name, setName] = useState('');
  const [size, setSize] = useState<8 | 16 | 32>(16);
  const [registerEndsAt, setRegisterEndsAt] = useState(futureDate(24));
  const [autoStartAt, setAutoStartAt] = useState(futureDate(48));
  const [prizes, setPrizes] = useState('{}');
  const [prizeError, setPrizeError] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    let parsedPrizes: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(prizes);
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('prizes must be an object');
      parsedPrizes = value as Record<string, unknown>;
      setPrizeError(false);
    } catch {
      setPrizeError(true);
      return;
    }
    create.mutate({
      name,
      size,
      registerEndsAt: new Date(registerEndsAt).toISOString(),
      autoStartAt: new Date(autoStartAt).toISOString(),
      prizes: parsedPrizes,
      config: {},
    });
  };

  return (
    <Panel eyebrow="Create" title="创建赛事" bodyClassName="p-4">
      <form className="space-y-3" onSubmit={submit}>
        <input
          data-testid="admin-t-name"
          required
          maxLength={64}
          className={INPUT_CLS}
          placeholder="赛事名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="eyebrow mb-1 block">规模</span>
            <select
              data-testid="admin-t-size"
              className={`${INPUT_CLS} px-2`}
              value={size}
              onChange={(event) => setSize(Number(event.target.value) as 8 | 16 | 32)}
            >
              <option value={8}>8 人</option>
              <option value={16}>16 人</option>
              <option value={32}>32 人</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="eyebrow mb-1 block">报名截止</span>
            <input
              required
              data-testid="admin-t-register-ends"
              type="datetime-local"
              className={`${INPUT_CLS} px-2`}
              value={registerEndsAt}
              onChange={(event) => setRegisterEndsAt(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="eyebrow mb-1 block">自动开始</span>
            <input
              required
              data-testid="admin-t-auto-start"
              type="datetime-local"
              className={`${INPUT_CLS} px-2`}
              value={autoStartAt}
              onChange={(event) => setAutoStartAt(event.target.value)}
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="eyebrow mb-1 block">奖池配置（JSON）</span>
          <textarea
            data-testid="admin-t-prizes"
            className={`${INPUT_CLS} min-h-24 font-mono text-xs`}
            value={prizes}
            onChange={(event) => setPrizes(event.target.value)}
            placeholder='{"champion":{"money":1000}}'
          />
        </label>
        {prizeError && <p className="text-sm text-bad-400">奖池必须是有效 JSON 对象。</p>}
        <Btn data-testid="admin-t-submit" type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? '创建中…' : '创建赛事'}
        </Btn>
        {create.isError && <p className="text-sm text-bad-400">赛事创建失败，请检查时间窗口。</p>}
      </form>
    </Panel>
  );
}

function AnnouncementForm(): JSX.Element {
  const create = useCreateAnnouncement();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate(
      { title, body },
      {
        onSuccess: () => {
          setTitle('');
          setBody('');
        },
      },
    );
  };
  return (
    <Panel eyebrow="Broadcast" title="发布公告" bodyClassName="p-4">
      <form className="space-y-3" onSubmit={submit}>
        <input
          data-testid="admin-a-title"
          required
          maxLength={128}
          className={INPUT_CLS}
          placeholder="标题"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          data-testid="admin-a-body"
          required
          maxLength={20_000}
          className={`${INPUT_CLS} min-h-24`}
          placeholder="公告内容"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <Btn data-testid="admin-a-submit" type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? '发布中…' : '发布公告'}
        </Btn>
        {create.isError && <p className="text-sm text-bad-400">公告发布失败。</p>}
      </form>
    </Panel>
  );
}

const TH = 'px-3 py-2 text-left font-medium';
const TD = 'px-3 py-3 align-top';

function TableShell({
  testId,
  head,
  children,
}: {
  testId?: string;
  head: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="overflow-x-auto border border-ink-600 bg-ink-850/40">
      <table data-testid={testId} className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-ink-800/80 text-[11px] tracking-wide text-fg-dim uppercase">
          {head}
        </thead>
        <tbody className="divide-y divide-ink-600/60">{children}</tbody>
      </table>
    </div>
  );
}

function TournamentTable({ items }: { items: TournamentView[] }): JSX.Element {
  if (items.length === 0)
    return <Empty icon={Trophy} title="暂无赛事" />;
  return (
    <TableShell
      testId="admin-tournaments"
      head={
        <tr>
          <th className={TH}>名称</th>
          <th className={TH}>规模</th>
          <th className={TH}>状态</th>
          <th className={TH}>报名截止</th>
          <th className={TH}>自动开始</th>
        </tr>
      }
    >
      {items.map((item) => (
        <tr key={item.id}>
          <td className={`${TD} font-medium`}>{item.name}</td>
          <td className={TD}>{item.size}</td>
          <td className={TD}>{tournamentStatusLabel(item.status)}</td>
          <td className={`${TD} text-fg-dim`}>{new Date(item.registerEndsAt).toLocaleString()}</td>
          <td className={`${TD} text-fg-dim`}>{new Date(item.autoStartAt).toLocaleString()}</td>
        </tr>
      ))}
    </TableShell>
  );
}

function UserTable({ users }: { users: UserAdminView[] }): JSX.Element {
  const setBan = useSetUserBan();
  if (users.length === 0) return <Empty icon={UserRound} title="没有匹配的用户" />;
  return (
    <div>
      <TableShell
        testId="admin-users"
        head={
          <tr>
            <th className={TH}>用户名</th>
            <th className={TH}>角色</th>
            <th className={TH}>金币</th>
            <th className={TH}>声誉</th>
            <th className={TH}>状态</th>
            <th className={TH}>操作</th>
          </tr>
        }
      >
        {users.map((user) => {
          // 注销＝物理删除，已注销账号不再出现在列表里，故只剩封禁/正常两态
          const banned = user.bannedAt !== null;
          return (
            <tr key={user.id}>
              <td className={`${TD} font-medium`}>{user.username}</td>
              <td className={TD}>{ROLE_LABEL[user.role]}</td>
              <td className={`${TD} tnum`}>{user.money}</td>
              <td className={`${TD} tnum`}>{user.reputation}</td>
              <td className={`${TD} ${banned ? 'text-bad-400' : 'text-fg-dim'}`}>
                {banned ? '已封禁' : '正常'}
              </td>
              <td className={TD}>
                {user.role === 'ADMIN' ? (
                  <span className="text-xs text-fg-faint">—</span>
                ) : (
                  <Btn
                    size="sm"
                    variant={banned ? 'ghost' : 'danger'}
                    data-testid={`${banned ? 'admin-unban' : 'admin-ban'}-${user.id}`}
                    disabled={setBan.isPending}
                    onClick={() => setBan.mutate({ userId: user.id, banned: !banned })}
                  >
                    <Icon icon={Ban} className="size-3" />
                    {banned ? '解封' : '封禁'}
                  </Btn>
                )}
              </td>
            </tr>
          );
        })}
      </TableShell>
      {setBan.isError && <p className="mt-2 text-sm text-bad-400">封禁/解封操作失败，请刷新后重试。</p>}
    </div>
  );
}

function AuditTable({ items }: { items: AuditView[] }): JSX.Element {
  if (items.length === 0) return <Empty icon={ShieldCheck} title="暂无审计记录" />;
  return (
    <TableShell
      head={
        <tr data-testid="admin-audits-head">
          <th className={TH}>时间</th>
          <th className={TH}>管理员</th>
          <th className={TH}>操作</th>
          <th className={TH}>目标</th>
        </tr>
      }
    >
      {items.map((item) => (
        <tr key={item.id}>
          <td className={`${TD} whitespace-nowrap text-fg-dim`}>
            {new Date(item.createdAt).toLocaleString()}
          </td>
          <td className={TD}>{item.adminNameSnapshot}</td>
          <td className={TD}>
            {/* 审计留痕需保留原始动作码（排障口径）；中文标签只作可读性补充 */}
            <span className="font-medium">{adminActionLabel(item.action)}</span>
            <span className="ml-1.5 font-mono text-[11px] text-fg-faint">{item.action}</span>
          </td>
          <td className={`${TD} text-fg-dim`}>
            {adminTargetLabel(item.targetType)}
            {item.targetId !== null && (
              <span className="ml-1 font-mono text-[11px] text-fg-faint">{item.targetId}</span>
            )}
          </td>
        </tr>
      ))}
    </TableShell>
  );
}
