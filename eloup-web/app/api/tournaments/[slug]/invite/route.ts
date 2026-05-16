import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { getTournamentBySlug } from '@/lib/tournaments';
import { issueInvite, revokeInvite } from '@/lib/invites';
import { isTournamentAdmin } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadTournament(slug: string) {
  const handle = db();
  const t = getTournamentBySlug(handle, slug);
  return { handle, t };
}

function joinUrl(token: string): string {
  return `${env().APP_DOMAIN.replace(/\/$/, '')}/tournaments/join/${token}`;
}

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { slug } = await params;
  const { handle, t } = await loadTournament(slug);
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const viewer = { id: session.user.id, role: session.user.role };
  if (!isTournamentAdmin(handle, viewer, t.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { token } = issueInvite(handle, t.id);
  return NextResponse.json({ token, joinUrl: joinUrl(token) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { slug } = await params;
  const { handle, t } = await loadTournament(slug);
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const viewer = { id: session.user.id, role: session.user.role };
  if (!isTournamentAdmin(handle, viewer, t.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json(revokeInvite(handle, t.id));
}
