import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listGames } from '@/lib/db/queries';
import { listMyTournaments, listMembers } from '@/lib/tournaments';
import { NewMatchForm } from '@/components/NewMatchForm';

export const dynamic = 'force-dynamic';

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ tournament?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { tournament: tournamentSlug } = await searchParams;
  const handle = db();
  const games = listGames(handle);
  const players = handle
    .prepare(`SELECT id, display_name, discord_handle FROM players ORDER BY display_name`)
    .all() as { id: string; display_name: string; discord_handle: string }[];

  const myTournaments = listMyTournaments(handle, session.user.id);
  const tournaments = myTournaments.map((t) => {
    const members = listMembers(handle, t.id).map((m) => ({
      id: m.player_id,
      display_name: m.display_name,
      discord_handle: m.discord_handle,
    }));
    return { id: t.id, slug: t.slug, name: t.name, members };
  });

  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">Log a match</h1>
      {games.length === 0 ? (
        <p className="mt-4 text-slate-400">
          No games configured yet. Ask a global admin to add one.
        </p>
      ) : (
        <NewMatchForm
          games={games}
          players={players}
          viewerId={session.user.id}
          tournaments={tournaments}
          defaultTournamentSlug={tournamentSlug ?? null}
        />
      )}
    </main>
  );
}
