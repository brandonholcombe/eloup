import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { canForceConfirmMatch, type SessionPlayer } from '@/lib/permissions';
import { deleteMatch } from '@/lib/db/admin-delete';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin delete of a match (reverses ELO if confirmed). Gated like force-confirm:
// global_admin, or tournament_admin of the match's tournament. Bracket-linked
// matches are protected (delete the tournament instead).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const handle = db();
  const match = handle
    .prepare(`SELECT tournament_id FROM matches WHERE id = ?`)
    .get(id) as { tournament_id: string | null } | undefined;
  if (!match) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canForceConfirmMatch(handle, sp, { tournament_id: match.tournament_id })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const res = deleteMatch(handle, id);
  if (res.status === 'bracket_linked') {
    return NextResponse.json(
      { error: 'This match is part of a bracket — delete the tournament instead.' },
      { status: 409 },
    );
  }
  if (res.status === 'not_found') return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
