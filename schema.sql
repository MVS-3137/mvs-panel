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
