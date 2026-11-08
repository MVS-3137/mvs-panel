// Panel MVS — generator tagów.
// Źródła: (1) tagi waszych filmów i ich wyniki, (2) podpowiedzi wyszukiwania YouTube (to, co ludzie wpisują),
// (3) darmowy model językowy Cloudflare Workers AI (binding AI). Bez AI działa w trybie uproszczonym.

import { curveAt } from "./yt.js";

export const LIMIT = 500;        // limit YouTube na wszystkie tagi razem
const TARGET = 420;              // zostawiamy zapas
const MAX_TAGS = 15;
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_FALLBACK = "@cf/meta/llama-3.1-8b-instruct-fast";

/* ---------- tekst ---------- */
const STOP = new Set("i w z na do o od za po się to jak co czy nie jest są dla ale lub oraz tym ten ta te tego jego ich już też tylko bardzo który która które ze we film filmie filmu video wideo gameplay odcinek".split(" "));
export function norm(s) {
  return String(s).toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w); // prymitywne „ucinanie” polskich końcówek
export const words = (s) => norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
export const tagCost = (t) => t.length + (t.includes(" ") ? 2 : 0); // YouTube liczy tagi ze spacją jak w cudzysłowie
export const totalCost = (tags) => tags.reduce((a, t) => a + tagCost(t), 0) + Math.max(0, tags.length - 1);
function cleanTag(t) {
  return String(t || "").replace(/[#"<>,]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60);
}

/* ---------- 1. wasze tagi i ich skuteczność ---------- */
export function ownTagStats(videos, wt) {
  const pool = videos.filter((v) => !v.is_short && v.tags && v.tags !== "[]");
  const val = (v) => (v.curve ? curveAt(v.curve, 168) : null) ?? v.views;
  const same = pool.filter((v) => !!v.wt === !!wt);
  const sorted = (same.length >= 5 ? same : pool).map(val).sort((a, b) => a - b);
  const med = sorted.length ? sorted[sorted.length >> 1] : 1;
  const map = new Map();
  for (const v of pool) {
    let tags = []; try { tags = JSON.parse(v.tags); } catch {}
    const perf = med > 0 ? val(v) / med : 1;
    for (const raw of new Set(tags.map(cleanTag).filter(Boolean))) {
      const s = map.get(raw) || { tag: raw, uses: 0, usesCat: 0, perfSum: 0, best: 0 };
      s.uses++; s.perfSum += perf; s.best = Math.max(s.best, val(v));
      if (!!v.wt === !!wt) s.usesCat++;
      map.set(raw, s);
    }
  }
  const n = same.length || pool.length || 1;
  return [...map.values()].map((s) => ({ ...s, perf: s.perfSum / s.uses, share: (same.length ? s.usesCat : s.uses) / n }));
}

function relevance(tag, keyStems) {
  const ws = words(tag).map(stem);
  if (!ws.length) return 0;
  return ws.filter((w) => keyStems.has(w)).length / ws.length;
}

/* ---------- 2. podpowiedzi wyszukiwania YouTube ---------- */
export async function ytSuggest(q) {
  try {
    const r = await fetch("https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=pl&gl=pl&q=" + encodeURIComponent(q), {
      headers: { "user-agent": "Mozilla/5.0 (panel MVS)" },
    });
    if (!r.ok) return [];
    const buf = await r.arrayBuffer();
    let txt = new TextDecoder("utf-8").decode(buf);
    if (txt.includes("�")) txt = new TextDecoder("iso-8859-2").decode(buf);
    const j = JSON.parse(txt);
    return (j[1] || []).map((s) => cleanTag(Array.isArray(s) ? s[0] : s)).filter(Boolean);
  } catch { return []; }
}

/* ---------- 3. AI ---------- */
function extractJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
async function askAI(env, desc, title, wt, own) {
  if (!env.AI) return null;
  const ownList = own.slice(0, 40).map((s) => `${s.tag} (użyty ${s.uses}×, wynik ${s.perf.toFixed(1)}×)`).join("; ");
  const messages = [
    { role: "system", content: "Jesteś ekspertem od SEO na YouTube dla polskiego kanału gamingowego MVS (głównie War Thunder, też inne gry). Odpowiadasz WYŁĄCZNIE poprawnym JSON-em, bez komentarzy." },
    { role: "user", content:
`Film: ${title ? `tytuł roboczy „${title}”. ` : ""}Kategoria: ${wt ? "War Thunder" : "inna gra"}.
Opis od twórcy: ${desc}

Tagi, których kanał używał wcześniej (wynik = wyświetlenia filmów z tym tagiem względem typowego filmu kanału):
${ownList || "brak danych"}

Zadanie:
1. "seeds": 3 krótkie frazy (2–4 słowa), które widzowie najpewniej wpisaliby w wyszukiwarkę YouTube, szukając takiego filmu. Po polsku, chyba że nazwa gry/pojazdu jest angielska.
2. "tags": 20 propozycji tagów: najpierw najbardziej konkretne (nazwy pojazdów, gier, trybów, nacji), potem frazy wyszukiwania, potem szersze. Mieszaj polskie i popularne angielskie nazwy własne. Dodaj typowe literówki nazw, jeśli są częste. Bez znaku #. Każdy tag max 40 znaków.
Format: {"seeds":["..."],"tags":["..."]}` },
  ];
  for (const model of [MODEL, MODEL_FALLBACK]) {
    try {
      const r = await env.AI.run(model, { messages, max_tokens: 700, temperature: 0.4 });
      const j = extractJson(r && (r.response ?? r.result?.response ?? r));
      if (j && Array.isArray(j.tags)) return { ...j, model };
    } catch {}
  }
  return null;
}

/* ---------- składanie wyniku ---------- */
export async function generateTags(env, { desc, title = "", wt = true }, videos) {
  const text = `${title} ${desc}`;
  const keyStems = new Set(words(text).map(stem));
  const own = ownTagStats(videos, wt);
  const ownRelevant = own.filter((s) => relevance(s.tag, keyStems) >= 0.5).sort((a, b) => b.perf * Math.log2(1 + b.uses) - a.perf * Math.log2(1 + a.uses));
  const brand = own.filter((s) => s.share >= 0.3).sort((a, b) => b.uses - a.uses).slice(0, 3);

  const ai = await askAI(env, desc, title, wt, [...ownRelevant, ...own.sort((a, b) => b.perf - a.perf)].slice(0, 40));
  const seeds = (ai?.seeds || []).map(cleanTag).filter(Boolean).slice(0, 3);
  if (!seeds.length) {
    const kw = [...new Set(words(text))].sort((a, b) => b.length - a.length);
    seeds.push(...[title, kw.slice(0, 2).join(" "), kw[0]].map(cleanTag).filter(Boolean));
  }

  // podpowiedzi YouTube dla fraz bazowych
  const sugLists = await Promise.all(seeds.slice(0, 3).map(ytSuggest));
  const suggested = new Set(sugLists.flat());
  const isSearched = (t) => suggested.has(t) || [...suggested].some((s) => s.startsWith(t + " ") || s === t);

  const cand = new Map();
  const add = (tag, score, src) => {
    const t = cleanTag(tag); if (!t || t.length < 2) return;
    const c = cand.get(t) || { tag: t, score: 0, src: new Set() };
    c.score += score; c.src.add(src); cand.set(t, c);
  };
  (ai?.tags || []).forEach((t, i) => add(t, 3 - i * 0.08, "ai"));
  seeds.forEach((t) => add(t, 2.5, "ai"));
  const ownBoost = (o) => Math.min(2, o.perf) * Math.min(1, (o.uses - 1) / 3); // 1 film to za mało, żeby ufać wynikowi
  for (const s of ownRelevant.slice(0, 12)) add(s.tag, 0.5 + ownBoost(s), "own");
  for (const s of [...suggested].filter((s) => relevance(s, keyStems) >= 0.5).slice(0, 8)) add(s, 1.5, "search");
  for (const c of cand.values()) {
    if (isSearched(c.tag)) { c.score += 2; c.src.add("search"); }
    const o = own.find((s) => s.tag === c.tag);
    if (o) { c.score += ownBoost(o); c.src.add("own"); c.own = o; }
    if (relevance(c.tag, keyStems) === 0 && !c.src.has("ai")) c.score -= 2;
  }
  for (const b of brand) { add(b.tag, 0, "brand"); const c = cand.get(b.tag); c.brand = true; c.own = b; }

  // wybór w limicie: najpierw najlepsze, marka na końcu
  const ranked = [...cand.values()].filter((c) => !c.brand).sort((a, b) => b.score - a.score);
  const picked = [];
  const brandTags = [...cand.values()].filter((c) => c.brand);
  const reserve = totalCost(brandTags.map((c) => c.tag)) + brandTags.length;
  for (const c of ranked) {
    if (picked.length >= MAX_TAGS - brandTags.length) break;
    if (picked.some((p) => norm(p.tag) === norm(c.tag))) continue;
    if (totalCost([...picked, c].map((x) => x.tag)) + reserve > TARGET) continue;
    picked.push(c);
  }
  for (const b of brandTags) if (totalCost([...picked, b].map((x) => x.tag)) <= LIMIT) picked.push(b);

  const out = picked.map((c) => ({
    tag: c.tag,
    sources: [...c.src],
    searched: c.src.has("search"),
    perf: c.own ? Math.round(c.own.perf * 10) / 10 : null,
    uses: c.own ? c.own.uses : 0,
  }));
  return {
    tags: out,
    chars: totalCost(out.map((t) => t.tag)),
    limit: LIMIT,
    ai: ai ? ai.model : null,
    seeds,
    suggestions: [...suggested].slice(0, 20),
    ownTop: ownRelevant.slice(0, 15).map((s) => ({ tag: s.tag, uses: s.uses, perf: Math.round(s.perf * 10) / 10 })),
  };
}
