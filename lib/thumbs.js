// Panel MVS — TOP miniatury wg WYNIKU 0–100 (bez shortów).
// Dane: tabela reach (dzienny CTR i wyświetlenia miniatury z YouTube Reporting API)
// + ctr_import (CTR „od początku” z eksportu YouTube Studio)
// + thumb_stats (udział widzów spoza subów i utrzymanie, z YouTube Analytics, pobierane stopniowo).
//
// Wynik = ważona średnia percentyli na tle innych filmów kanału (50 = typowa miniatura MVS):
//   40% CTR skorygowany o zasięg  – CTR zawsze spada, gdy YouTube pokazuje film szerzej, więc porównujemy
//                                  CTR z tym, czego można się spodziewać przy takiej liczbie wyświetleń miniatury
//   25% zasięg                    – ile razy YouTube pokazał miniaturę (algorytm „uwierzył” w film)
//   20% nowi widzowie             – jaka część wyświetleń przyszła od osób bez suba
//   15% dotrzymana obietnica      – średni % obejrzenia (miniatura-clickbait z szybkim odpływem traci)
// Brakująca składowa = jej waga rozkłada się na pozostałe.
import { ptDate, kvGet } from "./yt.js";

const MIN_IMP_24 = 200, MIN_IMP_LIFE = 1000, MIN_VIEWS_LIFE = 3000;
const DAYMS = 864e5;
export const WEIGHTS = { ctr: 0.4, reach: 0.25, fresh: 0.2, hold: 0.15 };
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

// percentyl (0–1) każdej wartości w puli; null zostaje null
function pct(vals) {
  const ok = vals.map((v, i) => [v, i]).filter(([v]) => v != null && isFinite(v)).sort((a, b) => a[0] - b[0]);
  const out = vals.map(() => null);
  if (ok.length < 2) { for (const [, i] of ok) out[i] = 0.5; return out; }
  let j = 0;
  while (j < ok.length) {
    let k = j; while (k + 1 < ok.length && ok[k + 1][0] === ok[j][0]) k++;
    const p = (j + k) / 2 / (ok.length - 1);
    for (let m = j; m <= k; m++) out[ok[m][1]] = p;
    j = k + 1;
  }
  return out;
}

// CTR minus oczekiwany CTR przy danym zasięgu (prosta regresja CTR ~ ln(wyświetlenia miniatury))
function ctrResidual(rows) {
  const pts = rows.filter((r) => r.imp > 0 && r.ctr != null);
  if (pts.length < 8) return rows.map((r) => r.ctr);
  const xs = pts.map((r) => Math.log(r.imp)), ys = pts.map((r) => r.ctr);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? Math.min(0, sxy / sxx) : 0; // tylko spadek CTR z zasięgiem – nigdy nie „karzemy” za duży zasięg
  return rows.map((r) => (r.imp > 0 && r.ctr != null ? r.ctr - (my + b * (Math.log(r.imp) - mx)) : null));
}

export function scorePool(rows) {
  const cr = pct(ctrResidual(rows));
  const re = pct(rows.map((r) => (r.imp > 0 ? Math.log(r.imp) : null)));
  const fr = pct(rows.map((r) => r.fresh));
  const ho = pct(rows.map((r) => r.hold));
  return rows.map((r, i) => {
    const parts = { ctr: cr[i], reach: re[i], fresh: fr[i], hold: ho[i] };
    let s = 0, w = 0;
    for (const k in WEIGHTS) if (parts[k] != null) { s += parts[k] * WEIGHTS[k]; w += WEIGHTS[k]; }
    const score = w ? Math.round((s / w) * 100) : null;
    const p = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v == null ? null : Math.round(v * 100)]));
    return { ...r, score, parts: p, partial: parts.fresh == null || parts.hold == null };
  });
}

export async function topThumbs(db) {
  const [cov, vids, first, life, imp, sums, ts] = await db.batch([
    db.prepare("SELECT (SELECT value FROM kv WHERE key='reach_since') AS since, MAX(day) AS until FROM reach"),
    db.prepare("SELECT id, title, published, thumb, thumb_hi, views, member, wt FROM videos WHERE is_short = 0 AND removed_at IS NULL AND COALESCE(live_override, is_live, 0) = 0 AND COALESCE(members_override, is_members, 0) = 0"),
    // pierwsza doba ≈ dzień publikacji + następny dzień (dni raportu liczone wg czasu pacyficznego)
    db.prepare(`SELECT r.video_id, SUM(r.impressions) AS imp, SUM(r.impressions * r.ctr) AS clk FROM reach r JOIN videos v ON v.id = r.video_id
      WHERE v.is_short = 0 AND COALESCE(v.live_override, v.is_live, 0) = 0 AND COALESCE(v.members_override, v.is_members, 0) = 0 AND r.day <= date(v.published, '-8 hours', '+1 day') GROUP BY r.video_id`),
    db.prepare("SELECT video_id, SUM(impressions) AS imp, SUM(impressions * ctr) AS clk, MIN(day) AS first FROM reach GROUP BY video_id"),
    db.prepare("SELECT video_id, ctr, impressions FROM ctr_import"),
    db.prepare("SELECT video_id, imp, clk, imp24, clk24 FROM reach_sum"),
    db.prepare("SELECT * FROM thumb_stats"),
  ]);
  // dane zwinięte (starsze niż 35 dni) + bieżące wiersze
  const add = (rows, id, imp, clk) => { const r = rows.get(id) || { video_id: id, imp: 0, clk: 0 }; r.imp += imp || 0; r.clk += clk || 0; rows.set(id, r); };
  const F = new Map(), L = new Map();
  for (const r of first.results) add(F, r.video_id, r.imp, r.clk);
  for (const r of life.results) add(L, r.video_id, r.imp, r.clk);
  for (const r of sums.results) { add(F, r.video_id, r.imp24, r.clk24); add(L, r.video_id, r.imp, r.clk); }
  const since = cov.results[0]?.since || null;
  const V = new Map(vids.results.map((v) => [v.id, v]));
  const T = new Map(ts.results.map((r) => [r.video_id, r]));
  const share = (n, d) => (d > 0 && n != null ? n / d : null);
  const pick = (v, ctr, impressions, source, fresh, hold) => ({
    id: v.id, title: v.title, thumb: v.thumb_hi || v.thumb, published: v.published, member: v.member, wt: v.wt, views: v.views,
    ctr: Math.round(ctr * 10000) / 100, imp: impressions, impressions: Math.round(impressions), source,
    fresh: fresh == null ? null : Math.round(fresh * 1000) / 10, hold: hold == null ? null : Math.round(hold * 10) / 10,
  });

  // pierwsza doba: tylko filmy wydane, gdy raporty już działały
  const pool24 = [...F.values()]
    .map((r) => ({ r, v: V.get(r.video_id) }))
    .filter(({ r, v }) => v && since && ptDate(Date.parse(v.published)) >= since && r.imp >= MIN_IMP_24)
    .map(({ r, v }) => { const t = T.get(v.id) || {}; return pick(v, r.clk / r.imp, r.imp, "api", share(t.nonsub24, t.views24), t.avp24); });

  // cały czas: eksport ze Studio, a dla nowszych filmów pełne dane z raportów
  const imported = new Map(imp.results.map((r) => [r.video_id, r]));
  const poolLife = [];
  let partial = 0;
  for (const v of V.values()) {
    const i = imported.get(v.id), a = L.get(v.id), t = T.get(v.id) || {};
    if ((v.views || 0) < MIN_VIEWS_LIFE) continue; // cały czas: tylko filmy z min. 3000 wyświetleń
    const fresh = share(t.nonsub_life, t.views_life), hold = t.avp_life;
    if (i) { poolLife.push(pick(v, i.ctr, i.impressions, "studio", fresh, hold)); continue; }
    if (!a || a.imp < MIN_IMP_LIFE) continue;
    if (since && ptDate(Date.parse(v.published)) >= since) poolLife.push(pick(v, a.clk / a.imp, a.imp, "api", fresh, hold));
    else partial++;
  }
  const rank = (pool) => scorePool(pool).map(({ imp, ...r }) => r).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.ctr - a.ctr);
  const r24 = rank(pool24), rl = rank(poolLife);
  const pending = ts.results.length;

  return {
    since, until: cov.results[0]?.until || null, imported: imported.size, partial,
    pool24: r24.length, poolLife: rl.length, audience: pending,
    job_at: await kvGet(db, "reach_job_at"), error: (await kvGet(db, "reach_error")) || "",
    top24: r24.slice(0, 5), topLife: rl.slice(0, 5),
  };
}

// Analytics: widzowie z/bez suba + utrzymanie dla jednego filmu (raport „subscribedStatus” przyjmuje 1 film na zapytanie).
// Pierwsza doba: raz, gdy film ma ≥3 dni. Cały czas: odświeżane co 30 dni. Kilka zapytań na odświeżenie.
export async function syncThumbStats(db, gfetch, now, budget = 4) {
  if (budget <= 0) return { calls: 0 };
  const base = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&dimensions=subscribedStatus&metrics=views,averageViewPercentage";
  const sinceRow = await db.prepare("SELECT value FROM kv WHERE key='reach_since'").first();
  const since = sinceRow?.value || "9999-12-31";
  const EX = "v.is_short = 0 AND v.removed_at IS NULL AND COALESCE(v.live_override, v.is_live, 0) = 0 AND COALESCE(v.members_override, v.is_members, 0) = 0";
  const { results: need24 } = await db.prepare(`SELECT v.id, v.published FROM videos v LEFT JOIN thumb_stats t ON t.video_id = v.id
    WHERE ${EX} AND t.d24_at IS NULL AND v.published <= ? AND date(v.published, '-8 hours') >= ? ORDER BY v.published DESC LIMIT ?`)
    .bind(new Date(now - 3 * DAYMS).toISOString(), since, budget).all();
  const left = budget - need24.length;
  const { results: needLife } = left > 0 ? await db.prepare(`SELECT v.id, v.published FROM videos v LEFT JOIN thumb_stats t ON t.video_id = v.id
    WHERE ${EX} AND v.views >= ? AND (t.life_at IS NULL OR t.life_at < ?) ORDER BY t.life_at IS NOT NULL, t.life_at, v.views DESC LIMIT ?`)
    .bind(MIN_VIEWS_LIFE, new Date(now - 30 * DAYMS).toISOString(), left).all() : { results: [] };
  const sum = (rows) => {
    let all = 0, non = 0, w = 0;
    for (const [st, views, avp] of rows || []) { all += views; w += views * (avp || 0); if (st === "UNSUBSCRIBED") non += views; }
    return { all, non, avp: all ? w / all : null };
  };
  const nowIso = new Date(now).toISOString(), st = [];
  for (const v of need24) {
    const d0 = ptDate(Date.parse(v.published)), d1 = isoDate(Date.parse(d0) + DAYMS);
    const s = sum((await gfetch(`${base}&filters=video==${v.id}&startDate=${d0}&endDate=${d1}`)).rows);
    st.push(db.prepare(`INSERT INTO thumb_stats (video_id, views24, nonsub24, avp24, d24_at) VALUES (?,?,?,?,?)
      ON CONFLICT(video_id) DO UPDATE SET views24=excluded.views24, nonsub24=excluded.nonsub24, avp24=excluded.avp24, d24_at=excluded.d24_at`).bind(v.id, s.all, s.non, s.avp, nowIso));
  }
  for (const v of needLife) {
    const s = sum((await gfetch(`${base}&filters=video==${v.id}&startDate=${isoDate(Date.parse(v.published) - DAYMS)}&endDate=${isoDate(now)}`)).rows);
    st.push(db.prepare(`INSERT INTO thumb_stats (video_id, views_life, nonsub_life, avp_life, life_at) VALUES (?,?,?,?,?)
      ON CONFLICT(video_id) DO UPDATE SET views_life=excluded.views_life, nonsub_life=excluded.nonsub_life, avp_life=excluded.avp_life, life_at=excluded.life_at`).bind(v.id, s.all, s.non, s.avp, nowIso));
  }
  if (st.length) { st.push(db.prepare("DELETE FROM kv WHERE key='cache_thumbs'")); await db.batch(st); }
  return { calls: need24.length + needLife.length };
}

// wiersze z eksportu YouTube Studio: [{id, ctr (0–100 albo ułamek), impressions}]
export function importStmts(db, rows, nowIso) {
  return rows.filter((r) => /^[A-Za-z0-9_-]{11}$/.test(r.id) && r.ctr >= 0).map((r) => {
    const ctr = r.ctr > 1 ? r.ctr / 100 : r.ctr;
    return db.prepare("INSERT OR REPLACE INTO ctr_import (video_id, ctr, impressions, imported_at) VALUES (?,?,?,?)").bind(r.id, ctr, Math.round(r.impressions || 0), nowIso);
  });
}
