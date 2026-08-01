import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getTournamentBySlug } from '@/lib/tournaments';
import { isTournamentAdmin } from '@/lib/permissions';
import {
  bracketExists,
  createBracket,
  seedMembersByElo,
  shuffledMembers,
} from '@/lib/db/bracket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Create the double-elim bracket. seeding: 'random' (default, a party draw) or
// 'elo' (seed by overall ELO).
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
  if (bracketExists(handle, t.id)) {
    return NextResponse.json({ error: 'bracket already exists' }, { status: 409 });
  }
  const body = (await req.json().catch(() => null)) as { seeding?: 'random' | 'elo' } | null;
  const seeds =
    body?.seeding === 'elo' ? seedMembersByElo(handle, t.id) : shuffledMembers(handle, t.id);
  if (seeds.length < 2) {
    return NextResponse.json({ error: 'need at least 2 members' }, { status: 400 });
  }
  createBracket(handle, t.id, seeds);
  return NextResponse.json({ ok: true, entrants: seeds.length });
}
