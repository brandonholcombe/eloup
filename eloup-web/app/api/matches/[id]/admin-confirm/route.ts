import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { forceConfirmMatch } from '@/lib/db/match';
import { canForceConfirmMatch, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const handle = db();
  const match = handle
    .prepare(`SELECT tournament_id FROM matches WHERE id = ?`)
    .get(id) as { tournament_id: string | null } | undefined;
  if (!match) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canForceConfirmMatch(handle, sp, match)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = forceConfirmMatch(handle, id);
  switch (result.status) {
    case 'no_match':
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    case 'already_confirmed':
      return NextResponse.json({ status: 'already_confirmed' });
    case 'not_pending':
      return NextResponse.json(
        { error: `match status is ${result.current}, cannot force-confirm` },
        { status: 409 },
      );
    case 'confirmed': {
      const deltas: Record<string, { perGame: number; overall: number }> = {};
      for (const [pid, d] of result.deltas) deltas[pid] = d;
      return NextResponse.json({ status: 'confirmed', deltas });
    }
  }
}
