// API panelu MVS — Cloudflare Pages Functions + D1 (binding: DB)
// Dostęp do całej strony (także /api) chroni Cloudflare Access, więc tutaj
// tylko zapisujemy, kto wprowadził zmianę.

const MEMBERS = ["Malvel", "Virtuoso", "Saito"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const bad = (msg) => json({ error: msg }, 400);

function who(request) {
  return request.headers.get("cf-access-authenticated-user-email") || "nieznany";
}

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

export async function onRequest({ request, env, params }) {
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
      return json({ projects: p.results, leaves: l.results, settings, me: who(request) });
    }

    if (res === "projects") {
      if (method === "POST") {
        const b = cleanProject(await readBody(request));
        for (const k of ["member", "title", "start", "planned_min"]) if (b[k] === undefined) return bad("Brak pola " + k);
        const r = await db.prepare(
          "INSERT INTO projects (member, title, start, planned_min, wt, created_by) VALUES (?,?,?,?,?,?)"
        ).bind(b.member, b.title, b.start, b.planned_min, b.wt ?? 1, who(request)).run();
        return json({ id: r.meta.last_row_id });
      }
      if (method === "PUT" && id) {
        const b = cleanProject(await readBody(request));
        const keys = Object.keys(b);
        if (!keys.length) return bad("Brak zmian");
        await db.prepare(`UPDATE projects SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`)
          .bind(...keys.map((k) => b[k]), Number(id)).run();
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
          .bind(b.member, b.from_date, b.to_date, String(b.note || "").slice(0, 120), who(request)).run();
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

    return json({ error: "Nie znaleziono" }, 404);
  } catch (e) {
    return typeof e === "string" ? bad(e) : json({ error: "Błąd serwera" }, 500);
  }
}
