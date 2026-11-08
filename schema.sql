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
CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, title TEXT, published TEXT, duration_s INTEGER, thumb TEXT, thumb_hi TEXT, tags TEXT, wt INTEGER DEFAULT 0, is_short INTEGER DEFAULT 0, member TEXT, project_id INTEGER, views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, updated TEXT, analytics_at TEXT, curve TEXT, approx24 INTEGER DEFAULT 0, removed_at TEXT);
CREATE TABLE IF NOT EXISTS snapshots (video_id TEXT NOT NULL, ts TEXT NOT NULL, views INTEGER, PRIMARY KEY (video_id, ts));
CREATE TABLE IF NOT EXISTS daily (video_id TEXT NOT NULL, day TEXT NOT NULL, views INTEGER, PRIMARY KEY (video_id, day));
CREATE TABLE IF NOT EXISTS channel_stats (ts TEXT PRIMARY KEY, subs INTEGER, views INTEGER, videos INTEGER);
CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, type TEXT, text TEXT, video_id TEXT, uniq TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS snap_ts ON snapshots (ts);
CREATE TABLE IF NOT EXISTS record_overrides (video_id TEXT NOT NULL, win INTEGER NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (video_id, win));
CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, unlocked_at TEXT, members TEXT, video_id TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS goal_points (ts TEXT PRIMARY KEY, subs INTEGER);
