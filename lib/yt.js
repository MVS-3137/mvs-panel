// Panel MVS — integracja z YouTube (Data API v3 + Analytics API).
// Wywoływane przez /api/refresh (co godzinę z crona albo przyciskiem w panelu).
import { evaluate as evaluateAchievements, updateSubs } from "./ach.js";
import { updateComp } from "./comp.js";
import { syncGradeStats } from "./grades.js";

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
export const ptDate = (ms) => isoDate(ms - ptOffsetH(ms) * HOUR);
const ptDayEnd = (day) => { const [y, m, d] = day.split("-").map(Number); const t = Date.UTC(y, m - 1, d + 1); return t + ptOffsetH(t) * HOUR; };

export function parseDuration(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
// filmy tylko dla wspierających: YouTube nie ma takiego pola, więc rozpoznajemy je po wzorze z kanału MVS
const MEMBERS_RE = /bez\s*cenzury|dla\s+wspieraj|wspierając|tylko\s+dla\s+członk|members?\s*only/i;
export function looksMembers(v, nowMs) {
  if (v.is_live) return false;
  if (MEMBERS_RE.test(v.title)) return true;
  const ageD = (nowMs - Date.parse(v.published)) / 864e5;
  // po 3+ dniach poniżej 100 wyświetleń przy wysokim odsetku polubień (oglądają tylko wspierający)
  return ageD >= 3 && v.views < 100 && v.likes >= Math.max(1, v.views * 0.05);
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

async function graw(url, token, init = {}) {
  CALLS++;
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: "Bearer " + token } });
  if (!r.ok) { const t = await r.text().catch(() => ""); const e = new Error("Google API " + r.status + ": " + t.slice(0, 160)); e.status = r.status; throw e; }
  return r;
}

/* ---------------- CTR miniatur: YouTube Reporting API (raport channel_reach_basic_a1) ---------------- */
const REACH = "channel_reach_basic_a1";
export function parseReachCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines.shift().split(",").map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const iD = ix("date"), iV = ix("video_id"), iI = ix("video_thumbnail_impressions"), iC = ix("video_thumbnail_impressions_ctr");
  if ([iD, iV, iI, iC].some((i) => i < 0)) return [];
  return lines.map((l) => l.split(",")).filter((c) => c[iV]).map((c) => {
    const d = c[iD]; let ctr = Number(c[iC]) || 0; if (ctr > 1) ctr /= 100;
    return { video_id: c[iV], day: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d, impressions: Number(c[iI]) || 0, ctr };
  });
}
async function syncReach(db, token, nowIso, maxDownloads) {
  let jobId = await kvGet(db, "reach_job_id");
  const base = "https://youtubereporting.googleapis.com/v1";
  if (!jobId) {
    const list = await (await graw(`${base}/jobs`, token)).json();
    const found = (list.jobs || []).find((j) => j.reportTypeId === REACH);
    jobId = found ? found.id : (await (await graw(`${base}/jobs`, token, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportTypeId: REACH, name: "Panel MVS - CTR miniatur" }),
    })).json()).id;
    await db.batch([kvSet(db, "reach_job_id", jobId), kvSet(db, "reach_job_at", nowIso)]);
  }
  const after = await kvGet(db, "reach_after");
  const rep = await (await graw(`${base}/jobs/${jobId}/reports${after ? "?createdAfter=" + encodeURIComponent(after) : ""}`, token)).json();
  const reports = (rep.reports || []).sort((a, b) => (a.createTime < b.createTime ? -1 : 1)).slice(0, maxDownloads);
  let last = after, rows = 0;
  const longIds = new Set((await db.prepare("SELECT id FROM videos WHERE is_short = 0").all()).results.map((r) => r.id));
  for (const r of reports) {
    const csv = await (await graw(r.downloadUrl, token)).text();
    const data = parseReachCsv(csv).filter((d) => longIds.has(d.video_id) && d.impressions > 0);
    if (data.length) {
      const minDay = data.reduce((m, d) => (d.day < m ? d.day : m), data[0].day);
      const since = await kvGet(db, "reach_since");
      if (!since || minDay < since) await db.batch([kvSet(db, "reach_since", minDay)]);
    }
    const st = data.map((d) => db.prepare("INSERT OR REPLACE INTO reach (video_id, day, impressions, ctr) VALUES (?,?,?,?)").bind(d.video_id, d.day, d.impressions, d.ctr));
    for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
    rows += data.length; last = r.createTime;
    await db.batch([kvSet(db, "reach_after", last)]);
  }
  // dni starsze niż 35 zwijamy do sum (mniej wierszy w bazie i mniej odczytów)
  if (reports.length) {
    const cut = isoDate(Date.now() - 35 * DAYMS);
    await db.batch([
      db.prepare(`INSERT INTO reach_sum (video_id, imp, clk, imp24, clk24)
        SELECT r.video_id, SUM(r.impressions), SUM(r.impressions * r.ctr),
          SUM(CASE WHEN r.day <= date(v.published, '-8 hours', '+1 day') THEN r.impressions ELSE 0 END),
          SUM(CASE WHEN r.day <= date(v.published, '-8 hours', '+1 day') THEN r.impressions * r.ctr ELSE 0 END)
        FROM reach r JOIN videos v ON v.id = r.video_id WHERE r.day < ? GROUP BY r.video_id
        ON CONFLICT(video_id) DO UPDATE SET imp = imp + excluded.imp, clk = clk + excluded.clk, imp24 = imp24 + excluded.imp24, clk24 = clk24 + excluded.clk24`).bind(cut),
      db.prepare("DELETE FROM reach WHERE day < ?").bind(cut),
    ]);
  }
  return { reports: reports.length, rows };
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
  const known = new Map((await db.prepare("SELECT id, title, member, published, removed_at FROM videos").all()).results.map((v) => [v.id, v]));
  const ids = new Set(known.keys());
  let page = "", pages = 0;
  do {
    const pl = await g(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? "&pageToken=" + page : ""}`, token);
    let fresh = 0;
    for (const it of pl.items || []) { if (!ids.has(it.contentDetails.videoId)) fresh++; ids.add(it.contentDetails.videoId); }
    page = (firstSync || fresh > 0) ? pl.nextPageToken : null;
    pages++;
  } while (page && pages < 20);

  // 3. statystyki filmów: co godzinę tylko młode i nowe filmy, pełna lista raz dziennie (oszczędza limit D1)
  const full = firstSync || (await kvGet(db, "full_day")) !== isoDate(now);
  const youngCut = new Date(now - 32 * DAYMS).toISOString();
  const all = [...ids].filter((id) => full || !known.has(id) || (known.get(id).published > youngCut && !known.get(id).removed_at));
  const videos = [];
  for (let i = 0; i < all.length; i += 50) {
    const r = await g(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,status,liveStreamingDetails&id=${all.slice(i, i + 50).join(",")}`, token);
    for (const v of r.items || []) {
      if (v.status.privacyStatus !== "public" || !v.snippet.publishedAt) continue;
      const tags = v.snippet.tags || [];
      const dur = parseDuration(v.contentDetails.duration);
      videos.push({
        id: v.id, title: v.snippet.title, published: v.snippet.publishedAt, duration_s: dur,
        thumb: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url || "",
        thumb_hi: (v.snippet.thumbnails.maxres || v.snippet.thumbnails.high || {}).url || "",
        tags: JSON.stringify(tags.slice(0, 60)), wt: isWT(v.snippet.title, tags) ? 1 : 0, is_short: dur <= 180 ? 1 : 0, is_live: v.liveStreamingDetails && v.liveStreamingDetails.actualStartTime ? 1 : 0,
        views: Number(v.statistics.viewCount || 0), likes: Number(v.statistics.likeCount || 0), comments: Number(v.statistics.commentCount || 0),
      });
    }
  }

  // 4. zapis filmów i migawek
  const stmts = [];
  for (const v of videos) {
    stmts.push(db.prepare(
      `INSERT INTO videos (id,title,published,duration_s,thumb,thumb_hi,tags,wt,is_short,views,likes,comments,updated,is_live,is_members) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, duration_s=excluded.duration_s, thumb=excluded.thumb, thumb_hi=excluded.thumb_hi, tags=excluded.tags,
       is_short=excluded.is_short, views=excluded.views, likes=excluded.likes, comments=excluded.comments, updated=excluded.updated, removed_at=NULL, is_live=excluded.is_live, is_members=MAX(COALESCE(videos.is_members,0), excluded.is_members)
       WHERE videos.views IS NOT excluded.views OR videos.likes IS NOT excluded.likes OR videos.comments IS NOT excluded.comments
         OR videos.title IS NOT excluded.title OR videos.thumb IS NOT excluded.thumb OR videos.tags IS NOT excluded.tags OR videos.removed_at IS NOT NULL
         OR videos.is_live IS NOT excluded.is_live OR COALESCE(videos.is_members,0) < excluded.is_members`
    ).bind(v.id, v.title, v.published, v.duration_s, v.thumb, v.thumb_hi, v.tags, v.wt, v.is_short, v.views, v.likes, v.comments, nowIso, v.is_live, looksMembers(v, now) ? 1 : 0));
    const ageH = (now - Date.parse(v.published)) / HOUR;
    // migawki potrzebne tylko do krzywej 24 h–28 dni: co godzinę do 50 h, potem raz dziennie do 31 dni
    if (ageH <= 50) stmts.push(db.prepare("INSERT OR REPLACE INTO snapshots (video_id, ts, views) VALUES (?,?,?)").bind(v.id, nowIso.slice(0, 13) + ":00:00Z", v.views));
    else if (ageH <= 31 * 24) stmts.push(db.prepare("INSERT OR IGNORE INTO snapshots (video_id, ts, views) VALUES (?,?,?)").bind(v.id, isoDate(now), v.views));
  }
  if (full) stmts.push(kvSet(db, "full_day", isoDate(now)));
  stmts.push(db.prepare("INSERT OR REPLACE INTO channel_stats (ts, subs, views, videos) VALUES (?,?,?,?)")
    .bind(nowIso.slice(0, 13) + ":00:00Z", subs, Number(ch.statistics.viewCount || 0), Number(ch.statistics.videoCount || 0)));
  stmts.push(kvSet(db, "channel_title", ch.snippet.title), kvSet(db, "channel_id", ch.id), kvSet(db, "channel_thumb", ch.snippet.thumbnails?.default?.url || ""));
  if (subs !== null) stmts.push(kvSet(db, "subs", subs));
  await db.batch(stmts);

  // 4b. filmy, które zniknęły z kanału (usunięte lub ukryte)
  const post = [];
  const ev = { newVideos: [], unassigned: [], removed: [], revivals: [], recChanges: [] };
  const publicIds = new Set(videos.map((v) => v.id));
  if (!firstSync && full) for (const [id, k] of known) {
    if (k.removed_at || publicIds.has(id)) continue;
    ev.removed.push(k);
    post.push(db.prepare("UPDATE videos SET removed_at=? WHERE id=?").bind(nowIso, id),
      news(db, "info", `Film „${k.title}” zniknął z kanału (usunięty albo ukryty).`, id, "gone:" + id + ":" + isoDate(now), nowIso));
  }

  // 5. nowe filmy → autor z planu + aktualności
  for (const v of videos) {
    if (known.has(v.id)) continue;
    if (v.is_live || looksMembers(v, now)) continue; // stream / film dla wspierających: bez planu i bez powiadomień
    const recent = now - Date.parse(v.published) < 4 * DAYMS;
    if (firstSync && !recent) continue;
    const p = await matchProject(db, v);
    if (p) {
      ev.newVideos.push({ ...v, member: p.member });
      post.push(...linkProject(db, v, p));
      post.push(news(db, "new_video", `Nowy film na kanale: „${v.title}” (montował: ${p.member})`, v.id, "new:" + v.id, nowIso));
    } else {
      ev.newVideos.push(v); ev.unassigned.push(v);
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
  // filmy wykluczone (stream / dla wspierających) nie mogą zamykać projektów ani wisieć w aktualnościach
  const EXCL = "SELECT id FROM videos WHERE COALESCE(live_override, is_live, 0) = 1 OR COALESCE(members_override, is_members, 0) = 1";
  post.push(
    db.prepare(`UPDATE projects SET status='active', uploaded=NULL, actual_min=NULL, video_id=NULL, video_url=NULL WHERE video_id IN (${EXCL})`),
    db.prepare(`UPDATE videos SET project_id=NULL WHERE project_id IS NOT NULL AND id IN (${EXCL})`),
    db.prepare(`DELETE FROM news WHERE type IN ('unassigned','new_video') AND video_id IN (${EXCL})`));
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
  const { results: rowsAll } = await db.prepare("SELECT id, title, member, published, views, comments, duration_s, curve, is_short, wt, removed_at, is_live, live_override, is_members, members_override FROM videos").all();
  const isLive = (r) => (r.live_override ?? r.is_live ?? 0) == 1 || (r.members_override ?? r.is_members ?? 0) == 1; // wykluczone: streamy i filmy dla wspierających
  const rows = rowsAll.filter((r) => !r.removed_at && !isLive(r)); // bez usuniętych i bez zapisów streamów
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
      if (oldRec[key] && oldRec[key].id !== best.id && !best.manual) ev.recChanges.push({ key, w, cat: c, id: v.id });
      // powiadomienie tylko dla świeżych filmów (stare filmy „zdobywają” rekordy tylko przez dociąganie historii)
      if (!firstSync && oldRec[key] && oldRec[key].id !== best.id && !best.manual && now - Date.parse(v.published) < 35 * DAYMS) {
        fin.push(news(db, "record", `NOWY REKORD ${c === "wt" ? "War Thunder" : "(inne gry)"} po ${label[w]}: „${v.title}” – ${best.views.toLocaleString("pl-PL")} wyświetleń${v.member ? " (" + v.member + ")" : ""}`, v.id, `rec:${key}:${v.id}`, nowIso));
      }
    }
  }
  fin.push(kvSet(db, "records", JSON.stringify(rec)));

  // „Film odżywa” liczony jest wyłącznie z trwałego wzrostu (9b) – pojedyncze skoki są ignorowane.
  const bucket = (id) => `rev2:${id}:${Math.floor(now / (90 * DAYMS))}`; // max 1 powiadomienie na film na ~90 dni

  // 9b. „Film odżywa” (raz dziennie, YouTube Analytics): trwały wzrost od ~10 dni.
  // Warunki (dobrane na danych kanału): film ma 30+ dni; w ostatnich 10 dniach co najmniej 9 dni ma
  // ≥2,5× „normalnej” dziennej oglądalności (mediana z dni 21–45 wstecz) i min. 60 wyświetleń,
  // a średnia z 10 dni to ≥3× normy i min. 100 dziennie. Dane Analytics mają ~3 dni opóźnienia.
  if (CALLS <= 36 && (await kvGet(db, "revival_day")) !== isoDate(now)) {
    try {
      const base = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&metrics=views";
      const last = now - 3 * DAYMS;
      const a = await g(`${base}&dimensions=video&sort=-views&maxResults=200&startDate=${isoDate(last - 6 * DAYMS)}&endDate=${isoDate(last)}`, token);
      const weekly = new Map((a.rows || []).map((r) => [r[0], r[1]]));
      const cand = rows.filter((v) => (weekly.get(v.id) || 0) >= 600 && Date.parse(v.published) <= now - 30 * DAYMS)
        .sort((x, y) => weekly.get(y.id) - weekly.get(x.id)).slice(0, 8);
      for (const v of cand) {
        const r = await g(`${base}&dimensions=day&sort=day&filters=video==${v.id}&startDate=${isoDate(last - 45 * DAYMS)}&endDate=${isoDate(last)}`, token);
        const daily = new Map((r.rows || []).map((x) => [x[0], x[1]]));
        const at = (k) => daily.get(isoDate(last - k * DAYMS)) || 0;
        const norm = [...Array(25)].map((_, i) => at(21 + i)).sort((x, y) => x - y)[12];
        const recent = [...Array(10)].map((_, i) => at(i));
        const mean = recent.reduce((x, y) => x + y, 0) / 10;
        const elevated = recent.filter((x) => x >= Math.max(60, 2.5 * norm)).length;
        if (elevated >= 9 && mean >= Math.max(100, 3 * norm)) {
          ev.revivals.push({ id: v.id, member: v.member, ageDays: (now - Date.parse(v.published)) / DAYMS });
          fin.push(news(db, "revival", `Film odżywa! „${v.title}” – od ok. 10 dni ma średnio ${Math.round(mean).toLocaleString("pl-PL")} wyświetleń dziennie, ${(mean / Math.max(norm, 1)).toFixed(1).replace(".", ",")}× więcej niż wcześniej (ok. ${Math.round(norm)}/dzień).`, v.id, bucket(v.id), nowIso));
        }
      }
      fin.push(kvSet(db, "revival_day", isoDate(now)));
    } catch (e) { log.push("odżycie: " + e.message); }
  }

  // 10. sprzątanie starych migawek
  fin.push(db.prepare("DELETE FROM snapshots WHERE length(ts) = 10 AND ts < ?").bind(isoDate(now - 40 * DAYMS)));
  fin.push(kvSet(db, "last_refresh", nowIso), kvSet(db, "first_sync_done", "1"), kvSet(db, "last_error", ""));
  await db.batch(fin);

  // 10b. CTR miniatur (Reporting API): nowe raporty dzienne, max kilka plików na odświeżenie
  if (CALLS <= 40) {
    try { const r = await syncReach(db, token, nowIso, Math.min(6, 44 - CALLS)); if (r.reports) log.push(`ctr: ${r.reports} raportów, ${r.rows} wierszy`); await db.batch([kvSet(db, "reach_error", "")]); }
    catch (e) {
      log.push("ctr: " + e.message);
      await db.batch([kvSet(db, "reach_error", e.status === 403 ? "Włącz „YouTube Reporting API” w Google Cloud (APIs & Services → Library)." : e.message.slice(0, 200))]);
    }
  }

  // 10c. konkurencja: suby i wyświetlenia kanałów z tabel (raz dziennie)
  if (CALLS <= 44) {
    try { await updateComp(db, (u) => g(u, token), now); } catch (e) { log.push("konkurencja: " + e.message); }
  }

  // 10d. oceny twórców: wyświetlenia/suby/utrzymanie z 90 dni + hook 30 s (raz dziennie)
  if (CALLS <= 40) {
    try { await syncGradeStats(db, (u) => g(u, token), now, Math.min(5, 45 - CALLS)); } catch (e) { log.push("oceny: " + e.message); }
  }

  // 11. tablica wyzwań: dokładne suby (raz dziennie) i achievementy
  if (CALLS <= 46) {
    try { await updateSubs(db, (u) => g(u, token), now); } catch (e) { log.push("suby: " + e.message); }
  }
  try {
    const parsed = rowsAll.filter((r) => !isLive(r)).map((r) => ({ ...r, curve: r.curve ? JSON.parse(r.curve) : null }));
    await evaluateAchievements(db, { ...ev, videos: parsed, ov, records: rec, valueAt: (v, h) => recordValue(v, h, ov), titleScore }, now);
  } catch (e) { log.push("achievementy: " + e.message); }

  // gotowe odpowiedzi zakładek liczone są raz i trzymane w kv; po nowych danych dziennych je kasujemy
  if (full || log.some((l) => l.startsWith("ctr:"))) await db.batch([db.prepare("DELETE FROM kv WHERE key IN ('cache_thumbs','cache_grades','cache_comp')")]);

  return { ok: true, videos: videos.length, full, analytics: todo.length, log };
}
