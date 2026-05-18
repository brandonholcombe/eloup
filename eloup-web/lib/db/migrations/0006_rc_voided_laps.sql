-- 0006_rc_voided_laps.sql — Per-driver count of voided fastest laps.
-- H6: qualif/practice penalty mechanism. When > 0, the top-3-avg
-- computation skips the N fastest normal laps for ranking only.
-- Stats (computeDriverStats) continue to show RAW top-3-avg with no
-- voids applied — voids affect placement, not the per-driver pace
-- surface. See Agents/TODO/Active/h6-race-kind-ranking.md.

ALTER TABLE rc_race_drivers
  ADD COLUMN voided_laps_count INTEGER NOT NULL DEFAULT 0 CHECK (voided_laps_count >= 0);
