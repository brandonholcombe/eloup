import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { setDriverPenalty, standingsForRace } from '@/lib/db/rc';
import { canEditRace, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Upper bound 599_999 (< 10 minutes). Operator fat-finger guard: anything
// ≥ 600000 almost certainly means seconds were typed into the ms field.
// The DB-level CHECK only guards the sign; the cap lives here.
const Body = z.object({
  penalty_ms: z.number().int().min(0).max(599_999),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ raceId: string; driverId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canEditRace(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { raceId, driverId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const handle = db();
  // Bracket the mutation: read placement BEFORE setDriverPenalty (which
  // recomputes placements internally), then again after. The UI uses the
  // pair to detect a no-op-on-placement save (penalty applied but
  // laps_completed kept the driver in the same row) and surface a hint.
  const beforeRow = standingsForRace(handle, raceId).find((s) => s.driver_id === driverId);
  const placement_before = beforeRow?.placement ?? null;

  const result = setDriverPenalty(handle, raceId, driverId, parsed.data.penalty_ms);
  switch (result.status) {
    case 'invalid':
      return NextResponse.json({ error: 'invalid penalty' }, { status: 400 });
    case 'no_row':
      return NextResponse.json({ error: 'race driver not found' }, { status: 404 });
    case 'ok': {
      const afterRow = standingsForRace(handle, raceId).find((s) => s.driver_id === driverId);
      return NextResponse.json({
        status: 'ok',
        placement_before,
        placement_after: afterRow?.placement ?? null,
        adjusted_total_time_ms: afterRow?.adjusted_total_time_ms ?? null,
        penalty_ms: parsed.data.penalty_ms,
      });
    }
  }
}
