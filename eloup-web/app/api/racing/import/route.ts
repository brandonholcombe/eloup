import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { canUploadRaceResults, type SessionPlayer } from '@/lib/permissions';
import { importLapMonitorJson } from '@/lib/rc/import';
import { createTrack } from '@/lib/rc/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  trackId: z.string().min(1).optional(),
  newTrackName: z.string().min(1).max(120).optional(),
  json: z.unknown(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canUploadRaceResults(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { trackId, newTrackName, json } = parsed.data;
  if (!trackId && !newTrackName) {
    return NextResponse.json(
      { error: 'one of trackId or newTrackName is required' },
      { status: 400 },
    );
  }

  const handle = db();
  const resolvedTrackId = trackId ?? createTrack(handle, newTrackName!).trackId;
  const result = importLapMonitorJson(handle, json, resolvedTrackId, sp.id);

  if (result.status === 'invalid') {
    return NextResponse.json({ error: 'invalid json', reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    status: 'ok',
    trackId: resolvedTrackId,
    summary: result.summary,
    raceIds: result.raceIds,
  });
}
