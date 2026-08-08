import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { statusColor } from '@/lib/result';
import { listMyTournaments } from '@/lib/tournaments';
import { TournamentFilter } from '@/components/TournamentFilter';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  game_name: string;
  status: string;
  confirmed_at: string | null;
  created_at: string;
};

type Search = { tournament?: string };

export default async function MatchesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth();
  if (!session?.user) return null; // middleware redirects, this is a backstop
  const { tournament } = await searchParams;
  const playerId = session.user.id;
  const handle = db();

  // Filter by tournament (viewer's memberships). Resolve slug→id; fall back to all.
  const myTournaments = listMyTournaments(handle, playerId);
  const activeTournament = tournament ? myTournaments.find((t) => t.slug === tournament) ?? null : null;
  const params: Record<string, unknown> = { pid: playerId };
  let clause = '';
  if (activeTournament) {
    clause = 'AND m.tournament_id = @tid';
    params.tid = activeTournament.id;
  }
  const rows = handle
    .prepare(
      `SELECT m.id, g.name AS game_name, m.status, mp.confirmed_at, m.created_at
         FROM matches m
         JOIN games g ON g.id = m.game_id
         JOIN match_participants mp ON mp.match_id = m.id AND mp.player_id = @pid
        WHERE 1=1 ${clause}
        ORDER BY m.created_at DESC
        LIMIT 50`,
    )
    .all(params) as Row[];

  const pending = rows.filter((r) => r.status === 'pending' && r.confirmed_at == null);
  const recent = rows.filter((r) => r.status === 'confirmed' || r.confirmed_at != null);

  return (
    <main className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Matches</h1>
        <Link
          href="/matches/new"
          className="inline-flex items-center justify-center h-tap min-w-tap rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white"
        >
          + New
        </Link>
      </div>

      {myTournaments.length > 0 && (
        <div className="mt-3">
          <TournamentFilter
            basePath="/matches"
            tournaments={myTournaments}
            active={activeTournament?.slug ?? null}
            allLabel="All my matches"
          />
        </div>
      )}

      <Section title="Awaiting your confirmation" rows={pending} emptyMsg="Nothing pending." />
      <Section title="Recent" rows={recent} emptyMsg="No matches yet." />
    </main>
  );
}

function Section({ title, rows, emptyMsg }: { title: string; rows: Row[]; emptyMsg: string }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm uppercase tracking-wide text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-slate-400">{emptyMsg}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/matches/${r.id}` as never}
                className="flex min-h-tap items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span>{r.game_name}</span>
                <span className={statusColor(r.status)}>{r.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
