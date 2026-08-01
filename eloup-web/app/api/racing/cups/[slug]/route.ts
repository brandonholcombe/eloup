import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { canUploadRaceResults } from '@/lib/permissions';
import {
  addRaceToCup,
  getCupBySlug,
  removeRaceFromCup,
  updatePointsScheme,
} from '@/lib/db/rc-cup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Manage a cup (RC-admin): add/remove a race, or update the points scheme.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const viewer = session?.user ? { id: session.user.id, role: session.user.role } : null;
  if (!canUploadRaceResults(viewer)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { slug } = await params;
  const handle = db();
  const cup = getCupBySlug(handle, slug);
  if (!cup) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    action?: 'add_race' | 'remove_race' | 'set_scheme';
    raceId?: string;
    pointsScheme?: number[];
  } | null;
  try {
    if (body?.action === 'add_race' && body.raceId) {
      addRaceToCup(handle, cup.id, body.raceId);
    } else if (body?.action === 'remove_race' && body.raceId) {
      removeRaceFromCup(handle, cup.id, body.raceId);
    } else if (body?.action === 'set_scheme' && body.pointsScheme) {
      updatePointsScheme(handle, cup.id, body.pointsScheme);
    } else {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
