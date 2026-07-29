import Link from 'next/link';
import { db } from '@/lib/db/client';
import { leaderboardForGame, listGames, overallLeaderboard, type LeaderRow } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

type Search = { tab?: string };

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { tab } = await searchParams;
  const handle = db();
  const games = listGames(handle);
  const activeTab = tab && (tab === 'overall' || games.some((g) => g.slug === tab)) ? tab : 'overall';

  const rows: LeaderRow[] =
    activeTab === 'overall'
      ? overallLeaderboard(handle, 50)
      : (() => {
          const g = games.find((x) => x.slug === activeTab);
          return g ? leaderboardForGame(handle, g.id, 50) : [];
        })();

  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">Leaderboards</h1>

      <nav aria-label="Leaderboard tabs" className="mt-4 flex gap-2 overflow-x-auto pb-2">
        <TabLink slug="overall" label="Overall" active={activeTab === 'overall'} />
        {games.map((g) => (
          <TabLink key={g.id} slug={g.slug} label={g.name} active={activeTab === g.slug} />
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="mt-6 text-slate-400">No ratings yet. Log a match to get started.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {rows.map((r, i) => (
            <li
              key={r.player_id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="w-6 text-right text-muted-foreground">{i + 1}</span>
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={r.avatar_url} className="h-8 w-8 rounded-full" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs">
                  {r.display_name.slice(0, 1)}
                </span>
              )}
              <span className="flex-1 truncate">{r.display_name}</span>
              <span className="font-mono text-sm tabular-nums">{Math.round(r.current_rating)}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function TabLink({ slug, label, active }: { slug: string; label: string; active: boolean }) {
  return (
    <Link
      href={{ pathname: '/leaderboards', query: { tab: slug } }}
      className={
        'inline-flex items-center justify-center h-tap min-w-tap whitespace-nowrap rounded-full px-4 py-1.5 text-sm ' +
        (active
          ? 'bg-blue-500 text-white'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white')
      }
    >
      {label}
    </Link>
  );
}
