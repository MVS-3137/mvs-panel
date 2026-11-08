// Panel MVS — Tablica wyzwań: cel subów + achievementy.
// Wszystkie achievementy liczą się od momentu uruchomienia etapu 3 (kv: ach_start).

const DAYMS = 864e5;
const HOUR = 36e5;
export const MEMBERS = ["Malvel", "Virtuoso", "Saito"];

// id, nazwa, rzadkość, opis (opis widać po odblokowaniu)
export const DEFS = [
  // --- Common ---
  ["first_blood", "First Blood", "common", "Pierwszy film wrzucony po uruchomieniu tablicy wyzwań."],
  ["level_up", "Level Up!", "common", "Kanał zdobył 1000 subów od uruchomienia tablicy wyzwań."],
  ["inquisition", "Nobody Expects the Spanish Inquisition", "common", "Film pojawił się na kanale, choć nie było go w planie nagrywek."],
  ["repair_cost", "Koszt naprawy wyższy niż zysk", "common", "Film z War Thunder miał po 7 dniach mniej wyświetleń niż średnia filmów z innych gier."],
  ["one_does_not", "One Does Not Simply Upload", "common", "Praca nad filmem (od startu w planie do premiery) trwała dłużej niż 14 dni."],
  // --- Uncommon ---
  ["you_died", "YOU DIED", "uncommon", "Film po 14 dniach ma mniej niż 1000 wyświetleń."],
  ["finally_awake", "Hey, You. You're Finally Awake", "uncommon", "Upload po przerwie dłuższej niż 30 dni od poprzedniego filmu tej samej osoby."],
  ["gotta_catch", "Gotta Catch 'Em All", "uncommon", "Trzy filmy trzech różnych osób w ciągu 7 dni."],
  ["speedrun", "Speedrun Any%", "uncommon", "Film wyszedł najpóźniej 3 dni po rozpoczęciu pracy w planie."],
  ["stay_awhile", "Stay a While and Listen", "uncommon", "Wrzucony film trwa co najmniej godzinę."],
  ["samurai", "Wake Up, Samurai", "uncommon", "Premiera filmu między północą a 5:00 rano."],
  ["afk", "AFK", "uncommon", "Ktoś z ekipy przez 21 dni nie wrzucił filmu i nie miał nic w planie."],
  ["triple_kill", "Triple Kill", "uncommon", "Jedna osoba wrzuciła 3 filmy w ciągu 30 dni."],
  // --- Rare ---
  ["praise_sun", "Praise the Sun", "rare", "Film starszy niż rok odżył i od ponad tygodnia łapie wyraźnie więcej wyświetleń."],
  ["war_never_changes", "War Never Changes", "rare", "Film z War Thunder pobił rekord (24 h, 7 lub 14 dni) w ciągu pierwszych 14 dni od premiery."],
  ["critical_hit", "Critical Hit", "rare", "Film po 7 dniach ma 200% lub więcej typowego wyniku kanału."],
  ["wasted", "Wasted", "rare", "Trzy filmy z rzędu po 7 dniach poniżej 60% typowego wyniku."],
  ["carrying", "Carrying the Team", "rare", "Trzy kolejne filmy jednej osoby powyżej typowego wyniku kanału."],
  ["half_life", "Half-Life 3 Confirmed", "rare", "Film, który był przesuwany w planie co najmniej 3 razy, w końcu wyszedł."],
  ["no_more_war", "No More War", "rare", "Pięć kolejnych filmów spoza War Thunder."],
  ["headshot", "Headshot", "rare", "Short zdobył 10 000 wyświetleń w ciągu 7 dni."],
  ["press_f", "Press F to Pay Respects", "rare", "Film zniknął z kanału (usunięty lub ukryty)."],
  // --- Epic ---
  ["rip_tear", "Rip and Tear", "epic", "Rekord 7 dni pobity dwa razy pod rząd przez tę samą osobę."],
  ["unstoppable", "Unstoppable", "epic", "Film osiągnął 10 000 wyświetleń w ciągu 7 dni."],
  ["terrorists_win", "Terrorists Win", "epic", "Film spoza War Thunder pobił rekord filmów z War Thunder."],
  ["sacked", "Sacked by the Board", "epic", "Pięć filmów z rzędu po 7 dniach poniżej 80% typowego wyniku."],
  ["mission_passed", "Mission Passed. Respect+", "epic", "Cel subów osiągnięty!"],
  ["dangerous_alone", "It's Dangerous to Go Alone", "epic", "Film zrobiony przez dwie osoby naraz (odblokowuje Saito)."],
  ["here_we_go", "Ah Shit, Here We Go Again", "epic", "Usunięty film wrócił na kanał jako nowy upload."],
  ["skill_issue", "Skill Issue", "epic", "Film z najsłabszą pierwszą dobą w historii kanału. Pierwsza doba najbardziej zależy od miniatury i tytułu."],
  // --- Legendary ---
  ["princess", "Thank You! But Our Princess Is in Another Castle", "legendary", "Cel subów osiągnięty i w ciągu doby ustawiony następny."],
  ["toss_coin", "Toss a Coin to Your Witcher", "legendary", "Liczba wspierających kanał osiągnęła co najmniej 50 (odblokowuje Saito)."],
  ["papiez", "Papieżowa godzina", "legendary", "Premiera o 21:37 albo film złapany z dokładnie 2137 wyświetleniami."],
  ["sixty_nine", "69", "legendary", "Film ma dokładnie 69 komentarzy i ten stan utrzymał się przez 69 godzin."],
  ["how_did_we", "How Did We Get Here?", "legendary", "Film jest jednocześnie najsłabszy w historii kanału po 24 h, 7, 14 i 28 dniach."],
  ["victory_royale", "Victory Royale", "legendary", "Film jest rekordzistą w swojej kategorii we wszystkich czterech oknach: 24 h, 7, 14 i 28 dni."],
].map(([id, name, rarity, desc]) => ({ id, name, rarity, desc }));
export const DEF = Object.fromEntries(DEFS.map((d) => [d.id, d]));
export const MANUAL = { dangerous_alone: ["Saito"], toss_coin: ["Saito"] };

/* ---------------- pomocnicze ---------------- */
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
function warsaw(ms) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
  } catch {
    const d = new Date(ms + HOUR);
    return { date: isoDate(ms + HOUR), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] };
  }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function kv(db, keys) {
  const { results } = await db.prepare(`SELECT key, value FROM kv WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}
const kvSet = (db, key, value) =>
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, String(value));

export function unlockStmts(db, id, { members = [], video_id = null, note = null } = {}, nowIso = new Date().toISOString()) {
  const d = DEF[id];
  const who = members.filter(Boolean);
  return [
    db.prepare("INSERT OR IGNORE INTO achievements (id, unlocked_at, members, video_id, note) VALUES (?,?,?,?,?)").bind(id, nowIso, who.join(","), video_id, note),
    db.prepare("INSERT OR IGNORE INTO news (ts, type, text, video_id, uniq) VALUES (?,?,?,?,?)")
      .bind(nowIso, "achievement", `Achievement odblokowany: ${d.name}${who.length ? " – zdobywa " + who.join(" & ") : ""}${/[!?.]$/.test(d.name) && !who.length ? "" : "!"}`, video_id, "ach:" + id),
  ];
}

/* ---------------- cel subów ---------------- */
// best = dokładna liczba z Analytics (jeśli wiarygodna), inaczej publiczna (zaokrąglona przez YouTube)
export function bestSubs(k) {
  const pub = k.subs ? Number(k.subs) : null;
  const ex = k.subs_exact ? Number(k.subs_exact) : null;
  if (ex !== null && pub !== null && Math.abs(ex - pub) <= Math.max(300, pub * 0.03)) return ex;
  return pub ?? ex;
}

// raz dziennie: dokładne suby i przyrost z 28 dni (YouTube Analytics)
export async function updateSubs(db, gfetch, now) {
  const k = await kv(db, ["subs_day"]);
  const today = isoDate(now);
  if (k.subs_day === today) return;
  const base = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&metrics=subscribersGained,subscribersLost";
  const life = await gfetch(`${base}&startDate=2005-01-01&endDate=${today}`);
  const last = await gfetch(`${base}&startDate=${isoDate(now - 30 * DAYMS)}&endDate=${isoDate(now - 3 * DAYMS)}`);
  const [lg, ll] = (life.rows && life.rows[0]) || [null, null];
  const [rg, rl] = (last.rows && last.rows[0]) || [0, 0];
  const st = [kvSet(db, "subs_day", today), kvSet(db, "subs_rate28", (rg - rl) / 28)];
  if (lg !== null) st.push(kvSet(db, "subs_exact", lg - ll));
  await db.batch(st);
}

/* ---------------- ocena achievementów ---------------- */
export async function evaluate(db, ev, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const K = await kv(db, ["ach_start", "ach_start_subs", "subs", "subs_exact", "goal", "goal_set_at", "goal_reached_at", "rip_seq", "c69"]);
  const subs = bestSubs(K);
  const st = [];

  // pierwszy raz: start tablicy wyzwań i domyślny cel
  if (!K.ach_start) {
    st.push(kvSet(db, "ach_start", nowIso));
    if (subs !== null) st.push(kvSet(db, "ach_start_subs", subs));
    if (!K.goal) {
      st.push(kvSet(db, "goal", 20000), kvSet(db, "goal_set_at", nowIso));
      if (subs !== null) st.push(db.prepare("INSERT OR REPLACE INTO goal_points (ts, subs) VALUES (?, ?)").bind(nowIso, subs));
    }
    await db.batch(st);
    return { started: true };
  }
  const START = Date.parse(K.ach_start);

  // cotygodniowy punkt na wykresie: poniedziałek rano
  const w = warsaw(now);
  if (w.weekday === "Mon" && w.hour >= 6 && subs !== null) {
    const exists = await db.prepare("SELECT 1 FROM goal_points WHERE substr(ts,1,10) >= ?").bind(isoDate(now - 20 * HOUR)).first();
    if (!exists) st.push(db.prepare("INSERT OR REPLACE INTO goal_points (ts, subs) VALUES (?, ?)").bind(nowIso, subs));
  }

  const { results: unl } = await db.prepare("SELECT id FROM achievements").all();
  const have = new Set(unl.map((r) => r.id));
  const give = (id, opt) => { if (have.has(id)) return; have.add(id); st.push(...unlockStmts(db, id, opt, nowIso)); };

  // dane
  const all = ev.videos.filter((v) => !v.removed_at);
  const age = (v) => (now - Date.parse(v.published)) / HOUR;
  const after = (v) => Date.parse(v.published) >= START;
  const longs = all.filter((v) => !v.is_short).sort((a, b) => (a.published < b.published ? -1 : 1));
  const shorts = all.filter((v) => v.is_short);
  const val = (v, h) => (h >= age(v) - 0.5 ? v.views : ev.valueAt(v, h));
  const ready = (v, h) => age(v) >= h || (ev.ov[v.id] && ev.ov[v.id][h] !== undefined);
  const cat = (v) => (v.wt ? "wt" : "other");
  const at = (v, h) => (ready(v, h) ? ev.valueAt(v, h) : null);
  const score7 = (v) => {
    if (age(v) < 168) return null;
    const x = at(v, 168); if (x == null) return null;
    const prev = (same) => longs.filter((o) => o.id !== v.id && o.published < v.published && (!same || cat(o) === cat(v)))
      .map((o) => at(o, 168)).filter((n) => n != null).slice(-10);
    let p = prev(true); if (p.length < 3) p = prev(false); if (p.length < 3) return null;
    const m = median(p); return m > 0 ? x / m : null;
  };
  const fresh = longs.filter(after);
  const freshAll = all.filter(after);

  // --- filmy ---
  const firstWithMember = fresh.find((v) => v.member);
  if (firstWithMember) give("first_blood", { members: [firstWithMember.member], video_id: firstWithMember.id });

  for (const v of fresh) {
    const who = { members: [v.member], video_id: v.id };
    if (v.duration_s >= 3600) give("stay_awhile", who);
    const wp = warsaw(Date.parse(v.published));
    if (wp.hour < 5) give("samurai", who);
    if (wp.hour === 21 && wp.minute === 37) give("papiez", who);
    if (age(v) >= 336) { const x = at(v, 336); if (x != null && x < 1000) give("you_died", who); }
    if ((age(v) <= 168 && v.views >= 10000) || (at(v, 168) ?? 0) >= 10000) give("unstoppable", who);
    const s = score7(v);
    if (s != null && s >= 2) give("critical_hit", who);
    if (v.wt && age(v) >= 168) {
      const others = longs.filter((o) => !o.wt).map((o) => at(o, 168)).filter((n) => n != null).slice(-10);
      const x = at(v, 168);
      if (others.length >= 3 && x != null && x < others.reduce((a, b) => a + b, 0) / others.length) give("repair_cost", who);
    }
    if (v.member) {
      const prev = longs.filter((o) => o.member === v.member && o.published < v.published).pop();
      if (prev && Date.parse(v.published) - Date.parse(prev.published) > 30 * DAYMS) give("finally_awake", who);
    }
    // non-WT bije rekord War Thunder
    if (!v.wt) for (const h of [24, 168, 336, 672]) {
      const x = at(v, h); if (x == null) continue;
      const wtBest = Math.max(0, ...longs.filter((o) => o.wt).map((o) => at(o, h)).filter((n) => n != null));
      if (wtBest > 0 && x > wtBest) { give("terrorists_win", who); break; }
    }
    // najsłabsza pierwsza doba / najsłabszy we wszystkich oknach
    const lowest = (h) => {
      const pool = longs.map((o) => [o, at(o, h)]).filter(([, n]) => n != null);
      if (pool.length < 10) return false;
      const x = at(v, h); return x != null && pool.every(([o, n]) => o.id === v.id || n > x);
    };
    if (age(v) >= 24 && lowest(24)) give("skill_issue", who);
    if (age(v) >= 672 && [24, 168, 336, 672].every(lowest)) give("how_did_we", who);
    // rekordzista we wszystkich oknach swojej kategorii
    if ([24, 168, 336, 672].every((h) => ev.records[cat(v) + h] && ev.records[cat(v) + h].id === v.id)) give("victory_royale", who);
  }
  for (const v of shorts.filter(after)) {
    if ((age(v) <= 168 && v.views >= 10000) || (at(v, 168) ?? 0) >= 10000) give("headshot", { members: [v.member], video_id: v.id });
  }
  // 2137 wyświetleń złapane przy odświeżeniu
  const pope = all.find((v) => v.views === 2137);
  if (pope) give("papiez", { members: [pope.member], video_id: pope.id, note: "2137 wyświetleń" });

  // serie na kanale
  const evald = fresh.filter((v) => age(v) >= 168).map((v) => ({ v, s: score7(v) })).filter((x) => x.s != null);
  const run = (arr, test, n) => { let c = 0; for (const x of arr) { c = test(x) ? c + 1 : 0; if (c >= n) return true; } return false; };
  if (run(evald, (x) => x.s < 0.6, 3)) give("wasted");
  if (run(evald, (x) => x.s < 0.8, 5)) give("sacked");
  if (run(fresh, (v) => !v.wt, 5)) give("no_more_war");
  for (const m of MEMBERS) {
    if (run(evald.filter((x) => x.v.member === m), (x) => x.s >= 1, 3)) give("carrying", { members: [m] });
    const mine = fresh.filter((v) => v.member === m);
    for (let i = 2; i < mine.length; i++) {
      if (Date.parse(mine[i].published) - Date.parse(mine[i - 2].published) <= 30 * DAYMS) { give("triple_kill", { members: [m], video_id: mine[i].id }); break; }
    }
  }
  for (const v of fresh) {
    const win = fresh.filter((o) => o.member && Date.parse(o.published) <= Date.parse(v.published) && Date.parse(v.published) - Date.parse(o.published) <= 7 * DAYMS);
    const who = [...new Set(win.map((o) => o.member))];
    if (who.length >= 3) { give("gotta_catch", { members: who }); break; }
  }

  // --- zdarzenia z tego odświeżenia ---
  for (const v of ev.unassigned || []) if (after(v)) give("inquisition", { video_id: v.id });
  for (const v of ev.removed || []) give("press_f", { members: [v.member], video_id: v.id });
  for (const r of ev.revivals || []) if (r.ageDays >= 365) give("praise_sun", { members: [r.member], video_id: r.id });
  for (const v of ev.newVideos || []) {
    if (!after(v)) continue;
    const { results: gone } = await db.prepare("SELECT id, title FROM videos WHERE removed_at IS NOT NULL AND removed_at >= ?").bind(K.ach_start).all();
    if (gone.some((g) => ev.titleScore(g.title, v.title) >= 0.6)) give("here_we_go", { members: [v.member], video_id: v.id });
  }
  let rip = JSON.parse(K.rip_seq || "[]");
  for (const c of ev.recChanges || []) {
    const v = all.find((x) => x.id === c.id);
    if (!v || !after(v)) continue;
    if (v.wt && c.w <= 336 && age(v) <= 15 * 24) give("war_never_changes", { members: [v.member], video_id: v.id });
    if (c.w === 168) {
      rip.push(v.member || "?");
      if (rip.length >= 2 && rip.at(-1) !== "?" && rip.at(-1) === rip.at(-2)) give("rip_tear", { members: [v.member], video_id: v.id });
    }
  }
  st.push(kvSet(db, "rip_seq", JSON.stringify(rip.slice(-5))));

  // 69 komentarzy przez 69 godzin
  const c69 = JSON.parse(K.c69 || "{}"), n69 = {};
  for (const v of all) if (v.comments === 69) {
    n69[v.id] = c69[v.id] || nowIso;
    if (now - Date.parse(n69[v.id]) >= 69 * HOUR && Date.parse(n69[v.id]) >= START) give("sixty_nine", { members: [v.member], video_id: v.id });
  }
  st.push(kvSet(db, "c69", JSON.stringify(n69)));

  // --- plan nagrywek ---
  const { results: projects } = await db.prepare("SELECT * FROM projects").all();
  const startDay = isoDate(START);
  for (const p of projects) {
    if (p.status !== "done" || !p.uploaded || p.uploaded < startDay) continue;
    const days = Math.round((Date.parse(p.uploaded) - Date.parse(p.start)) / DAYMS);
    const who = { members: [p.member], video_id: p.video_id };
    if (days > 14) give("one_does_not", who);
    if (days <= 3) give("speedrun", who);
    if ((p.shifts || 0) >= 3) give("half_life", who);
  }
  if (now - START >= 21 * DAYMS) for (const m of MEMBERS) {
    const last = Math.max(START,
      ...all.filter((v) => v.member === m).map((v) => Date.parse(v.published)),
      ...projects.filter((p) => p.member === m).map((p) => Math.max(Date.parse(p.start), Date.parse((p.created_at || "1970-01-01").replace(" ", "T") + "Z") || 0)),
      ...projects.filter((p) => p.member === m && p.status === "active").map(() => now));
    if (now - last >= 21 * DAYMS) give("afk", { members: [m] });
  }

  // --- suby ---
  if (subs !== null && K.ach_start_subs && subs - Number(K.ach_start_subs) >= 1000) give("level_up");
  if (subs !== null && K.goal && subs >= Number(K.goal)) {
    give("mission_passed", { note: "cel " + K.goal });
    if (!K.goal_reached_at) st.push(kvSet(db, "goal_reached_at", nowIso),
      db.prepare("INSERT OR IGNORE INTO news (ts, type, text, uniq) VALUES (?,?,?,?)").bind(nowIso, "milestone", `CEL OSIĄGNIĘTY: ${Number(K.goal).toLocaleString("pl-PL")} subów! Ustawcie nowy w zakładce Wyzwania.`, "goal:" + K.goal + ":" + K.goal_set_at));
  }

  if (st.length) await db.batch(st);
  return { ok: true };
}
