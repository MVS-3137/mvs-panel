// Panel MVS — Oceny: tytuły twórców + mocne strony / obszary do poprawy.
// Dane: filmy z panelu (autor z Performance), YouTube Analytics (90 dni), CTR, plan nagrywek, kliknięcia w panelu.
import { curveAt } from "./yt.js";

const DAYMS = 864e5;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const MEMBERS = ["Malvel", "Virtuoso", "Saito"];
const WIN = 90;            // okno „formy” w dniach
const WIN_LONG = 180;      // okno dla liczenia filmów (poradniki, długość itd.)
const TUTORIAL_RE = /poradnik|tutorial|jak\s|porad|musisz\s+(wiedzie|zna)|omówienie|omowienie|jaką\s+nację|wszystko\s+o|triki|tipy|guide|droga\s+do/i;

// kind: good = pozytywny, fun = żartobliwy/ostrzegawczy
export const TAGS = [
  { id: "szef", name: "SZEF", kind: "good", desc: "Jego filmy przyniosły kanałowi najwięcej wyświetleń w ostatnich 90 dniach." },
  { id: "montazysta", name: "Montażysta", kind: "good", desc: "Jego filmy najdłużej utrzymują uwagę widzów (średni % obejrzenia, ostatnie 90 dni)." },
  { id: "nauczyciel", name: "Nauczyciel", kind: "good", desc: "Zrobił najwięcej poradników w ostatnich 180 dniach." },
  { id: "ulubieniec", name: "Ulubieniec widzów", kind: "good", desc: "Jego filmy przyniosły kanałowi najwięcej subskrypcji w ostatnich 90 dniach." },
  { id: "obibok", name: "Obibok", kind: "fun", desc: "Nie dodał filmu od ponad 20 dni." },
  { id: "enjoyer", name: "MVS Panel Enjoyer", kind: "good", desc: "Najwięcej klika w panelu (ostatnie 30 dni)." },
  { id: "streamer", name: "Streamer", kind: "good", desc: "Najwięcej streamów w ostatnim miesiącu." },
  { id: "spoleczniak", name: "Społeczniak", kind: "good", desc: "Pod jego filmami jest najwięcej komentarzy (średnio na film, ostatnie 180 dni)." },
  { id: "wedkarz", name: "Wędkarz", kind: "good", desc: "Jego filmy mają najlepszy hook: najwięcej widzów zostaje po pierwszych 30 sekundach." },
  { id: "etat", name: "YouTube na pełny etat", kind: "good", desc: "W ciągu ostatnich 30 dni wstawił wyraźnie więcej filmów niż pozostała dwójka." },
  { id: "kiedys", name: "Kiedyś mi się uda...", kind: "fun", desc: "Żaden z jego filmów nie jest (jeszcze) rekordem kanału." },
  { id: "rekordzista", name: "Rekordzista", kind: "good", desc: "Ma najwięcej rekordów kanału (24 h / 7 / 14 / 28 dni, War Thunder i inne gry)." },
  // dodatkowe
  { id: "snajper", name: "Snajper", kind: "good", desc: "Jego miniatury i tytuły trafiają najcelniej: najwyższy CTR." },
  { id: "speedrunner", name: "Speedrunner", kind: "good", desc: "Najszybciej przechodzi od startu w planie nagrywek do premiery (średnio, ostatnie 180 dni)." },
  { id: "maratonczyk", name: "Maratończyk", kind: "good", desc: "Robi najdłuższe filmy (średnia długość, ostatnie 180 dni)." },
  { id: "pewniak", name: "Pewniak", kind: "good", desc: "Największa część jego filmów przebija typowy wynik kanału po 7 dniach." },
  { id: "jednostrzal", name: "One Shot, One Kill", kind: "good", desc: "Ma najlepszy pojedynczy film ostatnich 90 dni (wynik po 7 dniach)." },
  { id: "wanderer", name: "Turysta", kind: "good", desc: "Najczęściej wychodzi poza War Thunder: najwięcej filmów z innych gier w ostatnich 180 dniach." },
];
const TAG = Object.fromEntries(TAGS.map((t) => [t.id, t]));
const MANUAL_TAGS = ["montazysta", "streamer"]; // Saito może ustawić ręcznie (inni tego nie widzą)

/* ---------- codzienne dane z YouTube Analytics ---------- */
export async function syncGradeStats(db, gfetch, now, budget = 5) {
  const day = isoDate(now);
  const k = await db.prepare("SELECT value FROM kv WHERE key='grade_day'").first();
  if (k && k.value === day) return { skipped: true };
  const base = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE";
  const r = await gfetch(`${base}&dimensions=video&metrics=views,subscribersGained,averageViewPercentage&sort=-views&maxResults=200&startDate=${isoDate(now - WIN * DAYMS)}&endDate=${day}`);
  const st = [db.prepare("UPDATE grade_stats SET views90=0, subs90=0, avp90=NULL")];
  for (const [id, views, subs, avp] of r.rows || []) {
    st.push(db.prepare("INSERT INTO grade_stats (video_id, views90, subs90, avp90) VALUES (?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET views90=excluded.views90, subs90=excluded.subs90, avp90=excluded.avp90")
      .bind(id, views, subs, avp));
  }
  // hook: % widzów po 30 sekundach (krzywa utrzymania), raz na film, najnowsze najpierw
  const { results: todo } = await db.prepare(`SELECT v.id, v.duration_s FROM videos v LEFT JOIN grade_stats g ON g.video_id = v.id
    WHERE v.is_short = 0 AND v.removed_at IS NULL AND COALESCE(v.live_override, v.is_live, 0) = 0 AND COALESCE(v.members_override, v.is_members, 0) = 0
      AND v.duration_s >= 120 AND v.published <= ? AND v.published >= ? AND g.hook_at IS NULL ORDER BY v.published DESC LIMIT ?`)
    .bind(new Date(now - 7 * DAYMS).toISOString(), new Date(now - 365 * DAYMS).toISOString(), Math.max(0, budget - 1)).all();
  for (const v of todo) {
    try {
      const c = await gfetch(`${base}&dimensions=elapsedVideoTimeRatio&metrics=audienceWatchRatio&filters=video==${v.id}&startDate=2005-01-01&endDate=${day}`);
      const pts = (c.rows || []).map(([x, y]) => [Number(x), Number(y)]).sort((a, b) => a[0] - b[0]);
      const target = 30 / v.duration_s;
      let hook = null;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i][0] >= target) {
          const [x1, y1] = pts[i], [x0, y0] = i ? pts[i - 1] : [0, 1];
          hook = Math.min(1, y0 + ((y1 - y0) * (target - x0)) / Math.max(1e-9, x1 - x0));
          break;
        }
      }
      st.push(db.prepare("INSERT INTO grade_stats (video_id, hook30, hook_at) VALUES (?,?,?) ON CONFLICT(video_id) DO UPDATE SET hook30=excluded.hook30, hook_at=excluded.hook_at").bind(v.id, hook, day));
    } catch { st.push(db.prepare("INSERT INTO grade_stats (video_id, hook_at) VALUES (?,?) ON CONFLICT(video_id) DO UPDATE SET hook_at=excluded.hook_at").bind(v.id, day)); }
  }
  st.push(db.prepare("INSERT INTO kv (key, value) VALUES ('grade_day', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(day));
  await db.batch(st);
  return { videos: (r.rows || []).length, hooks: todo.length };
}

/* ---------- liczenie ocen ---------- */
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pct = (x) => (x * 100).toFixed(1).replace(".", ",") + "%";
const nfm = (n) => Math.round(n).toLocaleString("pl-PL");

export async function computeGrades(db, now = Date.now()) {
  const [vq, gq, kq, pq, cq, ctq, rq] = await db.batch([
    db.prepare(`SELECT id, title, published, duration_s, views, likes, comments, member, wt, is_short, curve,
      COALESCE(live_override, is_live, 0) AS live, COALESCE(members_override, is_members, 0) AS mem FROM videos WHERE removed_at IS NULL`),
    db.prepare("SELECT * FROM grade_stats"),
    db.prepare("SELECT key, value FROM kv WHERE key IN ('records','grade_manual')"),
    db.prepare("SELECT member, start, uploaded, status FROM projects WHERE status='done' AND uploaded IS NOT NULL"),
    db.prepare("SELECT member, SUM(n) AS n FROM clicks WHERE day >= ? GROUP BY member").bind(isoDate(now - 30 * DAYMS)),
    db.prepare("SELECT video_id, ctr FROM ctr_import"),
    db.prepare("SELECT video_id, SUM(impressions) AS imp, SUM(impressions * ctr) AS clk FROM reach GROUP BY video_id"),
  ]);
  const K = Object.fromEntries(kq.results.map((r) => [r.key, r.value]));
  const G = new Map(gq.results.map((g) => [g.video_id, g]));
  const CTR = new Map(ctq.results.map((r) => [r.video_id, r.ctr]));
  for (const r of rq.results) if (!CTR.has(r.video_id) && r.imp >= 500) CTR.set(r.video_id, r.clk / r.imp);
  const manual = JSON.parse(K.grade_manual || "{}");
  const records = JSON.parse(K.records || "{}");
  const ageD = (v) => (now - Date.parse(v.published)) / DAYMS;

  const all = vq.results.map((v) => ({ ...v, curve: v.curve ? JSON.parse(v.curve) : null }));
  const longs = all.filter((v) => !v.is_short && !v.live && !v.mem);
  const at7 = (v) => (ageD(v) >= 7 ? (v.curve ? curveAt(v.curve, 168) : null) ?? v.views : null);
  // typowy wynik kanału po 7 dniach (mediana 20 ostatnich długich filmów)
  const typical = median(longs.filter((v) => ageD(v) >= 7).sort((a, b) => (a.published < b.published ? 1 : -1)).slice(0, 20).map(at7).filter((x) => x != null)) || 1;

  const M = {};
  for (const m of MEMBERS) {
    const mine = longs.filter((v) => v.member === m);
    const in90 = mine.filter((v) => ageD(v) <= WIN), in180 = mine.filter((v) => ageD(v) <= WIN_LONG);
    const withG = mine.map((v) => ({ v, g: G.get(v.id) })).filter((x) => x.g);
    const viewsSum = withG.reduce((s, x) => s + (x.g.views90 || 0), 0);
    const retW = withG.filter((x) => x.g.avp90 != null && x.g.views90 >= 50);
    const retention = retW.length ? retW.reduce((s, x) => s + x.g.avp90 * x.g.views90, 0) / Math.max(1, retW.reduce((s, x) => s + x.g.views90, 0)) : null;
    const hooks = mine.filter((v) => ageD(v) <= 365).map((v) => G.get(v.id)?.hook30).filter((x) => x != null);
    const scores = in180.map((v) => { const x = at7(v); return x == null ? null : x / typical; }).filter((x) => x != null);
    const ctrs = mine.filter((v) => ageD(v) <= 365).map((v) => CTR.get(v.id)).filter((x) => x != null);
    const lastUp = mine.length ? Math.min(...mine.map(ageD)) : Infinity;
    const recs = Object.values(records).filter((r) => r && mine.some((v) => v.id === r.id)).length;
    const prod = pq.results.filter((p) => p.member === m && (now - Date.parse(p.uploaded)) / DAYMS <= WIN_LONG).map((p) => (Date.parse(p.uploaded) - Date.parse(p.start)) / DAYMS);
    const best = in90.map((v) => ({ v, s: at7(v) })).filter((x) => x.s != null).sort((a, b) => b.s - a.s)[0];
    const wtS = in180.filter((v) => v.wt).map(at7).filter((x) => x != null), otS = in180.filter((v) => !v.wt).map(at7).filter((x) => x != null);
    const views180 = in180.reduce((s, v) => s + v.views, 0);
    M[m] = {
      films: mine.length, films90: in90.length, films180: in180.length,
      uploads30: mine.filter((v) => ageD(v) <= 30).length,
      views90: viewsSum, subs90: withG.reduce((s, x) => s + (x.g.subs90 || 0), 0),
      retention: retention, hook: hooks.length >= 2 ? avg(hooks) : null,
      tutorials: in180.filter((v) => TUTORIAL_RE.test(v.title)).length,
      comments: in180.length >= 2 ? avg(in180.map((v) => v.comments || 0)) : null,
      commentsPer1k: views180 > 0 ? (in180.reduce((s, v) => s + (v.comments || 0), 0) / views180) * 1000 : null,
      likesPer1k: views180 > 0 ? (in180.reduce((s, v) => s + (v.likes || 0), 0) / views180) * 1000 : null,
      subsPer1k: viewsSum > 0 ? ((withG.reduce((s, x) => s + (x.g.subs90 || 0), 0)) / viewsSum) * 1000 : null,
      ctr: ctrs.length >= 2 ? avg(ctrs) : null,
      score: scores.length >= 2 ? median(scores) : null,
      share: scores.length >= 3 ? scores.filter((x) => x >= 1).length / scores.length : null,
      lastUp, records: recs, clicks: (cq.results.find((c) => c.member === m) || {}).n || 0,
      speed: prod.length >= 2 ? avg(prod) : null,
      length: in180.length >= 2 ? avg(in180.map((v) => v.duration_s / 60)) : null,
      best: best ? { id: best.v.id, title: best.v.title, s: best.s } : null,
      other180: in180.filter((v) => !v.wt).length,
      wtScore: wtS.length >= 2 ? median(wtS) / typical : null, otScore: otS.length >= 2 ? median(otS) / typical : null,
    };
  }

  // przyznawanie tytułów
  const tags = Object.fromEntries(MEMBERS.map((m) => [m, []]));
  const hints = {};
  const award = (id, key, { min = 0, low = false } = {}) => {
    const vals = MEMBERS.map((m) => [m, M[m][key]]).filter(([, v]) => v != null && v > min);
    if (!vals.length) return null;
    const best = low ? Math.min(...vals.map((x) => x[1])) : Math.max(...vals.map((x) => x[1]));
    const winners = vals.filter(([, v]) => v === best).map(([m]) => m);
    if (winners.length === MEMBERS.length && MEMBERS.length > 1) return null; // remis wszystkich = brak tytułu
    return winners;
  };
  const give = (id, winners) => { for (const m of winners || []) tags[m].push(id); };
  give("szef", award("szef", "views90"));
  const autoMont = award("montazysta", "retention");
  hints.montazysta = autoMont ? `${autoMont.join(", ")} (${MEMBERS.filter((m) => M[m].retention != null).map((m) => `${m}: ${pct(M[m].retention / 100)}`).join(", ")})` : "za mało danych";
  give("montazysta", manual.montazysta === undefined || manual.montazysta === "auto" ? autoMont : manual.montazysta ? [manual.montazysta] : []);
  give("nauczyciel", award("nauczyciel", "tutorials"));
  give("ulubieniec", award("ulubieniec", "subs90"));
  for (const m of MEMBERS) if (M[m].lastUp > 20) tags[m].push("obibok");
  give("enjoyer", award("enjoyer", "clicks", { min: 20 }));
  if (manual.streamer && MEMBERS.includes(manual.streamer)) tags[manual.streamer].push("streamer");
  give("spoleczniak", award("spoleczniak", "comments"));
  give("wedkarz", award("wedkarz", "hook"));
  for (const m of MEMBERS) {
    const others = MEMBERS.filter((o) => o !== m).map((o) => M[o].uploads30);
    if (M[m].uploads30 >= 3 && M[m].uploads30 >= Math.max(...others) + 2) tags[m].push("etat");
  }
  const anyRecords = MEMBERS.some((m) => M[m].records > 0);
  for (const m of MEMBERS) if (anyRecords && M[m].records === 0 && M[m].films > 0) tags[m].push("kiedys");
  give("rekordzista", award("rekordzista", "records"));
  give("snajper", award("snajper", "ctr"));
  give("speedrunner", award("speedrunner", "speed", { low: true, min: -1 }));
  give("maratonczyk", award("maratonczyk", "length"));
  give("pewniak", award("pewniak", "share"));
  const bestS = MEMBERS.map((m) => [m, M[m].best?.s]).filter(([, s]) => s != null);
  if (bestS.length) { const top = Math.max(...bestS.map((x) => x[1])); give("jednostrzal", bestS.filter(([, s]) => s === top).map(([m]) => m)); }
  give("wanderer", award("wanderer", "other180"));

  // mocne strony / do poprawki – zawsze względem średniej kanału, bez porównań między osobami
  const chan = (key) => avg(MEMBERS.map((m) => M[m][key]).filter((x) => x != null));
  const C = { score: 1, ctr: chan("ctr"), retention: chan("retention"), hook: chan("hook"), subsPer1k: chan("subsPer1k"), commentsPer1k: chan("commentsPer1k"), likesPer1k: chan("likesPer1k") };
  const cadence = Number((await db.prepare("SELECT value FROM settings WHERE key='cadence'").first())?.value || 5);
  const expected30 = 30 / (cadence * MEMBERS.length);

  const people = MEMBERS.map((m) => {
    const x = M[m], plus = [], minus = [];
    const cmp = (val, base, good, bad, fmtV) => {
      if (val == null || base == null || !base) return;
      const r = val / base;
      if (r >= 1.1) plus.push({ r, t: good(fmtV(val), fmtV(base)) });
      else if (r <= 0.9) minus.push({ r, t: bad(fmtV(val), fmtV(base)) });
    };
    cmp(x.score, 1, (a) => `Filmy osiągają średnio ${a} typowego wyniku kanału po 7 dniach.`, (a) => `Filmy osiągają ok. ${a} typowego wyniku kanału po 7 dniach. Warto sprawdzić, które tematy niosą najwięcej wyświetleń.`, (v) => Math.round(v * 100) + "%");
    cmp(x.ctr, C.ctr, (a, b) => `Miniatury i tytuły przyciągają kliknięcia: CTR ${a} (średnia kanału ${b}).`, (a, b) => `CTR ${a} przy średniej kanału ${b}. Warto testować mocniejsze miniatury i tytuły (np. przez zakładkę Miniatury).`, (v) => pct(v));
    cmp(x.retention, C.retention, (a, b) => `Widzowie zostają z filmem: średnio ${a} obejrzenia (średnia kanału ${b}).`, (a, b) => `Średnio ${a} obejrzenia przy średniej kanału ${b}. Dobrze sprawdza się szybsze przejście do sedna i krótsze przestoje.`, (v) => pct(v / 100));
    cmp(x.hook, C.hook, (a, b) => `Mocne otwarcia: po 30 sekundach zostaje ${a} widzów (średnia kanału ${b}).`, (a, b) => `Po 30 sekundach zostaje ${a} widzów (średnia kanału ${b}). Pierwsze sekundy to dobre miejsce na pokazanie, co będzie w filmie.`, (v) => pct(v));
    cmp(x.subsPer1k, C.subsPer1k, (a, b) => `Filmy dobrze zamieniają widzów w subskrybentów: ${a} subów na 1000 wyświetleń (średnia ${b}).`, (a, b) => `${a} subów na 1000 wyświetleń (średnia ${b}). Warto dodać w filmie wyraźny moment z zaproszeniem do subskrypcji.`, (v) => v.toFixed(1).replace(".", ","));
    cmp(x.commentsPer1k, C.commentsPer1k, (a, b) => `Filmy rozkręcają dyskusję: ${a} komentarza na 1000 wyświetleń (średnia ${b}).`, (a, b) => `${a} komentarza na 1000 wyświetleń (średnia ${b}). Pytanie do widzów na końcu filmu zwykle pomaga.`, (v) => v.toFixed(1).replace(".", ","));
    cmp(x.likesPer1k, C.likesPer1k, (a, b) => `Widzowie chętnie zostawiają łapkę w górę: ${a} na 1000 wyświetleń (średnia ${b}).`, (a, b) => `${a} polubienia na 1000 wyświetleń (średnia ${b}).`, (v) => v.toFixed(1).replace(".", ","));
    if (x.uploads30 >= expected30 * 1.3 && x.uploads30 >= 2) plus.push({ r: 1.3, t: `Regularność: ${x.uploads30} filmy w ostatnich 30 dniach.` });
    else if (x.lastUp > 20 && x.films > 0) minus.push({ r: 0.5, t: `Ostatni film ${Math.round(x.lastUp)} dni temu. Warto wpisać coś do planu nagrywek.` });
    if (x.wtScore != null && x.otScore != null) {
      if (x.wtScore >= x.otScore * 1.5) plus.push({ r: 1.2, t: `Filmy z War Thunder wypadają wyraźnie lepiej (${Math.round(x.wtScore * 100)}% typowego wyniku) niż z innych gier (${Math.round(x.otScore * 100)}%).` });
      else if (x.otScore >= x.wtScore * 1.2) plus.push({ r: 1.2, t: `Filmy z innych gier radzą sobie świetnie (${Math.round(x.otScore * 100)}% typowego wyniku): dobry kierunek do rozwijania.` });
    }
    if (x.best && x.best.s >= typical * 1.5) plus.push({ r: 1.4, t: `Najmocniejszy film ostatnio: „${x.best.title}” (${nfm(x.best.s)} wyświetleń po 7 dniach).` });
    plus.sort((a, b) => b.r - a.r); minus.sort((a, b) => a.r - b.r);
    if (!plus.length && x.films) plus.push({ t: "Stabilne wyniki, blisko średniej kanału we wszystkich wskaźnikach." });
    if (!minus.length && x.films) minus.push({ t: "Brak wyraźnych słabych punktów. Warto eksperymentować z nowymi formatami, żeby przebić typowy wynik." });
    return {
      name: m, avatar: `avatars/${m.toLowerCase()}.png`,
      tags: tags[m].map((id) => ({ id, name: TAG[id].name, kind: TAG[id].kind, desc: TAG[id].desc })),
      plus: plus.slice(0, 5).map((p) => p.t), minus: minus.slice(0, 4).map((p) => p.t),
      films: x.films,
    };
  });
  return { people, hints, manual, window: WIN };
}

export function clickStmt(db, member, n, day) {
  return db.prepare("INSERT INTO clicks (member, day, n) VALUES (?,?,?) ON CONFLICT(member, day) DO UPDATE SET n = n + excluded.n").bind(member, day, n);
}
export { MANUAL_TAGS };
