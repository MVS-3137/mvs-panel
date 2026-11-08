// Panel MVS — Konkurencja: dwie tabele kanałów (War Thunder: stała, liga PL: edytowalna).
// Raz dziennie zapisuje suby, wyświetlenia i liczbę filmów każdego kanału.

const DAYMS = 864e5;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const OWN_ID = "UC57B3vFUeVbjNS3Ob-nINkA";
export const EDITABLE = new Set(["pl"]);

const API = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics";

// codzienna aktualizacja; gfetch(url) zwraca JSON z autoryzacją
export async function updateComp(db, gfetch, now) {
  const today = isoDate(now);
  const k = await db.prepare("SELECT value FROM kv WHERE key='comp_day'").first();
  if (k && k.value === today) return { skipped: true };
  const { results } = await db.prepare("SELECT DISTINCT id FROM comp_channels").all();
  const ids = results.map((r) => r.id);
  const st = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await gfetch(`${API}&id=${ids.slice(i, i + 50).join(",")}`);
    for (const c of r.items || []) {
      st.push(db.prepare("UPDATE comp_channels SET title=?, thumb=?, handle=COALESCE(?, handle) WHERE id=?")
        .bind(c.snippet.title, c.snippet.thumbnails?.default?.url || "", c.snippet.customUrl || null, c.id));
      st.push(db.prepare("INSERT OR REPLACE INTO comp_stats (id, day, subs, views, videos) VALUES (?,?,?,?,?)")
        .bind(c.id, today, c.statistics.hiddenSubscriberCount ? null : Number(c.statistics.subscriberCount), Number(c.statistics.viewCount || 0), Number(c.statistics.videoCount || 0)));
    }
  }
  st.push(db.prepare("INSERT INTO kv (key, value) VALUES ('comp_day', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(today));
  st.push(db.prepare("DELETE FROM comp_stats WHERE day < ?").bind(isoDate(now - 120 * DAYMS)));
  await db.batch(st);
  return { channels: ids.length };
}

// link / @nazwa / ID → zapytanie do API
export function parseChannelInput(input) {
  const s = String(input || "").trim();
  let m = s.match(/(UC[A-Za-z0-9_-]{22})/);
  if (m) return { by: "id", value: m[1] };
  m = s.match(/@([A-Za-z0-9._\-À-ž]{2,100})/);
  if (m) return { by: "forHandle", value: "@" + m[1] };
  m = s.match(/youtube\.com\/(?:user)\/([^/?#]+)/i);
  if (m) return { by: "forUsername", value: m[1] };
  if (/^[A-Za-z0-9._-]{3,100}$/.test(s)) return { by: "forHandle", value: "@" + s };
  return null;
}

export async function resolveChannel(gfetch, input) {
  const p = parseChannelInput(input);
  if (!p) return null;
  const r = await gfetch(`${API}&${p.by}=${encodeURIComponent(p.value)}`);
  return (r.items || [])[0] || null;
}

// tabela: obecny stan + zmiana z ~28 dni
export async function compTables(db, now = Date.now()) {
  const [ch, stats] = await db.batch([
    db.prepare("SELECT id, list, title, handle, thumb, added_by FROM comp_channels"),
    db.prepare("SELECT id, day, subs, views FROM comp_stats ORDER BY day"),
  ]);
  const by = {};
  for (const s of stats.results) (by[s.id] ||= []).push(s);
  const target = isoDate(now - 28 * DAYMS);
  const lists = { wt: [], pl: [] };
  let updated = null;
  for (const c of ch.results) {
    const rows = by[c.id] || [];
    const last = rows[rows.length - 1];
    if (last && (!updated || last.day > updated)) updated = last.day;
    // punkt odniesienia: ostatni pomiar sprzed ≥28 dni, a gdy go brak – najstarszy dostępny
    const base = [...rows].reverse().find((r) => r.day <= target) || rows[0];
    const row = {
      id: c.id, title: c.title, handle: c.handle, thumb: c.thumb, own: c.id === OWN_ID, added_by: c.added_by,
      subs: last ? last.subs : null, views: last ? last.views : null, baseDay: base && base !== last ? base.day : null,
    };
    if (row.baseDay && last) {
      row.dSubs = last.subs != null && base.subs != null ? last.subs - base.subs : null;
      row.pSubs = row.dSubs != null && base.subs > 0 ? (row.dSubs / base.subs) * 100 : null;
      row.dViews = last.views - base.views;
      row.pViews = base.views > 0 ? (row.dViews / base.views) * 100 : null;
      row.days = Math.round((Date.parse(last.day) - Date.parse(base.day)) / DAYMS);
    }
    (lists[c.list] ||= []).push(row);
  }
  return { lists, updated, editable: [...EDITABLE] };
}
