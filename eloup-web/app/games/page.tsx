import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listGames } from '@/lib/db/queries';
import { NewGameForm } from '@/components/NewGameForm';

export const dynamic = 'force-dynamic';

export default async function GamesPage() {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.role !== 'global_admin') redirect('/leaderboards');
  const games = listGames(db());
  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">Games</h1>
      <p className="text-sm text-slate-400">global_admin only</p>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-slate-500">Catalog</h2>
        {games.length === 0 ? (
          <p className="mt-2 text-slate-400">No games yet — add one below.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {games.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <span>
                  {g.name} <span className="text-slate-500">({g.format})</span>
                </span>
                <span className="text-slate-500">
                  {g.min_participants}–{g.max_participants}, K={g.default_k}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-slate-500">Add a game</h2>
        <NewGameForm />
      </section>
    </main>
  );
}
