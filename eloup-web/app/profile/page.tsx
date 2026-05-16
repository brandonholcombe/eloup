import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

type OverallRow = { current_rating: number; escrowed_elo: number };
type PerGameRow = {
  game_name: string;
  current_rating: number;
  games_played: number;
};
type RecentRow = {
  match_id: string;
  game_name: string;
  status: string;
  rating_delta: number | null;
  placement: number | null;
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) return null;
  const playerId = session.user.id;
  const handle = db();

  const overall = handle
    .prepare(`SELECT current_rating, escrowed_elo FROM overall_ratings WHERE player_id = ?`)
    .get(playerId) as OverallRow | undefined;
  const perGame = handle
    .prepare(
      `SELECT g.name AS game_name, r.current_rating, r.games_played
         FROM ratings r JOIN games g ON g.id = r.game_id
        WHERE r.player_id = ?
        ORDER BY r.current_rating DESC`,
    )
    .all(playerId) as PerGameRow[];
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

  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">{session.user.name ?? 'Profile'}</h1>
      <p className="text-sm text-slate-400">Role: {session.user.role}</p>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-slate-500">Overall</h2>
        <p className="mt-2 font-mono text-3xl tabular-nums">
          {overall ? Math.round(overall.current_rating) : 1200}
        </p>
        {overall?.escrowed_elo ? (
          <p className="text-xs text-slate-500">{Math.round(overall.escrowed_elo)} escrowed</p>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-slate-500">Per-game</h2>
        {perGame.length === 0 ? (
          <p className="mt-2 text-slate-400">No games played yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {perGame.map((r) => (
              <li
                key={r.game_name}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <span>{r.game_name}</span>
                <span className="font-mono tabular-nums">
                  {Math.round(r.current_rating)} · {r.games_played}g
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-slate-500">Recent</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-slate-400">No matches yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((r) => (
              <li
                key={r.match_id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <span>
                  {r.game_name} <span className="text-slate-500">#{r.placement ?? '?'}</span>
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
