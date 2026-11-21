UPDATE videos SET is_live = 1 WHERE title LIKE '%Gears of War%';
UPDATE projects SET status='active', uploaded=NULL, actual_min=NULL, video_id=NULL, video_url=NULL WHERE video_id IN (SELECT id FROM videos WHERE title LIKE '%Gears of War%');
UPDATE videos SET project_id=NULL WHERE title LIKE '%Gears of War%';
DELETE FROM achievements WHERE id IN ('inquisition', 'stay_awhile');
DELETE FROM news WHERE type = 'achievement' AND (text LIKE '%Spanish Inquisition%' OR text LIKE '%Stay a While and Listen%');
DELETE FROM news WHERE type IN ('unassigned','new_video','slow_start','traffic') AND video_id IN (SELECT id FROM videos WHERE title LIKE '%Gears of War%');
DELETE FROM kv WHERE key LIKE 'cache_%';
DELETE FROM kv WHERE key IN ('trend_wt_at', 'trend_g_at');
