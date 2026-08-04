import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import {
  getTournamentBySlug,
  listMembers,
  listRecentMatches,
} from '@/lib/tournaments';
import { getStandings } from '@/lib/tournament-standings';
import { isTournamentAdmin, isTournamentMember } from '@/lib/permissions';
import { bracketExists, loadBracket } from '@/lib/db/bracket';
import { TournamentStandings } from '@/components/TournamentStandings';
import { InviteCard } from '@/components/InviteCard';
import { MemberRow } from '@/components/MemberRow';
import { CreateBracketButton } from '@/components/CreateBracketButton';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { slug } = await params;
  const handle = db();
  const tournament = getTournamentBySlug(handle, slug);
  if (!tournament) notFound();

  const viewer = { id: session.user.id, role: session.user.role };
  const viewerIsAdmin = isTournamentAdmin(handle, viewer, tournament.id);
  const viewerIsMember = isTournamentMember(handle, viewer.id, tournament.id);
  if (!viewerIsMember && viewer.role !== 'global_admin') notFound();

  const members = listMembers(handle, tournament.id);
  const standings = getStandings(handle, tournament.id);
  const recent = listRecentMatches(handle, tournament.id, 5);

  const hasBracket = bracketExists(handle, tournament.id);
  const bracketNodes = hasBracket ? loadBracket(handle, tournament.id).nodes : [];
  const champion = bracketNodes.find((n) => n.id === 'grand-R1-M1')?.winner ?? null;
  const nameById = new Map(members.map((m) => [m.player_id, m.display_name]));
  const nameOf = (id: string) => nameById.get(id) ?? '?';

  return (
    <main className="p-4">
      <Link href="/tournaments" className="text-sm text-slate-400 hover:text-slate-200">
        ← Tournaments
      </Link>
      <header className="mt-2 flex items-baseline justify-between gap-2">
        <h1 className="truncate text-2xl font-semibold">{tournament.name}</h1>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {members.length} member{members.length === 1 ? '' : 's'}
        </span>
      </header>
      {tournament.ends_at && (
        <p className="mt-1 text-xs text-muted-foreground">ends {tournament.ends_at.slice(0, 10)}</p>
      )}

      {viewerIsAdmin && (
        <InviteCard
          slug={tournament.slug}
          initialToken={tournament.invite_token}
          appDomain={env().APP_DOMAIN}
        />
      )}

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Bracket</h2>
        {hasBracket ? (
          <Link href={`/tournaments/${tournament.slug}/bracket`} className="mt-2 block">
            <Card className="flex items-center justify-between p-3">
              <span className="text-sm">
                {champion ? (
                  <>🏆 Champion: <span className="font-medium">{nameOf(champion)}</span></>
                ) : (
                  'Double-elimination bracket · in progress'
                )}
              </span>
              <span className="text-sm text-muted-foreground">View bracket →</span>
            </Card>
          </Link>
        ) : viewerIsAdmin ? (
          <div className="mt-2">
            <p className="text-sm text-muted-foreground">
              No bracket yet. Generate a double-elimination bracket from the current members with a
              random draw (reshuffle until the first result).
            </p>
            <CreateBracketButton slug={tournament.slug} memberCount={members.length} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No bracket yet.</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Standings</h2>
        <TournamentStandings rows={standings} viewerId={viewer.id} />
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Recent matches</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-slate-400">No confirmed matches yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/matches/${m.id}` as never}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <span>{m.game_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(m.ended_at ?? m.created_at).slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={{ pathname: '/matches/new', query: { tournament: tournament.slug } }}
          className="mt-3 inline-flex items-center justify-center h-tap min-w-tap rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white"
        >
          + Log a tournament match
        </Link>
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Members</h2>
        <ul className="mt-2 space-y-2">
          {members.map((m) => (
            <MemberRow
              key={m.player_id}
              slug={tournament.slug}
              member={m}
              viewerIsAdmin={viewerIsAdmin}
              isCreator={m.player_id === tournament.owner_id}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}
