import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  playerCategoryRatings,
  playerGameRatings,
  type GameRating,
} from '@/lib/db/queries';
import { categoryLabel } from '@/lib/games/categories';
import { adminNavLinks } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type OverallRow = { current_rating: number; escrowed_elo: number };
type RecentRow = {
  match_id: string;
  game_name: string;
  status: string;
  rating_delta: number | null;
  placement: number | null;
};

// Group rows by category preserving the existing iteration order (the
// rows are already sorted by category then name in SQL — see
// playerGameRatings). Plain `reduce` rather than `Object.groupBy`, which
// requires Node 21+; the runtime target for this app is Node 20.
function groupByCategory(rows: GameRating[]): Record<string, GameRating[]> {
  return rows.reduce<Record<string, GameRating[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) return null;
  const playerId = session.user.id;
  const handle = db();

  const overall = handle
    .prepare(`SELECT current_rating, escrowed_elo FROM overall_ratings WHERE player_id = ?`)
    .get(playerId) as OverallRow | undefined;
  const categoryRollup = playerCategoryRatings(handle, playerId);
  const games = playerGameRatings(handle, playerId);
  const recent = handle
    .prepare(
      `SELECT mp.match_id, g.name AS game_name, m.status, mp.rating_delta, mp.placement
         FROM match_participants mp
         JOIN matches m ON m.id = mp.match_id
         JOIN games g ON g.id = m.game_id
        WHERE mp.player_id = ?
        ORDER BY m.created_at DESC
        LIMIT 20`,
    )
    .all(playerId) as RecentRow[];

  const adminLinks = adminNavLinks(session.user.role);

  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">{session.user.name ?? 'Profile'}</h1>
      <p className="text-sm text-slate-400">Role: {session.user.role}</p>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Overall</h2>
        <p className="mt-2 font-mono text-3xl tabular-nums">
          {overall ? Math.round(overall.current_rating) : 1200}
        </p>
        {overall?.escrowed_elo ? (
          <p className="text-xs text-muted-foreground">{Math.round(overall.escrowed_elo)} escrowed</p>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">By category</h2>
        {categoryRollup.length === 0 ? (
          <p className="mt-2 text-slate-400">No games played yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {categoryRollup.map((c) => (
              <li
                key={c.category}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span>{c.label}</span>
                <span className="font-mono tabular-nums">
                  {c.weightedRating} · {c.gameCount} games · {c.totalMatches} matches
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Games</h2>
        {games.length === 0 ? (
          <p className="mt-2 text-slate-400">No games played yet.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {Object.entries(groupByCategory(games)).map(([slug, rows]) => (
              <div key={slug}>
                <h3 className="text-xs uppercase tracking-wide text-slate-600">
                  {categoryLabel(slug)}
                </h3>
                <ul className="mt-1 space-y-1">
                  {rows.map((r) => (
                    <li
                      key={r.gameId}
                      className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                    >
                      <span>{r.gameName}</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(r.currentRating)} · {r.gamesPlayed}g
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {adminLinks.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Admin</h2>
          <ul className="mt-2 space-y-2">
            {adminLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-tap items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                >
                  <span>{link.label}</span>
                  <span aria-hidden className="text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Recent</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-slate-400">No matches yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((r) => (
              <li
                key={r.match_id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span>
                  {r.game_name} <span className="text-muted-foreground">#{r.placement ?? '?'}</span>
                </span>
                <span className="font-mono tabular-nums">
                  {r.rating_delta != null
                    ? `${r.rating_delta >= 0 ? '+' : ''}${Math.round(r.rating_delta)}`
                    : r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
