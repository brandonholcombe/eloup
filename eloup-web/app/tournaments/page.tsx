import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listMyTournaments } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

export default async function TournamentsPage() {
  const session = await auth();
  if (!session?.user) return null;
  const mine = listMyTournaments(db(), session.user.id);

  return (
    <main className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tournaments</h1>
        <Link
          href="/tournaments/new"
          className="h-tap min-w-tap rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white"
        >
          + New
        </Link>
      </div>

      {mine.length === 0 ? (
        <p className="mt-6 text-slate-400">
          You&apos;re not in any tournaments yet. Create one or join via an invite link.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {mine.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tournaments/${t.slug}` as never}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-3"
              >
                <span className="truncate">{t.name}</span>
                {t.ends_at && (
                  <span className="text-xs text-muted-foreground">ends {t.ends_at.slice(0, 10)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
