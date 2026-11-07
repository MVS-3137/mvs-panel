import { refresh, kvGet, kvSet, linkProject } from "../../lib/yt.js";

// API panelu MVS — Cloudflare Pages Functions + D1 (binding: DB)
// Dostęp chroni functions/_middleware.js (hasła), który podaje zalogowaną osobę w data.user.

const MEMBERS = ["Malvel", "Virtuoso", "Saito"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const bad = (msg) => json({ error: msg }, 400);


async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function cleanProject(b) {
  const out = {};
  if (b.member !== undefined) { if (!MEMBERS.includes(b.member)) throw "Nieznana osoba"; out.member = b.member; }
  if (b.title !== undefined) { const t = String(b.title).trim().slice(0, 200); if (!t) throw "Brak tytułu"; out.title = t; }
  if (b.start !== undefined) { if (!DATE.test(b.start)) throw "Zła data startu"; out.start = b.start; }
  if (b.planned_min !== undefined) { const n = Number(b.planned_min); if (!(n > 0 && n < 600)) throw "Zła długość"; out.planned_min = n; }
  if (b.wt !== undefined) out.wt = b.wt ? 1 : 0;
  if (b.status !== undefined) { if (!["active", "done"].includes(b.status)) throw "Zły status"; out.status = b.status; }
  if (b.uploaded !== undefined) { if (b.uploaded !== null && !DATE.test(b.uploaded)) throw "Zła data wrzucenia"; out.uploaded = b.uploaded; }
  if (b.actual_min !== undefined) { const n = b.actual_min === null ? null : Number(b.actual_min); if (n !== null && !(n > 0 && n < 600)) throw "Zła długość"; out.actual_min = n; }
  if (b.video_url !== undefined) out.video_url = b.video_url ? String(b.video_url).slice(0, 300) : null;
  return out;
}

export async function onRequest({ request, env, params, data }) {
  const user = (data && data.user) || "nieznany";
  const db = env.DB;
  if (!db) return json({ error: "Brak bazy D1 (binding DB)" }, 500);
  const path = params.path || [];
  const [res, id] = path;
  const method = request.method;

  try {
    if (res === "state" && method === "GET") {
      const [p, l, s] = await db.batch([
        db.prepare("SELECT * FROM projects ORDER BY start"),
        db.prepare("SELECT * FROM leaves ORDER BY from_date"),
        db.prepare("SELECT key, value FROM settings"),
      ]);
      const settings = {};
      for (const r of s.results) settings[r.key] = Number(r.value);
      return json({ projects: p.results, leaves: l.results, settings, me: user });
    }

    if (res === "projects") {
      if (method === "POST") {
        const b = cleanProject(await readBody(request));
        for (const k of ["member", "title", "start", "planned_min"]) if (b[k] === undefined) return bad("Brak pola " + k);
        const r = await db.prepare(
          "INSERT INTO projects (member, title, start, planned_min, wt, created_by) VALUES (?,?,?,?,?,?)"
        ).bind(b.member, b.title, b.start, b.planned_min, b.wt ?? 1, user).run();
        return json({ id: r.meta.last_row_id });
      }
      if (method === "PUT" && id) {
        const b = cleanProject(await readBody(request));
        const keys = Object.keys(b);
        if (!keys.length) return bad("Brak zmian");
        const st = [db.prepare(`UPDATE projects SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`).bind(...keys.map((k) => b[k]), Number(id))];
        if (b.status === "active") st.push(
          db.prepare("UPDATE videos SET member=NULL, project_id=NULL WHERE project_id=?").bind(Number(id)),
          db.prepare("UPDATE projects SET video_id=NULL WHERE id=?").bind(Number(id)));
        await db.batch(st);
        return json({ ok: true });
      }
      if (method === "DELETE" && id) {
        await db.prepare("DELETE FROM projects WHERE id=?").bind(Number(id)).run();
        return json({ ok: true });
      }
    }

    if (res === "leaves") {
      if (method === "POST") {
        const b = await readBody(request);
        if (!MEMBERS.includes(b.member)) return bad("Nieznana osoba");
        if (!DATE.test(b.from_date) || !DATE.test(b.to_date) || b.to_date < b.from_date) return bad("Złe daty");
        const r = await db.prepare("INSERT INTO leaves (member, from_date, to_date, note, created_by) VALUES (?,?,?,?,?)")
          .bind(b.member, b.from_date, b.to_date, String(b.note || "").slice(0, 120), user).run();
        return json({ id: r.meta.last_row_id });
      }
      if (method === "DELETE" && id) {
        await db.prepare("DELETE FROM leaves WHERE id=?").bind(Number(id)).run();
        return json({ ok: true });
      }
    }

    if (res === "settings" && method === "PUT") {
      const b = await readBody(request);
      const allowed = ["cadence", "workPerMin", "minWork", "restPerMin"];
      const stmts = [];
      for (const k of allowed) {
        if (b[k] === undefined) continue;
        const n = Number(b[k]);
        if (!(n >= 0 && n < 100)) return bad("Zła wartość: " + k);
        stmts.push(db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, String(n)));
      }
      if (stmts.length) await db.batch(stmts);
      return json({ ok: true });
    }

    if (res === "yt" && method === "GET") {
      const [k, v, n] = await db.batch([
        db.prepare("SELECT key, value FROM kv WHERE key IN ('channel_title','channel_id','channel_thumb','subs','last_refresh','last_error','records')"),
        db.prepare("SELECT id, title, published, duration_s, thumb, wt, is_short, member, views, likes, comments, curve, approx24 FROM videos ORDER BY published DESC"),
        db.prepare("SELECT id, ts, type, text, video_id FROM news ORDER BY id DESC LIMIT 60"),
      ]);
      const kv = Object.fromEntries(k.results.map((r) => [r.key, r.value]));
      const connected = !!(await kvGet(db, "yt_refresh_token"));
      return json({
        connected, configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), me: user,
        channel: { title: kv.channel_title || "", id: kv.channel_id || "", thumb: kv.channel_thumb || "", subs: kv.subs ? Number(kv.subs) : null },
        last_refresh: kv.last_refresh || null, last_error: kv.last_error || "",
        videos: v.results.map((r) => ({ ...r, curve: r.curve ? JSON.parse(r.curve) : null })),
        news: n.results,
      });
    }

    if (res === "refresh" && method === "POST") {
      const last = await kvGet(db, "last_refresh");
      if (user !== "cron" && last && Date.now() - Date.parse(last) < 60e3) return bad("Odświeżano przed chwilą, poczekaj minutę");
      try {
        return json(await refresh(env));
      } catch (e) {
        await db.batch([kvSet(db, "last_error", new Date().toISOString() + " " + e.message)]);
        return json({ error: e.message }, 502);
      }
    }

    if (res === "videos" && id && path[2] === "assign" && method === "POST") {
      const b = await readBody(request);
      const v = await db.prepare("SELECT * FROM videos WHERE id=?").bind(id).first();
      if (!v) return json({ error: "Nie ma takiego filmu" }, 404);
      if (!MEMBERS.includes(b.member)) return bad("Nieznana osoba");
      const stmts = [db.prepare("UPDATE videos SET member=? WHERE id=?").bind(b.member, id)];
      if (!v.project_id) {
        const p = await db.prepare("SELECT * FROM projects WHERE member=? AND video_id IS NULL ORDER BY (status='active') DESC, start DESC LIMIT 1").bind(b.member).first();
        if (p) stmts.push(...linkProject(db, v, p));
      }
      stmts.push(db.prepare("UPDATE news SET type='info', text=? WHERE video_id=? AND type='unassigned'").bind(`Nowy film „${v.title}” (montował: ${b.member}, przypisał: ${user})`, id));
      await db.batch(stmts);
      return json({ ok: true });
    }

    return json({ error: "Nie znaleziono" }, 404);
  } catch (e) {
    return typeof e === "string" ? bad(e) : json({ error: "Błąd serwera" }, 500);
  }
}

