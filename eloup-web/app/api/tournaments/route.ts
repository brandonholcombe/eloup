import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { createTournament, SlugExhaustedError } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  name: z.string().min(1).max(80),
  endsAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const t = createTournament(db(), {
      name: parsed.data.name,
      ownerId: session.user.id,
      endsAt: parsed.data.endsAt ?? null,
    });
    return NextResponse.json({ id: t.id, slug: t.slug }, { status: 201 });
  } catch (err) {
    if (err instanceof SlugExhaustedError) {
      return NextResponse.json(
        { error: 'slug exhausted, try a different name' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
