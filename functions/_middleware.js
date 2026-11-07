// Logowanie do panelu MVS: każdy ma własne hasło.
// Hasła NIE są w kodzie. Ustawia się je w Cloudflare jako sekrety:
//   PASS_MALVEL, PASS_VIRTUOSO, PASS_SAITO, SESSION_SECRET
// (etap 2: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_KEY)

const MEMBERS = ["Malvel", "Virtuoso", "Saito"];
const COOKIE = "mvs_session";
const DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// porównanie odporne na mierzenie czasu
async function same(secret, a, b) {
  const [x, y] = await Promise.all([hmac(secret, "cmp:" + a), hmac(secret, "cmp:" + b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

async function makeToken(secret, member) {
  const exp = Date.now() + DAYS * 864e5;
  const body = `${member}.${exp}`;
  return `${body}.${await hmac(secret, body)}`;
}

async function readToken(secret, request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [member, exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!MEMBERS.includes(member) || !(Number(exp) > Date.now())) return null;
  return (await same(secret, sig || "", await hmac(secret, `${member}.${exp}`))) ? member : null;
}

const passFor = (env, member) => env["PASS_" + member.toUpperCase()];

function page(msg = "", status = 200) {
  const opts = MEMBERS.map((m) => `<option>${m}</option>`).join("");
  return new Response(
    `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel MVS – logowanie</title><link rel="icon" href="/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#0c1322;
background-image:radial-gradient(900px 400px at 50% -100px,#1a2a4a,transparent 70%);color:#ecdfcb;font:15px Inter,system-ui,sans-serif}
form{width:min(360px,100%);background:linear-gradient(180deg,#192842,#14203a);border:1px solid #24365a;border-radius:16px;padding:26px;text-align:center}
img{width:120px;height:120px;border-radius:16px;border:1px solid #b98447;margin-bottom:12px}
h1{font:600 22px Oswald,"Arial Narrow",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#dda061;margin:0 0 18px}
label{display:block;text-align:left;font-size:12px;color:#9ba6bb;margin:10px 0 4px}
select,input{width:100%;font:inherit;color:inherit;background:#0c1322;border:1px solid #24365a;border-radius:10px;padding:10px}
select:focus,input:focus{outline:2px solid #b98447;outline-offset:-1px}
button{width:100%;margin-top:18px;background:#dda061;color:#1a1206;border:0;border-radius:10px;padding:11px;font:600 15px Inter,sans-serif;cursor:pointer}
.err{color:#e2735f;font-size:13.5px;margin-top:12px;min-height:1em}
</style></head><body>
<form method="post" action="/login">
<img src="/logo.jpg" alt="Logo MVS"><h1>Panel MVS</h1>
<label>Kim jesteś?</label><select name="member">${opts}</select>
<label>Hasło</label><input type="password" name="password" required autofocus autocomplete="current-password">
<button>Wejdź</button><div class="err">${msg}</div>
</form></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

const PUBLIC = ["/logo.jpg", "/favicon.png", "/privacy", "/privacy.html"];

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  const secret = env.SESSION_SECRET;

  if (PUBLIC.includes(url.pathname)) return next();

  if (!secret || MEMBERS.some((m) => !passFor(env, m))) {
    return new Response("Panel nie ma jeszcze ustawionych haseł (PASS_MALVEL, PASS_VIRTUOSO, PASS_SAITO, SESSION_SECRET).", {
      status: 503, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (url.pathname === "/logout") {
    return new Response(null, {
      status: 302,
      headers: { location: "/login", "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  if (url.pathname === "/login") {
    if (request.method === "POST") {
      const f = await request.formData();
      const member = String(f.get("member") || "");
      const pass = String(f.get("password") || "");
      if (MEMBERS.includes(member) && (await same(secret, pass, passFor(env, member)))) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/",
            "set-cookie": `${COOKIE}=${encodeURIComponent(await makeToken(secret, member))}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
      await new Promise((r) => setTimeout(r, 1200)); // spowalnia zgadywanie haseł
      return page("Złe hasło. Spróbuj jeszcze raz.", 401);
    }
    return page();
  }

  // automatyczne odświeżanie z crona (osobny Worker z kluczem CRON_KEY)
  const cronKey = request.headers.get("x-cron-key");
  if (cronKey && url.pathname === "/api/refresh" && env.CRON_KEY && (await same(secret, cronKey, env.CRON_KEY))) {
    data.user = "cron";
    return next();
  }

  const member = await readToken(secret, request);
  if (!member) {
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Zaloguj się ponownie" }), { status: 401, headers: { "content-type": "application/json" } });
    }
    return Response.redirect(new URL("/login", url).toString(), 302);
  }

  data.user = member;
  return next();
}
