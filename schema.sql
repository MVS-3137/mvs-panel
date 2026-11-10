-- Baza panelu MVS (Cloudflare D1). Wklej całość w konsoli D1 i kliknij Execute.

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member      TEXT NOT NULL,            -- Malvel / Virtuoso / Saito
  title       TEXT NOT NULL,
  start       TEXT NOT NULL,            -- YYYY-MM-DD
  planned_min REAL NOT NULL DEFAULT 15, -- planowana długość filmu (min)
  wt          INTEGER NOT NULL DEFAULT 1, -- 1 = War Thunder
  status      TEXT NOT NULL DEFAULT 'active', -- active / done
  uploaded    TEXT,                     -- data wrzucenia
  actual_min  REAL,                     -- faktyczna długość filmu (min)
  video_url   TEXT,
  video_id    TEXT,
  shifts      INTEGER DEFAULT 0,
  game        TEXT,
  public_at   TEXT,
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leaves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member     TEXT NOT NULL,
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  note       TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('cadence', '4'),        -- co ile dni kanał powinien mieć nowy film
  ('workPerMin', '0.3'),   -- dni pracy na minutę planowanego filmu
  ('minWork', '3'),        -- minimum dni pracy nad filmem
  ('restPerMin', '0.15');  -- dni przerwy po wrzuceniu, na minutę filmu

-- Etap 2 (YouTube)
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, title TEXT, published TEXT, duration_s INTEGER, thumb TEXT, thumb_hi TEXT, tags TEXT, wt INTEGER DEFAULT 0, is_short INTEGER DEFAULT 0, member TEXT, project_id INTEGER, views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, updated TEXT, analytics_at TEXT, curve TEXT, approx24 INTEGER DEFAULT 0, removed_at TEXT, is_live INTEGER DEFAULT 0, live_override INTEGER, is_members INTEGER DEFAULT 0, members_override INTEGER, wt_override INTEGER, public_at TEXT);
CREATE TABLE IF NOT EXISTS snapshots (video_id TEXT NOT NULL, ts TEXT NOT NULL, views INTEGER, PRIMARY KEY (video_id, ts));
CREATE TABLE IF NOT EXISTS daily (video_id TEXT NOT NULL, day TEXT NOT NULL, views INTEGER, PRIMARY KEY (video_id, day));
CREATE TABLE IF NOT EXISTS channel_stats (ts TEXT PRIMARY KEY, subs INTEGER, views INTEGER, videos INTEGER);
CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, type TEXT, text TEXT, video_id TEXT, uniq TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS snap_ts ON snapshots (ts);
CREATE TABLE IF NOT EXISTS record_overrides (video_id TEXT NOT NULL, win INTEGER NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (video_id, win));
CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, unlocked_at TEXT, members TEXT, video_id TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS goal_points (ts TEXT PRIMARY KEY, subs INTEGER);
CREATE TABLE IF NOT EXISTS reach (video_id TEXT NOT NULL, day TEXT NOT NULL, impressions INTEGER, ctr REAL, PRIMARY KEY (video_id, day));
CREATE TABLE IF NOT EXISTS ctr_import (video_id TEXT PRIMARY KEY, ctr REAL, impressions INTEGER, imported_at TEXT);
CREATE TABLE IF NOT EXISTS comp_channels (id TEXT NOT NULL, list TEXT NOT NULL, title TEXT, handle TEXT, thumb TEXT, added_by TEXT, added_at TEXT, PRIMARY KEY (id, list));
CREATE TABLE IF NOT EXISTS comp_stats (id TEXT NOT NULL, day TEXT NOT NULL, subs INTEGER, views INTEGER, videos INTEGER, PRIMARY KEY (id, day));
CREATE TABLE IF NOT EXISTS grade_stats (video_id TEXT PRIMARY KEY, views90 INTEGER DEFAULT 0, subs90 INTEGER DEFAULT 0, avp90 REAL, hook30 REAL, hook_at TEXT);
CREATE TABLE IF NOT EXISTS clicks (member TEXT NOT NULL, day TEXT NOT NULL, n INTEGER DEFAULT 0, PRIMARY KEY (member, day));
CREATE TABLE IF NOT EXISTS reach_sum (video_id TEXT PRIMARY KEY, imp REAL DEFAULT 0, clk REAL DEFAULT 0, imp24 REAL DEFAULT 0, clk24 REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS reach_day ON reach (day);
CREATE TABLE IF NOT EXISTS thumb_stats (video_id TEXT PRIMARY KEY, views24 INTEGER, nonsub24 INTEGER, avp24 REAL, d24_at TEXT, views_life INTEGER, nonsub_life INTEGER, avp_life REAL, life_at TEXT);
INSERT OR IGNORE INTO settings (key, value) VALUES ('favorShift', '1');
CREATE TABLE IF NOT EXISTS games (member TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (member, name));
CREATE TABLE IF NOT EXISTS traffic_src (video_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, src TEXT NOT NULL DEFAULT '', views INTEGER, PRIMARY KEY (video_id, day, kind, src));
