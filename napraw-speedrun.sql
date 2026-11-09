UPDATE projects SET status='active', uploaded=NULL, actual_min=NULL, video_id=NULL, video_url=NULL WHERE video_id IN (SELECT id FROM videos WHERE is_short = 1 OR COALESCE(live_override, is_live, 0) = 1 OR COALESCE(members_override, is_members, 0) = 1);
UPDATE videos SET project_id=NULL WHERE project_id IS NOT NULL AND is_short = 1;
DELETE FROM achievements WHERE id = 'speedrun';
DELETE FROM news WHERE type = 'achievement' AND text LIKE '%Speedrun Any%';
DELETE FROM news WHERE type IN ('unassigned','new_video') AND video_id IN (SELECT id FROM videos WHERE is_short = 1);
DELETE FROM news WHERE type IN ('unassigned','new_video') AND EXISTS (SELECT 1 FROM videos v WHERE v.id = news.video_id AND julianday(news.ts) - julianday(v.published) > 4);
DELETE FROM kv WHERE key LIKE 'cache_%';
