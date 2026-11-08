// Panel MVS — TOP miniatury wg CTR (bez shortów).
// Dane: tabela reach (dzienny CTR z YouTube Reporting API, od ~30 dni przed uruchomieniem)
// + ctr_import (CTR „od początku” z eksportu YouTube Studio).
import { ptDate, kvGet } from "./yt.js";

const MIN_IMP_24 = 200, MIN_IMP_LIFE = 1000, MIN_VIEWS_LIFE = 3000;

export async function topThumbs(db) {
  const [cov, vids, first, life, imp] = await db.batch([
    db.prepare("SELECT MIN(day) AS since, MAX(day) AS until FROM reach"),
    db.prepare("SELECT id, title, published, thumb, thumb_hi, views, member, wt FROM videos WHERE is_short = 0 AND removed_at IS NULL AND COALESCE(live_override, is_live, 0) = 0"),
    // pierwsza doba ≈ dzień publikacji + następny dzień (dni raportu liczone wg czasu pacyficznego)
    db.prepare(`SELECT r.video_id, SUM(r.impressions) AS imp, SUM(r.impressions * r.ctr) AS clk FROM reach r JOIN videos v ON v.id = r.video_id
      WHERE v.is_short = 0 AND COALESCE(v.live_override, v.is_live, 0) = 0 AND r.day <= date(v.published, '-8 hours', '+1 day') GROUP BY r.video_id`),
    db.prepare("SELECT video_id, SUM(impressions) AS imp, SUM(impressions * ctr) AS clk, MIN(day) AS first FROM reach GROUP BY video_id"),
    db.prepare("SELECT video_id, ctr, impressions FROM ctr_import"),
  ]);
  const since = cov.results[0]?.since || null;
  const V = new Map(vids.results.map((v) => [v.id, v]));
  const pick = (v, ctr, impressions, source) => ({
    id: v.id, title: v.title, thumb: v.thumb_hi || v.thumb, published: v.published, member: v.member, wt: v.wt, views: v.views,
    ctr: Math.round(ctr * 10000) / 100, impressions: Math.round(impressions), source,
  });

  // TOP 5 po pierwszej dobie: tylko filmy wydane, gdy raporty już działały
  const top24 = first.results
    .map((r) => ({ r, v: V.get(r.video_id) }))
    .filter(({ r, v }) => v && since && ptDate(Date.parse(v.published)) >= since && r.imp >= MIN_IMP_24)
    .map(({ r, v }) => pick(v, r.clk / r.imp, r.imp, "api"))
    .sort((a, b) => b.ctr - a.ctr).slice(0, 5);

  // TOP 5 od początku: eksport ze Studio, a dla nowszych filmów pełne dane z raportów
  const imported = new Map(imp.results.map((r) => [r.video_id, r]));
  const lifeMap = new Map(life.results.map((r) => [r.video_id, r]));
  const lifeRows = [];
  let partial = 0;
  for (const v of V.values()) {
    const i = imported.get(v.id), a = lifeMap.get(v.id);
    if ((v.views || 0) < MIN_VIEWS_LIFE) continue; // cały czas: tylko filmy z min. 3000 wyświetleń
    if (i) { lifeRows.push(pick(v, i.ctr, i.impressions, "studio")); continue; }
    if (!a || a.imp < MIN_IMP_LIFE) continue;
    if (since && ptDate(Date.parse(v.published)) >= since) lifeRows.push(pick(v, a.clk / a.imp, a.imp, "api"));
    else partial++;
  }
  const topLife = lifeRows.sort((a, b) => b.ctr - a.ctr).slice(0, 5);

  return {
    since, until: cov.results[0]?.until || null, imported: imported.size, partial,
    job_at: await kvGet(db, "reach_job_at"), error: (await kvGet(db, "reach_error")) || "",
    top24, topLife,
  };
}

// wiersze z eksportu YouTube Studio: [{id, ctr (0–100 albo ułamek), impressions}]
export function importStmts(db, rows, nowIso) {
  return rows.filter((r) => /^[A-Za-z0-9_-]{11}$/.test(r.id) && r.ctr >= 0).map((r) => {
    const ctr = r.ctr > 1 ? r.ctr / 100 : r.ctr;
    return db.prepare("INSERT OR REPLACE INTO ctr_import (video_id, ctr, impressions, imported_at) VALUES (?,?,?,?)").bind(r.id, ctr, Math.round(r.impressions || 0), nowIso);
  });
}
