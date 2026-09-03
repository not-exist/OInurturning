import { useState, type FormEvent, type JSX } from 'react';
import {
  useAdminAnnouncements,
  useAdminAudits,
  useAdminTournaments,
  useAdminUsers,
  useCreateAnnouncement,
  useCreateTournament,
  type AuditView,
  type TournamentView,
} from '../../lib/hooks';

function futureDate(hours: number): string {
  const date = new Date(Date.now() + hours * 3_600_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AdminPage(): JSX.Element {
  const tournaments = useAdminTournaments();
  const announcements = useAdminAnnouncements();
  const audits = useAdminAudits();
  const [query, setQuery] = useState('');
  const users = useAdminUsers(query);

  if (tournaments.isPending || announcements.isPending || audits.isPending || users.isPending) {
    return <p className="text-neutral-500">加载管理端数据…</p>;
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
    return <p className="text-red-600">管理端数据加载失败。</p>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="border-b border-neutral-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Operations</p>
        <h1 className="mt-1 text-2xl font-semibold">管理端</h1>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <TournamentForm />
        <AnnouncementForm />
      </div>

      <section>
        <div className="mb-3 flex items-baseline justify-between border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">赛事</h2>
          <span className="text-xs text-neutral-500">{tournaments.data.length} 场</span>
        </div>
        <TournamentTable items={tournaments.data} />
      </section>

      <section>
        <div className="mb-3 border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">用户查询</h2>
        </div>
        <input
          className="mb-3 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm md:max-w-sm"
          placeholder="按用户名搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <UserTable users={users.data} />
      </section>

      <section>
        <div className="mb-3 border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">公告</h2>
        </div>
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200 bg-white">
          {announcements.data.map((announcement) => (
            <li key={announcement.id} className="px-3 py-3 text-sm">
              <p className="font-medium">{announcement.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-neutral-600">{announcement.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 border-b border-neutral-300 pb-2">
          <h2 className="text-lg font-semibold">审计日志</h2>
        </div>
        <AuditTable items={audits.data} />
      </section>
    </div>
  );
}

function TournamentForm(): JSX.Element {
  const create = useCreateTournament();
  const [name, setName] = useState('');
  const [size, setSize] = useState<8 | 16 | 32>(16);
  const [registerEndsAt, setRegisterEndsAt] = useState(futureDate(24));
  const [autoStartAt, setAutoStartAt] = useState(futureDate(48));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      name,
      size,
      registerEndsAt: new Date(registerEndsAt).toISOString(),
      autoStartAt: new Date(autoStartAt).toISOString(),
      prizes: {},
      config: {},
    });
  };

  return (
    <form className="space-y-3 border border-neutral-300 bg-white p-4" onSubmit={submit}>
      <h2 className="font-semibold">创建赛事</h2>
      <input required maxLength={64} className="w-full rounded border px-3 py-2 text-sm" placeholder="赛事名称" value={name} onChange={(event) => setName(event.target.value)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">规模<select className="mt-1 w-full rounded border px-2 py-2" value={size} onChange={(event) => setSize(Number(event.target.value) as 8 | 16 | 32)}><option value={8}>8 人</option><option value={16}>16 人</option><option value={32}>32 人</option></select></label>
        <label className="text-sm">报名截止<input required type="datetime-local" className="mt-1 w-full rounded border px-2 py-2" value={registerEndsAt} onChange={(event) => setRegisterEndsAt(event.target.value)} /></label>
        <label className="text-sm">自动开始<input required type="datetime-local" className="mt-1 w-full rounded border px-2 py-2" value={autoStartAt} onChange={(event) => setAutoStartAt(event.target.value)} /></label>
      </div>
      <button className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={create.isPending}>{create.isPending ? '创建中…' : '创建赛事'}</button>
      {create.isError && <p className="text-sm text-red-600">赛事创建失败，请检查时间窗口。</p>}
    </form>
  );
}

function AnnouncementForm(): JSX.Element {
  const create = useCreateAnnouncement();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ title, body }, { onSuccess: () => { setTitle(''); setBody(''); } });
  };
  return (
    <form className="space-y-3 border border-neutral-300 bg-white p-4" onSubmit={submit}>
      <h2 className="font-semibold">发布公告</h2>
      <input required maxLength={128} className="w-full rounded border px-3 py-2 text-sm" placeholder="标题" value={title} onChange={(event) => setTitle(event.target.value)} />
      <textarea required maxLength={20_000} className="min-h-24 w-full rounded border px-3 py-2 text-sm" placeholder="公告内容" value={body} onChange={(event) => setBody(event.target.value)} />
      <button className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={create.isPending}>{create.isPending ? '发布中…' : '发布公告'}</button>
      {create.isError && <p className="text-sm text-red-600">公告发布失败。</p>}
    </form>
  );
}

function TournamentTable({ items }: { items: TournamentView[] }): JSX.Element {
  if (items.length === 0) return <p className="text-sm text-neutral-500">暂无赛事。</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-y border-neutral-200 bg-white text-left text-sm"><thead className="bg-neutral-100 text-xs text-neutral-500"><tr><th className="px-3 py-2">名称</th><th className="px-3 py-2">规模</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">报名截止</th><th className="px-3 py-2">自动开始</th></tr></thead><tbody className="divide-y divide-neutral-200">{items.map((item) => <tr key={item.id}><td className="px-3 py-3 font-medium">{item.name}</td><td className="px-3 py-3">{item.size}</td><td className="px-3 py-3">{item.status}</td><td className="px-3 py-3 text-neutral-500">{new Date(item.registerEndsAt).toLocaleString()}</td><td className="px-3 py-3 text-neutral-500">{new Date(item.autoStartAt).toLocaleString()}</td></tr>)}</tbody></table></div>;
}

function UserTable({ users }: { users: { id: number; username: string; role: string; money: number; reputation: number }[] }): JSX.Element {
  if (users.length === 0) return <p className="text-sm text-neutral-500">没有匹配用户。</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-y border-neutral-200 bg-white text-left text-sm"><thead className="bg-neutral-100 text-xs text-neutral-500"><tr><th className="px-3 py-2">用户名</th><th className="px-3 py-2">角色</th><th className="px-3 py-2">金币</th><th className="px-3 py-2">声誉</th></tr></thead><tbody className="divide-y divide-neutral-200">{users.map((user) => <tr key={user.id}><td className="px-3 py-3 font-medium">{user.username}</td><td className="px-3 py-3">{user.role}</td><td className="px-3 py-3">{user.money}</td><td className="px-3 py-3">{user.reputation}</td></tr>)}</tbody></table></div>;
}

function AuditTable({ items }: { items: AuditView[] }): JSX.Element {
  if (items.length === 0) return <p className="text-sm text-neutral-500">暂无审计记录。</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-y border-neutral-200 bg-white text-left text-sm"><thead className="bg-neutral-100 text-xs text-neutral-500"><tr><th className="px-3 py-2">时间</th><th className="px-3 py-2">管理员</th><th className="px-3 py-2">操作</th><th className="px-3 py-2">目标</th></tr></thead><tbody className="divide-y divide-neutral-200">{items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-neutral-500">{new Date(item.createdAt).toLocaleString()}</td><td className="px-3 py-3">{item.adminNameSnapshot}</td><td className="px-3 py-3 font-medium">{item.action}</td><td className="px-3 py-3 text-neutral-500">{item.targetType} {item.targetId}</td></tr>)}</tbody></table></div>;
}
