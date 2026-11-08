// Panel MVS — kiedy wrzucać: najlepsze dni tygodnia i godzina premiery (liczone raz dziennie).
// Dni: dzienne wyświetlenia kanału z ostatnich 365 dni (YouTube Analytics). Każdy dzień dzielimy przez średnią
// z otaczających go 7 dni (usuwa wzrost kanału i pojedyncze hity), potem bierzemy medianę dla każdego dnia tygodnia.
// Godzina: wasze długie filmy z ostatniego roku – wyświetlenia po 7 dniach względem mediany kategorii (WT / inne),
// pogrupowane wg godziny premiery (okna 2-godzinne, min. 3 filmy w oknie).
import { curveAt } from "./yt.js";

const DAYMS = 864e5;
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const warsawHour = (ms) => {
  try { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms))); }
  catch { return new Date(ms + 3600e3).getUTCHours(); }
};

export function weekdayFactors(rows) {
  // rows: [["YYYY-MM-DD", views], ...] posortowane
  const v = rows.map((r) => Number(r[1]) || 0);
  const by = [[], [], [], [], [], [], []];
  for (let i = 3; i < v.length - 3; i++) {
    const win = v.slice(i - 3, i + 4), mean = win.reduce((a, b) => a + b, 0) / 7;
    if (mean < 20) continue; // za mało ruchu, szum
    by[new Date(rows[i][0] + "T12:00:00Z").getUTCDay()].push(v[i] / mean);
  }
  const m = by.map(med);
  if (m.some((x) => x == null)) return null;
  const avg = m.reduce((a, b) => a + b, 0) / 7;
  return { f: m.map((x) => Math.round((x / avg) * 1000) / 1000), n: by.map((a) => a.length) };
}

export function bestHour(videos, now) {
  const year = videos.filter((v) => !v.is_short && Date.parse(v.published) > now - 365 * DAYMS && Date.parse(v.published) < now - 8 * DAYMS);
  const pts = year.map((v) => ({ v, x: curveAt(typeof v.curve === "string" ? JSON.parse(v.curve) : v.curve, 168) })).filter((p) => p.x > 0);
  const medCat = {};
  for (const c of [0, 1]) medCat[c] = med(pts.filter((p) => (p.v.wt ? 1 : 0) === c).map((p) => p.x));
  const buckets = new Map();
  for (const p of pts) {
    const base = medCat[p.v.wt ? 1 : 0]; if (!base) continue;
    const h = warsawHour(Date.parse(p.v.published)), b = Math.floor(h / 2) * 2;
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(p.x / base);
  }
  const list = [...buckets.entries()].map(([b, r]) => ({ from: b, n: r.length, ratio: Math.round(med(r) * 100) / 100 })).sort((a, b) => a.from - b.from);
  const ok = list.filter((b) => b.n >= 3);
  let best = ok.sort((a, b) => b.ratio - a.ratio)[0] || null;
  if (!best && list.length) best = [...list].sort((a, b) => b.n - a.n)[0]; // za mało danych: najczęstsza pora
  return { hour: best ? best.from : 17, ratio: best ? best.ratio : null, n: best ? best.n : 0, buckets: list, videos: pts.length };
}

export async function syncBestTimes(db, gfetch, now, videos) {
  const day = isoDate(now);
  const k = await db.prepare("SELECT value FROM kv WHERE key='times_day'").first();
  if (k && k.value === day) return { skipped: true };
  const end = now - 3 * DAYMS; // Analytics ma ~3 dni opóźnienia
  const r = await gfetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&dimensions=day&metrics=views&sort=day&startDate=${isoDate(end - 365 * DAYMS)}&endDate=${isoDate(end)}`);
  const out = { at: new Date(now).toISOString(), days: weekdayFactors(r.rows || []), hour: bestHour(videos, now) };
  await db.batch([
    db.prepare("INSERT INTO kv (key, value) VALUES ('best_times', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(out)),
    db.prepare("INSERT INTO kv (key, value) VALUES ('times_day', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(day),
  ]);
  return out;
}
