import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getTournamentBySlug } from '@/lib/tournaments';
import { isTournamentAdmin } from '@/lib/permissions';
import { deleteTournament } from '@/lib/db/admin-delete';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin delete of a whole tournament: cascades matches/participants/bracket/
// members and reverses the ELO its confirmed matches applied. global_admin or
// tournament_admin.
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { slug } = await params;
  const handle = db();
  const t = getTournamentBySlug(handle, slug);
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const viewer = { id: session.user.id, role: session.user.role };
  if (!isTournamentAdmin(handle, viewer, t.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  deleteTournament(handle, t.id);
  return NextResponse.json({ ok: true });
}
