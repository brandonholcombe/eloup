import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { canUploadRaceResults } from '@/lib/permissions';
import { listRaces } from '@/lib/db/rc';
import { getCupBySlug, cupStandings, cupRaces } from '@/lib/db/rc-cup';
import { parsePointsScheme } from '@/lib/rc/cup';
import { formatRecordedDateOnly } from '@/lib/rc/datetime';
import { rankMedal } from '@/lib/rank';
import { Card } from '@/components/ui/card';
import { CupManage } from '@/components/CupManage';

export const dynamic = 'force-dynamic';

function raceLabel(r: {
  race_name: string | null;
  race_kind: string;
  track_name: string;
  race_started_at: string;
}): string {
  const name = r.race_name ?? r.race_kind;
  return `${name} · ${r.track_name} · ${formatRecordedDateOnly(r.race_started_at)}`;
}

export default async function CupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const handle = db();
  const cup = getCupBySlug(handle, slug);
  if (!cup) notFound();

  const session = await auth();
  const viewer = session?.user ? { id: session.user.id, role: session.user.role } : null;
  const isAdmin = canUploadRaceResults(viewer);

  const standings = cupStandings(handle, cup.id);
  const races = cupRaces(handle, cup.id);
  const scheme = parsePointsScheme(cup.points_scheme);
  const inCup = new Set(races.map((r) => r.id));
  const available = isAdmin
    ? listRaces(handle, {})
        .filter((r) => !inCup.has(r.id))
        .map((r) => ({ id: r.id, label: raceLabel(r) }))
    : [];

  return (
    <main className="mx-auto max-w-4xl p-4">
      <Link href="/racing" className="text-sm text-muted-foreground hover:text-slate-200">
        ← Racing
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{cup.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        RC points-series cup · {races.length} race{races.length === 1 ? '' : 's'} · points{' '}
        {scheme.join('-')}
      </p>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Standings</h2>
        {standings.length === 0 ? (
          <p className="mt-2 text-slate-400">No races assigned yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {standings.map((s, i) => (
              <li
                key={s.driverId}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <span className="w-6 text-right text-muted-foreground">
                  {rankMedal(i + 1) ?? i + 1}
                </span>
                <span className="flex-1 truncate">{s.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {s.wins}W · {s.races} race{s.races === 1 ? '' : 's'}
                </span>
                <span className="w-12 text-right font-mono tabular-nums">{s.points}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Races</h2>
        {races.length === 0 ? (
          <p className="mt-2 text-slate-400">No races in this cup yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {races.map((r) => (
              <li key={r.id}>
                <Link href={`/racing/${r.id}`}>
                  <Card className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{r.race_name ?? r.race_kind}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.track_name} · {formatRecordedDateOnly(r.race_started_at)}
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin && (
        <CupManage
          slug={cup.slug}
          cupRaces={races.map((r) => ({ id: r.id, label: raceLabel(r) }))}
          availableRaces={available}
          scheme={scheme}
        />
      )}
    </main>
  );
}
