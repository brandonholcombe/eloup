import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { canUploadRaceResults } from '@/lib/permissions';
import { createCup } from '@/lib/db/rc-cup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Create an RC cup (RC-admin only).
export async function POST(req: Request) {
  const session = await auth();
  const viewer = session?.user ? { id: session.user.id, role: session.user.role } : null;
  if (!canUploadRaceResults(viewer)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const cup = createCup(db(), { name, createdBy: viewer!.id });
  return NextResponse.json({ ok: true, slug: cup.slug });
}
