import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getGame } from '@/lib/db/queries';
import { canCreateGame } from '@/lib/permissions';
import {
  GAME_CATEGORY_SLUGS,
  type GameCategorySlug,
} from '@/lib/games/categories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  category: z.enum(GAME_CATEGORY_SLUGS as [GameCategorySlug, ...GameCategorySlug[]]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const session = await auth();
  const player = session?.user ? { id: session.user.id, role: session.user.role } : null;
  if (!canCreateGame(player)) {
    // 401 when unauthenticated, 403 when authenticated-but-not-admin.
    // Matches H5's setDriverPlayer envelope shape.
    return NextResponse.json({ error: 'forbidden' }, { status: player ? 403 : 401 });
  }
  const { gameId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const handle = db();
  const existing = getGame(handle, gameId);
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  handle.prepare(`UPDATE games SET category = ? WHERE id = ?`).run(parsed.data.category, gameId);
  return NextResponse.json({ id: gameId, category: parsed.data.category });
}
