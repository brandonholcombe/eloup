import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { canUploadRaceResults, type SessionPlayer } from '@/lib/permissions';
import { importLapMonitorJson } from '@/lib/rc/import';
import { importLapMonitorTxt } from '@/lib/rc/import-txt';
import { createTrack } from '@/lib/rc/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Discriminated body — explicit `format` literal removes the z.union
// left-to-right ambiguity. Scripting consumers MUST set the literal.
const Body = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('json'),
    trackId: z.string().min(1).optional(),
    newTrackName: z.string().min(1).max(120).optional(),
    json: z.unknown(),
  }),
  z.object({
    format: z.literal('txt'),
    trackId: z.string().min(1).optional(),
    newTrackName: z.string().min(1).max(120).optional(),
    text: z.string().min(1),
  }),
]);

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
  const { trackId, newTrackName } = parsed.data;
  if (!trackId && !newTrackName) {
    return NextResponse.json(
      { error: 'one of trackId or newTrackName is required' },
      { status: 400 },
    );
  }

  const handle = db();
  const resolvedTrackId = trackId ?? createTrack(handle, newTrackName!).trackId;

  const result =
    parsed.data.format === 'json'
      ? importLapMonitorJson(handle, parsed.data.json, resolvedTrackId, sp.id)
      : importLapMonitorTxt(handle, parsed.data.text, resolvedTrackId, sp.id);

  if (result.status === 'invalid') {
    const errKey = parsed.data.format === 'json' ? 'invalid json' : 'invalid txt';
    return NextResponse.json({ error: errKey, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    status: 'ok',
    trackId: resolvedTrackId,
    summary: result.summary,
    raceIds: result.raceIds,
  });
}
