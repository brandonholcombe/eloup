import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { searchPlayers } from '@/lib/db/queries';
import { canEditRace, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;
const MAX_QUERY_LEN = 64;

// Admin-gated read of the players table. display_name + discord_handle
// is PII for a Discord-community app; keep the gate aligned with
// canEditRace so widening admin powers in one place widens search too.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canEditRace(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const rawQ = url.searchParams.get('q') ?? '';
  // Cap the query length before letting it touch SQL — defensive. The
  // searchPlayers helper itself already trims + short-circuits on
  // empty, but bounding the input here protects against pathological
  // 10k-char URLs.
  const q = rawQ.slice(0, MAX_QUERY_LEN);

  const rawLimit = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (rawLimit != null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(MAX_LIMIT, parsed));
    }
  }

  const players = searchPlayers(db(), q, limit);
  return NextResponse.json({ players });
}
