// Panel MVS – budzik. Co godzinę prosi panel o pobranie świeżych danych z YouTube.
// Diagnostyka: otwórz adres workera z ?key=TWÓJ_CRON_KEY, żeby uruchomić odświeżenie ręcznie i zobaczyć wynik.

async function wake(env) {
  if (!env.PANEL_URL || /WPISZ/.test(env.PANEL_URL)) return { status: 0, body: "Brak PANEL_URL w cron/wrangler.toml" };
  if (!env.CRON_KEY) return { status: 0, body: "Brak sekretu CRON_KEY w ustawieniach workera mvs-budzik" };
  const r = await fetch(env.PANEL_URL.replace(/\/$/, "") + "/api/refresh", { method: "POST", headers: { "x-cron-key": env.CRON_KEY } });
  return { status: r.status, body: (await r.text()).slice(0, 600) };
}

export default {
  async scheduled(event, env, ctx) {
    const r = await wake(env);
    console.log("refresh", r.status, r.body);
  },
  async fetch(request, env) {
    const key = new URL(request.url).searchParams.get("key");
    if (!key) return new Response("Budzik panelu MVS działa. Dopisz ?key=… (CRON_KEY), żeby uruchomić odświeżenie ręcznie.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (key !== env.CRON_KEY) return new Response("Zły klucz (inny niż CRON_KEY w budziku).", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    const r = await wake(env);
    const hint = r.status === 200 ? "OK – panel odświeżony." : r.status === 401 ? "Panel odrzucił klucz: CRON_KEY w panelu (Pages) i w budziku muszą być identyczne, a panel po dodaniu sekretu wymaga ponownego wdrożenia." : r.status === 503 ? "Panel nie ma ustawionych haseł/sekretów." : r.status === 0 ? "" : "Sprawdź komunikat poniżej.";
    return new Response(`Status panelu: ${r.status}\n${hint}\n\n${r.body}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
