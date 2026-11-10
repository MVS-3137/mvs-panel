// Panel MVS — analiza gier z waszych bibliotek: o czym jest gra i jak daleko jest od widowni War Thundera.
// Dla każdej nowej gry (po kilka na odświeżenie): Steam (wyszukiwarka + opis + gatunki), SteamSpy (tagi graczy),
// potem Workers AI przypisuje kategorię (do formatów), dystans 1–5 i jedno zdanie opisu. Ręczna ocena (src='manual') wygrywa zawsze.
// Raz w tygodniu panel odświeża oceny AI starsze niż 30 dni (gry się zmieniają, AI też).
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_FALLBACK = "@cf/meta/llama-3.1-8b-instruct-fast";
export const CATS = ["tank", "build", "war", "air", "sea", "strategy", "party", "survival", "other"];
const DAYMS = 864e5;

export const gameKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l")
  .replace(/[™®©:]/g, "").replace(/\s+/g, " ").trim();

async function steamInfo(name, fetcher) {
  const out = { appid: null, title: null, about: "", genres: [], tags: [] };
  try {
    const s = await (await fetcher(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=PL`)).json();
    const it = (s.items || []).find((x) => gameKey(x.name) === gameKey(name)) || (s.items || [])[0];
    if (!it) return out;
    out.appid = it.id; out.title = it.name;
  } catch { return out; }
  try {
    const d = await (await fetcher(`https://store.steampowered.com/api/appdetails?appids=${out.appid}&l=english`)).json();
    const x = d?.[out.appid]?.data;
    if (x) { out.about = String(x.short_description || "").slice(0, 300); out.genres = (x.genres || []).map((g) => g.description); }
  } catch {}
  try {
    const t = await (await fetcher(`https://steamspy.com/api.php?request=appdetails&appid=${out.appid}`)).json();
    out.tags = Object.entries(t.tags || {}).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
  } catch {}
  return out;
}

// zapas, gdy AI nie odpowie: prosta reguła po tagach i nazwie
export function ruleGuess(name, tags = [], genres = []) {
  const t = (tags.join(" ") + " " + genres.join(" ") + " " + name).toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has("tank", "czołg", "armor")) return { cat: "tank", dist: 1 };
  if (has("vehicular combat", "building", "crafting") && has("vehicle", "combat", "military")) return { cat: "build", dist: 2 };
  if (has("world war", "wwii", "military", "war", "tactical", "realistic")) return { cat: "war", dist: 2 };
  if (has("flight", "air combat", "naval", "submarine", "ship")) return { cat: has("naval", "submarine", "ship") ? "sea" : "air", dist: 2 };
  if (has("grand strategy", "rts", "strategy", "wargame")) return { cat: "strategy", dist: 3 };
  if (has("party", "social deduction", "funny", "co-op")) return { cat: "party", dist: 4 };
  if (has("survival", "open world survival")) return { cat: "survival", dist: 4 };
  return { cat: "other", dist: 5 };
}

function extractJson(txt) {
  if (txt && typeof txt === "object") return txt;
  const s = String(txt || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function aiClassify(env, games) {
  if (!env.AI) return null;
  const list = games.map((g, i) => `${i + 1}. ${g.name}${g.genres.length ? ` | gatunki: ${g.genres.join(", ")}` : ""}${g.tags.length ? ` | tagi: ${g.tags.join(", ")}` : ""}${g.about ? ` | opis: ${g.about}` : ""}`).join("\n");
  const messages = [
    { role: "system", content: `Jesteś analitykiem polskiego kanału YouTube MVS. Kanał ma ok. 12 tys. subów, a widownia to gracze War Thundera: czołgi, lotnictwo i flota, militaria, II wojna światowa, realizm, rywalizacja trójki kolegów (Malvel, Virtuoso, Saito). Kanał przechodzi stopniowo na szerszy gaming, zaczynając od gier najbliższych tej widowni.
Dla każdej gry zwróć obiekt JSON:
- "n": numer gry z listy
- "cat": jedna z: tank (czołgi w centrum gry), build (budowanie pojazdów/maszyn i walka nimi), war (shooter/symulator wojenny), air (lotnictwo), sea (okręty, łodzie podwodne), strategy (strategia, wojenna lub nie), party (gra imprezowa/co-op dla paczki znajomych), survival (przetrwanie, crafting), other (reszta)
- "dist": dystans od widowni War Thundera, 1–5: 1 = ta sama widownia (czołgi, pojazdy wojskowe), 2 = bliska (militaria, WW2, realistyczne shootery, lotnictwo/flota), 3 = średnia (strategie wojenne, budowanie pojazdów, duże popularne shootery), 4 = daleka (party, horror co-op, survival, wyścigi), 5 = zupełnie inna widownia (symulatory życia, gry dla dzieci, puzzle, casual)
- "about": jedno zdanie po polsku (max 14 słów), o czym jest gra
- "veh": true, jeśli w grze są pojazdy, którymi się walczy lub jeździ
Zwróć wyłącznie tablicę JSON, bez komentarzy.` },
    { role: "user", content: list },
  ];
  for (const model of [MODEL, MODEL_FALLBACK]) {
    try {
      const r = await env.AI.run(model, { messages, max_tokens: 900, temperature: 0.2 });
      const j = extractJson(r && (r.response ?? r.result?.response ?? r));
      if (Array.isArray(j) && j.length) return j;
    } catch {}
  }
  return null;
}

// fetcher: liczony fetch (limit zapytań na jedno wywołanie); budget: ile zapytań zewnętrznych wolno zużyć
export async function syncGameInfo(db, env, now, fetcher, budget = 9) {
  const per = 3; // Steam: wyszukiwarka + opis + tagi
  const n = Math.min(4, Math.floor((budget - 1) / per));
  if (n <= 0) return { done: 0 };
  const stale = new Date(now - 30 * DAYMS).toISOString();
  const { results: libs } = await db.prepare("SELECT DISTINCT name FROM games").all();
  const { results: known } = await db.prepare("SELECT key, src, checked_at FROM game_info").all();
  const K = new Map(known.map((k) => [k.key, k]));
  // najpierw gry, których panel jeszcze nie zna; potem (raz w tygodniu, po trochu) odświeżenie starych ocen AI
  const week = new Date(now).toISOString().slice(0, 10);
  const lastWeekly = (await db.prepare("SELECT value FROM kv WHERE key='gi_week'").first())?.value || "";
  const weekly = !lastWeekly || Date.parse(week) - Date.parse(lastWeekly) >= 7 * DAYMS;
  const seen = new Set(), todo = [];
  for (const { name } of libs) {
    const key = gameKey(name);
    if (!key || seen.has(key) || key.includes("war thunder")) continue;
    seen.add(key);
    const k = K.get(key);
    if (!k) todo.push({ name, key, fresh: true });
  }
  if (!todo.length && weekly) for (const { name } of libs) {
    const k = K.get(gameKey(name));
    if (k && k.src !== "manual" && (k.src === "rule" || (k.checked_at || "") < stale) && !todo.some((t) => t.key === k.key)) todo.push({ name, key: k.key, fresh: false });
  }
  if (!todo.length) {
    if (weekly) await db.batch([db.prepare("INSERT INTO kv (key, value) VALUES ('gi_week', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(week)]);
    return { done: 0 };
  }
  const batch = todo.slice(0, n);
  const infos = [];
  for (const t of batch) infos.push({ ...t, ...(await steamInfo(t.name, fetcher)) });
  const ai = await aiClassify(env, infos);
  const nowIso = new Date(now).toISOString();
  const st = infos.map((g, i) => {
    const a = ai && ai.find((x) => Number(x.n) === i + 1);
    const rule = ruleGuess(g.name, g.tags, g.genres);
    const cat = a && CATS.includes(a.cat) ? a.cat : rule.cat;
    const dist = a && a.dist >= 1 && a.dist <= 5 ? Math.round(a.dist) : rule.dist;
    const about = (a && String(a.about || "").slice(0, 140)) || (g.about ? g.about.slice(0, 140) : "");
    return db.prepare(`INSERT INTO game_info (key, name, appid, tags, cat, dist, about, veh, src, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET appid=excluded.appid, tags=excluded.tags, about=excluded.about, veh=excluded.veh, checked_at=excluded.checked_at,
        cat=CASE WHEN game_info.src='manual' THEN game_info.cat ELSE excluded.cat END,
        dist=CASE WHEN game_info.src='manual' THEN game_info.dist ELSE excluded.dist END,
        src=CASE WHEN game_info.src='manual' THEN 'manual' ELSE excluded.src END`)
      .bind(g.key, g.name, g.appid, JSON.stringify(g.tags.slice(0, 8)), cat, dist, about, a && a.veh ? 1 : 0, ai ? "ai" : "rule", nowIso);
  });
  await db.batch(st);
  return { done: st.length, ai: !!ai };
}
