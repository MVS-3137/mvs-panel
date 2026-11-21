// Panel MVS — zakładka Miniatury: oceny A+…F, „co działa u was” (AI ogląda miniatury), inspiracje z YouTube.
//
// Dane: ręczny import „Table data.csv” z YouTube Studio (CTR miniatury, wyświetlenia miniatury jeśli są, wyświetlenia),
// + raz w tygodniu z YouTube Analytics: średni % obejrzenia i średni czas oglądania (1–3 zapytania).
//
// Ocena miniatury (na tle waszych długich filmów, percentyle → A+…F). Wagi z researchu:
//   35% skuteczne kliknięcie = CTR × średni % obejrzenia. YouTube w teście A/B miniatur wybiera zwycięzcę po udziale
//       w czasie oglądania, nie po samym CTR – liczy się kliknięcie, po którym widz zostaje.
//   35% CTR na tle zasięgu: CTR naturalnie spada, gdy YouTube pokazuje film szerszej widowni (oficjalna pomoc YouTube),
//       więc porównujemy CTR z tym, czego można się spodziewać przy tej liczbie wyświetleń miniatury.
//   20% zasięg: ile razy YouTube pokazał miniaturę – algorytm „uwierzył” w opakowanie.
//   10% dotrzymana obietnica: średni % obejrzenia (clickbait z szybkim odpływem traci).
const DAYMS = 864e5;
export const WEIGHTS = { eff: 0.35, ctr: 0.35, reach: 0.2, hold: 0.1 };
const GRADES = [[95, "A+"], [85, "A"], [77, "A-"], [68, "B+"], [58, "B"], [48, "B-"], [38, "C+"], [28, "C"], [20, "C-"], [10, "D"], [0, "F"]];
export const gradeOf = (p) => (GRADES.find(([t]) => p >= t) || [0, "F"])[1];
const MIN_IMP = 1000;
const YT = "https://www.googleapis.com/youtube/v3";
const OWN = "UC57B3vFUeVbjNS3Ob-nINkA";
const kvPut = (db, k, v) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, typeof v === "string" ? v : JSON.stringify(v));
async function kv(db, k) { const r = await db.prepare("SELECT value FROM kv WHERE key=?").bind(k).first(); return r ? r.value : null; }

function pct(vals) {
  const ok = vals.map((v, i) => [v, i]).filter(([v]) => v != null && isFinite(v)).sort((a, b) => a[0] - b[0]);
  const out = vals.map(() => null);
  if (ok.length < 2) { for (const [, i] of ok) out[i] = 0.5; return out; }
  let j = 0;
  while (j < ok.length) { let k = j; while (k + 1 < ok.length && ok[k + 1][0] === ok[j][0]) k++; const p = (j + k) / 2 / (ok.length - 1); for (let m = j; m <= k; m++) out[ok[m][1]] = p; j = k + 1; }
  return out;
}
function ctrResidual(rows) {
  const pts = rows.filter((r) => r.imp > 0 && r.ctr != null);
  if (pts.length < 8) return rows.map((r) => r.ctr);
  const xs = pts.map((r) => Math.log(r.imp)), ys = pts.map((r) => r.ctr);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? Math.min(0, sxy / sxx) : 0;
  return rows.map((r) => (r.imp > 0 && r.ctr != null ? r.ctr - (my + b * (Math.log(r.imp) - mx)) : null));
}
export function scorePool(rows) {
  const cr = pct(ctrResidual(rows)), re = pct(rows.map((r) => (r.imp > 0 ? Math.log(r.imp) : null)));
  const ef = pct(rows.map((r) => (r.ctr != null && r.avp != null ? r.ctr * r.avp : null))), ho = pct(rows.map((r) => r.avp));
  const raw = rows.map((r, i) => {
    const parts = { eff: ef[i], ctr: cr[i], reach: re[i], hold: ho[i] };
    let s = 0, w = 0;
    for (const k in WEIGHTS) if (parts[k] != null) { s += parts[k] * WEIGHTS[k]; w += WEIGHTS[k]; }
    return { parts, raw: w ? s / w : null };
  });
  // ocena = miejsce w rankingu kanału (A+ = top 5% waszych miniatur, F = dolne 10%)
  const rank = pct(raw.map((x) => x.raw));
  return rows.map((r, i) => {
    const score = rank[i] == null ? null : Math.round(rank[i] * 100);
    return { ...r, score, grade: score == null ? null : gradeOf(score), parts: Object.fromEntries(Object.entries(raw[i].parts).map(([k, v]) => [k, v == null ? null : Math.round(v * 100)])) };
  });
}

// „co działa u was”: średni wynik miniatur z daną cechą (wg analizy AI) względem średniej kanału
const FEATS = [
  ["vehicle", (f) => f.vehicle, "Pojazd jako główny motyw"], ["face", (f) => (f.faces || 0) > 0, "Twarz / postać z emocją"],
  ["many", (f) => (f.objects || 0) >= 4, "Dużo elementów (4+)"], ["single", (f) => (f.objects || 0) <= 2, "1–2 główne elementy"],
  ["text0", (f) => (f.text_words || 0) === 0, "Bez napisu"], ["text13", (f) => (f.text_words || 0) >= 1 && f.text_words <= 3, "Krótki napis (1–3 słowa)"],
  ["text4", (f) => (f.text_words || 0) >= 4, "Dłuższy napis (4+ słów)"], ["contrast", (f) => f.contrast === "wysoki", "Wysoki kontrast"],
  ["clean", (f) => f.background === "czyste", "Czyste, proste tło"], ["busy", (f) => f.background === "zatłoczone", "Zatłoczone tło"],
  ["arrows", (f) => !!f.arrows, "Strzałki / kółka / podkreślenia"], ["explosion", (f) => !!f.action, "Akcja: wybuch, ogień, strzał"],
  ["warm", (f) => (f.palette || []).some((c) => /czerw|pomar|żółt|zolt/i.test(c)), "Ciepłe kolory (czerwień, pomarańcz, żółć)"],
  ["cool", (f) => (f.palette || []).some((c) => /niebie|ziel|szar/i.test(c)) && !(f.palette || []).some((c) => /czerw|pomar|żółt/i.test(c)), "Chłodna paleta bez ciepłych akcentów"],
];
function insights(scored) {
  const withF = scored.filter((r) => r.feats && r.score != null);
  if (withF.length < 8) return { n: withF.length, items: [] };
  const avg = withF.reduce((a, r) => a + r.score, 0) / withF.length;
  const items = [];
  for (const [id, test, label] of FEATS) {
    const yes = withF.filter((r) => { try { return test(r.feats); } catch { return false; } });
    if (yes.length < 3 || yes.length > withF.length - 3) continue;
    const m = yes.reduce((a, r) => a + r.score, 0) / yes.length;
    items.push({ id, label, n: yes.length, avg: Math.round(m), diff: Math.round(m - avg), grade: gradeOf(m), examples: yes.sort((a, b) => b.score - a.score).slice(0, 3).map((r) => r.id) });
  }
  items.sort((a, b) => b.diff - a.diff);
  return { n: withF.length, avg: Math.round(avg), items };
}

export async function thumbsData(db) {
  const [vq, tq, fq, kq] = await db.batch([
    db.prepare(`SELECT id, title, published, member, wt, views, duration_s, thumb_hi, thumb FROM videos WHERE is_short = 0 AND removed_at IS NULL
      AND COALESCE(live_override, is_live, 0) = 0 AND COALESCE(members_override, is_members, 0) = 0`),
    db.prepare("SELECT * FROM thumb_data"),
    db.prepare("SELECT video_id, feats, descr FROM thumb_vision"),
    db.prepare("SELECT key, value FROM kv WHERE key IN ('thumb_import','thumb_inspo','thumb_enrich_at')"),
  ]);
  const K = Object.fromEntries(kq.results.map((r) => [r.key, r.value]));
  const T = new Map(tq.results.map((r) => [r.video_id, r]));
  const F = new Map(fq.results.map((r) => { let f = null; try { f = JSON.parse(r.feats); } catch {} return [r.video_id, { f, d: r.descr }]; }));
  const pool = [];
  for (const v of vq.results) {
    const t = T.get(v.id);
    if (!t || t.ctr == null) continue;
    const imp = t.impressions || (t.views && t.ctr > 0 ? Math.round(t.views / t.ctr) : 0); // brak kolumny „wyświetlenia miniatury” → szacunek z wyświetleń i CTR
    if (imp < MIN_IMP) continue;
    pool.push({ id: v.id, title: v.title, published: v.published, member: v.member, wt: v.wt, thumb: v.thumb_hi || v.thumb || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      ctr: t.ctr, imp, impEst: !t.impressions, views: t.views || v.views, avp: t.avp, avd: t.avd, feats: F.get(v.id)?.f || null, descr: F.get(v.id)?.d || "" });
  }
  const scored = scorePool(pool).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const out = scored.map(({ feats, ...r }) => ({ ...r, ctr: Math.round(r.ctr * 10000) / 100, avp: r.avp == null ? null : Math.round(r.avp * 10) / 10, hasVision: !!feats }));
  let imp = null, inspo = null;
  try { imp = K.thumb_import ? JSON.parse(K.thumb_import) : null; } catch {}
  try { inspo = K.thumb_inspo ? JSON.parse(K.thumb_inspo) : null; } catch {}
  if (inspo && inspo.items) for (const x of inspo.items) { const f = F.get(x.id); if (f) x.descr = f.d; }
  return { import: imp, videos: out, insights: insights(scored), inspo, enrichAt: K.thumb_enrich_at || null, vision: { done: F.size, of: pool.length } };
}

// import z „Table data.csv”: wiersze {id, ctr (0–100), impressions?, views?, avd? (s), avp? (%)} – jedno zapytanie (limit D1)
export function importStmts(db, rows, meta, nowIso) {
  const clean = rows.filter((r) => /^[A-Za-z0-9_-]{11}$/.test(r.id) && r.ctr >= 0).map((r) => [r.id, r.ctr > 1 ? r.ctr / 100 : r.ctr, r.impressions || null, r.views || null, r.avd || null, r.avp || null]);
  const J = JSON.stringify(clean);
  return { n: clean.length, st: [
    db.prepare(`INSERT INTO thumb_data (video_id, ctr, impressions, views, avd, avp, imported_at)
      SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'), ? FROM json_each(?) WHERE true
      ON CONFLICT(video_id) DO UPDATE SET ctr=excluded.ctr, impressions=COALESCE(excluded.impressions, thumb_data.impressions), views=COALESCE(excluded.views, thumb_data.views),
        avd=COALESCE(excluded.avd, thumb_data.avd), avp=COALESCE(excluded.avp, thumb_data.avp), imported_at=excluded.imported_at`).bind(nowIso, J),
    // Grafik w Ocenach korzysta z tej tabeli
    db.prepare(`INSERT OR REPLACE INTO ctr_import (video_id, ctr, impressions, imported_at) SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), COALESCE(json_extract(value,'$[2]'),0), ? FROM json_each(?)`).bind(nowIso, J),
    kvPut(db, "thumb_import", { at: nowIso, n: clean.length, ...meta }),
    db.prepare("DELETE FROM kv WHERE key IN ('cache_thumbs','cache_grades','thumb_enrich_at')"),
  ] };
}

// raz w tygodniu (i zaraz po imporcie): średni % obejrzenia + średni czas oglądania z Analytics, od początku filmu
export async function enrichThumbData(db, g, now, budget = 3) {
  const at = Number(await kv(db, "thumb_enrich_at")) || 0;
  if (now - at < 7 * DAYMS || budget < 1) return { skipped: true };
  const { results } = await db.prepare("SELECT video_id FROM thumb_data").all();
  const ids = results.map((r) => r.video_id);
  if (!ids.length) return { skipped: true };
  const rows = [];
  for (let i = 0; i < ids.length && i / 150 < budget; i += 150) {
    const r = await g(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&dimensions=video&metrics=averageViewPercentage,averageViewDuration&maxResults=200&filters=video==${ids.slice(i, i + 150).join(",")}&startDate=2010-01-01&endDate=${new Date(now).toISOString().slice(0, 10)}&sort=-averageViewDuration`);
    rows.push(...(r.rows || []));
  }
  await db.batch([
    db.prepare("UPDATE thumb_data SET avp = json_extract(j.value,'$[1]'), avd = json_extract(j.value,'$[2]') FROM json_each(?) AS j WHERE thumb_data.video_id = json_extract(j.value,'$[0]')").bind(JSON.stringify(rows)),
    kvPut(db, "thumb_enrich_at", String(now)), db.prepare("DELETE FROM kv WHERE key='cache_thumbs'"),
  ]);
  return { rows: rows.length };
}

// AI ogląda miniatury (Workers AI, model z obrazem): cechy + jedno zdanie opisu. Po kilka na odświeżenie.
const VISION = "@cf/meta/llama-3.2-11b-vision-instruct";
const VPROMPT = `Opisz miniaturę z YouTube (kanał gamingowy, głównie War Thunder – czołgi, samoloty). Zwróć WYŁĄCZNIE obiekt JSON:
{"vehicle": true/false (czołg, samolot, okręt lub inny pojazd jest głównym motywem),
 "faces": liczba ludzkich twarzy lub postaci z widoczną emocją,
 "objects": liczba wyraźnych głównych elementów,
 "text_words": liczba słów napisu na miniaturze (0, jeśli brak),
 "contrast": "wysoki" | "średni" | "niski",
 "background": "czyste" | "zatłoczone",
 "arrows": true/false (strzałki, kółka, podkreślenia),
 "action": true/false (wybuch, ogień, strzał, dym),
 "palette": [2–3 dominujące kolory po polsku],
 "style": "realistyczny" | "komiksowy" | "render 3D" | "zrzut z gry" | "inny",
 "descr": "jedno zdanie po polsku: co jest na miniaturze i jak jest skomponowana"}`;
export async function visionThumbs(env, db, now, fetcher, budget = 3) {
  if (!env.AI || budget < 1) return { skipped: true };
  const { results } = await db.prepare(`SELECT t.video_id AS id FROM thumb_data t LEFT JOIN thumb_vision v ON v.video_id = t.video_id WHERE v.video_id IS NULL
    UNION SELECT value AS id FROM json_each((SELECT value FROM kv WHERE key='thumb_inspo_ids')) WHERE value NOT IN (SELECT video_id FROM thumb_vision) LIMIT ?`).bind(budget).all();
  if (!results.length) return { done: 0 };
  if (!(await kv(db, "vision_agreed"))) { try { await env.AI.run(VISION, { prompt: "agree" }); } catch {} await db.batch([kvPut(db, "vision_agreed", "1")]); }
  const st = [];
  for (const { id } of results) {
    try {
      const img = new Uint8Array(await (await fetcher(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`)).arrayBuffer());
      const r = await env.AI.run(VISION, { messages: [{ role: "user", content: VPROMPT }], image: [...img], max_tokens: 400, temperature: 0.1 });
      const txt = String(r?.response ?? r?.description ?? "");
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      const j = a >= 0 && b > a ? JSON.parse(txt.slice(a, b + 1)) : null;
      st.push(db.prepare("INSERT OR REPLACE INTO thumb_vision (video_id, feats, descr, at) VALUES (?,?,?,?)").bind(id, j ? JSON.stringify(j) : null, j ? String(j.descr || "").slice(0, 300) : "", new Date(now).toISOString()));
    } catch (e) {
      st.push(db.prepare("INSERT OR REPLACE INTO thumb_vision (video_id, feats, descr, at) VALUES (?,?,?,?)").bind(id, null, "", new Date(now).toISOString()));
    }
  }
  st.push(db.prepare("DELETE FROM kv WHERE key='cache_thumbs'"));
  await db.batch(st);
  return { done: results.length };
}

// Inspiracje (raz w tygodniu): miniatury, które wystrzeliły ponad swój kanał – WT świat, WT Polska, gaming PL.
// Miara: wyświetlenia ÷ subskrypcje kanału (im więcej, tym bardziej miniatura i temat przyciągnęły ludzi spoza subów).
export async function syncInspo(db, g, now, budget = 6) {
  const at = Number(await kv(db, "thumb_inspo_at")) || 0;
  if (now - at < 7 * DAYMS || budget < 8) return { skipped: true };
  const after = new Date(now - 30 * DAYMS).toISOString();
  const queries = [["WT – świat", `q=${encodeURIComponent("War Thunder")}&relevanceLanguage=en`], ["WT – Polska", `q=${encodeURIComponent("War Thunder")}&regionCode=PL&relevanceLanguage=pl`], ["Gaming PL", `videoCategoryId=20&regionCode=PL&relevanceLanguage=pl`]];
  const items = [];
  for (const [group, q] of queries) {
    const s = await g(`${YT}/search?part=id&type=video&maxResults=25&order=viewCount&publishedAfter=${after}&${q}`);
    const ids = (s.items || []).map((x) => x.id.videoId).filter(Boolean);
    if (!ids.length) continue;
    const v = await g(`${YT}/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`);
    for (const x of v.items || []) {
      const d = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(x.contentDetails.duration || "") || [];
      if ((+d[1] || 0) * 3600 + (+d[2] || 0) * 60 + (+d[3] || 0) <= 120 || x.snippet.channelId === OWN) continue;
      items.push({ group, id: x.id, title: x.snippet.title, channel: x.snippet.channelTitle, channelId: x.snippet.channelId, views: Number(x.statistics.viewCount || 0), thumb: `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg` });
    }
  }
  const chIds = [...new Set(items.map((x) => x.channelId))];
  const subs = new Map();
  for (let i = 0; i < chIds.length; i += 50) {
    const c = await g(`${YT}/channels?part=statistics&id=${chIds.slice(i, i + 50).join(",")}`);
    for (const x of c.items || []) subs.set(x.id, Number(x.statistics.subscriberCount || 0));
  }
  const top = [];
  for (const group of queries.map((q) => q[0])) {
    const list = items.filter((x) => x.group === group).map((x) => ({ ...x, subs: subs.get(x.channelId) || 0, ratio: Math.round((x.views / Math.max(1000, subs.get(x.channelId) || 0)) * 10) / 10 }))
      .filter((x) => x.views >= 5000).sort((a, b) => b.ratio - a.ratio);
    const seen = new Set();
    for (const x of list) { if (seen.has(x.channelId)) continue; seen.add(x.channelId); top.push(x); if (seen.size >= 6) break; }
  }
  await db.batch([kvPut(db, "thumb_inspo", { at: new Date(now).toISOString(), items: top }), kvPut(db, "thumb_inspo_ids", top.map((x) => x.id)), kvPut(db, "thumb_inspo_at", String(now)), db.prepare("DELETE FROM kv WHERE key='cache_thumbs'")]);
  return { items: top.length };
}
