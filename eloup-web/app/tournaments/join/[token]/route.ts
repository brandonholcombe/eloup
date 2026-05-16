import { NextResponse } from 'next/server';
import { auth, signIn } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { buildJoinResponse, consumeInvite } from '@/lib/invites';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  const { token } = await params;
  if (!session?.user) {
    const callback = new URL(req.url).pathname;
    await signIn('discord', { redirectTo: callback });
    return new NextResponse('redirecting to sign-in', { status: 401 });
  }
  return buildJoinResponse(consumeInvite(db(), token, session.user.id), req.url);
}
