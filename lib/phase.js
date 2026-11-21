// Panel MVS — fazy planu przejścia i wymagania (bramy decyzji). Liczone raz dziennie.
// Wymagania to EFEKTY (suby, oglądalność, wyniki gier), a nie liczba wrzuconych filmów.
// Na koniec fazy: wszystko spełnione → panel sam przechodzi do następnej; coś niespełnione → decyzja Saito:
// zaakceptować wyniki i przejść dalej albo przedłużyć fazę o tydzień.
const DAYMS = 864e5;
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => isoDate(Date.parse(d + "T12:00:00Z") + n * DAYMS);
export const PLAN_START = "2026-11-09";
export const WT_BASE = 9100; // mediana long-formów WT z planu (sierpień–listopad 2026)
import { curveAt } from "./yt.js";
const RPT = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE";

export const PHASES = [
  { n: 1, name: "Faza 1 · Test", gate: "Brama 1", weeks: 12, goal: "Przetestować 3–4 gry-mosty i znaleźć grę, która dorównuje War Thunderowi, bez utraty tempa kanału.",
    reqs: [
      { id: "bridge", label: "Gra-most przeszła próg", target: 1, unit: "", desc: "Film z nowej gry ma po 28 dniach min. 45% mediany WT i jest obejrzany średnio w min. 30%." },
      { id: "growth", label: "Wzrost kanału", target: 250, unit: "subów / mies.", desc: "Średnio nowych subskrypcji miesięcznie w tej fazie." },
      { id: "newsubs", label: "Suby spoza War Thundera", target: 15, unit: "%", desc: "Jaka część nowych subów w tej fazie przyszła z filmów z innych gier." },
      { id: "core", label: "Rdzeń WT się trzyma", target: Math.round(WT_BASE * 0.7), unit: "wyśw.", desc: "Mediana filmów WT z tej fazy po 28 dniach: min. 70% mediany sprzed planu (9,1 tys.)." },
    ] },
  { n: 2, name: "Faza 2 · Wybór", gate: "Brama 2", weeks: 13, goal: "Zbudować serię w grze, która przeszła próg, i przenieść na nią część widowni.",
    reqs: [
      { id: "series", label: "Seria w nowej grze", target: 1, unit: "", desc: "Gra z min. 3 filmami, których mediana po 28 dniach to min. 45% mediany WT." },
      { id: "growth", label: "Wzrost kanału", target: 300, unit: "subów / mies.", desc: "Średnio nowych subskrypcji miesięcznie w tej fazie." },
      { id: "newsubs", label: "Suby spoza War Thundera", target: 35, unit: "%", desc: "Jaka część nowych subów w tej fazie przyszła z filmów z innych gier." },
      { id: "views", label: "Oglądalność innych gier", target: 40, unit: "%", desc: "Udział filmów z innych gier w wyświetleniach kanału (ostatnie 28 dni)." },
    ] },
  { n: 3, name: "Faza 3 · Gaming", gate: "Cel końcowy", weeks: 26, goal: "Kanał gamingowy z War Thunderem jako dodatkiem.",
    reqs: [
      { id: "games2", label: "Dwie gry z progiem", target: 2, unit: "", desc: "Od początku planu min. 2 różne gry przeszły próg (45% mediany WT, 30% obejrzane)." },
      { id: "growth", label: "Wzrost kanału", target: 400, unit: "subów / mies.", desc: "Średnio nowych subskrypcji miesięcznie w tej fazie." },
      { id: "newsubs", label: "Suby spoza War Thundera", target: 55, unit: "%", desc: "Większość nowych subów przychodzi już z innych gier." },
      { id: "views", label: "Oglądalność innych gier", target: 60, unit: "%", desc: "Udział filmów z innych gier w wyświetleniach kanału (ostatnie 28 dni)." },
    ] },
];
export const phaseDef = (n) => PHASES.find((p) => p.n === n) || PHASES[0];
export function phaseDates(st) {
  const P = phaseDef(st.n);
  const end = addDays(st.start, (P.weeks + (st.ext || 0)) * 7 - 1);
  return { start: st.start, end, weeks: P.weeks + (st.ext || 0) };
}
const kvPut = (db, k, v) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, typeof v === "string" ? v : JSON.stringify(v));
async function kv(db, k) { const r = await db.prepare("SELECT value FROM kv WHERE key=?").bind(k).first(); return r ? r.value : null; }
export async function loadPhase(db) {
  const st = JSON.parse((await kv(db, "phase")) || "null") || { n: 1, start: PLAN_START, ext: 0, log: [] };
  return st;
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[™®©:]/g, "").replace(/\s+/g, " ").trim();

// wymagania: raz dziennie (3 zapytania do Analytics)
export async function syncPhase(db, g, now, budget = 4) {
  const day = isoDate(now);
  if ((await kv(db, "phase_day")) === day || budget < 3) return { skipped: true };
  const st = await loadPhase(db);
  const P = phaseDef(st.n), D = phaseDates(st);
  const end = isoDate(Math.min(now, Date.parse(D.end + "T23:59:59Z")));
  const days = Math.max(1, (Date.parse(end) - Date.parse(D.start)) / DAYMS + 1);

  const EX = "removed_at IS NULL AND COALESCE(live_override, is_live, 0) = 0 AND COALESCE(members_override, is_members, 0) = 0";
  const [vq, gq, nq, pq] = await db.batch([
    db.prepare(`SELECT id, title, published, wt, is_short, curve, project_id FROM videos WHERE ${EX}`),
    db.prepare("SELECT video_id, avp90 FROM grade_stats"),
    db.prepare("SELECT DISTINCT name FROM games UNION SELECT name FROM game_info"),
    db.prepare("SELECT id, game FROM projects WHERE game IS NOT NULL"),
  ]);
  const V = new Map(vq.results.map((v) => [v.id, { ...v, curve: v.curve ? JSON.parse(v.curve) : null }]));
  const AVP = new Map(gq.results.map((x) => [x.video_id, x.avp90]));
  const PG = new Map(pq.results.map((x) => [x.id, x.game]));
  const names = [...new Set(nq.results.map((x) => x.name).concat(["Minecraft", "Battlefield 6", "Hearts of Iron IV", "RimWorld"]))]
    .filter((n) => !/war\s*thunder/i.test(n)).map((n) => [norm(n), n]).filter(([k]) => k.length >= 4).sort((a, b) => b[0].length - a[0].length);
  const gameOf = (v) => PG.get(v.project_id) || (names.find(([k]) => norm(v.title).includes(k)) || [])[1] || "inna gra";
  const isWT = (id) => ((V.get(id) || {}).wt ? 1 : 0);

  // 1) suby i wyświetlenia wg filmu od początku fazy; 2) suby kanału od początku fazy; 3) wyświetlenia wg filmu, ostatnie 28 dni
  const a = await g(`${RPT}&dimensions=video&metrics=subscribersGained&sort=-subscribersGained&maxResults=200&startDate=${D.start}&endDate=${end}`);
  const b = await g(`${RPT}&metrics=subscribersGained,subscribersLost&startDate=${D.start}&endDate=${end}`);
  const c = await g(`${RPT}&dimensions=video&metrics=views&sort=-views&maxResults=200&startDate=${isoDate(now - 28 * DAYMS)}&endDate=${day}`);
  let sW = 0, sO = 0;
  for (const [id, n] of a.rows || []) { if (!V.has(id)) continue; if (isWT(id)) sW += n; else sO += n; }
  const gained = (b.rows && b.rows[0] && b.rows[0][0]) || 0;
  let vW = 0, vO = 0;
  for (const [id, n] of c.rows || []) { if (!V.has(id)) continue; if (isWT(id)) vW += n; else vO += n; }

  // filmy po 28 dniach
  const at28 = (v) => (now - Date.parse(v.published) >= 28 * DAYMS ? curveAt(v.curve, 672) : null);
  const longs = [...V.values()].filter((v) => !v.is_short);
  const inPhase = (v) => v.published.slice(0, 10) >= D.start && v.published.slice(0, 10) <= D.end;
  const wtMed = med(longs.filter((v) => v.wt && inPhase(v)).map(at28).filter((x) => x != null)) ;
  const ref = WT_BASE;
  const pass = (v) => { const x = at28(v), avp = AVP.get(v.id); return x != null && x >= 0.45 * ref && (avp == null || avp >= 30); };
  const byGame = new Map();
  for (const v of longs.filter((v) => !v.wt && v.published.slice(0, 10) >= PLAN_START)) { const k = gameOf(v); if (!byGame.has(k)) byGame.set(k, []); byGame.get(k).push(v); }
  const passGames = (from) => [...byGame.entries()].filter(([k, l]) => k !== "inna gra" && l.some((v) => v.published.slice(0, 10) >= from && pass(v))).map(([k]) => k);
  const series = [...byGame.entries()].filter(([k]) => k !== "inna gra").map(([k, l]) => { const xs = l.map(at28).filter((x) => x != null); return { k, n: xs.length, m: med(xs) }; })
    .filter((x) => x.n >= 3 && x.m >= 0.45 * ref);

  const val = {
    bridge: { v: passGames(D.start).length, note: passGames(D.start).join(", ") },
    games2: { v: passGames(PLAN_START).length, note: passGames(PLAN_START).join(", ") },
    series: { v: series.length, note: series.map((x) => `${x.k} (${x.n} filmy, mediana ${Math.round(x.m)})`).join(", ") },
    growth: { v: Math.round((gained / days) * 30), note: `${gained} nowych subów w ${Math.round(days)} dni` },
    newsubs: { v: sW + sO ? Math.round((sO / (sW + sO)) * 1000) / 10 : null, note: `${sO} z ${sW + sO} subów przypisanych do filmów` },
    core: { v: wtMed == null ? null : Math.round(wtMed), note: wtMed == null ? "brak filmów WT z tej fazy starszych niż 28 dni" : "mediana filmów WT z tej fazy po 28 dniach" },
    views: { v: vW + vO ? Math.round((vO / (vW + vO)) * 1000) / 10 : null, note: `${vO} z ${vW + vO} wyświetleń w 28 dni` },
  };
  const reqs = P.reqs.map((r) => ({ ...r, value: val[r.id].v, note: val[r.id].note, ok: val[r.id].v != null && val[r.id].v >= r.target }));
  const allOk = reqs.every((r) => r.ok);
  const ended = day > D.end;
  const status = { at: new Date(now).toISOString(), n: st.n, name: P.name, gate: P.gate, goal: P.goal, ...D, ext: st.ext || 0, reqs, allOk, ended, pending: ended && !allOk, done: !!st.done };

  const stmts = [kvPut(db, "phase_status", status), kvPut(db, "phase_day", day)];
  const nowIso = new Date(now).toISOString();
  const news = (text, uniq) => db.prepare("INSERT OR IGNORE INTO news (ts, type, text, uniq) VALUES (?,?,?,?)").bind(nowIso, "phase", text, uniq);
  if (ended && !st.done) {
    if (allOk) {
      const next = advance(st, "auto", "Wszystkie wymagania spełnione", now);
      stmts.push(kvPut(db, "phase", next), db.prepare("DELETE FROM kv WHERE key='phase_day'"),
        news(next.done ? `Plan przejścia zrealizowany! ${P.name}: wszystkie cele spełnione.` : `${P.gate} zaliczona! Wszystkie wymagania fazy spełnione – startuje ${phaseDef(next.n).name}.`, `phase:${st.n}:${st.start}:ok`));
    } else {
      stmts.push(news(`${P.name} dobiegła końca, ale nie wszystkie wymagania są spełnione (${reqs.filter((r) => r.ok).length}/${reqs.length}). Saito decyduje: przejść dalej czy przedłużyć fazę o tydzień.`, `phase:${st.n}:${st.start}:${st.ext || 0}:pending`));
    }
  }
  await db.batch(stmts);
  return { status };
}

export function advance(st, by, why, now) {
  const D = phaseDates(st);
  const log = (st.log || []).concat({ n: st.n, start: st.start, end: D.end, ext: st.ext || 0, by, why, at: new Date(now).toISOString() });
  if (st.n >= PHASES.length) return { ...st, done: true, log };
  return { n: st.n + 1, start: addDays(D.end, 1), ext: 0, log };
}
