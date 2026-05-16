-- 0002_tournament_indexes.sql — M5 indexes for tournament lookups.
-- No new tables; reuses M4's tournaments / tournament_admins /
-- tournament_members / matches.tournament_id (all from 0001_init.sql).

CREATE INDEX IF NOT EXISTS idx_tournaments_invite_token
  ON tournaments(invite_token) WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_members_player
  ON tournament_members(player_id);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_status
  ON matches(tournament_id, status) WHERE tournament_id IS NOT NULL;
