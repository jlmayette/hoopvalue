-- ============================================================
-- HoopValue schema — single migration, idempotent
-- ============================================================

-- Canonical player table. Every other reference points here.
CREATE TABLE IF NOT EXISTS players (
  id              SERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,   -- lowercased, accents stripped, suffixes removed
  first_name      TEXT,
  last_name       TEXT,
  team            TEXT,                    -- NBA team abbreviation (current)
  position        TEXT,                    -- G, F, C, or hybrid like G-F
  age             NUMERIC(4,1),
  -- Cross-platform IDs so we can match league rosters to players:
  sleeper_id      TEXT UNIQUE,
  espn_id         TEXT UNIQUE,
  fantrax_id      TEXT UNIQUE,
  nba_id          TEXT UNIQUE,             -- from NBA.com (future-proofing)
  -- Bookkeeping
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_normalized_name ON players(normalized_name);
CREATE INDEX IF NOT EXISTS idx_players_sleeper ON players(sleeper_id);
CREATE INDEX IF NOT EXISTS idx_players_espn ON players(espn_id);
CREATE INDEX IF NOT EXISTS idx_players_fantrax ON players(fantrax_id);

-- Each ranking source (RotoWire, RotoBaller, etc.)
CREATE TABLE IF NOT EXISTS ranking_sources (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,        -- 'rotowire', 'rotoballer', etc.
  display_name TEXT NOT NULL,
  source_url  TEXT NOT NULL,
  weight      NUMERIC(3,2) NOT NULL DEFAULT 1.00,  -- recency weight, 0-1
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_scraped_at TIMESTAMPTZ
);

-- Each ranking row from each source
CREATE TABLE IF NOT EXISTS source_rankings (
  id          SERIAL PRIMARY KEY,
  source_id   INT NOT NULL REFERENCES ranking_sources(id) ON DELETE CASCADE,
  player_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rank        INT NOT NULL,
  scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, player_id, scraped_at)
);

CREATE INDEX IF NOT EXISTS idx_source_rankings_player ON source_rankings(player_id);
CREATE INDEX IF NOT EXISTS idx_source_rankings_source ON source_rankings(source_id, scraped_at DESC);

-- The computed consensus, refreshed after every scrape
CREATE TABLE IF NOT EXISTS consensus_rankings (
  player_id        INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  rank             INT NOT NULL,
  value            INT NOT NULL,           -- 0-10000 logarithmic
  num_sources      INT NOT NULL,
  rank_stddev      NUMERIC(6,2),           -- disagreement signal
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consensus_rank ON consensus_rankings(rank);

-- A user's saved league (so we don't re-pull from origin every refresh)
CREATE TABLE IF NOT EXISTS leagues (
  id              SERIAL PRIMARY KEY,
  platform        TEXT NOT NULL,           -- 'sleeper', 'fantrax', 'espn'
  external_id     TEXT NOT NULL,           -- the platform's league ID
  league_name     TEXT,
  scoring_format  TEXT,                    -- 'points' | '9cat' | '8cat' | 'other'
  team_count      INT,
  last_synced_at  TIMESTAMPTZ,
  -- ESPN private leagues need cookies; we store them encrypted in a real app.
  -- For now we'll just hold session metadata.
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, external_id)
);

-- Teams within a league
CREATE TABLE IF NOT EXISTS league_teams (
  id              SERIAL PRIMARY KEY,
  league_id       INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,           -- platform-specific team id / roster id
  team_name       TEXT,
  owner_name      TEXT,
  UNIQUE(league_id, external_id)
);

-- Roster snapshot — wiped and reloaded each sync
CREATE TABLE IF NOT EXISTS league_rosters (
  id              SERIAL PRIMARY KEY,
  league_team_id  INT NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  player_id       INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rosters_team ON league_rosters(league_team_id);

-- Seed the known ranking sources
INSERT INTO ranking_sources (slug, display_name, source_url, weight) VALUES
  ('rotowire',   'RotoWire',                 'https://www.rotowire.com/basketball/article/fantasy-basketball-dynasty-rankings-2025-95326', 0.60),
  ('rotoballer', 'RotoBaller',               'https://www.rotoballer.com/fantasy-basketball-dynasty-rankings-march-2026/1831700',           0.85),
  ('angle',      'Angle Fantasy Basketball', 'https://anglefantasybasketball.com/',                                                          1.00),
  ('athlon',     'Athlon Sports',            'https://athlonsports.com/fantasy/2026-nba-draft-fantasy-rookie-rankings',                      0.95),
  ('dynatyze',   'Dynatyze',                 'https://dynatyze.com/dynasty-basketball-rankings',                                             1.00),
  ('hashtag',    'Hashtag Basketball',       'https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings',                            1.00)
ON CONFLICT (slug) DO NOTHING;
