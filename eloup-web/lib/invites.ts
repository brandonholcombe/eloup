import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { env } from '@/lib/env';
import { getTournamentById, type TournamentRow } from '@/lib/tournaments';

const TOKEN_BYTES = 18;

export type ConsumeResult =
  | { status: 'joined' | 'already_member'; tournament: TournamentRow }
  | { status: 'invalid_token' };

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function issueInvite(
  db: Database.Database,
  tournamentId: string,
): { token: string } {
  const token = generateToken();
  const info = db
    .prepare(`UPDATE tournaments SET invite_token = ? WHERE id = ?`)
    .run(token, tournamentId);
  if (info.changes === 0) throw new Error(`tournament not found: ${tournamentId}`);
  return { token };
}

export function revokeInvite(db: Database.Database, tournamentId: string): { revoked: boolean } {
  const before = db
    .prepare(`SELECT invite_token FROM tournaments WHERE id = ?`)
    .get(tournamentId) as { invite_token: string | null } | undefined;
  if (!before) throw new Error(`tournament not found: ${tournamentId}`);
  if (before.invite_token == null) return { revoked: false };
  db.prepare(`UPDATE tournaments SET invite_token = NULL WHERE id = ?`).run(tournamentId);
  return { revoked: true };
}

export function consumeInvite(
  db: Database.Database,
  token: string,
  playerId: string,
): ConsumeResult {
  return db.transaction((): ConsumeResult => {
    const row = db
      .prepare(`SELECT * FROM tournaments WHERE invite_token = ?`)
      .get(token) as TournamentRow | undefined;
    if (!row) return { status: 'invalid_token' };

    const existing = db
      .prepare(
        `SELECT 1 AS ok FROM tournament_members WHERE tournament_id = ? AND player_id = ?`,
      )
      .get(row.id, playerId) as { ok: number } | undefined;
    if (existing) return { status: 'already_member', tournament: row };

    db.prepare(
      `INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`,
    ).run(row.id, playerId);
    return { status: 'joined', tournament: row };
  }).immediate();
}

export function getInviteToken(
  db: Database.Database,
  tournamentId: string,
): string | null {
  const t = getTournamentById(db, tournamentId);
  return t?.invite_token ?? null;
}

export function buildJoinResponse(result: ConsumeResult): Response {
  if (result.status === 'invalid_token') {
    return new NextResponse('Invite is no longer valid', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  // Build the absolute redirect against APP_DOMAIN, NOT req.url. Next.js
  // populates req.url from the server's bind interface (0.0.0.0:3000 in
  // the cluster), and forwarded-host trust isn't applied to URL parsing
  // here. APP_DOMAIN is the canonical public origin, validated as a URL
  // by lib/env's zod schema.
  const target = new URL(`/tournaments/${result.tournament.slug}`, env().APP_DOMAIN);
  return NextResponse.redirect(target, 303);
}
