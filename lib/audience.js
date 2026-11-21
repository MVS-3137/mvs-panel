// Panel MVS — szacunek widowni: ile procent to widzowie „War Thunderowi”, a ile z innych gier. Raz w tygodniu.
// To przybliżenie oparte na wyświetleniach i subskrypcjach (YouTube nie podaje unikalnych widzów przez API).
//
// Trzy wskaźniki (każdy daje udział widowni WT, 0–1):
//   A. subskrybenci (waga 60%): udział subów zdobytych na filmach WT – cała historia kanału
//   B. kto ogląda (waga 25%): ostatnie 90 dni; widownia WT = wyświetlenia filmów WT + wyświetlenia filmów z innych gier
//      od osób z subem (to wasi ludzie, którzy poszli za wami); reszta = nowi widzowie z innych gier
//   C. wyświetlenia (waga 15%): udział filmów WT w wyświetleniach kanału z ostatnich 90 dni
// Wynik = 0,60·A + 0,25·B + 0,15·C. Brakujący wskaźnik = jego waga rozkłada się na pozostałe.
const DAYMS = 864e5;
export const AUD_WEIGHTS = { subs: 0.6, cross: 0.25, views: 0.15 };
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const RPT = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE";
const kvPut = (db, k, v) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, typeof v === "string" ? v : JSON.stringify(v));
async function kv(db, k) { const r = await db.prepare("SELECT value FROM kv WHERE key=?").bind(k).first(); return r ? r.value : null; }

export async function syncAudience(db, g, now, budget = 6) {
  if (budget < 3) return { skipped: true };
  const last = Number(await kv(db, "audience_at")) || 0;
  let job = JSON.parse((await kv(db, "aud_job")) || "null");
  if (!job && now - last < 7 * DAYMS) return { skipped: true };
  let calls = 0;
  const call = (u) => { calls++; return g(u); };
  const today = isoDate(now), from90 = isoDate(now - 90 * DAYMS);
  const EX = "removed_at IS NULL AND COALESCE(live_override, is_live, 0) = 0 AND COALESCE(members_override, is_members, 0) = 0";
  const { results: vids } = await db.prepare(`SELECT id, wt, is_short, published FROM videos WHERE ${EX}`).all();
  const V = new Map(vids.map((v) => [v.id, v]));
  const isWT = (id) => (V.get(id) || {}).wt ? 1 : 0;

  if (!job) {
    // 1 zapytanie: suby z całej historii wg filmu; 1 zapytanie: ostatnie 90 dni (wyświetlenia + suby) wg filmu
    const life = await call(`${RPT}&dimensions=video&metrics=subscribersGained&sort=-subscribersGained&maxResults=200&startDate=2010-01-01&endDate=${today}`);
    const d90 = await call(`${RPT}&dimensions=video&metrics=views,subscribersGained&sort=-views&maxResults=200&startDate=${from90}&endDate=${today}`);
    const sum = (rows, col, wt) => (rows || []).filter((r) => V.has(r[0]) && isWT(r[0]) === wt).reduce((a, r) => a + (r[col] || 0), 0);
    const subsLifeWT = sum(life.rows, 1, 1), subsLifeOT = sum(life.rows, 1, 0);
    const views90WT = sum(d90.rows, 1, 1), views90OT = sum(d90.rows, 1, 0);
    const subs90WT = sum(d90.rows, 2, 1), subs90OT = sum(d90.rows, 2, 0);
    // filmy z innych gier z wyświetleniami w ostatnich 90 dniach: dla każdego podział z subem / bez suba (po kilka na odświeżenie)
    const other = (d90.rows || []).filter((r) => V.has(r[0]) && !isWT(r[0]) && r[1] >= 50).slice(0, 30).map((r) => r[0]);
    job = { started: now, subsLifeWT, subsLifeOT, views90WT, views90OT, subs90WT, subs90OT, todo: other, sub: 0, non: 0 };
  }
  while (job.todo.length && budget - calls >= 1) {
    const id = job.todo.shift();
    try {
      const r = await call(`${RPT}&dimensions=subscribedStatus&metrics=views&filters=video==${id}&startDate=${from90}&endDate=${today}`);
      for (const [st, v] of r.rows || []) { if (st === "SUBSCRIBED") job.sub += v; else job.non += v; }
    } catch {}
  }
  if (job.todo.length) { await db.batch([kvPut(db, "aud_job", job)]); return { calls, pending: job.todo.length }; }

  // wynik
  const share = (a, b) => (a + b > 0 ? a / (a + b) : null);
  const sLife = share(job.subsLifeWT, job.subsLifeOT), s90 = share(job.subs90WT, job.subs90OT);
  const A = sLife; // suby: cała historia kanału (100%)
  const otTotal = job.sub + job.non;
  const subPartOT = otTotal > 0 ? job.sub / otTotal : null;
  const B = subPartOT == null ? null : share(job.views90WT + job.views90OT * subPartOT, job.views90OT * (1 - subPartOT));
  const C = share(job.views90WT, job.views90OT);
  const parts = { subs: A, cross: B, views: C };
  let s = 0, w = 0;
  for (const k in AUD_WEIGHTS) if (parts[k] != null) { s += parts[k] * AUD_WEIGHTS[k]; w += AUD_WEIGHTS[k]; }
  const wt = w ? s / w : null;
  const r1 = (x) => (x == null ? null : Math.round(x * 1000) / 10);
  const prev = JSON.parse((await kv(db, "audience")) || "null");
  const out = {
    at: new Date(now).toISOString(), wt: r1(wt), other: wt == null ? null : Math.round((1 - wt) * 1000) / 10,
    prevWt: prev ? prev.wt : null, prevAt: prev ? prev.at : null,
    parts: { subs: r1(A), subsLife: r1(sLife), subs90: r1(s90), cross: r1(B), followers: r1(subPartOT), views: r1(C) },
  };
  // historia tygodniowa (do wykresu w przyszłości), max 104 tygodnie
  const hist = JSON.parse((await kv(db, "audience_hist")) || "[]");
  hist.push({ d: out.at.slice(0, 10), wt: out.wt });
  await db.batch([kvPut(db, "audience", out), kvPut(db, "audience_hist", hist.slice(-104)), kvPut(db, "audience_at", String(now)), db.prepare("DELETE FROM kv WHERE key='aud_job'")]);
  return { calls, done: true, wt: out.wt };
}
