// Panel MVS – budzik. Co godzinę prosi panel o pobranie świeżych danych z YouTube.
export default {
  async scheduled(event, env, ctx) {
    const r = await fetch(env.PANEL_URL.replace(/\/$/, "") + "/api/refresh", {
      method: "POST",
      headers: { "x-cron-key": env.CRON_KEY },
    });
    console.log("refresh", r.status, (await r.text()).slice(0, 300));
  },
  async fetch() {
    return new Response("Budzik panelu MVS działa.");
  },
};
