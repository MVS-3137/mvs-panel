// Panel MVS — zakładka Pomysły: trendy na YouTube.
// 1) War Thunder: filmy z ostatnich 4 dni (świat i Polska), sortowane po wyświetleniach, ranking wg wyświetleń na godzinę;
//    AI grupuje tytuły w tematy (np. nowa aktualizacja, konkretny pojazd). Co 12 h.
// 2) Gry na polskim YouTube: najpopularniejsze filmy gamingowe z ostatnich 7 dni (kategoria Gry, region PL, język polski),
//    AI rozpoznaje grę z tytułu i tagów, sumujemy wyświetlenia → TOP 10 + zmiana miejsca względem poprzedniej aktualizacji. Co 24 h.
// Koszt: wyszukiwanie w YouTube API = 100 jednostek limitu (dziennie jest 10 000); razem ok. 600 jednostek na dobę.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_FALLBACK = "@cf/meta/llama-3.1-8b-instruct-fast";
const YT = "https://www.googleapis.com/youtube/v3";
const H = 36e5, DAYMS = 864e5;
const OWN = "UC57B3vFUeVbjNS3Ob-nINkA";
const kvPut = (db, k, v) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, typeof v === "string" ? v : JSON.stringify(v));
async function kv(db, k) { const r = await db.prepare("SELECT value FROM kv WHERE key=?").bind(k).first(); return r ? r.value : null; }
const dur = (iso) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };

function extractJson(txt) {
  if (txt && typeof txt === "object") return txt;
  const s = String(txt || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
async function ai(env, system, user, max = 1200) {
  if (!env.AI) return null;
  for (const model of [MODEL, MODEL_FALLBACK]) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: max, temperature: 0.2 });
      const j = extractJson(r && (r.response ?? r.result?.response ?? r));
      if (Array.isArray(j)) return j;
    } catch {}
  }
  return null;
}

async function videoDetails(g, ids, now) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await g(`${YT}/videos?part=snippet,statistics,contentDetails&id=${ids.slice(i, i + 50).join(",")}`);
    for (const v of r.items || []) {
      const ageH = Math.max(1, (now - Date.parse(v.snippet.publishedAt)) / H);
      const views = Number(v.statistics.viewCount || 0);
      out.push({
        id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, channelId: v.snippet.channelId,
        published: v.snippet.publishedAt, views, vph: Math.round(views / ageH), short: dur(v.contentDetails.duration) <= 120,
        thumb: (v.snippet.thumbnails?.medium || v.snippet.thumbnails?.default || {}).url || "",
        tags: (v.snippet.tags || []).slice(0, 6), lang: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || "",
      });
    }
  }
  return out;
}
// czy film jest po polsku: język audio, polskie znaki/słowa w tytule albo polskie tagi
const PL_WORDS = /\b(jak|czy|nie|się|sie|najlepsz\w*|nowy|nowa|nowe|gra|gram|gramy|zagrałem|zagralem|czołg\w*|czolg\w*|samolot\w*|polsk\w*|po polsku|poradnik|aktualizacja|każdy|kazdy|dlaczego|który|ktory)\b/i;
const isPL = (v) => v.lang.startsWith("pl") || /[ąćęłńóśźż]/i.test(v.title) || PL_WORDS.test(v.title) || v.tags.some((t) => /\b(pl|polska|po polsku|polski)\b/i.test(t));
const slim = ({ id, title, channel, views, vph, thumb, short }) => ({ id, title, channel, views, vph, thumb, short });

// --- 1. War Thunder ---
async function wtSide(g, env, now, lang, db, diag) {
  // świat: 4 dni; Polska: 7 dni (mniejszy rynek), polskie zapytanie + ostatnie filmy polskich kanałów z zakładki Konkurencja
  const after = new Date(now - (lang === "pl" ? 7 : 4) * DAYMS).toISOString();
  const q = lang === "pl" ? "War Thunder po polsku|War Thunder PL|War Thunder polska" : "War Thunder";
  const geo = lang === "pl" ? "&regionCode=PL&relevanceLanguage=pl" : "&relevanceLanguage=en";
  const s = await g(`${YT}/search?part=id&type=video&maxResults=50&order=viewCount&q=${encodeURIComponent(q)}&publishedAfter=${after}${geo}`);
  const ids = new Set((s.items || []).map((x) => x.id.videoId).filter(Boolean));
  const plChannels = new Set();
  if (lang === "pl" && db) {
    const { results: ch } = await db.prepare("SELECT DISTINCT id FROM comp_channels WHERE id != ?").bind(OWN).all();
    for (const c of ch.slice(0, 10)) {
      plChannels.add(c.id);
      try {
        const r = await g(`${YT}/playlistItems?part=contentDetails&maxResults=10&playlistId=UU${c.id.slice(2)}`);
        for (const it of r.items || []) if ((it.contentDetails.videoPublishedAt || "") >= after) ids.add(it.contentDetails.videoId);
      } catch {}
    }
  }
  const found = await videoDetails(g, [...ids], now);
  let vids = found.filter((v) => v.channelId !== OWN && !v.short && /war\s*thunder|warthunder/i.test(v.title + " " + v.tags.join(" ")));
  if (lang === "pl") vids = vids.filter((v) => plChannels.has(v.channelId) || isPL(v));
  else vids = vids.filter((v) => !isPL(v));
  if (diag) diag[lang] = { found: found.length, kept: vids.length };
  vids.sort((a, b) => b.vph - a.vph);
  const top = vids.slice(0, lang === "pl" ? 25 : 40);
  if (!top.length) return [];
  const list = top.map((v, i) => `${i + 1}. ${v.title} | ${v.channel} | ${v.vph} wyśw./h`).join("\n");
  const A = await ai(env, `Analizujesz najpopularniejsze filmy o War Thunder z ostatnich 4 dni dla polskiego kanału YouTube MVS. Pogrupuj filmy w 3–6 TEMATÓW, które teraz trendują (np. nowa aktualizacja, konkretny pojazd lub nacja, zmiana w grze, wydarzenie, wyzwanie lub format). Pomiń temat „ogólny gameplay”, jeśli nic go nie łączy.
Zwróć wyłącznie tablicę JSON: [{"topic": "krótka nazwa tematu po polsku (max 6 słów)", "why": "jedno zdanie po polsku, co się dzieje i dlaczego to trenduje", "n": [numery filmów z listy, najlepsze 2–3 na początku]}]. Kolejność: od najmocniejszego tematu.`, list, 900);
  const topics = [];
  if (A) for (const t of A) {
    const vs = (t.n || []).map((n) => top[Number(n) - 1]).filter(Boolean);
    if (!vs.length || !t.topic) continue;
    topics.push({ topic: String(t.topic).slice(0, 60), why: String(t.why || "").slice(0, 200), vph: vs.reduce((a, v) => a + v.vph, 0), videos: vs.slice(0, 3).map(slim) });
  }
  if (!topics.length) topics.push({ topic: "Najszybciej rosnące filmy", why: "AI nie odpowiedziało – pokazuję po prostu filmy z największą liczbą wyświetleń na godzinę.", vph: 0, videos: top.slice(0, 3).map(slim) });
  return topics.sort((a, b) => b.vph - a.vph).slice(0, 6);
}

// --- 2. Gry na polskim YouTube ---
const KNOWN_GAMES = [
  [/minecraft/, "Minecraft"], [/fortnite/, "Fortnite"], [/roblox/, "Roblox"], [/counter[- ]?strike|\bcs ?2\b|\bcs:?go\b/, "Counter-Strike 2"], [/\bgta\b|grand theft auto/, "GTA V"],
  [/\bfc ?2[4-7]\b|ea sports fc|\bfifa\b/, "EA SPORTS FC"], [/valorant/, "Valorant"], [/league of legends|\blol\b/, "League of Legends"], [/war thunder/, "War Thunder"],
  [/world of tanks|\bwot\b/, "World of Tanks"], [/battlefield/, "Battlefield"], [/call of duty|warzone|\bcod\b/, "Call of Duty"], [/apex legends/, "Apex Legends"],
  [/rainbow six|\br6\b/, "Rainbow Six Siege"], [/rocket league/, "Rocket League"], [/\bdota\b/, "Dota 2"], [/\bpubg\b/, "PUBG"], [/rust\b/, "Rust"],
  [/schedule i\b/, "Schedule I"], [/r\.?e\.?p\.?o\b/, "R.E.P.O."], [/peak\b/, "PEAK"], [/lethal company/, "Lethal Company"], [/phasmophobia/, "Phasmophobia"],
  [/among us/, "Among Us"], [/brawl stars/, "Brawl Stars"], [/clash royale/, "Clash Royale"], [/clash of clans/, "Clash of Clans"], [/genshin/, "Genshin Impact"],
  [/the sims|\bsims ?4\b/, "The Sims 4"], [/hearts of iron|\bhoi ?4\b/, "Hearts of Iron IV"], [/euro truck|\bets ?2\b/, "Euro Truck Simulator 2"], [/farming simulator/, "Farming Simulator"],
  [/wiedźmin|wiedzmin|witcher/, "Wiedźmin"], [/cyberpunk/, "Cyberpunk 2077"], [/elden ring/, "Elden Ring"], [/helldivers/, "HELLDIVERS 2"], [/arc raiders/, "ARC Raiders"],
  [/escape from tarkov|\btarkov\b/, "Escape from Tarkov"], [/dead by daylight|\bdbd\b/, "Dead by Daylight"], [/stardew/, "Stardew Valley"], [/terraria/, "Terraria"],
  [/subnautica/, "Subnautica"], [/the forest|sons of the forest/, "Sons of the Forest"], [/hollow knight|silksong/, "Hollow Knight: Silksong"], [/marvel rivals/, "Marvel Rivals"],
];
async function gamesPL(g, env, now, diag) {
  const after = new Date(now - 7 * DAYMS).toISOString();
  // Najpopularniejsze filmy gamingowe to głównie shorty i zagraniczne hity, a sam „region PL / język pl” ich nie odsiewa.
  // Dlatego prosimy YouTube od razu o dłuższe filmy (4–20 min i 20+ min) i dokładamy typowe polskie słowa z tytułów.
  const PLQ = encodeURIComponent("gram|gramy|zagrałem|zagraliśmy|polsku|przetrwać|najlepsze|każdym");
  const ids = [];
  for (const [dur, q] of [["medium", PLQ], ["long", PLQ], ["medium", ""]]) {
    const s = await g(`${YT}/search?part=id&type=video&maxResults=50&order=viewCount&videoCategoryId=20&regionCode=PL&relevanceLanguage=pl&videoDuration=${dur}${q ? "&q=" + q : ""}&publishedAfter=${after}`);
    ids.push(...(s.items || []).map((x) => x.id.videoId).filter(Boolean));
  }
  const found = await videoDetails(g, [...new Set(ids)], now);
  const longF = found.filter((v) => !v.short);
  const vids = longF.filter(isPL);
  if (diag) Object.assign(diag, { found: found.length, long: longF.length, kept: vids.length, ai: 0, rule: 0 });
  const games = new Map();
  const addGame = (v, name) => {
    const key = name.toLowerCase();
    const e = games.get(key) || { game: name, views: 0, videos: 0, channels: new Set(), top: null };
    e.views += v.views; e.videos++; e.channels.add(v.channelId);
    if (!e.top || v.views > e.top.views) e.top = v;
    games.set(key, e);
  };
  const named = new Set();
  for (let i = 0; i < vids.length; i += 25) {
    const part = vids.slice(i, i + 25);
    const list = part.map((v, k) => `${k + 1}. ${v.title} | tagi: ${v.tags.join(", ")} | kanał: ${v.channel}`).join("\n");
    const A = await ai(env, `Dla każdego filmu z polskiego YouTube podaj, jakiej gry wideo dotyczy. Używaj oficjalnej, najkrótszej nazwy gry (np. "Minecraft", "Fortnite", "Counter-Strike 2", "GTA V", "EA SPORTS FC 25"). Jeśli film nie dotyczy jednej konkretnej gry (np. vlog, sprzęt, kilka gier, nie da się ustalić), daj null.
Zwróć wyłącznie tablicę JSON: [{"n": numer, "game": "nazwa" albo null}].`, list, 1200);
    if (!A) continue;
    for (const x of A) {
      const v = part[Number(x.n) - 1];
      if (!v || named.has(v.id) || !x.game || typeof x.game !== "string" || /^null$/i.test(x.game)) continue;
      named.add(v.id); addGame(v, x.game.trim().slice(0, 60)); if (diag) diag.ai++;
    }
  }
  // zapas bez AI: nazwy gier z tytułu i tagów
  for (const v of vids) {
    if (named.has(v.id)) continue;
    const hay = (v.title + " | " + v.tags.join(" | ")).toLowerCase();
    const hit = KNOWN_GAMES.find(([re]) => re.test(hay));
    if (hit) { named.add(v.id); addGame(v, hit[1]); if (diag) diag.rule++; }
  }
  // gra musi mieć min. 2 różne kanały – jeden wielki twórca to jeszcze nie trend
  return [...games.values()].filter((e) => e.channels.size >= 2).sort((a, b) => b.views - a.views).slice(0, 10)
    .map((e) => ({ game: e.game, views: e.views, videos: e.videos, channels: e.channels.size, top: slim(e.top) }));
}

// jedno zadanie na odświeżenie (żeby zmieścić się w limicie zapytań): najpierw WT (co 12 h), potem gry (co 24 h)
export async function syncTrends(db, g, env, now, budget = 10) {
  if (budget < 6) return { skipped: true };
  const wtAt = Number(await kv(db, "trend_wt_at")) || 0;
  if (now - wtAt >= 12 * H) {
    const diag = {};
    const world = await wtSide(g, env, now, "en", db, diag);
    const pl = await wtSide(g, env, now, "pl", db, diag);
    await db.batch([kvPut(db, "trend_wt", { at: new Date(now).toISOString(), world, pl, diag }), kvPut(db, "trend_wt_at", String(now))]);
    return { wt: true };
  }
  const gAt = Number(await kv(db, "trend_g_at")) || 0;
  if (now - gAt >= 24 * H) {
    const diag = { at: new Date(now).toISOString() };
    let top = [];
    try { top = await gamesPL(g, env, now, diag); } catch (e) { diag.err = String(e.message || e).slice(0, 200); }
    if (!top.length) { await db.batch([kvPut(db, "trend_g_at", String(now - 21 * H)), kvPut(db, "trend_g_diag", diag)]); return { games: 0, diag }; } // spróbuj za ~3 h
    const prev = JSON.parse((await kv(db, "trend_g")) || "null");
    const prevRank = new Map((prev?.top || []).map((x, i) => [x.game.toLowerCase(), i + 1]));
    const withChange = top.map((x, i) => { const p = prevRank.get(x.game.toLowerCase()); return { ...x, rank: i + 1, prev: p || null, change: p ? p - (i + 1) : null, isNew: !!prev && !p }; });
    const st = [kvPut(db, "trend_g", { at: new Date(now).toISOString(), prevAt: prev?.at || null, top: withChange, diag }), kvPut(db, "trend_g_at", String(now)), kvPut(db, "trend_g_diag", diag)];
    // 🎯 Wasza gra w trendach: gra z waszych bibliotek wskoczyła do TOP 10 (tylko gdy jest poprzedni ranking, żeby nie zalać przy pierwszym)
    if (prev) {
      const { results: lib } = await db.prepare("SELECT member, name FROM games").all();
      const nk = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[™®©:]/g, "").replace(/\s+/g, " ").trim();
      const nowIso = new Date(now).toISOString(), week = Math.floor(now / (7 * DAYMS));
      for (const x of withChange.filter((x) => x.prev == null && !/war\s*thunder/i.test(x.game))) {
        const g0 = nk(x.game);
        if (g0.length < 4) continue;
        const owners = [...new Set(lib.filter((l) => { const n = nk(l.name); return n.length >= 4 && (n.includes(g0) || g0.includes(n)); }).map((l) => l.member))];
        if (!owners.length) continue;
        st.push(db.prepare("INSERT OR IGNORE INTO news (ts, type, text, uniq) VALUES (?,?,?,?)").bind(nowIso, "trend_game",
          `Wasza gra w trendach: ${x.game} wskoczyła na ${x.rank}. miejsce TOP 10 gier na polskim YouTube (${x.views.toLocaleString("pl-PL")} wyświetleń w 7 dni, ${x.channels} kanałów). Macie ją w bibliotece: ${owners.join(", ")}.`, `tg:${g0}:${week}`));
      }
    }
    await db.batch(st);
    return { games: top.length };
  }
  return { skipped: true };
}

// 👀 Konkurencja wystrzeliła: świeży film (≤ 10 dni) kanału z zakładki Konkurencja ma ≥ 5× typowego wyniku tego kanału.
// Raz dziennie przegląd wszystkich kanałów, po 3 kanały na odświeżenie (2 zapytania na kanał).
export async function syncCompHits(db, g, now, budget = 6) {
  const day = new Date(now).toISOString().slice(0, 10);
  let q = JSON.parse((await kv(db, "comp_hit_q")) || "null");
  if (!q || (q.i >= q.ids.length && q.day !== day)) {
    const { results } = await db.prepare("SELECT DISTINCT id, title FROM comp_channels WHERE id != ?").bind(OWN).all();
    if (q && q.day === day) return { skipped: true };
    q = { day, ids: results.map((r) => r.id), i: 0 };
  }
  if (q.i >= q.ids.length) return { skipped: true };
  let calls = 0;
  const st = [], nowIso = new Date(now).toISOString();
  while (q.i < q.ids.length && budget - calls >= 2) {
    const ch = q.ids[q.i++];
    try {
      calls++;
      const pl = await g(`${YT}/playlistItems?part=contentDetails&maxResults=30&playlistId=UU${ch.slice(2)}`);
      const ids = (pl.items || []).map((x) => x.contentDetails.videoId);
      if (!ids.length) continue;
      calls++;
      const vids = (await videoDetails(g, ids, now)).filter((v) => !v.short);
      const age = (v) => (now - Date.parse(v.published)) / DAYMS;
      const base = vids.filter((v) => age(v) >= 14 && age(v) <= 180).map((v) => v.views).sort((a, b) => a - b);
      if (base.length < 5) continue;
      const med = base[base.length >> 1];
      for (const v of vids.filter((v) => age(v) <= 10 && v.views >= Math.max(2000, 5 * med))) {
        st.push(db.prepare("INSERT OR IGNORE INTO news (ts, type, text, video_id, uniq) VALUES (?,?,?,?,?)").bind(nowIso, "comp_hit",
          `Konkurencja wystrzeliła: „${v.title}” (${v.channel}) ma już ${v.views.toLocaleString("pl-PL")} wyświetleń po ${Math.max(1, Math.round(age(v)))} ${Math.round(age(v)) === 1 ? "dniu" : "dniach"} – ok. ${Math.round(v.views / med)}× więcej niż typowy film tego kanału (ok. ${med.toLocaleString("pl-PL")}). Może warto podpatrzeć temat.`, v.id, "ch:" + v.id));
      }
    } catch {}
  }
  st.push(kvPut(db, "comp_hit_q", q));
  await db.batch(st);
  return { calls, done: q.i, of: q.ids.length };
}
