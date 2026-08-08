import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { slugify, withSuffix } from '@/lib/slug';

const MAX_SLUG_RETRIES = 5;

export type TournamentRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  format: string | null;
  invite_token: string | null;
  created_at: string;
  ends_at: string | null;
};

export type TournamentMemberRow = {
  player_id: string;
  display_name: string;
  discord_handle: string;
  avatar_url: string | null;
  is_admin: number;
  is_guest: number;
  joined_at: string;
};

export const MAX_GUEST_NAME = 40;

export class InvalidGuestNameError extends Error {
  constructor() {
    super('guest name must be 1–40 characters');
    this.name = 'InvalidGuestNameError';
  }
}

export type RecentMatchRow = {
  id: string;
  game_id: string;
  game_name: string;
  status: string;
  created_at: string;
  ended_at: string | null;
};

export class SlugExhaustedError extends Error {
  constructor(public readonly baseSlug: string) {
    super(`slug exhausted: ${baseSlug}`);
    this.name = 'SlugExhaustedError';
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(err.message);
}

export function createTournament(
  db: Database.Database,
  input: { name: string; ownerId: string; endsAt?: string | null },
): TournamentRow {
  const baseSlug = slugify(input.name);

  for (let attempt = 1; attempt <= MAX_SLUG_RETRIES; attempt++) {
    const slug = withSuffix(baseSlug, attempt);
    const id = randomUUID();
    try {
      return db.transaction((): TournamentRow => {
        db.prepare(
          `INSERT INTO tournaments(id, name, slug, owner_id, format, ends_at)
           VALUES (?, ?, ?, ?, 'named_group', ?)`,
        ).run(id, input.name, slug, input.ownerId, input.endsAt ?? null);
        db.prepare(
          `INSERT INTO tournament_admins(tournament_id, player_id) VALUES (?, ?)`,
        ).run(id, input.ownerId);
        db.prepare(
          `INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`,
        ).run(id, input.ownerId);
        const row = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(id) as TournamentRow;
        return row;
      }).immediate();
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        continue;
      }
      throw err;
    }
  }
  throw new SlugExhaustedError(baseSlug);
}

export function getTournamentBySlug(
  db: Database.Database,
  slug: string,
): TournamentRow | null {
  const row = db.prepare(`SELECT * FROM tournaments WHERE slug = ?`).get(slug) as
    | TournamentRow
    | undefined;
  return row ?? null;
}

export function getTournamentById(
  db: Database.Database,
  id: string,
): TournamentRow | null {
  const row = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(id) as
    | TournamentRow
    | undefined;
  return row ?? null;
}

export function listMyTournaments(
  db: Database.Database,
  playerId: string,
): TournamentRow[] {
  return db
    .prepare(
      `SELECT t.* FROM tournaments t
         JOIN tournament_members tm ON tm.tournament_id = t.id
        WHERE tm.player_id = ?
        ORDER BY t.created_at DESC`,
    )
    .all(playerId) as TournamentRow[];
}

// All tournaments (for the anonymous-visible leaderboard filter).
export function listAllTournaments(db: Database.Database): TournamentRow[] {
  return db
    .prepare(`SELECT * FROM tournaments ORDER BY created_at DESC`)
    .all() as TournamentRow[];
}

export function listMembers(
  db: Database.Database,
  tournamentId: string,
): TournamentMemberRow[] {
  return db
    .prepare(
      `SELECT p.id AS player_id, p.display_name, p.discord_handle, p.avatar_url,
              p.is_guest, tm.joined_at,
              CASE WHEN ta.player_id IS NULL THEN 0 ELSE 1 END AS is_admin
         FROM tournament_members tm
         JOIN players p ON p.id = tm.player_id
         LEFT JOIN tournament_admins ta
                ON ta.tournament_id = tm.tournament_id AND ta.player_id = tm.player_id
        WHERE tm.tournament_id = ?
        ORDER BY p.display_name ASC`,
    )
    .all(tournamentId) as TournamentMemberRow[];
}

export function listRecentMatches(
  db: Database.Database,
  tournamentId: string,
  limit = 5,
): RecentMatchRow[] {
  return db
    .prepare(
      `SELECT m.id, m.game_id, g.name AS game_name, m.status, m.created_at, m.ended_at
         FROM matches m
         JOIN games g ON g.id = m.game_id
        WHERE m.tournament_id = ?
          AND m.status = 'confirmed'
        ORDER BY COALESCE(m.ended_at, m.created_at) DESC
        LIMIT ?`,
    )
    .all(tournamentId, limit) as RecentMatchRow[];
}

// H12: add a guest entrant (someone with no Discord) to a tournament. The guest
// is a normal players row with a synthetic discord_id ('guest:<uuid>' — never
// collides with a numeric Discord snowflake, so it can never be logged into) and
// is_guest = 1. Reuses the whole member → bracket → match → ELO pipeline. The
// entered name is used for both display_name and discord_handle. One transaction.
export function addGuestMember(
  db: Database.Database,
  tournamentId: string,
  name: string,
): TournamentMemberRow {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_GUEST_NAME) {
    throw new InvalidGuestNameError();
  }
  const t = getTournamentById(db, tournamentId);
  if (!t) throw new Error(`tournament not found: ${tournamentId}`);
  return db.transaction((): TournamentMemberRow => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, email,
                           email_verified, avatar_url, role, is_guest)
       VALUES (?, ?, ?, ?, NULL, 0, NULL, 'user', 1)`,
    ).run(id, `guest:${randomUUID()}`, trimmed, trimmed);
    db.prepare(
      `INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`,
    ).run(tournamentId, id);
    return listMembers(db, tournamentId).find((m) => m.player_id === id)!;
  }).immediate();
}

// H12: delete guest players who are no longer referenced anywhere, so a deleted
// tournament (or a removed guest member) doesn't leave orphaned guests polluting
// the global leaderboard. Only purges is_guest rows with NO remaining membership,
// NO match_participants, and NO bracket_matches reference — FK-safe in that order
// (overall_ratings → ratings → players). Must run inside a transaction; the
// caller has already removed the relevant tournament_members / matches.
export function purgeOrphanGuests(db: Database.Database, playerIds: string[]): number {
  const isGuest = db.prepare(`SELECT 1 FROM players WHERE id = ? AND is_guest = 1`);
  const stillMember = db.prepare(`SELECT 1 FROM tournament_members WHERE player_id = ? LIMIT 1`);
  const hasMatch = db.prepare(`SELECT 1 FROM match_participants WHERE player_id = ? LIMIT 1`);
  const inBracket = db.prepare(
    `SELECT 1 FROM bracket_matches
      WHERE p1_player_id = ? OR p2_player_id = ? OR winner_player_id = ? LIMIT 1`,
  );
  const delOverall = db.prepare(`DELETE FROM overall_ratings WHERE player_id = ?`);
  const delRatings = db.prepare(`DELETE FROM ratings WHERE player_id = ?`);
  const delPlayer = db.prepare(`DELETE FROM players WHERE id = ?`);
  let purged = 0;
  for (const id of playerIds) {
    if (!isGuest.get(id)) continue;
    if (stillMember.get(id)) continue;
    if (hasMatch.get(id)) continue;
    if (inBracket.get(id, id, id)) continue;
    delOverall.run(id);
    delRatings.run(id);
    delPlayer.run(id);
    purged++;
  }
  return purged;
}

export function removeMember(
  db: Database.Database,
  tournamentId: string,
  playerId: string,
): { removed: boolean } {
  const t = getTournamentById(db, tournamentId);
  if (!t) throw new Error(`tournament not found: ${tournamentId}`);
  if (t.owner_id === playerId) {
    throw new CreatorImmutableError(`cannot remove the tournament creator`);
  }
  return db.transaction((): { removed: boolean } => {
    db.prepare(
      `DELETE FROM tournament_admins WHERE tournament_id = ? AND player_id = ?`,
    ).run(tournamentId, playerId);
    const info = db
      .prepare(`DELETE FROM tournament_members WHERE tournament_id = ? AND player_id = ?`)
      .run(tournamentId, playerId);
    // Clean up a removed guest who is now unreferenced (no-op for real players).
    purgeOrphanGuests(db, [playerId]);
    return { removed: info.changes > 0 };
  }).immediate();
}

export function promoteToAdmin(
  db: Database.Database,
  tournamentId: string,
  playerId: string,
): { promoted: boolean } {
  const member = db
    .prepare(
      `SELECT 1 AS ok FROM tournament_members WHERE tournament_id = ? AND player_id = ?`,
    )
    .get(tournamentId, playerId) as { ok: number } | undefined;
  if (!member) throw new NotAMemberError(`player ${playerId} is not a member`);
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO tournament_admins(tournament_id, player_id) VALUES (?, ?)`,
    )
    .run(tournamentId, playerId);
  return { promoted: info.changes > 0 };
}

export function demoteFromAdmin(
  db: Database.Database,
  tournamentId: string,
  playerId: string,
  callerRole: 'user' | 'global_admin',
): { demoted: boolean } {
  const t = getTournamentById(db, tournamentId);
  if (!t) throw new Error(`tournament not found: ${tournamentId}`);
  if (t.owner_id === playerId && callerRole !== 'global_admin') {
    throw new CreatorImmutableError(`creator can only be demoted by a global_admin`);
  }
  const info = db
    .prepare(`DELETE FROM tournament_admins WHERE tournament_id = ? AND player_id = ?`)
    .run(tournamentId, playerId);
  return { demoted: info.changes > 0 };
}

export class CreatorImmutableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CreatorImmutableError';
  }
}

export class NotAMemberError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'NotAMemberError';
  }
}

export type MembershipGuardResult =
  | { ok: true }
  | { ok: false; reason: 'caller_not_member' | 'participant_not_member'; offending?: string };

export function checkTournamentMatchMembership(
  db: Database.Database,
  tournamentId: string,
  callerId: string,
  participantIds: readonly string[],
): MembershipGuardResult {
  const memberSet = new Set(
    (
      db
        .prepare(`SELECT player_id FROM tournament_members WHERE tournament_id = ?`)
        .all(tournamentId) as { player_id: string }[]
    ).map((r) => r.player_id),
  );
  if (!memberSet.has(callerId)) {
    return { ok: false, reason: 'caller_not_member' };
  }
  for (const pid of participantIds) {
    if (!memberSet.has(pid)) {
      return { ok: false, reason: 'participant_not_member', offending: pid };
    }
  }
  return { ok: true };
}
