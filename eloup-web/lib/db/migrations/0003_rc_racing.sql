-- 0003_rc_racing.sql — RC racing domain (Lap Monitor JSON ingestion).
-- R1 ships display-only race results; ELO integration is R2.
-- See Agents/TODO/Active/r1-rc-racing-dashboard.md for the field-by-field
-- mapping from Lap Monitor JSON to these tables.

CREATE TABLE rc_tracks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  layout_notes TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rc_drivers (
  id                      TEXT PRIMARY KEY,
  lap_monitor_driver_uuid TEXT NOT NULL UNIQUE,
  display_name            TEXT NOT NULL,
  player_id               TEXT REFERENCES players(id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- lap_monitor_uuid is the idempotency anchor: re-uploading the same JSON
-- (even into a different track) is rejected by the UNIQUE constraint.
CREATE TABLE rc_races (
  id               TEXT PRIMARY KEY,
  lap_monitor_uuid TEXT NOT NULL UNIQUE,
  track_id         TEXT NOT NULL REFERENCES rc_tracks(id),
  race_started_at  TEXT NOT NULL,
  race_kind        TEXT NOT NULL CHECK (race_kind IN ('qualif','practice','race')),
  race_name        TEXT,
  duration_seconds INTEGER,
  source_blob      TEXT NOT NULL,
  uploaded_by      TEXT NOT NULL REFERENCES players(id),
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rc_race_drivers (
  race_id        TEXT NOT NULL REFERENCES rc_races(id) ON DELETE CASCADE,
  driver_id      TEXT NOT NULL REFERENCES rc_drivers(id),
  transponder_id INTEGER NOT NULL,
  placement      INTEGER NOT NULL,
  laps_completed INTEGER NOT NULL,
  best_lap_ms    INTEGER,
  total_time_ms  INTEGER NOT NULL,
  PRIMARY KEY (race_id, driver_id)
);

-- lap_index is the 0-based position within the JSON laps[] array; PK on it
-- because userIndex repeats (-1) for ignored laps and cannot be unique.
-- lap_number stores userIndex verbatim (0 for initial, -1 for ignored, 1+ for normal).
CREATE TABLE rc_laps (
  race_id          TEXT NOT NULL REFERENCES rc_races(id) ON DELETE CASCADE,
  driver_id        TEXT NOT NULL REFERENCES rc_drivers(id),
  lap_index        INTEGER NOT NULL,
  lap_number       INTEGER,
  lap_time_ms      INTEGER NOT NULL,
  end_timestamp_ms INTEGER NOT NULL,
  lap_kind         TEXT NOT NULL CHECK (lap_kind IN ('initial','normal','ignored')),
  PRIMARY KEY (race_id, driver_id, lap_index)
);

CREATE INDEX idx_rc_races_track_started ON rc_races(track_id, race_started_at DESC);
CREATE INDEX idx_rc_race_drivers_driver ON rc_race_drivers(driver_id);
CREATE INDEX idx_rc_laps_race            ON rc_laps(race_id);
CREATE INDEX idx_rc_laps_driver_best
  ON rc_laps(driver_id, lap_time_ms)
  WHERE lap_kind = 'normal';
