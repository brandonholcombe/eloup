-- Backfill: pre-2026-05-17 R1 imports stored Lap Monitor's centisecond
-- values verbatim in *_ms columns. Multiply by 10 once so the column
-- semantics finally match the column names. Future imports (post-fix in
-- lib/rc/import.ts) already store true milliseconds, so this migration
-- runs exactly once via schema_migrations and a fresh DB sees a no-op
-- because rc_* tables are empty at first-startup migration time.
UPDATE rc_laps SET lap_time_ms = lap_time_ms * 10, end_timestamp_ms = end_timestamp_ms * 10;

UPDATE rc_race_drivers
   SET best_lap_ms = best_lap_ms * 10,
       total_time_ms = total_time_ms * 10;
