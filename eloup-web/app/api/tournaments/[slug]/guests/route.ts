import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  addGuestMember,
  getTournamentBySlug,
  InvalidGuestNameError,
} from '@/lib/tournaments';
import { isTournamentAdmin } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin: add a guest entrant (no Discord) to a tournament by name.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name : '';
  try {
    return NextResponse.json(addGuestMember(handle, t.id, name));
  } catch (err) {
    if (err instanceof InvalidGuestNameError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
