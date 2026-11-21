CREATE TABLE IF NOT EXISTS thumb_data (video_id TEXT PRIMARY KEY, ctr REAL, impressions INTEGER, views INTEGER, avd REAL, avp REAL, imported_at TEXT);
CREATE TABLE IF NOT EXISTS thumb_vision (video_id TEXT PRIMARY KEY, feats TEXT, descr TEXT, at TEXT);
INSERT OR IGNORE INTO thumb_data (video_id, ctr, impressions, imported_at) SELECT video_id, ctr, NULLIF(impressions, 0), imported_at FROM ctr_import;
DROP TABLE IF EXISTS thumb_stats;
DELETE FROM reach;
DELETE FROM reach_sum;
DELETE FROM kv WHERE key IN ('cache_thumbs','reach_job_id','reach_job_at','reach_error','reach_since');
