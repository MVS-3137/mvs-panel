// Łączenie panelu z kanałem YouTube (Google OAuth). Dostęp tylko po zalogowaniu do panelu.
import { kvSet, refresh } from "../../lib/yt.js";

const SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly";

const html = (msg, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel MVS</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1322;color:#ecdfcb;font:15px system-ui,sans-serif;padding:16px">
<div style="max-width:440px;background:#14203a;border:1px solid #24365a;border-radius:14px;padding:22px;text-align:center">${msg}
<p><a href="/#perf" style="color:#dda061">Wróć do panelu</a></p></div></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );

export async function onRequest({ request, env, params, data, waitUntil }) {
  const url = new URL(request.url);
  const step = (params.path || [])[0];
  const redirect = url.origin + "/oauth/callback";

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return html("Brakuje sekretów <b>GOOGLE_CLIENT_ID</b> i <b>GOOGLE_CLIENT_SECRET</b> w ustawieniach Cloudflare.", 500);
  }

  if (step === "start") {
    const state = crypto.randomUUID();
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: SCOPES,
      access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state,
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: "https://accounts.google.com/o/oauth2/v2/auth?" + q,
        "set-cookie": `mvs_oauth=${state}; Path=/oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  if (step === "callback") {
    const cookie = (request.headers.get("cookie") || "").match(/mvs_oauth=([^;]+)/);
    if (url.searchParams.get("error")) return html("Google odmówił dostępu: " + url.searchParams.get("error").replace(/[<>&]/g, ""), 400);
    if (!cookie || cookie[1] !== url.searchParams.get("state")) return html("Sesja łączenia wygasła. Spróbuj jeszcze raz.", 400);

    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: url.searchParams.get("code") || "", client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect, grant_type: "authorization_code",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) return html("Nie udało się połączyć: " + String(j.error_description || j.error || r.status).replace(/[<>&]/g, ""), 400);
    if (!String(j.scope || "").includes("yt-analytics")) return html("Zaznacz wszystkie zgody na ekranie Google (także Analytics) i spróbuj jeszcze raz.", 400);

    await env.DB.batch([kvSet(env.DB, "yt_refresh_token", j.refresh_token), kvSet(env.DB, "connected_by", (data && data.user) || "")]);
    waitUntil(refresh(env).catch((e) => env.DB.batch([kvSet(env.DB, "last_error", new Date().toISOString() + " " + e.message)])));
    return new Response(null, { status: 302, headers: { location: "/#perf", "set-cookie": "mvs_oauth=; Path=/oauth; Max-Age=0" } });
  }

  return html("Nie znaleziono", 404);
}
