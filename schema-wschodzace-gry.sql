-- Panel MVS: wschodzące gry (zamiast TOP 10 gier na polskim YouTube). Uruchom raz w konsoli D1.
DELETE FROM kv WHERE key IN ('trend_g', 'trend_g_at', 'trend_g_diag');
