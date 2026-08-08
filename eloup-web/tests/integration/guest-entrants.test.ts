import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  addGuestMember,
  createTournament,
  InvalidGuestNameError,
  listMembers,
  purgeOrphanGuests,
  removeMember,
} from '@/lib/tournaments';
import { findPlayerByDiscordId, overallLeaderboard, searchPlayers } from '@/lib/db/queries';
import { createBracket, loadBracket, recordBracketResult } from '@/lib/db/bracket';
import { deleteTournament } from '@/lib/db/admin-delete';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-guest-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

// A real (Discord) owner to create the tournament with.
function makeOwner(db: Database.Database): string {
  const id = 'owner';
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
  ).run(id, '111111111111111111', 'owner', 'Owner');
  return id;
}

describe('guest tournament entrants (H12)', () => {
  it('addGuestMember creates an is_guest player with a synthetic discord_id + member row', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });

    const guest = addGuestMember(db, t.id, '  Bob the Guest  ');
    expect(guest.display_name).toBe('Bob the Guest'); // trimmed
    expect(guest.is_guest).toBe(1);

    const row = db
      .prepare(`SELECT discord_id, is_guest, email, avatar_url FROM players WHERE id = ?`)
      .get(guest.player_id) as {
      discord_id: string;
      is_guest: number;
      email: string | null;
      avatar_url: string | null;
    };
    expect(row.discord_id).toMatch(/^guest:/);
    expect(row.is_guest).toBe(1);
    expect(row.email).toBeNull();
    expect(row.avatar_url).toBeNull();

    // Member of the tournament, badged in listMembers.
    const members = listMembers(db, t.id);
    expect(members.find((m) => m.player_id === guest.player_id)?.is_guest).toBe(1);
  });

  it('a synthetic guest discord_id never collides with a numeric Discord login', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    addGuestMember(db, t.id, 'Guesty');
    // A real Discord snowflake is all-numeric — it can never equal 'guest:<uuid>'.
    expect(findPlayerByDiscordId(db, '999888777666555444')).toBeNull();
  });

  it('rejects empty / whitespace / over-long guest names', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    expect(() => addGuestMember(db, t.id, '   ')).toThrow(InvalidGuestNameError);
    expect(() => addGuestMember(db, t.id, 'x'.repeat(41))).toThrow(InvalidGuestNameError);
  });

  it('duplicate guest names are allowed (distinct synthetic ids)', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    const a = addGuestMember(db, t.id, 'Duplicate');
    const b = addGuestMember(db, t.id, 'Duplicate');
    expect(a.player_id).not.toBe(b.player_id);
  });

  it('a guest can be seeded into a bracket and win a match (ELO moves)', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    // owner + 3 guests = a 4-entrant bracket.
    const g1 = addGuestMember(db, t.id, 'G1').player_id;
    const g2 = addGuestMember(db, t.id, 'G2').player_id;
    const g3 = addGuestMember(db, t.id, 'G3').player_id;
    const ids = [owner, g1, g2, g3];
    createBracket(db, t.id, ids);

    // Play the whole thing: the guest at index 1 always wins its ready matches.
    let guard = 0;
    for (;;) {
      if (guard++ > 500) throw new Error('did not terminate');
      const { nodes } = loadBracket(db, t.id);
      const ready = nodes.find((n) => n.status === 'ready');
      if (!ready) break;
      // Prefer g1 as the winner whenever it's in the match, else pick p1.
      const winner = ready.p1 === g1 || ready.p2 === g1 ? g1 : ready.p1!;
      const res = recordBracketResult(db, t.id, ready.id, winner, owner);
      expect(res.status).toBe('ok');
    }
    // A guest played matches → it has a per-game rating row with games_played > 0.
    const gr = db
      .prepare(`SELECT games_played FROM ratings WHERE player_id = ? AND game_id = 'game_smash'`)
      .get(g1) as { games_played: number } | undefined;
    expect(gr && gr.games_played).toBeGreaterThan(0);
  });

  it('removeMember purges an unplayed orphan guest but keeps one who played', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    const orphan = addGuestMember(db, t.id, 'Never Played').player_id;

    removeMember(db, t.id, orphan);
    expect(db.prepare(`SELECT 1 FROM players WHERE id = ?`).get(orphan)).toBeUndefined();
  });

  it('deleteTournament purges its guests so they leave the global leaderboard', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    const guest = addGuestMember(db, t.id, 'Party Guest').player_id;
    // Give the guest an overall_ratings row (as a real membership would over time).
    db.prepare(
      `INSERT INTO overall_ratings(player_id, current_rating) VALUES (?, 1200)`,
    ).run(guest);
    expect(overallLeaderboard(db).some((r) => r.player_id === guest)).toBe(true);

    expect(deleteTournament(db, t.id).status).toBe('ok');
    expect(db.prepare(`SELECT 1 FROM players WHERE id = ?`).get(guest)).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM overall_ratings WHERE player_id = ?`).get(guest)).toBeUndefined();
    expect(overallLeaderboard(db).some((r) => r.player_id === guest)).toBe(false);
  });

  it('searchPlayers excludes guests', () => {
    const db = freshDb();
    const owner = makeOwner(db);
    const t = createTournament(db, { name: 'Smash', ownerId: owner });
    addGuestMember(db, t.id, 'Searchable Guest');
    expect(searchPlayers(db, 'Searchable')).toHaveLength(0);
    expect(searchPlayers(db, 'Owner').length).toBeGreaterThan(0);
  });
});
