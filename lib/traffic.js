// Panel MVS — skąd przyszedł ruch: propozycje przy innym filmie, ekran końcowy, karty.
// Tylko powiadomienia w Aktualnościach, tylko znaczące skoki (bez spamu).
//
// Dane: YouTube Analytics, dzienne (YouTube podaje je z ~2–3-dniowym opóźnieniem).
// Raz na dzień danych: lista długich filmów z min. 100 wyświetleniami tego dnia, potem po kilka filmów na odświeżenie:
//   1 zapytanie: wyświetlenia wg typu źródła; + szczegóły (który film) dla propozycji i ekranu końcowego, gdy jest czego szukać.
//
// Kiedy powiadomienie (wszystkie warunki naraz):
//   propozycje przy jednym filmie: ≥ 100 wyświetleń i ≥ 20% ruchu filmu tego dnia
//   ekran końcowy jednego filmu:   ≥ 15 wyświetleń i ≥ 5% ruchu
//   karty (łącznie):               ≥ 15 wyświetleń i ≥ 5% ruchu
//   + skok: ≥ 3× średnia dzienna z tego samego źródła z poprzednich 7 dni (stały ruch z ekranu końcowego to nie news)
//   + pierwsze 7 dni po włączeniu panel tylko się uczy (bez powiadomień)
//   + max 3 takie powiadomienia na dzień danych (najsilniejsze wygrywają)
const DAYMS = 864e5;
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const A = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&metrics=views";
const RULES = {
  RELATED_VIDEO: { min: 100, share: 0.2, detailMin: 60, label: (s) => `z propozycji przy filmie ${s}` },
  END_SCREEN: { min: 15, share: 0.05, detailMin: 10, label: (s) => `z ekranu końcowego filmu ${s}` },
  ANNOTATION: { min: 15, share: 0.05, label: () => "z kart w innych filmach" },
};
const SPIKE = 3, LEARN_DAYS = 7, MAX_PER_DAY = 3;
const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const plDay = (d) => { const x = new Date(d + "T12:00:00Z"); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };

async function kv(db, k) { const r = await db.prepare("SELECT value FROM kv WHERE key=?").bind(k).first(); return r ? r.value : null; }
const kvPut = (db, k, v) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, String(v));

export async function syncTraffic(db, gfetch, now, budget = 6) {
  if (budget <= 0) return { calls: 0 };
  let calls = 0;
  const call = async (u) => { calls++; return gfetch(u); };
  let start = await kv(db, "trf_start");
  if (!start) { start = isoDate(now - 3 * DAYMS); await db.batch([kvPut(db, "trf_start", start)]); }
  let q = JSON.parse((await kv(db, "trf_q")) || "null");
  const target = isoDate(now - 2 * DAYMS); // najnowszy dzień, dla którego Analytics zwykle ma już dane

  // nowy dzień danych, gdy poprzedni skończony
  if (!q || (q.i >= q.ids.length && q.day < target)) {
    const day = q ? isoDate(Date.parse(q.day) + DAYMS) : start;
    if (day > target) return { calls };
    const r = await call(`${A}&dimensions=video&sort=-views&maxResults=50&startDate=${day}&endDate=${day}`);
    const rows = (r.rows || []).filter((x) => x[1] >= 100);
    if (!rows.length) return { calls }; // dane jeszcze się nie pojawiły – spróbujemy za godzinę
    const ids = rows.map((x) => x[0]);
    const { results: longs } = await db.prepare(`SELECT id FROM videos WHERE is_short = 0 AND removed_at IS NULL
      AND COALESCE(live_override, is_live, 0) = 0 AND COALESCE(members_override, is_members, 0) = 0
      AND id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all();
    const ok = new Set(longs.map((x) => x.id));
    q = { day, ids: ids.filter((id) => ok.has(id)), i: 0 };
    await db.batch([kvPut(db, "trf_q", JSON.stringify(q)), db.prepare("DELETE FROM traffic_src WHERE day < ?").bind(isoDate(Date.parse(day) - 30 * DAYMS))]);
  }

  const learning = Date.parse(q.day) - Date.parse(start) < LEARN_DAYS * DAYMS;
  const D = q.day, from = isoDate(Date.parse(D) - 7 * DAYMS), to = isoDate(Date.parse(D) - DAYMS);
  const cands = [];
  while (q.i < q.ids.length && budget - calls >= 3) { // 1 zapytanie o typy + do 2 o szczegóły – film sprawdzamy w całości
    const vid = q.ids[q.i];
    const base = `${A}&startDate=${D}&endDate=${D}&filters=video==${vid}`;
    const types = await call(`${base}&dimensions=insightTrafficSourceType`);
    const byType = Object.fromEntries((types.rows || []).map(([t, v]) => [t, v]));
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    const rows = [["ALL", "", total]];
    if (byType.ANNOTATION) rows.push(["ANNOTATION", "", byType.ANNOTATION]);
    for (const kind of ["END_SCREEN", "RELATED_VIDEO"]) {
      if ((byType[kind] || 0) < RULES[kind].detailMin) continue;
      const d = await call(`${A}&startDate=${D}&endDate=${D}&filters=video==${vid};insightTrafficSourceType==${kind}&dimensions=insightTrafficSourceDetail&sort=-views&maxResults=10`);
      for (const [src, v] of d.rows || []) if (v >= 5 && src !== vid) rows.push([kind, src, v]);
    }
    // historia z 7 poprzednich dni (do wykrywania skoku)
    const { results: hist } = await db.prepare("SELECT kind, src, SUM(views) AS v FROM traffic_src WHERE video_id=? AND day BETWEEN ? AND ? GROUP BY kind, src")
      .bind(vid, from, to).all();
    const H = new Map(hist.map((h) => [h.kind + "|" + h.src, h.v]));
    for (const [kind, src, v] of rows) {
      const R = RULES[kind];
      if (!R || learning) continue;
      if (v < Math.max(R.min, R.share * total)) continue;
      const avg = (H.get(kind + "|" + src) || 0) / 7;
      if (v < SPIKE * avg) continue;
      cands.push({ vid, kind, src, v, total, score: v / Math.max(1, avg) * Math.log10(v) });
    }
    await db.batch([
      db.prepare("INSERT OR REPLACE INTO traffic_src (video_id, day, kind, src, views) SELECT ?, ?, json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]') FROM json_each(?)")
        .bind(vid, D, JSON.stringify(rows)),
    ]);
    q.i++;
  }

  // powiadomienia (max 3 na dzień danych)
  const st = [kvPut(db, "trf_q", JSON.stringify(q))];
  if (cands.length) {
    const used = Number(await kv(db, "trf_cnt:" + D)) || 0;
    const pick = cands.sort((a, b) => b.score - a.score).slice(0, Math.max(0, MAX_PER_DAY - used));
    if (pick.length) {
      const ids = [...new Set(pick.flatMap((c) => [c.vid, c.src]).filter(Boolean))];
      const { results: own } = await db.prepare("SELECT id, title FROM videos WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all();
      const T = new Map(own.map((x) => [x.id, { title: x.title, own: true }]));
      const ext = ids.filter((id) => !T.has(id));
      if (ext.length && calls < budget + 1) {
        try {
          const r = await call(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ext.join(",")}`);
          for (const it of r.items || []) T.set(it.id, { title: it.snippet.title, channel: it.snippet.channelTitle });
        } catch {}
      }
      const nowIso = new Date(now).toISOString();
      for (const c of pick) {
        const me = T.get(c.vid);
        if (!me) continue;
        const s = T.get(c.src);
        const srcTxt = s ? `„${s.title}”${s.own ? "" : s.channel ? ` (kanał ${s.channel})` : " (inny kanał)"}` : "z innego kanału";
        const pct = Math.round((c.v / c.total) * 100);
        const text = `„${me.title}” dostał ${c.v.toLocaleString("pl-PL")} wyświetleń ${RULES[c.kind].label(srcTxt)} – ${pct}% ruchu filmu tego dnia (${plDay(D)}).`;
        st.push(db.prepare("INSERT OR IGNORE INTO news (ts, type, text, video_id, uniq) VALUES (?,?,?,?,?)").bind(nowIso, "traffic", text, c.vid, `trf:${c.vid}:${c.kind}:${c.src}:${D}`));
      }
      st.push(kvPut(db, "trf_cnt:" + D, used + pick.length), db.prepare("DELETE FROM kv WHERE key LIKE 'trf_cnt:%' AND key < ?").bind("trf_cnt:" + isoDate(Date.parse(D) - 10 * DAYMS)));
    }
  }
  await db.batch(st);
  return { calls, day: D, done: q.i, of: q.ids.length };
}
