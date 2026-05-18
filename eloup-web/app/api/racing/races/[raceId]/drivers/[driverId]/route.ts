import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { setDriverPenalty, setVoidedLapsCount, standingsForRace } from '@/lib/db/rc';
import { canEditRace, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH body accepts EITHER `penalty_ms` (race-kind penalty) OR
// `voided_laps_count` (qualif/practice penalty mechanism — voids N
// fastest laps from the top-3-avg ranking). `.strict()` on each branch
// rejects bodies that pass BOTH fields: "submitted both, only one
// applied" is a bug-magnet, so we turn that into a 400.
//
// Upper bound 599_999 (< 10 minutes) on penalty_ms is the operator
// fat-finger guard. Upper bound 10 on voided_laps_count caps the number
// of admin-discretion lap voids per driver.
const Body = z.union([
  z.object({ penalty_ms: z.number().int().min(0).max(599_999) }).strict(),
  z.object({ voided_laps_count: z.number().int().min(0).max(10) }).strict(),
]);

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
  // Bracket the mutation: read placement BEFORE the mutation (which
  // recomputes placements internally), then again after. The UI uses the
  // pair to detect a no-op-on-placement save and surface a hint.
  const beforeRow = standingsForRace(handle, raceId).find((s) => s.driver_id === driverId);
  const placement_before = beforeRow?.placement ?? null;

  const result =
    'penalty_ms' in parsed.data
      ? setDriverPenalty(handle, raceId, driverId, parsed.data.penalty_ms)
      : setVoidedLapsCount(handle, raceId, driverId, parsed.data.voided_laps_count);

  switch (result.status) {
    case 'invalid':
      return NextResponse.json(
        {
          error:
            'penalty_ms' in parsed.data ? 'invalid penalty' : 'invalid voided_laps_count',
        },
        { status: 400 },
      );
    case 'no_row':
      return NextResponse.json({ error: 'race driver not found' }, { status: 404 });
    case 'ok': {
      const afterRow = standingsForRace(handle, raceId).find((s) => s.driver_id === driverId);
      return NextResponse.json({
        status: 'ok',
        placement_before,
        placement_after: afterRow?.placement ?? null,
        adjusted_total_time_ms: afterRow?.adjusted_total_time_ms ?? null,
        penalty_ms: afterRow?.penalty_ms ?? 0,
        voided_laps_count: afterRow?.voided_laps_count ?? 0,
      });
    }
  }
}
