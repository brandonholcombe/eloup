import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { rankMedal } from '@/lib/rank';
import {
  gamePlayerRank,
  leaderboardForGame,
  listGames,
  overallLeaderboard,
  overallPlayerRank,
  type LeaderRow,
  type PlayerRank,
} from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

type Search = { tab?: string };

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { tab } = await searchParams;
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const handle = db();
  const games = listGames(handle);
  const activeTab = tab && (tab === 'overall' || games.some((g) => g.slug === tab)) ? tab : 'overall';
  const activeGame = activeTab === 'overall' ? null : games.find((x) => x.slug === activeTab) ?? null;

  const rows: LeaderRow[] =
    activeTab === 'overall'
      ? overallLeaderboard(handle, 50)
      : activeGame
        ? leaderboardForGame(handle, activeGame.id, 50)
        : [];

  // "Your rank" — only surfaced when the viewer is ranked but NOT already in the
  // visible top-50 rows (otherwise their highlighted row is enough).
  const viewerRank: PlayerRank | null = viewerId
    ? activeTab === 'overall'
      ? overallPlayerRank(handle, viewerId)
      : activeGame
        ? gamePlayerRank(handle, activeGame.id, viewerId)
        : null
    : null;
  const viewerInView = !!viewerId && rows.some((r) => r.player_id === viewerId);
  const showYourRank = !!viewerRank && !viewerInView;

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
          {rows.map((r, i) => {
            const isViewer = r.player_id === viewerId;
            return (
              <li
                key={r.player_id}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                  isViewer ? 'border-blue-500 bg-card' : 'border-border bg-card'
                }`}
              >
                <span className="w-6 text-right text-muted-foreground">{rankMedal(i + 1) ?? i + 1}</span>
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={r.avatar_url} className="h-8 w-8 rounded-full" />
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs">
                    {r.display_name.slice(0, 1)}
                  </span>
                )}
                <span className="flex-1 truncate">
                  {r.display_name}
                  {isViewer && <span className="ml-1 text-blue-400">(you)</span>}
                </span>
                <span className="font-mono text-sm tabular-nums">{Math.round(r.current_rating)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {showYourRank && viewerRank && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-blue-500 bg-card px-3 py-2">
          <span className="w-6 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {viewerRank.rank}
          </span>
          <span className="flex-1 truncate text-sm">
            You <span className="text-muted-foreground">· #{viewerRank.rank} of {viewerRank.total}</span>
          </span>
          <span className="font-mono text-sm tabular-nums">{Math.round(viewerRank.current_rating)}</span>
        </div>
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
