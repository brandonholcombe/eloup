import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  CreatorImmutableError,
  getTournamentBySlug,
  removeMember,
} from '@/lib/tournaments';
import { isTournamentAdmin } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; playerId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { slug, playerId } = await params;
  const handle = db();
  const t = getTournamentBySlug(handle, slug);
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const viewer = { id: session.user.id, role: session.user.role };
  if (!isTournamentAdmin(handle, viewer, t.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json(removeMember(handle, t.id, playerId));
  } catch (err) {
    if (err instanceof CreatorImmutableError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
