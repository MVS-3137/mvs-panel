import { refresh, kvGet, kvSet, linkProject, loadOverrides } from "../../lib/yt.js";
import { DEFS, DEF, MANUAL, unlockStmts, bestSubs } from "../../lib/ach.js";
import { generateTags } from "../../lib/tags.js";
import { topThumbs, importStmts } from "../../lib/thumbs.js";

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
        // Half-Life 3: liczymy przesunięcia (późniejszy start albo dłuższy film)
        const old = await db.prepare("SELECT start, planned_min FROM projects WHERE id=?").bind(Number(id)).first();
        if (old && ((b.start && b.start > old.start) || (b.planned_min && b.planned_min > old.planned_min))) {
          st.push(db.prepare("UPDATE projects SET shifts = COALESCE(shifts,0) + 1 WHERE id=?").bind(Number(id)));
        }
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
      if (user !== "Saito") return json({ error: "Ustawienia rytmu może zmieniać tylko Saito" }, 403);
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
        db.prepare("SELECT id, title, published, duration_s, thumb, wt, is_short, member, views, likes, comments, curve, approx24 FROM videos WHERE removed_at IS NULL ORDER BY published DESC"),
        db.prepare("SELECT id, ts, type, text, video_id FROM news ORDER BY id DESC LIMIT 60"),
      ]);
      const kv = Object.fromEntries(k.results.map((r) => [r.key, r.value]));
      const connected = !!(await kvGet(db, "yt_refresh_token"));
      const ov = await loadOverrides(db);
      return json({
        connected, configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), me: user,
        channel: { title: kv.channel_title || "", id: kv.channel_id || "", thumb: kv.channel_thumb || "", subs: kv.subs ? Number(kv.subs) : null },
        last_refresh: kv.last_refresh || null, last_error: kv.last_error || "",
        videos: v.results.map((r) => ({ ...r, curve: r.curve ? JSON.parse(r.curve) : null, manual: ov[r.id] || null })),
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
      stmts.push(db.prepare("UPDATE achievements SET members=? WHERE video_id=? AND (members IS NULL OR members='') AND id NOT IN ('press_f')").bind(b.member, id));
      stmts.push(db.prepare("UPDATE news SET type='info', text=? WHERE video_id=? AND type='unassigned'").bind(`Nowy film „${v.title}” (montował: ${b.member}, przypisał: ${user})`, id));
      await db.batch(stmts);
      return json({ ok: true });
    }

    if (res === "challenge" && method === "GET") {
      const [k, pts, ach] = await db.batch([
        db.prepare("SELECT key, value FROM kv WHERE key IN ('goal','goal_set_at','goal_reached_at','subs','subs_exact','subs_rate28','ach_start')"),
        db.prepare("SELECT ts, subs FROM goal_points ORDER BY ts"),
        db.prepare("SELECT id, unlocked_at, members, video_id, note FROM achievements"),
      ]);
      const K = Object.fromEntries(k.results.map((r) => [r.key, r.value]));
      const setAt = K.goal_set_at || "";
      return json({
        me: user, goal: K.goal ? Number(K.goal) : null, goal_set_at: setAt || null, goal_reached_at: K.goal_reached_at || null,
        subs: bestSubs(K), subs_exact: K.subs_exact ? Number(K.subs_exact) : null, rate28: K.subs_rate28 != null ? Number(K.subs_rate28) : null,
        started: K.ach_start || null,
        points: pts.results.filter((p) => p.ts >= setAt.slice(0, 19)),
        defs: DEFS, manual: MANUAL,
        unlocked: Object.fromEntries(ach.results.map((a) => [a.id, { ...a, members: a.members ? a.members.split(",") : [] }])),
      });
    }

    if (res === "goal" && method === "PUT") {
      const b = await readBody(request);
      const goal = Math.round(Number(b.goal));
      if (!(goal > 0 && goal < 1e9)) return bad("Podaj liczbę subów");
      const k = Object.fromEntries((await db.prepare("SELECT key, value FROM kv WHERE key IN ('goal','goal_reached_at','subs','subs_exact')").all()).results.map((r) => [r.key, r.value]));
      const now = new Date().toISOString(), subs = bestSubs(k);
      const st = [kvSet(db, "goal", goal), kvSet(db, "goal_set_at", now), db.prepare("DELETE FROM kv WHERE key='goal_reached_at'"),
        db.prepare("DELETE FROM goal_points"),
        db.prepare("INSERT OR IGNORE INTO news (ts, type, text, uniq) VALUES (?,?,?,?)").bind(now, "info", `${user} ustawił nowy cel: ${goal.toLocaleString("pl-PL")} subów.`, "goalset:" + now)];
      if (subs !== null) st.push(db.prepare("INSERT INTO goal_points (ts, subs) VALUES (?, ?)").bind(now, subs));
      if (k.goal_reached_at && Date.now() - Date.parse(k.goal_reached_at) <= 864e5 && goal > Number(k.goal)) st.push(...unlockStmts(db, "princess", {}, now));
      await db.batch(st);
      return json({ ok: true });
    }

    if (res === "achievements" && id && path[2] === "unlock" && method === "POST") {
      if (!MANUAL[id]) return bad("Tego achievementu nie odblokowuje się ręcznie");
      if (!MANUAL[id].includes(user)) return json({ error: `Ten achievement może odblokować tylko: ${MANUAL[id].join(", ")}` }, 403);
      const b = await readBody(request);
      const members = [...new Set((b.members || []).filter((m) => MEMBERS.includes(m)))];
      if (id === "dangerous_alone" && members.length !== 2) return bad("Wybierz dwie osoby, które zrobiły film razem");
      await db.batch(unlockStmts(db, id, { members: id === "toss_coin" ? [] : members, note: "odblokował: " + user }));
      return json({ ok: true });
    }

    if (res === "tags" && method === "POST") {
      const b = await readBody(request);
      const desc = String(b.desc || "").trim().slice(0, 3000), title = String(b.title || "").trim().slice(0, 150);
      if (desc.length < 15) return bad("Opisz film trochę dokładniej (min. kilka słów)");
      const { results } = await db.prepare("SELECT tags, views, curve, wt, is_short FROM videos WHERE removed_at IS NULL").all();
      const videos = results.map((r) => ({ ...r, curve: r.curve ? JSON.parse(r.curve) : null }));
      return json(await generateTags(env, { desc, title, wt: !!b.wt }, videos));
    }

    if (res === "thumbs" && method === "GET") {
      try { return json(await topThumbs(db)); }
      catch (e) { return json({ error: "Brak tabel na miniatury. Wykonaj SQL z pliku schema-miniatury.sql." }, 500); }
    }

    if (res === "ctr" && id === "import" && method === "POST") {
      const b = await readBody(request);
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
      const st = importStmts(db, rows.map((r) => ({ id: String(r.id || ""), ctr: Number(r.ctr), impressions: Number(r.impressions) })), new Date().toISOString());
      if (!st.length) return bad("Nie znaleziono w pliku filmów z CTR");
      for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
      return json({ ok: true, imported: st.length });
    }

    return json({ error: "Nie znaleziono" }, 404);
  } catch (e) {
    return typeof e === "string" ? bad(e) : json({ error: "Błąd serwera" }, 500);
  }
}

