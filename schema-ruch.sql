CREATE TABLE IF NOT EXISTS traffic_src (video_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, src TEXT NOT NULL DEFAULT '', views INTEGER, PRIMARY KEY (video_id, day, kind, src));
