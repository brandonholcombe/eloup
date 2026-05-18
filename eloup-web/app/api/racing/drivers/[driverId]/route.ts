import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getDriverWithLinkedPlayer, setDriverPlayer } from '@/lib/db/rc';
import { canEditRace, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  player_id: z.string().min(1).nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ driverId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canEditRace(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { driverId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const handle = db();
  const result = setDriverPlayer(handle, driverId, parsed.data.player_id);
  switch (result.status) {
    case 'no_driver':
      return NextResponse.json({ error: 'driver not found' }, { status: 404 });
    case 'no_player':
      // 422 — the URL itself (the driver) is valid; the request body
      // refers to a player that doesn't exist. 404 here would imply the
      // route itself was the wrong URL.
      return NextResponse.json({ error: 'player not found' }, { status: 422 });
    case 'ok': {
      const refreshed = getDriverWithLinkedPlayer(handle, driverId);
      return NextResponse.json({
        status: 'ok',
        player_id: parsed.data.player_id,
        linked_player:
          refreshed?.player_id != null
            ? {
                id: refreshed.player_id,
                display_name: refreshed.linked_display_name,
                discord_handle: refreshed.linked_discord_handle,
                avatar_url: refreshed.linked_avatar_url,
              }
            : null,
      });
    }
  }
}
