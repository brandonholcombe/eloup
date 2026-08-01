import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getTournamentBySlug } from '@/lib/tournaments';
import { isTournamentAdmin } from '@/lib/permissions';
import { recordBracketResult, recordWalkover } from '@/lib/db/bracket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-authoritative: report a played bracket result (creates a real Smash
// match + ELO), or a walkover/no-show (advances without a match/ELO).
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
  const body = (await req.json().catch(() => null)) as {
    nodeId?: string;
    winnerId?: string;
    walkover?: boolean;
  } | null;
  if (!body?.nodeId || !body?.winnerId) {
    return NextResponse.json({ error: 'nodeId and winnerId required' }, { status: 400 });
  }
  const res = body.walkover
    ? recordWalkover(handle, t.id, body.nodeId, body.winnerId)
    : recordBracketResult(handle, t.id, body.nodeId, body.winnerId, viewer.id);
  if (res.status !== 'ok') {
    const code = res.status === 'no_node' ? 404 : 400;
    return NextResponse.json({ error: res.status }, { status: code });
  }
  return NextResponse.json({ ok: true, champion: res.champion });
}
