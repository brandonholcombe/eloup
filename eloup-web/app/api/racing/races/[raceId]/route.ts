import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { setRaceTrack } from '@/lib/db/rc';
import { canEditRace, type SessionPlayer } from '@/lib/permissions';
import { createTrack } from '@/lib/rc/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.union([
  z.object({ trackId: z.string().min(1) }),
  z.object({ trackName: z.string().min(1).max(120) }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canEditRace(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { raceId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const handle = db();
  let resolvedTrackId: string;
  let matched = false;
  if ('trackId' in parsed.data) {
    resolvedTrackId = parsed.data.trackId;
  } else {
    const created = createTrack(handle, parsed.data.trackName);
    resolvedTrackId = created.trackId;
    matched = created.matched;
  }

  const result = setRaceTrack(handle, raceId, resolvedTrackId);
  switch (result.status) {
    case 'no_race':
      return NextResponse.json({ error: 'race not found' }, { status: 404 });
    case 'no_track':
      return NextResponse.json({ error: 'track not found' }, { status: 400 });
    case 'ok':
      return NextResponse.json({ status: 'ok', trackId: resolvedTrackId, matched });
  }
}
