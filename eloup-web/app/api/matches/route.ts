import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getGame } from '@/lib/db/queries';
import { checkTournamentMatchMembership, getTournamentById } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  gameId: z.string().min(1),
  tournamentId: z.string().min(1).nullable().optional(),
  participants: z
    .array(
      z.object({
        playerId: z.string().min(1),
        placement: z.number().int().min(1),
        teamLabel: z.string().min(1).max(2).nullable(),
      }),
    )
    .min(2),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', detail: parsed.error.flatten() }, { status: 400 });
  }
  const { gameId, participants } = parsed.data;
  const tournamentId = parsed.data.tournamentId ?? null;

  const handle = db();
  const game = getGame(handle, gameId);
  if (!game) return NextResponse.json({ error: 'unknown game' }, { status: 404 });
  if (participants.length < game.min_participants || participants.length > game.max_participants) {
    return NextResponse.json(
      { error: `participant count out of range ${game.min_participants}–${game.max_participants}` },
      { status: 400 },
    );
  }
  if (game.format === 'team' && participants.some((p) => !p.teamLabel)) {
    return NextResponse.json({ error: 'team format requires teamLabel on every row' }, { status: 400 });
  }

  const viewerId = session.user.id;

  if (tournamentId) {
    const t = getTournamentById(handle, tournamentId);
    if (!t) return NextResponse.json({ error: 'unknown tournament' }, { status: 404 });
    const guard = checkTournamentMatchMembership(
      handle,
      tournamentId,
      viewerId,
      participants.map((p) => p.playerId),
    );
    if (!guard.ok) {
      return NextResponse.json(
        guard.reason === 'caller_not_member'
          ? { error: 'caller is not a tournament member' }
          : { error: 'participant is not a tournament member', playerId: guard.offending },
        { status: 403 },
      );
    }
  }

  const matchId = randomUUID();
  const now = new Date().toISOString();

  const tx = handle.transaction(() => {
    handle
      .prepare(
        `INSERT INTO matches(id, game_id, tournament_id, created_by, status)
         VALUES (?, ?, ?, ?, 'pending')`,
      )
      .run(matchId, gameId, tournamentId, viewerId);
    const insertRow = handle.prepare(
      `INSERT INTO match_participants(match_id, player_id, team_label, placement, confirmed_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const p of participants) {
      const confirmedAt = p.playerId === viewerId ? now : null;
      insertRow.run(matchId, p.playerId, p.teamLabel, p.placement, confirmedAt);
    }
  });
  try {
    tx.immediate();
  } catch (err) {
    return NextResponse.json(
      { error: 'insert failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ id: matchId }, { status: 201 });
}
