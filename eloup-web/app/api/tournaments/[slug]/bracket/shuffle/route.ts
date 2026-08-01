import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getTournamentBySlug } from '@/lib/tournaments';
import { isTournamentAdmin } from '@/lib/permissions';
import { bracketExists, reseedBracket, shuffledMembers } from '@/lib/db/bracket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin: reshuffle the draw (regenerate from current members). Blocked once any
// result is reported (409).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
  if (!bracketExists(handle, t.id)) {
    return NextResponse.json({ error: 'no bracket' }, { status: 404 });
  }
  const res = reseedBracket(handle, t.id, shuffledMembers(handle, t.id));
  if (res.status === 'has_results') {
    return NextResponse.json({ error: 'results already reported' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
