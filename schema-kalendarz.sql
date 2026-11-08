ALTER TABLE videos ADD COLUMN wt_override INTEGER;
CREATE TABLE IF NOT EXISTS thumb_stats (video_id TEXT PRIMARY KEY, views24 INTEGER, nonsub24 INTEGER, avp24 REAL, d24_at TEXT, views_life INTEGER, nonsub_life INTEGER, avp_life REAL, life_at TEXT);
INSERT OR IGNORE INTO settings (key, value) VALUES ('favorShift', '1');
DELETE FROM kv WHERE key = 'cache_thumbs';
