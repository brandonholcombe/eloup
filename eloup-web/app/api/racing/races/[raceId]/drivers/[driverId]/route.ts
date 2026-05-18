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
  const result = setDriverPenalty(handle, raceId, driverId, parsed.data.penalty_ms);
  switch (result.status) {
    case 'invalid':
      return NextResponse.json({ error: 'invalid penalty' }, { status: 400 });
    case 'no_row':
      return NextResponse.json({ error: 'race driver not found' }, { status: 404 });
    case 'ok': {
      const standings = standingsForRace(handle, raceId);
      const row = standings.find((s) => s.driver_id === driverId);
      return NextResponse.json({
        status: 'ok',
        placement: row?.placement ?? null,
        adjusted_total_time_ms: row?.adjusted_total_time_ms ?? null,
      });
    }
  }
}
