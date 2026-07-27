import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listGames } from '@/lib/db/queries';
import { NewGameForm } from '@/components/NewGameForm';
import { GameCategoryEditor } from '@/components/GameCategoryEditor';
import { InfoTip } from '@/components/InfoTip';

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
        <h2 className="flex items-center text-sm uppercase tracking-wide text-muted-foreground">
          Catalog
          <InfoTip label="catalog row format">
            Each row shows <strong>name (format)</strong> on the left and{' '}
            <strong>min–max players, K=&lt;factor&gt;</strong> on the right.
          </InfoTip>
        </h2>
        {games.length === 0 ? (
          <p className="mt-2 text-slate-400">No games yet — add one below.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {games.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="inline-flex items-center">
                  {g.name}{' '}
                  <span className="ml-1 text-muted-foreground">({g.format})</span>
                  <InfoTip label="match format">
                    How players are grouped: <strong>1v1</strong> is two solo
                    players, <strong>team</strong> is balanced teams sharing a
                    rating delta, <strong>ffa</strong> is a free-for-all with
                    pairwise scoring.
                  </InfoTip>
                </span>
                <span className="inline-flex items-center text-muted-foreground">
                  {g.min_participants}–{g.max_participants}
                  <InfoTip label="participant range">
                    Allowed player count: <strong>min–max</strong>. A range of{' '}
                    <strong>2–2</strong> means exactly 2 players;{' '}
                    <strong>3–6</strong> means anywhere from 3 to 6.
                  </InfoTip>
                  , K={g.default_k}
                  <InfoTip label="K-factor">
                    ELO <strong>K-factor</strong> — how much ratings swing per
                    match for this game. Higher K = bigger swings. Project
                    default is 32; lower values are more conservative.
                  </InfoTip>
                </span>
                <GameCategoryEditor gameId={g.id} currentCategory={g.category} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Add a game</h2>
        <NewGameForm />
      </section>
    </main>
  );
}
