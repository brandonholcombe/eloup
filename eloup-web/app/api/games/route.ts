import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listGames } from '@/lib/db/queries';
import { canCreateGame } from '@/lib/permissions';
import {
  GAME_CATEGORY_SLUGS,
  type GameCategorySlug,
} from '@/lib/games/categories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  format: z.enum(['1v1', 'team', 'ffa']),
  min_participants: z.number().int().min(2).max(32),
  max_participants: z.number().int().min(2).max(32),
  default_k: z.number().int().min(1).max(128).default(32),
  category: z
    .enum(GAME_CATEGORY_SLUGS as [GameCategorySlug, ...GameCategorySlug[]])
    .default('other'),
});

export async function GET() {
  return NextResponse.json({ games: listGames(db()) });
}

export async function POST(req: Request) {
  const session = await auth();
  const player = session?.user ? { id: session.user.id, role: session.user.role } : null;
  if (!canCreateGame(player)) {
    // Reviewer MINOR #5: separate unauthenticated (401) from authenticated-
    // but-forbidden (403). The new PATCH handler does the same so both
    // methods on /api/games now agree on auth-vs-forbidden semantics.
    return NextResponse.json({ error: 'forbidden' }, { status: player ? 403 : 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', detail: parsed.error.flatten() }, { status: 400 });
  }
  const { name, slug, format, min_participants, max_participants, default_k, category } =
    parsed.data;
  if (max_participants < min_participants) {
    return NextResponse.json({ error: 'max < min' }, { status: 400 });
  }
  const id = randomUUID();
  try {
    db()
      .prepare(
        `INSERT INTO games(id, name, slug, default_k, format, min_participants, max_participants, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, slug, default_k, format, min_participants, max_participants, category);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      return NextResponse.json({ error: 'slug already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ id }, { status: 201 });
}
