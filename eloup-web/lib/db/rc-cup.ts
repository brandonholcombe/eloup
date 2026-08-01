import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { slugify } from '@/lib/slug';
import {
  DEFAULT_POINTS_SCHEME,
  parsePointsScheme,
  scoreCup,
  type CupResultRow,
  type CupStanding,
} from '@/lib/rc/cup';

export type Cup = {
  id: string;
  name: string;
  slug: string;
  points_scheme: string;
  created_at: string;
};

export type CupSummary = Cup & { race_count: number };

export function listCups(db: Database.Database): CupSummary[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.points_scheme, c.created_at,
              (SELECT COUNT(*) FROM rc_cup_races cr WHERE cr.cup_id = c.id) AS race_count
         FROM rc_cups c
        ORDER BY c.created_at DESC`,
    )
    .all() as CupSummary[];
}

export function getCupBySlug(db: Database.Database, slug: string): Cup | null {
  return (
    (db
      .prepare(`SELECT id, name, slug, points_scheme, created_at FROM rc_cups WHERE slug = ?`)
      .get(slug) as Cup | undefined) ?? null
  );
}

/** Create a cup with a unique slug. `points_scheme` validated; defaults if omitted. */
export function createCup(
  db: Database.Database,
  input: { name: string; createdBy: string; pointsScheme?: number[] },
): Cup {
  const scheme = input.pointsScheme
    ? parsePointsScheme(input.pointsScheme)
    : DEFAULT_POINTS_SCHEME;
  const id = randomUUID();
  const base = slugify(input.name) || 'cup';
  // Ensure slug uniqueness (append -2, -3, … on collision).
  let slug = base;
  let n = 1;
  const exists = db.prepare(`SELECT 1 FROM rc_cups WHERE slug = ?`);
  while (exists.get(slug)) slug = `${base}-${++n}`;
  db.prepare(
    `INSERT INTO rc_cups(id, name, slug, points_scheme, created_by) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.name, slug, JSON.stringify(scheme), input.createdBy);
  return getCupBySlug(db, slug)!;
}

export function updatePointsScheme(
  db: Database.Database,
  cupId: string,
  pointsScheme: number[],
): void {
  const scheme = parsePointsScheme(pointsScheme);
  db.prepare(`UPDATE rc_cups SET points_scheme = ? WHERE id = ?`).run(
    JSON.stringify(scheme),
    cupId,
  );
}

export function addRaceToCup(db: Database.Database, cupId: string, raceId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO rc_cup_races(cup_id, race_id) VALUES (?, ?)`,
  ).run(cupId, raceId);
}

export function removeRaceFromCup(db: Database.Database, cupId: string, raceId: string): void {
  db.prepare(`DELETE FROM rc_cup_races WHERE cup_id = ? AND race_id = ?`).run(cupId, raceId);
}

export type CupRace = {
  id: string;
  race_name: string | null;
  race_kind: 'qualif' | 'practice' | 'race';
  track_name: string;
  race_started_at: string;
};

/** The races assigned to a cup (newest first), for the picker + display. */
export function cupRaces(db: Database.Database, cupId: string): CupRace[] {
  return db
    .prepare(
      `SELECT r.id, r.race_name, r.race_kind, t.name AS track_name, r.race_started_at
         FROM rc_cup_races cr
         JOIN rc_races r ON r.id = cr.race_id
         JOIN rc_tracks t ON t.id = r.track_id
        WHERE cr.cup_id = ?
        ORDER BY r.race_started_at DESC`,
    )
    .all(cupId) as CupRace[];
}

/** Cup standings: join the cup's races to driver placements, then pure-score. */
export function cupStandings(db: Database.Database, cupId: string): CupStanding[] {
  const cup = db.prepare(`SELECT points_scheme FROM rc_cups WHERE id = ?`).get(cupId) as
    | { points_scheme: string }
    | undefined;
  if (!cup) return [];
  const scheme = parsePointsScheme(cup.points_scheme);
  const rows = db
    .prepare(
      `SELECT rrd.driver_id, d.display_name, d.player_id, rrd.placement
         FROM rc_cup_races cr
         JOIN rc_race_drivers rrd ON rrd.race_id = cr.race_id
         JOIN rc_drivers d ON d.id = rrd.driver_id
        WHERE cr.cup_id = ?`,
    )
    .all(cupId) as CupResultRow[];
  return scoreCup(rows, scheme);
}
