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
        published: v.snippet.publishedAt, views, vph: Math.round(views / ageH), short: dur(v.contentDetails.duration) <= 180,
        thumb: (v.snippet.thumbnails?.medium || v.snippet.thumbnails?.default || {}).url || "",
        tags: (v.snippet.tags || []).slice(0, 6), lang: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || "",
      });
    }
  }
  return out;
}
const slim = ({ id, title, channel, views, vph, thumb, short }) => ({ id, title, channel, views, vph, thumb, short });

// --- 1. War Thunder ---
async function wtSide(g, env, now, lang) {
  const after = new Date(now - 4 * DAYMS).toISOString();
  const geo = lang === "pl" ? "&regionCode=PL&relevanceLanguage=pl" : "&relevanceLanguage=en";
  const s = await g(`${YT}/search?part=id&type=video&maxResults=50&order=viewCount&q=${encodeURIComponent("War Thunder")}&publishedAfter=${after}${geo}`);
  const ids = (s.items || []).map((x) => x.id.videoId).filter(Boolean);
  let vids = (await videoDetails(g, ids, now)).filter((v) => v.channelId !== OWN && /war\s*thunder|warthunder/i.test(v.title + " " + v.tags.join(" ")));
  if (lang === "pl") vids = vids.filter((v) => v.lang.startsWith("pl") || /[ąćęłńóśźż]/i.test(v.title) || /\b(jak|czy|nie|się|najlepsz|nowy|nowa|gra)\b/i.test(v.title));
  else vids = vids.filter((v) => !v.lang.startsWith("pl"));
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
async function gamesPL(g, env, now) {
  const after = new Date(now - 7 * DAYMS).toISOString();
  const ids = [];
  let page = "";
  for (let p = 0; p < 2; p++) {
    const s = await g(`${YT}/search?part=id&type=video&maxResults=50&order=viewCount&videoCategoryId=20&regionCode=PL&relevanceLanguage=pl&publishedAfter=${after}${page ? "&pageToken=" + page : ""}`);
    ids.push(...(s.items || []).map((x) => x.id.videoId).filter(Boolean));
    page = s.nextPageToken; if (!page) break;
  }
  const vids = (await videoDetails(g, [...new Set(ids)], now))
    .filter((v) => v.lang.startsWith("pl") || /[ąćęłńóśźż]/i.test(v.title) || /\b(jak|czy|nie|się|najlepsz|nowy|nowa|gra|gram|zagrałem)\b/i.test(v.title));
  const games = new Map();
  for (let i = 0; i < vids.length; i += 40) {
    const part = vids.slice(i, i + 40);
    const list = part.map((v, k) => `${k + 1}. ${v.title} | tagi: ${v.tags.join(", ")} | kanał: ${v.channel}`).join("\n");
    const A = await ai(env, `Dla każdego filmu z polskiego YouTube podaj, jakiej gry wideo dotyczy. Używaj oficjalnej, najkrótszej nazwy gry (np. "Minecraft", "Fortnite", "Counter-Strike 2", "GTA V", "EA SPORTS FC 25"). Jeśli film nie dotyczy jednej konkretnej gry (np. vlog, sprzęt, kilka gier, nie da się ustalić), daj null.
Zwróć wyłącznie tablicę JSON: [{"n": numer, "game": "nazwa" albo null}].`, list, 1200);
    if (!A) continue;
    for (const x of A) {
      const v = part[Number(x.n) - 1];
      if (!v || !x.game || typeof x.game !== "string") continue;
      const name = x.game.trim().slice(0, 60), key = name.toLowerCase();
      const e = games.get(key) || { game: name, views: 0, videos: 0, channels: new Set(), top: null };
      e.views += v.views; e.videos++; e.channels.add(v.channelId);
      if (!e.top || v.views > e.top.views) e.top = v;
      games.set(key, e);
    }
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
    const world = await wtSide(g, env, now, "en");
    const pl = await wtSide(g, env, now, "pl");
    await db.batch([kvPut(db, "trend_wt", { at: new Date(now).toISOString(), world, pl }), kvPut(db, "trend_wt_at", String(now))]);
    return { wt: true };
  }
  const gAt = Number(await kv(db, "trend_g_at")) || 0;
  if (now - gAt >= 24 * H) {
    const top = await gamesPL(g, env, now);
    if (!top.length) { await db.batch([kvPut(db, "trend_g_at", String(now - 21 * H))]); return { games: 0 }; } // spróbuj za ~3 h
    const prev = JSON.parse((await kv(db, "trend_g")) || "null");
    const prevRank = new Map((prev?.top || []).map((x, i) => [x.game.toLowerCase(), i + 1]));
    const withChange = top.map((x, i) => { const p = prevRank.get(x.game.toLowerCase()); return { ...x, rank: i + 1, prev: p || null, change: p ? p - (i + 1) : null, isNew: !!prev && !p }; });
    await db.batch([kvPut(db, "trend_g", { at: new Date(now).toISOString(), prevAt: prev?.at || null, top: withChange }), kvPut(db, "trend_g_at", String(now))]);
    return { games: top.length };
  }
  return { skipped: true };
}
