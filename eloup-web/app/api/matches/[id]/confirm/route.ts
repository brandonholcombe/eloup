import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { confirmRow } from '@/lib/db/match';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const result = confirmRow(db(), id, session.user.id);
  switch (result.status) {
    case 'no_row':
      return NextResponse.json({ error: 'not a participant' }, { status: 403 });
    case 'already_confirmed':
      return NextResponse.json({ status: 'already_confirmed' });
    case 'pending':
      return NextResponse.json({ status: 'pending', remaining: result.remaining });
    case 'confirmed': {
      const deltas: Record<string, { perGame: number; overall: number }> = {};
      for (const [pid, d] of result.deltas) deltas[pid] = d;
      return NextResponse.json({ status: 'confirmed', deltas });
    }
  }
}
