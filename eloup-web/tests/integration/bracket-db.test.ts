import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { createTournament } from '@/lib/tournaments';
import {
  bracketExists,
  createBracket,
  loadBracket,
  recordBracketResult,
  recordWalkover,
} from '@/lib/db/bracket';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-bracket-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayers(db: Database.Database, n: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `p${i}`;
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
    ).run(id, id, id, id);
    ids.push(id);
  }
  return ids;
}

function makeTournament(db: Database.Database, owner: string): string {
  const t = createTournament(db, { name: 'Smash Cup', ownerId: owner });
  return t.id;
}

describe('bracket DB layer', () => {
  it('migration creates the Smash game', () => {
    const db = freshDb();
    const g = db.prepare(`SELECT id, format FROM games WHERE id = 'game_smash'`).get() as
      | { id: string; format: string }
      | undefined;
    expect(g).toEqual({ id: 'game_smash', format: '1v1' });
  });

  it('create → persist → load round-trips, marks format', () => {
    const db = freshDb();
    const ps = seedPlayers(db, 8);
    const tid = makeTournament(db, ps[0]!);
    expect(bracketExists(db, tid)).toBe(false);
    createBracket(db, tid, ps);
    expect(bracketExists(db, tid)).toBe(true);
    const fmt = db.prepare(`SELECT format FROM tournaments WHERE id = ?`).get(tid) as {
      format: string;
    };
    expect(fmt.format).toBe('double_elim');
    const { nodes } = loadBracket(db, tid);
    // 8-draw: 14 competitive + grand reset node = 15
    expect(nodes.length).toBe(15);
    // some winners-R1 node is ready (both real players, 8 = full draw)
    expect(nodes.some((n) => n.status === 'ready')).toBe(true);
  });

  it('reporting results advances the bracket to a champion and fires ELO', () => {
    const db = freshDb();
    const ps = seedPlayers(db, 8);
    const tid = makeTournament(db, ps[0]!);
    createBracket(db, tid, ps);

    // Play the whole thing: lower-index player always wins. Loop until champion.
    let guard = 0;
    for (;;) {
      if (guard++ > 1000) throw new Error('did not terminate');
      const { nodes } = loadBracket(db, tid);
      const ready = nodes.find((n) => n.status === 'ready');
      if (!ready) break;
      const rank = (p: string) => Number(p.slice(1));
      const winner = rank(ready.p1!) < rank(ready.p2!) ? ready.p1! : ready.p2!;
      const res = recordBracketResult(db, tid, ready.id, winner, ps[0]!);
      expect(res.status).toBe('ok');
    }
    const { nodes } = loadBracket(db, tid);
    const gf = nodes.find((n) => n.id === 'grand-R1-M1')!;
    expect(gf.winner).toBe('p1'); // top seed wins

    // ELO fired: real matches rows were created + confirmed, ratings moved.
    const matchCount = db
      .prepare(`SELECT count(*) AS c FROM matches WHERE tournament_id = ? AND status = 'confirmed'`)
      .get(tid) as { c: number };
    expect(matchCount.c).toBeGreaterThan(0);
    const p1Overall = db
      .prepare(`SELECT current_rating FROM overall_ratings WHERE player_id = 'p1'`)
      .get() as { current_rating: number };
    expect(p1Overall.current_rating).toBeGreaterThan(1200); // champion gained ELO
  });

  it('walkover advances without creating a match or moving ELO', () => {
    const db = freshDb();
    const ps = seedPlayers(db, 8);
    const tid = makeTournament(db, ps[0]!);
    createBracket(db, tid, ps);
    const { nodes } = loadBracket(db, tid);
    const ready = nodes.find((n) => n.status === 'ready')!;
    const res = recordWalkover(db, tid, ready.id, ready.p1!);
    expect(res.status).toBe('ok');
    const matchCount = db
      .prepare(`SELECT count(*) AS c FROM matches WHERE tournament_id = ?`)
      .get(tid) as { c: number };
    expect(matchCount.c).toBe(0); // no match created
    const reloaded = loadBracket(db, tid).nodes.find((n) => n.id === ready.id)!;
    expect(reloaded.status).toBe('done');
    expect(reloaded.winner).toBe(ready.p1);
  });

  it('rejects double-create and bad reports', () => {
    const db = freshDb();
    const ps = seedPlayers(db, 8);
    const tid = makeTournament(db, ps[0]!);
    createBracket(db, tid, ps);
    expect(() => createBracket(db, tid, ps)).toThrow(/already exists/);
    expect(recordBracketResult(db, tid, 'nope', ps[0]!, ps[0]!).status).toBe('no_node');
    const { nodes } = loadBracket(db, tid);
    const ready = nodes.find((n) => n.status === 'ready')!;
    expect(recordBracketResult(db, tid, ready.id, 'ghost', ps[0]!).status).toBe('bad_winner');
  });
});
