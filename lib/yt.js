// Panel MVS — integracja z YouTube (Data API v3 + Analytics API).
// Wywoływane przez /api/refresh (co godzinę z crona albo przyciskiem w panelu).

export const CHECKPOINTS = [
  ...Array.from({ length: 48 }, (_, i) => i + 1),          // 1..48 h co godzinę
  ...Array.from({ length: 26 }, (_, i) => (i + 3) * 24),   // dni 3..28
];
export const WINDOWS = [24, 168, 336, 672]; // 24 h, 7, 14, 28 dni
const HOUR = 36e5;
const DAYMS = 864e5;

/* ---------------- pomocnicze ---------------- */
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
function warsawDate(ms) {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date(ms)); }
  catch { return isoDate(ms + HOUR); }
}
// Analytics liczy dni wg czasu pacyficznego
function ptOffsetH(ms) {
  const d = new Date(ms), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const dst = (m > 3 && m < 11) || (m === 3 && day >= 10) || (m === 11 && day < 3);
  return dst ? 7 : 8;
}
const ptDate = (ms) => isoDate(ms - ptOffsetH(ms) * HOUR);
const ptDayEnd = (day) => { const [y, m, d] = day.split("-").map(Number); const t = Date.UTC(y, m - 1, d + 1); return t + ptOffsetH(t) * HOUR; };

export function parseDuration(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
export const isWT = (title, tags) => /war\s*thunder|warthunder/i.test(title + " " + (tags || []).join(" "));

function norm(s) {
  return String(s).toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w));
}
export function titleScore(a, b) {
  const A = new Set(norm(a)), B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return (2 * n) / (A.size + B.size);
}

/* ---------------- krzywa wyświetleń ---------------- */
// punkty [godziny od premiery, wyświetlenia] → wartość w h (interpolacja liniowa)
function interp(points, h, maxGap) {
  for (let i = 1; i < points.length; i++) {
    const [h0, v0] = points[i - 1], [h1, v1] = points[i];
    if (h >= h0 && h <= h1) {
      if (h1 - h0 > maxGap) return null;
      return h1 === h0 ? v1 : Math.round(v0 + ((v1 - v0) * (h - h0)) / (h1 - h0));
    }
  }
  return null;
}
export function buildCurve(publishedMs, nowMs, snaps, daily) {
  const age = (nowMs - publishedMs) / HOUR;
  const sp = [[0, 0], ...snaps.map((s) => [(Date.parse(s.ts) - publishedMs) / HOUR, s.views])].sort((a, b) => a[0] - b[0]);
  let cum = 0;
  const ap = [[0, 0]];
  for (const d of [...daily].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    cum += d.views;
    ap.push([Math.max(0, (ptDayEnd(d.day) - publishedMs) / HOUR), cum]);
  }
  let approx24 = 0;
  const c = CHECKPOINTS.map((h) => {
    if (h > age) return null;
    const gap = h <= 48 ? 6 : 36;
    let v = interp(sp, h, gap);
    if (v === null) { v = interp(ap, h, 30); if (h === 24 && v !== null) approx24 = 1; }
    return v;
  });
  return { curve: c, approx24 };
}
export function curveAt(curve, h) {
  if (!curve) return null;
  if (h <= CHECKPOINTS[0]) return curve[0] === null ? null : Math.round(curve[0] * h);
  for (let i = 1; i < CHECKPOINTS.length; i++) {
    if (h <= CHECKPOINTS[i]) {
      const a = curve[i - 1], b = curve[i];
      if (a === null || b === null) return null;
      return Math.round(a + ((b - a) * (h - CHECKPOINTS[i - 1])) / (CHECKPOINTS[i] - CHECKPOINTS[i - 1]));
    }
  }
  return curve[curve.length - 1];
}

/* ---------------- ręczne rekordy (wpisane z YouTube Studio) ---------------- */
export async function loadOverrides(db) {
  try {
    const { results } = await db.prepare("SELECT video_id, win, views FROM record_overrides").all();
    const o = {};
    for (const r of results) (o[r.video_id] ||= {})[r.win] = r.views;
    return o;
  } catch { return {}; }
}
export function recordValue(v, w, ov) {
  const m = ov[v.id] && ov[v.id][w];
  return m !== undefined ? m : curveAt(v.curve, w);
}

/* ---------------- Google API ---------------- */
let CALLS = 0; // darmowy plan Cloudflare: max 50 zapytań zewnętrznych na jedno wywołanie
async function g(url, token) {
  CALLS++;
  const r = await fetch(url, { headers: { authorization: "Bearer " + token } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google API " + r.status + ": " + (j.error?.message || url.split("?")[0]));
  return j;
}
export async function accessToken(env, refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("token: " + (j.error || r.status)); e.revoked = j.error === "invalid_grant"; throw e; }
  return j.access_token;
}

/* ---------------- baza ---------------- */
export async function kvGet(db, key) {
  const r = await db.prepare("SELECT value FROM kv WHERE key=?").bind(key).first();
  return r ? r.value : null;
}
export const kvSet = (db, key, value) =>
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, String(value));
const news = (db, type, text, videoId, uniq, nowIso) =>
  db.prepare("INSERT OR IGNORE INTO news (ts, type, text, video_id, uniq) VALUES (?,?,?,?,?)").bind(nowIso, type, text, videoId || null, uniq || null);

/* ---------------- dopasowanie filmu do planu ---------------- */
export async function matchProject(db, video) {
  const pubDay = warsawDate(Date.parse(video.published));
  const { results } = await db.prepare(
    "SELECT * FROM projects WHERE video_id IS NULL AND (status='active' OR (status='done' AND uploaded >= ?)) AND start <= ?"
  ).bind(isoDate(Date.parse(pubDay) - 5 * DAYMS), isoDate(Date.parse(pubDay) + DAYMS)).all();
  let best = null, bestScore = 0;
  for (const p of results) {
    const s = titleScore(p.title, video.title);
    if (s > bestScore || (s === bestScore && best && p.start < best.start)) { best = p; bestScore = s; }
  }
  return bestScore >= 0.3 ? best : null;
}
export function linkProject(db, video, project) {
  const pubDay = warsawDate(Date.parse(video.published));
  return [
    db.prepare("UPDATE projects SET status='done', uploaded=COALESCE(uploaded, ?), actual_min=?, video_id=?, video_url=? WHERE id=?")
      .bind(pubDay, Math.max(0.5, Math.round(video.duration_s / 30) / 2), video.id, "https://youtu.be/" + video.id, project.id),
    db.prepare("UPDATE videos SET member=?, project_id=?, wt=? WHERE id=?").bind(project.member, project.id, project.wt ? 1 : 0, video.id),
  ];
}

/* ---------------- odświeżenie ---------------- */
export async function refresh(env, opts = {}) {
  const db = env.DB;
  const now = opts.now || Date.now();
  const nowIso = new Date(now).toISOString();
  const log = [];
  CALLS = 1;
  const refreshToken = await kvGet(db, "yt_refresh_token");
  if (!refreshToken) return { ok: false, error: "YouTube nie jest połączony" };

  let token;
  try { token = await accessToken(env, refreshToken); }
  catch (e) {
    if (e.revoked) {
      await db.batch([db.prepare("DELETE FROM kv WHERE key='yt_refresh_token'"), news(db, "error", "Połączenie z YouTube wygasło. Połącz kanał ponownie w zakładce Performance.", null, "revoked:" + isoDate(now), nowIso)]);
    }
    throw e;
  }

  // 1. kanał
  const ch = (await g("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true", token)).items?.[0];
  if (!ch) throw new Error("Nie znaleziono kanału na tym koncie Google");
  const subs = ch.statistics.hiddenSubscriberCount ? null : Number(ch.statistics.subscriberCount);
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const firstSync = !(await kvGet(db, "first_sync_done"));

  // 2. lista filmów (pełna przy pierwszej synchronizacji, potem pierwsza strona)
  const known = new Map((await db.prepare("SELECT id, member, published FROM videos").all()).results.map((v) => [v.id, v]));
  const ids = new Set(known.keys());
  let page = "", pages = 0;
  do {
    const pl = await g(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? "&pageToken=" + page : ""}`, token);
    let fresh = 0;
    for (const it of pl.items || []) { if (!ids.has(it.contentDetails.videoId)) fresh++; ids.add(it.contentDetails.videoId); }
    page = (firstSync || fresh > 0) ? pl.nextPageToken : null;
    pages++;
  } while (page && pages < 20);

  // 3. statystyki filmów
  const all = [...ids];
  const videos = [];
  for (let i = 0; i < all.length; i += 50) {
    const r = await g(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,status&id=${all.slice(i, i + 50).join(",")}`, token);
    for (const v of r.items || []) {
      if (v.status.privacyStatus !== "public" || !v.snippet.publishedAt) continue;
      const tags = v.snippet.tags || [];
      const dur = parseDuration(v.contentDetails.duration);
      videos.push({
        id: v.id, title: v.snippet.title, published: v.snippet.publishedAt, duration_s: dur,
        thumb: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url || "",
        thumb_hi: (v.snippet.thumbnails.maxres || v.snippet.thumbnails.high || {}).url || "",
        tags: JSON.stringify(tags.slice(0, 60)), wt: isWT(v.snippet.title, tags) ? 1 : 0, is_short: dur <= 180 ? 1 : 0,
        views: Number(v.statistics.viewCount || 0), likes: Number(v.statistics.likeCount || 0), comments: Number(v.statistics.commentCount || 0),
      });
    }
  }

  // 4. zapis filmów i migawek
  const stmts = [];
  for (const v of videos) {
    stmts.push(db.prepare(
      `INSERT INTO videos (id,title,published,duration_s,thumb,thumb_hi,tags,wt,is_short,views,likes,comments,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, duration_s=excluded.duration_s, thumb=excluded.thumb, thumb_hi=excluded.thumb_hi, tags=excluded.tags,
       is_short=excluded.is_short, views=excluded.views, likes=excluded.likes, comments=excluded.comments, updated=excluded.updated`
    ).bind(v.id, v.title, v.published, v.duration_s, v.thumb, v.thumb_hi, v.tags, v.wt, v.is_short, v.views, v.likes, v.comments, nowIso));
    const ageH = (now - Date.parse(v.published)) / HOUR;
    const ts = ageH < 31 * 24 ? nowIso.slice(0, 13) + ":00:00Z" : isoDate(now);
    stmts.push(db.prepare("INSERT OR REPLACE INTO snapshots (video_id, ts, views) VALUES (?,?,?)").bind(v.id, ts, v.views));
  }
  stmts.push(db.prepare("INSERT OR REPLACE INTO channel_stats (ts, subs, views, videos) VALUES (?,?,?,?)")
    .bind(nowIso.slice(0, 13) + ":00:00Z", subs, Number(ch.statistics.viewCount || 0), Number(ch.statistics.videoCount || 0)));
  stmts.push(kvSet(db, "channel_title", ch.snippet.title), kvSet(db, "channel_id", ch.id), kvSet(db, "channel_thumb", ch.snippet.thumbnails?.default?.url || ""));
  if (subs !== null) stmts.push(kvSet(db, "subs", subs));
  await db.batch(stmts);

  // 5. nowe filmy → autor z planu + aktualności
  const post = [];
  for (const v of videos) {
    if (known.has(v.id)) continue;
    const recent = now - Date.parse(v.published) < 4 * DAYMS;
    if (firstSync && !recent) continue;
    const p = await matchProject(db, v);
    if (p) {
      post.push(...linkProject(db, v, p));
      post.push(news(db, "new_video", `Nowy film na kanale: „${v.title}” (montował: ${p.member})`, v.id, "new:" + v.id, nowIso));
    } else {
      post.push(news(db, "unassigned", `Nowy film „${v.title}”, ale nie pasuje do nikogo z planu. Przypisz autora w zakładce Performance.`, v.id, "new:" + v.id, nowIso));
    }
  }
  if (firstSync) post.push(news(db, "info", `Panel połączony z kanałem ${ch.snippet.title}. Wczytano ${videos.length} filmów.`, null, "connected:" + ch.id, nowIso));

  // 6. kamienie milowe subów
  const lastSubs = Number(await kvGet(db, "last_milestone_subs")) || 0;
  if (subs !== null) {
    const step = subs < 1000 ? 100 : subs < 10000 ? 1000 : subs < 100000 ? 5000 : 50000;
    const reached = Math.floor(subs / step) * step;
    if (!firstSync && reached > lastSubs && reached > 0) post.push(news(db, "milestone", `Kanał przekroczył ${reached.toLocaleString("pl-PL")} subów! 🎉`, null, "subs:" + reached, nowIso));
    if (reached > lastSubs) post.push(kvSet(db, "last_milestone_subs", reached));
  }
  if (post.length) await db.batch(post);

  // 7. dane historyczne z Analytics (max 10 filmów na raz)
  const today = isoDate(now);
  const { results: todo } = await db.prepare(
    `SELECT id, published FROM videos WHERE (analytics_at IS NULL) OR (analytics_at < ? AND published > ?) ORDER BY published DESC LIMIT ?`
  ).bind(today, new Date(now - 31 * DAYMS).toISOString(), Math.max(0, Math.min(10, 45 - CALLS))).all();
  const touched = new Set(videos.filter((v) => now - Date.parse(v.published) < 31 * DAYMS).map((v) => v.id));
  for (const v of todo) {
    const pubMs = Date.parse(v.published);
    const start = ptDate(pubMs), end = isoDate(Math.min(now - DAYMS, pubMs + 29 * DAYMS));
    const st = [];
    if (end >= start) {
      try {
        const r = await g(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${start}&endDate=${end}&metrics=views&dimensions=day&filters=video==${v.id}&sort=day`, token);
        for (const [day, views] of r.rows || []) st.push(db.prepare("INSERT OR REPLACE INTO daily (video_id, day, views) VALUES (?,?,?)").bind(v.id, day, views));
      } catch (e) { log.push("analytics " + v.id + ": " + e.message); continue; }
    }
    st.push(db.prepare("UPDATE videos SET analytics_at=? WHERE id=?").bind(today, v.id));
    await db.batch(st);
    touched.add(v.id);
  }

  // 8. krzywe wyświetleń dla zmienionych filmów
  if (touched.size) {
    const list = [...touched];
    const q = "(" + list.map(() => "?").join(",") + ")";
    const [vs, sn, dl] = await db.batch([
      db.prepare(`SELECT id, published FROM videos WHERE id IN ${q}`).bind(...list),
      db.prepare(`SELECT video_id, ts, views FROM snapshots WHERE video_id IN ${q}`).bind(...list),
      db.prepare(`SELECT video_id, day, views FROM daily WHERE video_id IN ${q}`).bind(...list),
    ]);
    const group = (rows) => rows.reduce((m, r) => ((m[r.video_id] ||= []).push(r), m), {});
    const S = group(sn.results), D = group(dl.results);
    await db.batch(vs.results.map((v) => {
      const pub = Date.parse(v.published);
      const { curve, approx24 } = buildCurve(pub, now, (S[v.id] || []).filter((s) => s.ts.length > 10), D[v.id] || []);
      return db.prepare("UPDATE videos SET curve=?, approx24=? WHERE id=?").bind(JSON.stringify(curve), approx24, v.id);
    }));
  }

  // 9. rekordy (osobno War Thunder i inne gry) i „film odżywa”
  const { results: rows } = await db.prepare("SELECT id, title, member, published, views, curve, is_short, wt FROM videos").all();
  const ov = await loadOverrides(db);
  const longs = rows.filter((r) => !r.is_short && (r.curve || ov[r.id])).map((r) => ({ ...r, curve: r.curve ? JSON.parse(r.curve) : null }));
  const oldRec = JSON.parse((await kvGet(db, "records")) || "{}");
  const rec = {};
  const fin = [];
  const label = { 24: "24 godzin", 168: "7 dni", 336: "14 dni", 672: "28 dni" };
  for (const c of ["wt", "other"]) {
    for (const w of WINDOWS) {
      let best = null;
      for (const v of longs) {
        if ((v.wt ? "wt" : "other") !== c) continue;
        const x = recordValue(v, w, ov);
        if (x !== null && (!best || x > best.views)) best = { id: v.id, views: x, manual: !!(ov[v.id] && ov[v.id][w] !== undefined) };
      }
      if (!best) continue;
      const key = c + w;
      rec[key] = best;
      const v = longs.find((x) => x.id === best.id);
      // powiadomienie tylko dla świeżych filmów (stare filmy „zdobywają” rekordy tylko przez dociąganie historii)
      if (!firstSync && oldRec[key] && oldRec[key].id !== best.id && !best.manual && now - Date.parse(v.published) < 35 * DAYMS) {
        fin.push(news(db, "record", `NOWY REKORD ${c === "wt" ? "War Thunder" : "(inne gry)"} po ${label[w]}: „${v.title}” – ${best.views.toLocaleString("pl-PL")} wyświetleń${v.member ? " (" + v.member + ")" : ""}`, v.id, `rec:${key}:${v.id}`, nowIso));
      }
    }
  }
  fin.push(kvSet(db, "records", JSON.stringify(rec)));

  const yday = isoDate(now - DAYMS);
  const [y, a] = await db.batch([
    db.prepare("SELECT video_id, views FROM snapshots WHERE ts = ?").bind(yday),
    // najstarsza dzienna migawka sprzed 3–15 dni = punkt odniesienia „normalnej” oglądalności
    db.prepare("SELECT video_id, MIN(ts) AS ts, views FROM snapshots WHERE length(ts) = 10 AND ts >= ? AND ts <= ? GROUP BY video_id")
      .bind(isoDate(now - 15 * DAYMS), isoDate(now - 3 * DAYMS)),
  ]);
  const Y = Object.fromEntries(y.results.map((r) => [r.video_id, r.views]));
  const A = Object.fromEntries(a.results.map((r) => [r.video_id, { views: r.views, days: (Date.parse(yday) - Date.parse(r.ts)) / DAYMS }]));
  const week = isoDate(now - (new Date(now).getUTCDay() * DAYMS));
  for (const v of rows) {
    if (now - Date.parse(v.published) < 45 * DAYMS || Y[v.id] === undefined) continue;
    const d24 = v.views - Y[v.id];
    const base = A[v.id] && A[v.id].days >= 2 ? (Y[v.id] - A[v.id].views) / A[v.id].days : null;
    if (base !== null && d24 >= Math.max(50, base * 3)) {
      fin.push(news(db, "revival", `Film odżywa! „${v.title}” złapał ${d24.toLocaleString("pl-PL")} wyświetleń w dobę (zwykle ok. ${Math.round(base)}).`, v.id, `rev:${v.id}:${week}`, nowIso));
    }
  }

  // 10. sprzątanie starych migawek
  fin.push(db.prepare("DELETE FROM snapshots WHERE length(ts) = 10 AND ts < ?").bind(isoDate(now - 40 * DAYMS)));
  fin.push(kvSet(db, "last_refresh", nowIso), kvSet(db, "first_sync_done", "1"), kvSet(db, "last_error", ""));
  await db.batch(fin);

  return { ok: true, videos: videos.length, analytics: todo.length, log };
}
