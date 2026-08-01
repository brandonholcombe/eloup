-- 0009_bracket.sql — double-elimination bracket persistence (M8c).
-- One row per bracket node; mirrors the pure engine's BracketNode
-- (lib/bracket/engine.ts). node_id is the engine id `${bracket}-R${round}-M${position}`,
-- unique within a tournament; winner_to_node/loser_to_node reference node_ids.

CREATE TABLE bracket_matches (
  tournament_id    TEXT NOT NULL REFERENCES tournaments(id),
  node_id          TEXT NOT NULL,
  bracket          TEXT NOT NULL CHECK (bracket IN ('winners','losers','grand')),
  round            INTEGER NOT NULL,
  position         INTEGER NOT NULL,
  p1_player_id     TEXT REFERENCES players(id),
  p2_player_id     TEXT REFERENCES players(id),
  p1_void          INTEGER NOT NULL DEFAULT 0,
  p2_void          INTEGER NOT NULL DEFAULT 0,
  winner_to_node   TEXT,
  winner_to_slot   INTEGER CHECK (winner_to_slot IN (1,2)),
  loser_to_node    TEXT,
  loser_to_slot    INTEGER CHECK (loser_to_slot IN (1,2)),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','ready','bye','done')),
  winner_player_id TEXT REFERENCES players(id),
  match_id         TEXT REFERENCES matches(id),
  PRIMARY KEY (tournament_id, node_id)
);

CREATE INDEX idx_bracket_matches_tournament ON bracket_matches(tournament_id);

-- Fixed Smash Bros game (1v1) so double-elim bracket results create real
-- matches rows that feed per-game + overall ELO. Category 'fighting'.
INSERT OR IGNORE INTO games(id, name, slug, default_k, format, min_participants, max_participants, category)
VALUES ('game_smash', 'Super Smash Bros.', 'smash', 32, '1v1', 2, 2, 'fighting');
