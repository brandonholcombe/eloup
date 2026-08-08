-- 0011_overall_rating_delta.sql — store the per-participant OVERALL ELO delta so
-- an admin delete can reverse it exactly (H10). match_participants previously
-- stored only the per-game rating_delta; the overall delta was computed but not
-- persisted. Nullable: pre-migration rows reverse overall by 0 (approximation).
ALTER TABLE match_participants
  ADD COLUMN overall_rating_delta REAL;
