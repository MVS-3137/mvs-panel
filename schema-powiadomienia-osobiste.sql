ALTER TABLE news ADD COLUMN who TEXT;
UPDATE news SET who = TRIM((CASE WHEN text LIKE '%Malvel%' THEN 'Malvel,' ELSE '' END) || (CASE WHEN text LIKE '%Virtuoso%' THEN 'Virtuoso,' ELSE '' END) || (CASE WHEN text LIKE '%Saito%' THEN 'Saito,' ELSE '' END), ',') WHERE type = 'grade';
