import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { ConfirmRowButton } from '@/components/ConfirmRowButton';
import { AdminForceConfirmButton } from '@/components/AdminForceConfirmButton';
import { canForceConfirmMatch, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type RowDetail = {
  player_id: string;
  display_name: string;
  discord_handle: string;
  team_label: string | null;
  placement: number | null;
  rating_before: number | null;
  rating_delta: number | null;
  confirmed_at: string | null;
};

type MatchHeader = {
  id: string;
  game_name: string;
  status: string;
  created_at: string;
};

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const handle = db();
  const match = handle
    .prepare(
      `SELECT m.id, g.name AS game_name, m.status, m.created_at, m.tournament_id
         FROM matches m JOIN games g ON g.id = m.game_id WHERE m.id = ?`,
    )
    .get(id) as (MatchHeader & { tournament_id: string | null }) | undefined;
  if (!match) notFound();
  const sp: SessionPlayer | null = session?.user
    ? { id: session.user.id, role: session.user.role }
    : null;
  const canAdminForce =
    match.status === 'pending' &&
    canForceConfirmMatch(handle, sp, { tournament_id: match.tournament_id });
  const rows = handle
    .prepare(
      `SELECT mp.player_id, p.display_name, p.discord_handle, mp.team_label, mp.placement,
              mp.rating_before, mp.rating_delta, mp.confirmed_at
         FROM match_participants mp JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = ?
        ORDER BY mp.placement, p.display_name`,
    )
    .all(id) as RowDetail[];

  return (
    <main className="p-4">
      <Link href="/matches" className="text-sm text-slate-400 hover:text-slate-200">
        ← Matches
      </Link>
      <header className="mt-2">
        <h1 className="text-xl font-semibold">{match.game_name}</h1>
        <p className="text-sm text-slate-400">Status: {match.status}</p>
      </header>
      <ul className="mt-4 space-y-2">
        {rows.map((r) => {
          const isMine = session?.user?.id === r.player_id;
          const confirmed = r.confirmed_at != null;
          return (
            <li
              key={r.player_id}
              className="rounded-md border border-border bg-card p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {r.display_name}
                  {isMine && <span className="ml-1 text-blue-400">(you)</span>}
                </span>
                <span className="text-slate-400">#{r.placement ?? '?'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                <span>{r.team_label ? `Team ${r.team_label}` : ' '}</span>
                <span>
                  {confirmed ? '✓ confirmed' : 'awaiting confirmation'}
                  {r.rating_delta != null && (
                    <span className="ml-2 font-mono tabular-nums text-slate-300">
                      Δ {r.rating_delta >= 0 ? '+' : ''}
                      {Math.round(r.rating_delta)}
                    </span>
                  )}
                </span>
              </div>
              {isMine && !confirmed && match.status === 'pending' && (
                <ConfirmRowButton matchId={match.id} />
              )}
            </li>
          );
        })}
      </ul>
      {canAdminForce && <AdminForceConfirmButton matchId={match.id} />}
    </main>
  );
}
