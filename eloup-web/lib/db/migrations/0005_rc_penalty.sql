-- 0005_rc_penalty.sql — Per-driver penalty time (in ms) added to total time.
-- H2: admin-discretionary penalty for jump starts, illegal contact, etc.
-- Non-negative: admins clear a penalty by setting it back to 0, not by
-- entering a negative offset. The application-level cap (< 600000ms /
-- 10 minutes) is enforced at the API boundary; the DB CHECK only guards
-- the sign. See Agents/TODO/Active/h2-race-admin-edits.md.

ALTER TABLE rc_race_drivers
  ADD COLUMN penalty_ms INTEGER NOT NULL DEFAULT 0 CHECK(penalty_ms >= 0);
