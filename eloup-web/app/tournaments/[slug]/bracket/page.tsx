import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getTournamentBySlug, listMembers } from '@/lib/tournaments';
import { isTournamentAdmin, isTournamentMember } from '@/lib/permissions';
import { bracketExists, loadBracket } from '@/lib/db/bracket';
import { Bracket } from '@/components/Bracket';
import { ShuffleBracketButton } from '@/components/ShuffleBracketButton';

export const dynamic = 'force-dynamic';

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
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

  if (!bracketExists(handle, tournament.id)) {
    redirect(`/tournaments/${tournament.slug}`);
  }

  const nodes = loadBracket(handle, tournament.id).nodes;
  const bracketStarted = nodes.some((n) => n.status === 'done');
  const nameById = new Map(listMembers(handle, tournament.id).map((m) => [m.player_id, m.display_name]));
  const nameOf = (id: string) => nameById.get(id) ?? '?';

  return (
    <main className="p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/tournaments/${tournament.slug}`}
          className="text-sm text-muted-foreground hover:text-slate-200"
        >
          ← {tournament.name}
        </Link>
        {viewerIsAdmin && !bracketStarted && <ShuffleBracketButton slug={tournament.slug} />}
      </div>
      <h1 className="mt-1 text-lg font-semibold">Bracket</h1>
      <div className="mt-2">
        <Bracket nodes={nodes} nameOf={nameOf} slug={tournament.slug} viewerIsAdmin={viewerIsAdmin} />
      </div>
    </main>
  );
}
