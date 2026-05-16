-- 0001_init.sql — initial schema for EloUp (M4)
-- Every table from project-review-and-plan.md §4.2 in this single file.
-- M5 (tournaments) and M6 (betting) consume the reserved columns without
-- needing a migration of their own.

CREATE TABLE players (
  id              TEXT PRIMARY KEY,
  discord_id      TEXT NOT NULL UNIQUE,
  discord_handle  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  email           TEXT,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  avatar_url      TEXT,
  role            TEXT NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'tournament_admin', 'global_admin')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE games (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  default_k         INTEGER NOT NULL DEFAULT 32,
  format            TEXT NOT NULL CHECK (format IN ('1v1', 'ffa', 'team')),
  min_participants  INTEGER NOT NULL,
  max_participants  INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tournaments (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  owner_id      TEXT NOT NULL REFERENCES players(id),
  format        TEXT,
  invite_token  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at       TEXT
);

CREATE TABLE tournament_admins (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  player_id     TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE tournament_members (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  player_id     TEXT NOT NULL REFERENCES players(id),
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE matches (
  id              TEXT PRIMARY KEY,
  game_id         TEXT NOT NULL REFERENCES games(id),
  tournament_id   TEXT REFERENCES tournaments(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('scheduled', 'pending', 'confirmed', 'disputed', 'cancelled')),
  scheduled_at    TEXT,
  started_at      TEXT,
  ended_at        TEXT,
  created_by      TEXT NOT NULL REFERENCES players(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- match_participants: rating_before/rating_delta are NULL at insert time
-- (Flow 3) and filled by the confirm-match transaction (Flow 4).
CREATE TABLE match_participants (
  match_id      TEXT NOT NULL REFERENCES matches(id),
  player_id     TEXT NOT NULL REFERENCES players(id),
  team_label    TEXT,
  placement     INTEGER,
  score         REAL,
  rating_before REAL,
  rating_delta  REAL,
  confirmed_at  TEXT,
  PRIMARY KEY (match_id, player_id)
);

-- Per-(player, game) rating. Denormalized current_rating; rebuildable from matches.
CREATE TABLE ratings (
  player_id     TEXT NOT NULL REFERENCES players(id),
  game_id       TEXT NOT NULL REFERENCES games(id),
  current_rating REAL NOT NULL DEFAULT 1200,
  games_played  INTEGER NOT NULL DEFAULT 0,
  last_match_id TEXT REFERENCES matches(id),
  PRIMARY KEY (player_id, game_id)
);

-- overall_ratings: ELO floor at 0 (Q-RATE/floor). escrowed_elo reserved
-- for M6 betting; M4 confirm-match MUST NOT overwrite it on upsert.
CREATE TABLE overall_ratings (
  player_id      TEXT PRIMARY KEY REFERENCES players(id),
  current_rating REAL NOT NULL DEFAULT 1200 CHECK (current_rating >= 0),
  escrowed_elo   REAL NOT NULL DEFAULT 0 CHECK (escrowed_elo >= 0),
  last_match_id  TEXT REFERENCES matches(id)
);

-- bets: reserved for M6. M4 schema-only. Status enum allows void on
-- disputed/cancelled (umbrella plan §4.2). No M4 writes.
CREATE TABLE bets (
  id          TEXT PRIMARY KEY,
  match_id    TEXT NOT NULL REFERENCES matches(id),
  bettor_id   TEXT NOT NULL REFERENCES players(id),
  side        TEXT NOT NULL,
  amount_elo  REAL NOT NULL CHECK (amount_elo > 0),
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'won', 'lost', 'void')),
  placed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at  TEXT
);

CREATE INDEX idx_ratings_game_rating ON ratings(game_id, current_rating DESC);
CREATE INDEX idx_overall_rating ON overall_ratings(current_rating DESC);
CREATE INDEX idx_mp_player_confirmed ON match_participants(player_id, confirmed_at);
CREATE INDEX idx_matches_status_created ON matches(status, created_at DESC);
