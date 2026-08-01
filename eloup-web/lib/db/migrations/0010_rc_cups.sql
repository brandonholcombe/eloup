-- 0010_rc_cups.sql — RC truck cup: a points-series championship over imported
-- RC races (M8b). RC-native (driver-based, no ELO, no matches). Standings =
-- points-by-finish (rc_race_drivers.placement) aggregated across the cup's races.

CREATE TABLE rc_cups (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  points_scheme TEXT NOT NULL,   -- JSON int array; scheme[i] = points for placement i+1, 0 beyond
  created_by    TEXT NOT NULL REFERENCES players(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rc_cup_races (
  cup_id  TEXT NOT NULL REFERENCES rc_cups(id) ON DELETE CASCADE,
  race_id TEXT NOT NULL REFERENCES rc_races(id) ON DELETE CASCADE,
  PRIMARY KEY (cup_id, race_id)
);

CREATE INDEX idx_rc_cup_races_cup ON rc_cup_races(cup_id);
