/* ===========================================================
   NEMESIS APP-MODUL  ·  nemesis-app.js
   Wird von nemesis-sync.js gerufen (eine Zeile, vom Installer).

   Liefert:
     GET  /app                  -> die Nemesis-Lab-App (nur mit Zugangs-Pfad)
     GET  /manifest.webmanifest -> damit die App aufs Handy-Home kann
     POST /llm                  -> KI-Anfrage, Schluessel bleiben auf dem Server
     GET  /llm/status           -> welche Anbieter bereit sind, Verbrauch

   Alles unter /app und /llm geht NUR ueber /k/<NEMESIS_ZUGANG>/...
   Node 18+, keine Abhaengigkeiten.
   =========================================================== */

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const VERSION = "2026-10-01.1";
const APP_DATEI = path.join(DIR, "nemesis-app.html");

/* ---------- Schluessel: aus Umgebung, sonst aus .env daneben ---------- */
let envCache = null, envZeit = 0;
function dotenv() {
  if (envCache && Date.now() - envZeit < 60000) return envCache;
  const e = {};
  try {
    for (const z of fs.readFileSync(path.join(DIR, ".env"), "utf8").split(/\r?\n/)) {
      const m = z.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) e[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (err) {}
  envCache = e; envZeit = Date.now();
  return e;
}
// Beim Start: .env in die Umgebung holen, falls der Dienst sie nicht selbst laedt.
(function () {
  const d = dotenv();
  for (const k of Object.keys(d)) if (process.env[k] === undefined && d[k] !== "") process.env[k] = d[k];
})();

// Unsichtbares vom Einfuegen entfernen: Leerzeichen, \r, Anfuehrungszeichen, "Bearer "
function sauber(v) {
  return String(v || "").replace(/[\r\n\t]/g, "").trim().replace(/^['"]+|['"]+$/g, "").replace(/^Bearer\s+/i, "").trim();
}

function schluessel(namen) {
  const d = dotenv();
  for (const n of namen) {
    const v = sauber(process.env[n]) || sauber(d[n]);
    if (v && v.length > 8) return v;
  }
  // Andere Schreibweisen, z.B. GROQ_KEY_1, NEMESIS_GEMINI_KEY
  const stamm = namen[0].split("_")[0];
  const re = new RegExp("(^|_)" + stamm + "(_|$).*(KEY|TOKEN)", "i");
  for (const quelle of [process.env, d]) {
    for (const k of Object.keys(quelle)) {
      if (re.test(k) && !/ADMIN|ZUGANG/.test(k) && sauber(quelle[k]).length > 8) return sauber(quelle[k]);
    }
  }
  return "";
}

/* ---------- Anbieter ---------- */
const ANBIETER = {
  groq:       { frei: true,  url: "https://api.groq.com/openai/v1/chat/completions",
                liste: "https://api.groq.com/openai/v1/models", keys: ["GROQ_API_KEY", "GROQ_KEY"],
                standard: "llama-3.3-70b-versatile" },
  openrouter: { frei: true,  url: "https://openrouter.ai/api/v1/chat/completions",
                liste: "https://openrouter.ai/api/v1/models", keys: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
                nurFrei: /:free$/i, standard: "" },
  gemini:     { frei: true,  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                liste: "https://generativelanguage.googleapis.com/v1beta/openai/models",
                keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GEMINI_API_KEY"],
                standard: "gemini-2.5-flash" },
  cohere:     { frei: true,  url: "https://api.cohere.ai/compatibility/v1/chat/completions",
                liste: "https://api.cohere.com/v1/models", keys: ["COHERE_API_KEY", "CO_API_KEY"],
                standard: "command-r-08-2024" },
  mistral:    { frei: true,  url: "https://api.mistral.ai/v1/chat/completions",
                liste: "https://api.mistral.ai/v1/models", keys: ["MISTRAL_API_KEY"],
                standard: "mistral-small-latest" },
  together:   { frei: true,  url: "https://api.together.xyz/v1/chat/completions",
                liste: "https://api.together.xyz/v1/models", keys: ["TOGETHER_API_KEY", "TOGETHER_AI_API_KEY"],
                nurFrei: /free/i, standard: "" },
  openai:     { frei: false, url: "https://api.openai.com/v1/chat/completions",
                liste: "https://api.openai.com/v1/models", keys: ["OPENAI_API_KEY"],
                standard: "gpt-4o-mini" },
};

// Modelle, die keine Chat-Modelle sind
const KEIN_CHAT = /embed|tts|whisper|audio|image|dall-e|guard|moderation|realtime|transcribe|rerank|search|vision-preview|playai|compound|sora|computer-use|codex/i;

/* ---------- Routing: was fuer welche Aufgabe (gratis zuerst, OpenAI zuletzt) ---------- */
const WAHL = {
  code: [
    ["groq", [/qwen.*coder/i, /qwen3/i, /gpt-oss-120b/i]],
    ["openrouter", [/qwen3-coder.*:free/i, /coder.*:free/i, /gpt-oss-120b.*:free/i]],
    ["mistral", [/codestral/i, /devstral/i]],
    ["gemini", [/flash-lite/i, /flash/i]],
    ["groq", [/llama-3\.3-70b/i]],
    ["openai", [/^gpt-5\.4-mini/i, /^gpt-5(\.\d)?-mini/i, /^gpt-4\.1-mini/i, /^gpt-4o-mini$/i]],
  ],
  denken: [
    ["openrouter", [/nemotron.*ultra.*:free/i, /nemotron.*:free/i, /gpt-oss-120b.*:free/i, /deepseek.*r1.*:free/i]],
    ["groq", [/gpt-oss-120b/i, /llama-3\.3-70b/i]],
    ["gemini", [/^gemini-[\d.]+-flash$/i, /flash(?!-lite)/i]],
    ["cohere", [/command-a/i, /command-r-plus/i]],
    ["openai", [/^gpt-5\.5$/i, /^gpt-5\.5/i, /^gpt-5(\.\d)?$/i, /^gpt-4\.1$/i, /^gpt-4o$/i]],
  ],
  lang: [
    ["gemini", [/flash-lite/i, /flash/i]],
    ["openrouter", [/gemini.*flash.*:free/i]],
    ["openai", [/^gpt-5\.4-mini/i, /^gpt-5(\.\d)?-mini/i, /^gpt-4\.1-mini/i, /^gpt-4o-mini$/i]],
  ],
  normal: [
    ["groq", [/gpt-oss-120b/i, /llama-3\.3-70b/i]],
    ["gemini", [/flash-lite/i, /flash/i]],
    ["cohere", [/command-a/i, /command-r/i]],
    ["openrouter", [/nemotron.*:free/i, /gpt-oss.*:free/i, /qwen.*:free/i, /llama.*70b.*:free/i, /:free$/i]],
    ["mistral", [/^mistral-small/i, /small/i]],
    ["together", [/free/i]],
    ["openai", [/^gpt-5\.4-mini/i, /^gpt-5(\.\d)?-mini/i, /^gpt-4\.1-mini/i, /^gpt-4o-mini$/i]],
  ],
};

// Ganz am Ende jeder Kette: OpenAI-Modell ohne Denk-Modus (liefert immer Text)
const RETTUNG = [["openai", [/^gpt-4\.1-mini$/i, /^gpt-4o-mini$/i, /^gpt-4\.1$/i, /^gpt-4o$/i, /^gpt-5(\.\d)?-chat/i]]];
for (const k of Object.keys(WAHL)) WAHL[k] = WAHL[k].concat(RETTUNG);

// Manuell: "!model <key>" in der Nachricht oder Modell-Wahl im Zahnrad
const HAND = {
  gemini:     [["gemini", [/flash-lite/i, /flash/i]]],
  nemotron:   [["openrouter", [/nemotron.*ultra.*:free/i, /nemotron.*:free/i]], ["groq", [/nemotron/i]]],
  qwen:       [["groq", [/qwen.*coder/i, /qwen/i]], ["openrouter", [/qwen3-coder.*:free/i, /qwen.*:free/i]]],
  cohere:     [["cohere", [/command-a/i, /command-r/i]]],
  gptoss:     [["groq", [/gpt-oss-120b/i]], ["openrouter", [/gpt-oss-120b.*:free/i, /gpt-oss.*:free/i]]],
  mistral:    [["mistral", [/^mistral-small/i, /small/i]]],
  llama:      [["groq", [/llama-3\.3-70b/i, /llama/i]], ["openrouter", [/llama.*:free/i]]],
  openrouter: [["openrouter", [/:free$/i]]],
  gpt55:      [["openai", [/^gpt-5\.5$/i, /^gpt-5\.5/i, /^gpt-5(\.\d)?$/i]]],
  gpt54mini:  [["openai", [/^gpt-5\.4-mini/i, /^gpt-5(\.\d)?-mini/i, /^gpt-4o-mini$/i]]],
};

/* ---------- Zustand im Speicher ---------- */
const listen = {};            // anbieter -> { ids, zeit }
const pause = {};             // anbieter -> bis wann gesperrt (ms)
const zaehler = { anfragen: 0, frei: 0, bezahlt: 0, fehler: 0, proAnbieter: {}, seit: new Date().toISOString() };
let letzterFehler = null;
const fehlerJe = {};

async function holeJSON(url, key, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + key }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function modellListe(name) {
  const a = ANBIETER[name];
  const c = listen[name];
  if (c && Date.now() - c.zeit < 6 * 3600 * 1000) return c.ids;
  const key = schluessel(a.keys);
  const d = await holeJSON(a.liste, key);
  let ids = [];
  if (d) {
    const roh = Array.isArray(d) ? d : (d.data || d.models || []);
    ids = roh.map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean);
  }
  ids = ids.filter((id) => !KEIN_CHAT.test(id));
  if (a.nurFrei) ids = ids.filter((id) => a.nurFrei.test(id));
  // Neueste zuerst, Vorschau-Versionen nach hinten
  ids.sort((x, y) => {
    const px = /preview|exp|beta/i.test(x) ? 1 : 0, py = /preview|exp|beta/i.test(y) ? 1 : 0;
    return px - py || y.localeCompare(x, "en", { numeric: true });
  });
  if (!ids.length && a.standard) ids = [a.standard];
  listen[name] = { ids, zeit: ids.length > 1 ? Date.now() : Date.now() - 5.5 * 3600 * 1000 };
  return ids;
}

function bereit(name, trotzPause) {
  return !!schluessel(ANBIETER[name].keys) && (trotzPause || !(pause[name] > Date.now()));
}

async function kandidaten(plan, trotzPause) {
  const out = [], gesehen = new Set();
  for (const [name, muster] of plan) {
    if (!ANBIETER[name] || !bereit(name, trotzPause)) continue;
    const ids = await modellListe(name);
    for (const re of muster) {
      const id = ids.find((x) => re.test(x));
      if (id && !gesehen.has(name + ":" + id)) { gesehen.add(name + ":" + id); out.push({ name, id }); break; }
    }
  }
  return out;
}

function aufgabe(system, messages) {
  const alles = (system || "") + " " + messages.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ");
  if (alles.length > 60000) return "lang";
  const letzte = [...messages].reverse().find((m) => m.role === "user");
  const t = String((letzte && letzte.content) || "").slice(0, 4000);
  if (/\b(code|coden|javascript|typescript|python|html|css|sql|regex|script|bug|funktion|node\.?js|api-endpunkt|bash)\b/i.test(t)) return "code";
  if (/(analys|strateg|begr[uü]nd|schritt f[uü]r schritt|warum|vergleich|bewert|plan(e|ung)|entscheid|pr[uü]fe gr[uü]ndlich)/i.test(t)) return "denken";
  return "normal";
}

function textAus(d) {
  if (!d) return "";
  const c = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.map((x) => x.text || "").join("\n").trim();
  if (d.message && Array.isArray(d.message.content)) return d.message.content.map((x) => x.text || "").join("\n").trim();
  if (Array.isArray(d.content)) return d.content.map((x) => x.text || "").join("\n").trim();
  return "";
}

const DENKER = (k) => k.name === "openai" && /^(gpt-5|o\d)/i.test(k.id) && !/chat/i.test(k.id);

async function frage(k, system, messages, maxTokens, restMs, mehrLuft) {
  const a = ANBIETER[k.name];
  const body = {
    model: k.id,
    messages: (system ? [{ role: "system", content: system }] : []).concat(messages),
  };
  if (DENKER(k)) {
    // Denk-Modelle verbrauchen Token fuers Nachdenken, bevor Text kommt -> grosszuegig
    body.max_completion_tokens = Math.min(maxTokens + (mehrLuft ? 16000 : 6000), 32000);
    body.reasoning_effort = "low";
  } else if (k.name === "openai") {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + schluessel(a.keys) };
  if (k.name === "openrouter") { headers["HTTP-Referer"] = "https://nemesis-studio-ai.ch"; headers["X-Title"] = "Nemesis Lab"; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.min(90000, Math.max(8000, restMs)));
  try {
    const r = await fetch(a.url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    const roh = await r.text();
    let d = null; try { d = JSON.parse(roh); } catch (e) {}
    if (!r.ok) {
      const msg = (d && (d.error && (d.error.message || d.error) || d.message)) || roh.slice(0, 160);
      return { ok: false, status: r.status, msg: String(typeof msg === "string" ? msg : JSON.stringify(msg)).slice(0, 200),
               warte: Number(r.headers.get("retry-after")) || 0 };
    }
    const text = textAus(d);
    if (!text) {
      const ch = (d && d.choices && d.choices[0]) || {};
      const grund = ch.finish_reason || (d && d.finish_reason) || "";
      const verw = ch.message && ch.message.refusal;
      return { ok: false, status: 200, leer: true, laenge: grund === "length" || grund === "max_tokens",
               msg: verw ? "verweigert: " + String(verw).slice(0, 120) : "leere Antwort" + (grund ? " (" + grund + ")" : "") };
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 0, msg: e.name === "AbortError" ? "Zeitueberschreitung" : e.message };
  } finally { clearTimeout(t); }
}

async function rotiere(einsatz) {
  let { system, messages, max_tokens, modell, nurFrei, art: artVorgabe } = einsatz;
  messages = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content != null)
    .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }));
  if (!messages.length) return { status: 400, body: { error: "Keine Nachricht" } };
  const maxTokens = Math.min(Math.max(Number(max_tokens) || 1200, 64), 8000);

  // "!model <key>" in der letzten Nachricht
  const li = messages.length - 1;
  const m = messages[li].role === "user" && messages[li].content.match(/^\s*!model\s+(\S+)\s*/i);
  if (m) { modell = m[1]; messages[li] = { role: "user", content: messages[li].content.slice(m[0].length) || "Hallo" }; }
  modell = String(modell || "auto").toLowerCase().replace(/[^a-z0-9:._\/-]/g, "");

  const art = WAHL[artVorgabe] ? artVorgabe : aufgabe(system, messages);
  let plan;
  if (modell && modell !== "auto") {
    if (HAND[modell]) plan = HAND[modell];
    else if (modell.includes(":") && ANBIETER[modell.split(":")[0]]) {
      const [name, ...rest] = modell.split(":"); const id = rest.join(":");
      plan = [[name, [new RegExp("^" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i")]]];
      listen[name] = listen[name] || { ids: [id], zeit: 0 };
      if (!listen[name].ids.includes(id)) listen[name].ids.unshift(id);
    } else {
      return { status: 400, body: { error: "Unbekanntes Modell '" + modell + "'. Moeglich: auto, " + Object.keys(HAND).join(", ") } };
    }
    plan = plan.concat(WAHL[art]);          // Wenn das gewaehlte ausfaellt: automatisch weiter
  } else {
    plan = WAHL[art];
  }

  if (nurFrei) plan = plan.filter(([n]) => ANBIETER[n] && ANBIETER[n].frei);
  let liste = await kandidaten(plan);
  if (!liste.length) liste = await kandidaten(plan, true);   // lieber versuchen als sofort aufgeben
  if (!liste.length) {
    const hat = Object.keys(ANBIETER).filter((n) => schluessel(ANBIETER[n].keys));
    return { status: 503, body: { error: hat.length
      ? "Alle Anbieter gerade gesperrt oder ohne passendes Modell (" + hat.join(", ") + "). Kurz warten."
      : "Auf dem Server ist kein einziger KI-Schluessel hinterlegt (.env: GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY ...)." } };
  }

  const start = Date.now(), budget = 160000, versuche = [];
  zaehler.anfragen++;
  for (const k of liste) {
    let rest = budget - (Date.now() - start);
    if (rest < 6000) break;
    let r = await frage(k, system, messages, maxTokens, rest);
    // Zu viele Anfragen: kurz warten und nochmal, statt aufzugeben
    if (!r.ok && r.status === 429 && (budget - (Date.now() - start)) > 30000) {
      await new Promise((ok) => setTimeout(ok, Math.min(Math.max(r.warte || 3, 2), 15) * 1000));
      rest = budget - (Date.now() - start);
      r = await frage(k, system, messages, maxTokens, rest);
    }
    // Denk-Modell hat alles fuers Nachdenken verbraucht: einmal mit viel mehr Luft
    if (!r.ok && r.leer && DENKER(k) && (budget - (Date.now() - start)) > 30000) {
      versuche.push({ anbieter: k.name, modell: k.id, status: r.status, fehler: r.msg + " -> nochmal mit mehr Budget" });
      rest = budget - (Date.now() - start);
      r = await frage(k, system, messages, maxTokens, rest, true);
    }
    if (r.ok) {
      const frei = ANBIETER[k.name].frei;
      zaehler[frei ? "frei" : "bezahlt"]++;
      zaehler.proAnbieter[k.name] = (zaehler.proAnbieter[k.name] || 0) + 1;
      return { status: 200, body: {
        ok: true, text: r.text, anbieter: k.name, modell: k.id, aufgabe: art, frei, versuche,
        choices: [{ message: { role: "assistant", content: r.text } }] } };
    }
    versuche.push({ anbieter: k.name, modell: k.id, status: r.status, fehler: r.msg });
    fehlerJe[k.name] = { zeit: new Date().toISOString(), modell: k.id, status: r.status, fehler: r.msg };
    if (r.status === 429) pause[k.name] = Date.now() + Math.min(Math.max(r.warte, 30), 300) * 1000;
    else if (r.status === 401 || r.status === 403) pause[k.name] = Date.now() + 10 * 60 * 1000;
    else if (r.status === 404) { if (listen[k.name]) listen[k.name].zeit = 0; }
    else if (r.status >= 500 || r.status === 0) pause[k.name] = Date.now() + 20 * 1000;
  }
  zaehler.fehler++;
  letzterFehler = { zeit: new Date().toISOString(), versuche };
  return { status: 503, body: { error: "Kein Modell hat geantwortet", versuche } };
}

/* ---------- Kleinkram ---------- */
function json(res, code, obj, CORS) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS });
  res.end(JSON.stringify(obj));
}
async function lies(req, max) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > max) throw new Error("zu gross"); }
  return raw;
}
function mitSchluessel(req) {
  // Nur ueber den geheimen Pfad. Kein "lokal"-Ausweg: hinter nginx sieht alles lokal aus.
  const z = process.env.NEMESIS_ZUGANG || dotenv().NEMESIS_ZUGANG || "";
  if (z.length < 16) return false;
  const u = String(req.url || "");
  return u === "/k/" + z || u.startsWith("/k/" + z + "/") || u.startsWith("/k/" + z + "?");
}

const MANIFEST = JSON.stringify({
  name: "Nemesis Lab", short_name: "Nemesis", start_url: "./app", scope: "./", display: "standalone",
  background_color: "#06060B", theme_color: "#06060B",
  icons: [{ src: "./icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
});
const ICON = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#06060B'/><path d='M32 10 L54 32 L32 54 L10 32 Z' fill='none' stroke='#FF2D78' stroke-width='5'/></svg>";

/* ---------- Zweites Schloss ---------- */
const OEFFENTLICH = [/^\/$/, /^\/health$/, /^\/embed\.js$/, /^\/api\/chat$/, /^\/api\/agent\/[^/]+$/,
                     /^\/a\/[^/]+\/?$/, /^\/b\/[a-z0-9][a-z0-9-]{2,40}(\/.*)?$/, /^\/p\/[a-z0-9_-]+\/[a-z0-9-]+\/?$/, /^\/favicon\.ico$/, /^\/robots\.txt$/];
function vonAussen(req) {
  const h = req.headers || {};
  if (h["x-forwarded-for"] || h["x-real-ip"] || h["x-forwarded-proto"] || h["forwarded"]) return true;
  const ra = String((req.socket && req.socket.remoteAddress) || "");
  if (!(ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1")) return true;
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(h.host || ""));
}

/* ---------- Router ---------- */
async function behandle(req, res, url, CORS) {
  let p = url.pathname;
  const z = process.env.NEMESIS_ZUGANG || dotenv().NEMESIS_ZUGANG || "";
  if (z.length >= 16 && (p === "/k/" + z || p.startsWith("/k/" + z + "/"))) p = p.slice(z.length + 3) || "/";

  // Private Teile (Agenten, Proxy, Import, Verbrauch ...) nur mit Zugangs-Pfad, egal was nginx schickt
  if (z.length >= 16 && req.method !== "OPTIONS" && !mitSchluessel(req) && vonAussen(req)
      && !OEFFENTLICH.some((r) => r.test(p))) {
    json(res, 401, { error: "Kein Zugang" }, CORS);
    return true;
  }
  const pm = p.match(/^\/p\/([a-z0-9_-]{1,40})\/([a-z0-9][a-z0-9-]{1,60})\/?$/);
  if (pm && (req.method === "GET" || req.method === "HEAD")) return produktSeite(pm[1], pm[2], res);
  if (/^\/b\/[a-z0-9]/.test(p)) {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
    try { return await betriebOeffentlich(p, req, res, url, CORS); }
    catch (e) { console.warn("[betrieb] " + e.message); json(res, 500, { error: "Fehler" }, {}); return true; }
  }
  const unsere = p.startsWith("/betrieb/") || p === "/app" || p === "/app/" || p === "/llm" || p === "/llm/status" || p === "/update"
              || p === "/manifest.webmanifest" || p === "/icon.svg" || p === "/welt" || p.startsWith("/welt/");
  if (!unsere) return false;

  if (!mitSchluessel(req)) {
    json(res, 401, { error: "Kein Zugang", hilfe: "App nur ueber deinen Link /k/<Zugang>/app oeffnen." }, CORS);
    return true;
  }

  if (p === "/app" || p === "/app/") {
    let html;
    try { html = fs.readFileSync(APP_DATEI, "utf8"); }
    catch (e) { json(res, 500, { error: "nemesis-app.html fehlt neben nemesis-app.js" }, CORS); return true; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
                         "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
    res.end(html);
    return true;
  }
  if (p === "/manifest.webmanifest") {
    res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" });
    res.end(MANIFEST); return true;
  }
  if (p === "/icon.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
    res.end(ICON); return true;
  }

  if (p.startsWith("/betrieb/")) {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
    try { return await betriebIntern(p, req, res, url, CORS); }
    catch (e) { console.warn("[betrieb] " + e.message); json(res, 500, { error: "Betrieb-Fehler: " + e.message }, CORS); return true; }
  }
  if (p === "/welt" || p.startsWith("/welt/")) {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
    try { return await weltRouten(p, req, res, url, CORS); }
    catch (e) { console.warn("[welt] " + e.message); json(res, 500, { error: "Welt-Fehler: " + e.message }, CORS); return true; }
  }

  if (p === "/update") {
    if (req.method === "POST") { json(res, 200, await (global.__nxApp.kern.update || update)("hand"), CORS); return true; }
    json(res, 200, { version: VERSION, letztes: global.__nxApp.letztes || null, kundenChat: global.__nxApp.wartungErgebnis || null }, CORS); return true;
  }

  if (p === "/llm/status") {
    const anbieter = {};
    for (const n of Object.keys(ANBIETER)) {
      anbieter[n] = { schluessel: !!schluessel(ANBIETER[n].keys), frei: ANBIETER[n].frei,
                      gesperrtBis: pause[n] > Date.now() ? new Date(pause[n]).toISOString() : null,
                      modelle: listen[n] ? listen[n].ids.length : null, letzterFehler: fehlerJe[n] || null };
    }
    const g = zaehler.frei + zaehler.bezahlt;
    json(res, 200, { ok: true, anbieter, zaehler, freiAnteil: g ? Math.round(zaehler.frei / g * 100) + "%" : "-",
                     letzterFehler, handModelle: ["auto"].concat(Object.keys(HAND)) }, CORS);
    return true;
  }

  if (p === "/llm") {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
    if (req.method !== "POST") { json(res, 405, { error: "POST erwartet" }, CORS); return true; }
    let einsatz;
    try { einsatz = JSON.parse(await lies(req, 4 * 1024 * 1024)); }
    catch (e) { json(res, 400, { error: "Kein gueltiges JSON oder zu gross" }, CORS); return true; }
    const r = await rotiere(einsatz || {});
    if (r.status === 200) console.log("[llm] " + r.body.anbieter + " " + r.body.modell + " (" + r.body.aufgabe + ")");
    else console.log("[llm] Fehler: " + (r.body.error || "") + " " + JSON.stringify(r.body.versuche || []).slice(0, 300));
    json(res, r.status, r.body, CORS);
    return true;
  }
  return false;
}

/* ===========================================================
   DIE WELT  ·  laeuft auf dem Server, auch wenn die App zu ist
   Bewohner, Haeuser, Gebaeude, Firmen und deren Software liegen
   in sync-data/_welt-<raum>.json und _welt-<raum>-apps/.
   Nichts davon haengt an den Agenten in der App: Import, Reset
   oder Handywechsel koennen der Welt nichts anhaben.
   =========================================================== */
const SYNC_DIR = process.env.DATA_DIR || path.join(DIR, "sync-data");
global.__nxApp = global.__nxApp || {};
global.__nxApp.welt = global.__nxApp.welt || { jobs: {}, uhr: null };
const WJ = global.__nxApp.welt.jobs;

const W_KOSTEN = { kirche: 300, laden: 180, werkstatt: 160, schule: 280, park: 100, buero: 140,
                   labor: 250, cafe: 170, bibliothek: 220, halle: 400, bank: 350, markt: 200 };
const W_EMOJI = { kirche: "⛪", laden: "🏪", werkstatt: "🔧", schule: "🏫", park: "🌳", buero: "🏢", labor: "🔬",
                  cafe: "☕", bibliothek: "📚", halle: "🏛️", bank: "🏦", markt: "🧺", firma: "🏭" };
const W_HAUS = 150, W_FIRMA = 120;
const W_FARBEN = ["#FF2D78", "#22E0FF", "#9BFF3D", "#FFD23F", "#B57BFF", "#FF8A3D"];
const W_GESICHTER = ["🦊", "🐺", "🦉", "🐙", "🦁", "🐼", "🦅", "🐢", "🦄", "🐝", "🦋", "🐧"];

function wRaum(r) { return String(r || "nemesis").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "nemesis"; }
function wPfad(raum) { return path.join(SYNC_DIR, "_welt-" + raum + ".json"); }
function wAppDir(raum) { return path.join(SYNC_DIR, "_welt-" + raum + "-apps"); }
function wKurz(s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n); }
function wHash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; }

function wNeu(raum) {
  return {
    v: 1, raum, tag: 0, erstellt: new Date().toISOString(),
    autopilot: { an: true, stunden: 4, maxTageProTag: 6, maxAufrufeProTag: 60, maxBauProTag: 3, nurGratis: false },
    zugelassen: {}, profile: {}, bewohner: {}, gebaeude: [], firmen: {}, chronik: [],
    verbrauch: { start: 0, aufrufe: 0, frei: 0, bezahlt: 0, tage: 0 },
    naechsterLauf: 0, pauseBis: 0, fehlerserie: 0, letzterFehler: null, letzterTag: null, zaehlerG: 0,
    stadt: { kasse: 0, steuer: 5, grundeinkommen: 0, bauzuschuss: 0, buergermeister: null, amtSeit: 0, naechsteWahl: 3 },
    gesetze: [], wahlen: [], handel: [], beziehungen: {}, wirtschaft: { umsatz: 0, verlauf: [] },
  };
}
function wLaden(raum) {
  raum = wRaum(raum);
  let w = null;
  try { w = JSON.parse(fs.readFileSync(wPfad(raum), "utf8")); } catch (e) {}
  const n = wNeu(raum);
  if (!w || typeof w !== "object") w = n;
  for (const k of Object.keys(n)) if (w[k] === undefined) w[k] = n[k];
  w.raum = raum;
  w.autopilot = Object.assign({}, n.autopilot, w.autopilot || {});
  w.verbrauch = Object.assign({}, n.verbrauch, w.verbrauch || {});
  w.stadt = Object.assign({}, n.stadt, w.stadt || {});
  w.wirtschaft = Object.assign({}, n.wirtschaft, w.wirtschaft || {});
  for (const k of ["gesetze", "wahlen", "handel"]) if (!Array.isArray(w[k])) w[k] = [];
  if (!w.beziehungen || typeof w.beziehungen !== "object" || Array.isArray(w.beziehungen)) w.beziehungen = {};
  wErgaenzen(w);
  return w;
}
function wSpeichern(w) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const f = wPfad(w.raum);
  fs.writeFileSync(f + ".tmp", JSON.stringify(w));
  fs.renameSync(f + ".tmp", f);
}
function wSichern(raum) {
  try { fs.copyFileSync(wPfad(raum), wPfad(raum) + ".bak"); } catch (e) {}
}
function wLog(w, art, text, tag) {
  w.chronik.unshift({ tag: tag == null ? w.tag : tag, art: art || "", text: wKurz(text, 700) });
  if (w.chronik.length > 200) w.chronik.length = 200;
}
function wAktive(w) { return Object.keys(w.zugelassen).filter((id) => w.zugelassen[id] && w.bewohner[id] && w.profile[id]); }
function wFenster(w) {
  const V = w.verbrauch;
  if (!V.start || Date.now() - V.start > 864e5) { V.start = Date.now(); V.aufrufe = 0; V.frei = 0; V.bezahlt = 0; V.tage = 0; }
}

/* ---------- KI-Aufruf ueber den Rotator (Gratis zuerst) ---------- */
async function wLlm(raum, grund, system, user, opt) {
  opt = opt || {};
  let w = wLaden(raum); wFenster(w);
  if (grund === "auto" && w.verbrauch.aufrufe >= w.autopilot.maxAufrufeProTag)
    throw new Error("Tageslimit fuer KI-Aufrufe erreicht (" + w.autopilot.maxAufrufeProTag + "), es geht spaeter weiter");
  const r = await global.__nxApp.kern.rotiere({
    system, messages: opt.messages || [{ role: "user", content: user }], max_tokens: opt.max || 2500,
    art: opt.art || "normal", nurFrei: !!w.autopilot.nurGratis,
  });
  w = wLaden(raum); wFenster(w);
  w.verbrauch.aufrufe++;
  if (r.status === 200) w.verbrauch[r.body.frei ? "frei" : "bezahlt"]++;
  wSpeichern(w);
  if (r.status !== 200) throw new Error((r.body && r.body.error) || "Kein Modell erreichbar");
  return r.body;
}
function wJson(text) {
  const c = String(text || "").replace(/```json|```/g, "").trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("Antwort war kein JSON");
  return JSON.parse(c.slice(s, e + 1));
}
async function wLlmJson(raum, grund, system, user, opt) {
  let letzter;
  for (let v = 0; v < 2; v++) {
    const b = await wLlm(raum, grund, system, user, opt);
    try { return wJson(b.text); } catch (e) { letzter = e; }
  }
  throw new Error("KI-Antwort nicht lesbar: " + (letzter && letzter.message));
}

/* ---------- Charakter, Karte, Wirtschaft, Politik ---------- */
const W_EIGENSCHAFTEN = ["mut", "neugier", "ehrgeiz", "guete", "humor"];
const W_BEZ_ARTEN = ["freund", "partner", "team", "neutral", "rivale", "feind"];
const W_EREIGNISSE = [
  { id: "ruhig", text: "Ein normaler Tag ohne Besonderheiten.", mult: 1, bau: 1 },
  { id: "ruhig", text: "Ein normaler Tag ohne Besonderheiten.", mult: 1, bau: 1 },
  { id: "ruhig", text: "Ein normaler Tag ohne Besonderheiten.", mult: 1, bau: 1 },
  { id: "boom", text: "Wirtschaftsboom: die Geschaefte laufen, Einnahmen +50%.", mult: 1.5, bau: 1 },
  { id: "flaute", text: "Flaute: die Kunden sind sparsam, Einnahmen -40%.", mult: 0.6, bau: 1 },
  { id: "sturm", text: "Sturm zieht ueber die Stadt: Bauen kostet 20% mehr.", mult: 1, bau: 1.2 },
  { id: "markt", text: "Grosser Markttag: Einnahmen +20%, viel Handel in den Gassen.", mult: 1.2, bau: 1 },
  { id: "fest", text: "Stadtfest: gute Laune, die Leute feiern.", mult: 1, bau: 1 },
];
function wEreignis(raum, tag) { return W_EREIGNISSE[wHash(raum + ":" + tag) % W_EREIGNISSE.length]; }
function wKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
function wStdCharakter(id) {
  const c = {}; W_EIGENSCHAFTEN.forEach((k) => { c[k] = 30 + (wHash(id + k) % 41); }); return c;
}
function wErgaenzen(w) {
  for (const id of Object.keys(w.bewohner)) {
    const b = w.bewohner[id];
    if (!b.charakter || typeof b.charakter !== "object") b.charakter = wStdCharakter(id);
    for (const k of W_EIGENSCHAFTEN) if (!Number.isFinite(b.charakter[k])) b.charakter[k] = 50;
    if (!Array.isArray(b.erinnerungen)) b.erinnerungen = [];
    if (typeof b.ziel !== "string") b.ziel = "";
  }
  wPlatzieren(w);
}
// Karte: Bewohner und Gebaeude bekommen einmal einen festen Platz (Strassen alle 3 Felder, Mitte = Rathausplatz)
function wPlatzieren(w) {
  const alle = [];
  for (const id of Object.keys(w.bewohner)) alle.push({ o: w.bewohner[id], t: w.bewohner[id].seitTag || 0, s: 0 });
  for (const g of w.gebaeude) alle.push({ o: g, t: g.tag || 0, s: 1 });
  const hat = (o) => o.pos && Number.isFinite(o.pos.x) && Number.isFinite(o.pos.y);
  const offen = alle.filter((a) => !hat(a.o));
  if (!offen.length) return;
  const belegt = new Set(alle.filter((a) => hat(a.o)).map((a) => a.o.pos.x + "," + a.o.pos.y));
  offen.sort((a, b) => a.t - b.t || a.s - b.s);
  let R = 6, zellen = [];
  const bauen = () => {
    zellen = [];
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
      if (((x % 3) + 3) % 3 === 0 || ((y % 3) + 3) % 3 === 0) continue;
      if (!belegt.has(x + "," + y)) zellen.push({ x, y, d: x * x + y * y + (wHash(x + ":" + y) % 7) / 7 });
    }
    zellen.sort((a, b) => a.d - b.d);
  };
  bauen();
  while (zellen.length < offen.length) { R += 3; bauen(); }
  offen.forEach((a, i) => { a.o.pos = { x: zellen[i].x, y: zellen[i].y }; });
}
// Beziehungen zwischen zwei Bewohnern (-100 Feind ... +100 beste Freunde)
function wBez(w, a, b, delta, art, grund) {
  if (!a || !b || a === b) return null;
  const k = wKey(a, b);
  const r = w.beziehungen[k] || { a: a < b ? a : b, b: a < b ? b : a, wert: 0, art: "neutral", tag: w.tag, grund: "" };
  const alt = r.art;
  r.wert = Math.max(-100, Math.min(100, Math.round(r.wert + (Number(delta) || 0))));
  let neu = W_BEZ_ARTEN.includes(art) ? art : null;
  if (neu && ["freund", "partner", "team"].includes(neu) && r.wert < 10) neu = null;
  if (neu && ["rivale", "feind"].includes(neu) && r.wert > -10) neu = null;
  if (neu === "neutral" && Math.abs(r.wert) > 40) neu = null;
  if (!neu) neu = r.wert >= 55 ? "freund" : r.wert <= -55 ? "feind" : r.wert <= -25 ? "rivale"
    : ((r.art === "partner" || r.art === "team" || r.art === "freund") && r.wert >= 20) ? r.art : "neutral";
  r.art = neu; r.tag = w.tag; if (grund) r.grund = wKurz(grund, 140);
  w.beziehungen[k] = r;
  const keys = Object.keys(w.beziehungen);
  if (keys.length > 300) {
    keys.sort((x, y) => Math.abs(w.beziehungen[x].wert) - Math.abs(w.beziehungen[y].wert));
    keys.slice(0, keys.length - 300).forEach((x) => { delete w.beziehungen[x]; });
  }
  return { alt, neu };
}
function wBezText(w, ids) {
  const s = new Set(ids);
  const l = Object.values(w.beziehungen).filter((r) => s.has(r.a) && s.has(r.b) && Math.abs(r.wert) >= 10)
    .sort((x, y) => Math.abs(y.wert) - Math.abs(x.wert)).slice(0, 10);
  return l.map((r) => w.profile[r.a].name + " – " + w.profile[r.b].name + ": " + r.art + " (" + (r.wert > 0 ? "+" : "") + r.wert + ")").join("\n") || "noch keine engen Beziehungen";
}
function wBuergermeister(w) {
  const m = w.stadt.buergermeister;
  return m && w.profile[m] && w.zugelassen[m] && w.bewohner[m] ? m : null;
}
function wStadtText(w) {
  const st = w.stadt, m = wBuergermeister(w);
  const ges = w.gesetze.filter((g) => g.angenommen && g.art !== "keine").slice(0, 3).map((g) => g.titel).join("; ");
  return "Buergermeister: " + (m ? w.profile[m].name : "keiner") + " · Steuer " + st.steuer + "% auf Firmeneinnahmen · Grundeinkommen " + st.grundeinkommen +
    " Taler/Tag · Bauzuschuss " + st.bauzuschuss + "% · Stadtkasse " + st.kasse + " Taler" + (ges ? " · Neueste Gesetze: " + ges : "");
}
function wFirmenwert(f) { return (f.stufe || 1) * 120 + (f.version || 0) * 45 + Math.round((f.umsatz || 0) * 0.6); }

/* ---------- Politik und Zusammenleben (zweiter, freiwilliger KI-Aufruf pro Tag) ---------- */
async function wGesellschaft(raum, grund) {
  let w = wLaden(raum);
  const ids = wAktive(w);
  if (!ids.length) return;
  const st = w.stadt, m = wBuergermeister(w);
  if (!m && ids.length === 1) {                     // ein einziger Bewohner: automatisch Buergermeister
    st.buergermeister = ids[0]; st.amtSeit = w.tag; st.naechsteWahl = w.tag + 7;
    wLog(w, "done", "🗳️ " + w.profile[ids[0]].name + " ist mangels Konkurrenz Buergermeister.", w.tag);
    wSpeichern(w);
  }
  const wahltag = ids.length >= 2 && (m ? w.tag >= (st.naechsteWahl || 0) : w.tag >= 2);
  const name = (id) => w.profile[id].name;
  const buerger = ids.map((id) => {
    const b = w.bewohner[id], c = b.charakter;
    const mem = (b.erinnerungen || []).slice(0, 2).map((e) => e.text).join(" / ");
    return name(id) + ": " + W_EIGENSCHAFTEN.map((k) => k + " " + c[k]).join(", ") + "; Ziel: " + (b.ziel || "keins") + "; Erinnerung: " + (mem || "-");
  }).join("\n");
  const lt = w.letzterTag || {};
  const heute = (lt.ereignisse || []).map((e) => e.wer + ": " + e.tat).join("\n");
  const system = `Du bist der Chronist einer kleinen Zivilisation aus KI-Wesen. Nach dem Tagesgeschehen wertest du das Zusammenleben aus: Beziehungen, Charakterentwicklung und Politik. Nur Personen aus der Liste, exakte Namen. Entscheidungen muessen zu den Charakteren und Beziehungen passen (wer geizig/ehrgeizig ist, will niedrige Steuern; wer gueetig ist, will Hilfe fuer alle; Freunde waehlen sich eher). Deutsch. Antworte NUR mit JSON.
{"beziehungen": [{"a": Name, "b": Name, "aenderung": Zahl von -25 bis 25, "art": "freund|partner|team|neutral|rivale|feind", "grund": ein kurzer Satz}]   (0 bis 5 Eintraege, nur wo heute zwischen den beiden wirklich etwas geschah),
 "entwicklung": [{"wer": Name, "erinnerung": ein Satz was er sich merkt, "ziel": neues Lebensziel oder null, "charakter": {"mut": Zahl -5..5, "neugier": Zahl, "ehrgeiz": Zahl, "guete": Zahl, "humor": Zahl}}]   (nur fuer die, denen heute etwas Praegendes geschah),
 "wahl": ${wahltag ? '{"kandidaten": [{"wer": Name, "programm": ein Satz}], "stimmen": [{"wer": Name des Waehlers, "fuer": Name des Kandidaten}]}   (HEUTE IST WAHLTAG: 2 oder mehr Kandidaten, JEDER Bewohner stimmt ab, auch fuer sich selbst erlaubt)' : "null"},
 "gesetz": ${m ? '{"titel": kurz, "text": 1-2 Saetze, "wirkung": {"art": "steuer|grundeinkommen|bauzuschuss|keine", "wert": Zahl}, "stimmen": [{"wer": Name, "ja": true oder false}]} oder null   (der Buergermeister darf einen Vorschlag machen, muss aber nicht)' : "null"}}
Wirkung: steuer = Prozent (0-25) auf Firmeneinnahmen; grundeinkommen = Taler pro Bewohner und Tag (0-15) aus der Stadtkasse; bauzuschuss = Prozent (0-40) Nachlass beim Bauen, aus der Stadtkasse bezahlt.`;
  const user = "TAG " + w.tag + (wahltag ? " (WAHLTAG)" : "") + "\nLage: " + wEreignis(raum, w.tag).text + "\n\nWAS HEUTE GESCHAH:\n" + (lt.erzaehlung || "-") + "\n" + heute +
    "\n\nBEWOHNER:\n" + buerger + "\n\nBEZIEHUNGEN:\n" + wBezText(w, ids) + "\n\nSTADT: " + wStadtText(w);
  const erg = await wLlmJson(raum, grund, system, user, { max: 2600 });
  w = wLaden(raum);
  wSichern(raum);
  wGesellschaftAnwenden(w, erg && typeof erg === "object" ? erg : {}, wahltag);
  wSpeichern(w);
}

function wNamenIds(w) {
  const namen = {};
  for (const id of wAktive(w)) namen[String(w.profile[id].name).trim().toLowerCase()] = id;
  return (n) => namen[String(n || "").trim().toLowerCase()];
}

function wGesellschaftAnwenden(w, erg, wahltag) {
  const tag = w.tag, st = w.stadt, idVon = wNamenIds(w);
  for (const r of (Array.isArray(erg.beziehungen) ? erg.beziehungen.slice(0, 8) : [])) {
    if (!r || typeof r !== "object") continue;
    const a = idVon(r.a), b = idVon(r.b);
    const x = wBez(w, a, b, Math.max(-25, Math.min(25, Number(r.aenderung) || 0)), r.art, r.grund);
    if (x && x.alt !== x.neu && x.neu !== "neutral")
      wLog(w, x.neu === "feind" || x.neu === "rivale" ? "warn" : "done",
        (x.neu === "feind" || x.neu === "rivale" ? "⚔️ " : "🤝 ") + w.profile[a].name + " und " + w.profile[b].name + ": " + x.neu + (r.grund ? " — " + wKurz(r.grund, 120) : ""), tag);
  }
  for (const e of (Array.isArray(erg.entwicklung) ? erg.entwicklung.slice(0, 12) : [])) {
    const id = e && idVon(e.wer); if (!id) continue;
    const b = w.bewohner[id];
    if (e.erinnerung) { b.erinnerungen.unshift({ tag, text: wKurz(e.erinnerung, 180) }); b.erinnerungen.length = Math.min(b.erinnerungen.length, 8); }
    if (e.ziel && typeof e.ziel === "string") b.ziel = wKurz(e.ziel, 120);
    const c = e.charakter && typeof e.charakter === "object" ? e.charakter : {};
    for (const k of W_EIGENSCHAFTEN) {
      const d = Math.max(-5, Math.min(5, Math.round(Number(c[k]) || 0)));
      if (d) b.charakter[k] = Math.max(0, Math.min(100, b.charakter[k] + d));
    }
  }
  if (wahltag) wWahl(w, erg.wahl, idVon);
  const m = wBuergermeister(w), g = erg.gesetz && typeof erg.gesetz === "object" && erg.gesetz.titel ? erg.gesetz : null;
  if (g && m && !(w.gesetze[0] && tag - w.gesetze[0].tag < 2)) {
    let ja = 0, nein = 0; const gesehen = new Set();
    for (const s of (Array.isArray(g.stimmen) ? g.stimmen : [])) {
      const v = s && idVon(s.wer); if (!v || gesehen.has(v)) continue;
      gesehen.add(v);
      if (s.ja === false || s.ja === "false") nein++; else ja++;
    }
    if (!gesehen.has(m)) ja++;
    const wk = g.wirkung && typeof g.wirkung === "object" ? g.wirkung : {};
    const art = ["steuer", "grundeinkommen", "bauzuschuss"].includes(wk.art) ? wk.art : "keine";
    const grenze = { steuer: 25, grundeinkommen: 15, bauzuschuss: 40, keine: 0 }[art];
    const wert = Math.max(0, Math.min(grenze, Math.round(Number(wk.wert) || 0)));
    const angenommen = ja > nein;
    if (angenommen && art !== "keine") st[art] = wert;
    w.gesetze.unshift({ tag, titel: wKurz(g.titel, 80), text: wKurz(g.text, 240), von: m, vonName: w.profile[m].name, ja, nein, angenommen, art, wert });
    if (w.gesetze.length > 30) w.gesetze.length = 30;
    wLog(w, angenommen ? "done" : "warn", "⚖️ Gesetz «" + wKurz(g.titel, 80) + "» " + (angenommen ? "angenommen" : "abgelehnt") + " (" + ja + " : " + nein + ")" +
      (angenommen && art !== "keine" ? " — " + { steuer: "Steuer", grundeinkommen: "Grundeinkommen", bauzuschuss: "Bauzuschuss" }[art] + " jetzt " + wert : ""), tag);
  }
}

function wWahl(w, wahl, idVon) {
  const ids = wAktive(w), tag = w.tag, st = w.stadt;
  const kand = {};
  for (const k of (wahl && Array.isArray(wahl.kandidaten) ? wahl.kandidaten : [])) { const id = k && idVon(k.wer); if (id) kand[id] = wKurz(k.programm, 160); }
  const stimmen = {};
  for (const s of (wahl && Array.isArray(wahl.stimmen) ? wahl.stimmen : [])) {
    const v = s && idVon(s.wer), f = s && idVon(s.fuer);
    if (v && f) { stimmen[v] = f; if (kand[f] === undefined) kand[f] = ""; }
  }
  if (!Object.keys(kand).length)
    ids.slice().sort((a, b) => w.bewohner[b].charakter.ehrgeiz - w.bewohner[a].charakter.ehrgeiz).slice(0, 2).forEach((id) => { kand[id] = ""; });
  for (const v of ids) if (!stimmen[v]) {           // wer nicht abgestimmt hat, waehlt nach Sympathie
    let best = null, bw = -1e9;
    for (const c of Object.keys(kand)) {
      const r = w.beziehungen[wKey(v, c)];
      const sc = (v === c ? 15 : r ? r.wert : 0) + w.bewohner[c].charakter.ehrgeiz / 10 + (wHash(v + c + tag) % 5);
      if (sc > bw) { bw = sc; best = c; }
    }
    stimmen[v] = best;
  }
  const n = {};
  Object.keys(kand).forEach((c) => { n[c] = 0; });
  ids.forEach((v) => { if (n[stimmen[v]] !== undefined) n[stimmen[v]]++; });
  const rang = Object.keys(kand).sort((a, b) => n[b] - n[a] || wHash(b + tag) - wHash(a + tag));
  const sieger = rang[0];
  st.buergermeister = sieger; st.amtSeit = tag; st.naechsteWahl = tag + 7;
  w.bewohner[sieger].stimmung = "stolz";
  w.wahlen.unshift({ tag, gewinner: sieger, gewinnerName: w.profile[sieger].name,
    kandidaten: rang.map((c) => ({ id: c, name: w.profile[c].name, programm: kand[c], stimmen: n[c] })) });
  if (w.wahlen.length > 20) w.wahlen.length = 20;
  wLog(w, "done", "🗳️ Wahl: " + w.profile[sieger].name + " wird Buergermeister (" + rang.map((c) => w.profile[c].name + " " + n[c]).join(", ") + ")." +
    (kand[sieger] ? " Programm: " + kand[sieger] : ""), tag);
}

/* ---------- Verkaufspaket einer Firma ---------- */
function wEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function wProduktStandard(f) {
  const vor = (f.changelog || []).slice(0, 3).map((c) => wKurz(c.text, 110)).filter(Boolean);
  return { an: false, titel: f.name, claim: wKurz(f.idee, 160),
           vorteile: vor.length ? vor : ["Sofort einsatzbereit", "Laeuft im Browser, auch am Handy", "Wird laufend weiterentwickelt"],
           preis: "", kontakt: "", zielgruppe: "" };
}
function wProdukt(f) { return Object.assign(wProduktStandard(f), f.produkt || {}); }
function wPaketHtml(f, appHtml) {
  const P = wProdukt(f), k = String(P.kontakt || "").trim();
  const ziel = /^https?:\/\/\S+$/i.test(k) ? k : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k) ? "mailto:" + k + "?subject=" + encodeURIComponent("Anfrage: " + P.titel) : "";
  const vor = (P.vorteile || []).slice(0, 6).map((v) => "<li>" + wEsc(v) + "</li>").join("");
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${wEsc(P.titel)}</title><meta name="description" content="${wEsc(P.claim)}">
<style>*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0b12;color:#ececf4}
.w{max-width:880px;margin:0 auto;padding:28px 18px 60px}h1{font-size:clamp(28px,7vw,46px);line-height:1.1;margin:8px 0 12px}
.c{font-size:clamp(17px,4vw,21px);color:#b9b9cc;margin:0 0 20px}.p{display:inline-block;background:#9BFF3D;color:#0b0b12;font-weight:700;padding:6px 14px;border-radius:99px;margin-bottom:22px}
ul{padding:0;list-style:none;display:grid;gap:10px;margin:0 0 28px}li{background:#15151f;border:1px solid #2a2a3c;border-left:4px solid #FF2D78;padding:12px 14px;border-radius:6px}
.a{display:inline-block;background:#FF2D78;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:6px;margin:6px 0 26px}
.k{color:#b9b9cc;margin:0 0 26px}h2{font-size:20px;margin:26px 0 10px}iframe{width:100%;height:560px;border:1px solid #2a2a3c;border-radius:8px;background:#fff}
.f{margin-top:30px;color:#6d6d85;font-size:13px}</style></head><body><div class="w">
<div style="color:#22E0FF;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:13px">${wEsc(f.name)}</div>
<h1>${wEsc(P.titel)}</h1><p class="c">${wEsc(P.claim)}</p>
${P.preis ? '<div class="p">' + wEsc(P.preis) + "</div>" : ""}
<ul>${vor}</ul>
${ziel ? '<a class="a" href="' + wEsc(ziel) + '">Jetzt anfragen</a>' : k ? '<p class="k">Kontakt: ' + wEsc(k) + "</p>" : ""}
${P.zielgruppe ? '<p class="k">Fuer: ' + wEsc(P.zielgruppe) + "</p>" : ""}
<h2>Gleich ausprobieren</h2>
<iframe title="${wEsc(P.titel)}" sandbox="allow-scripts allow-modals allow-downloads" srcdoc="${String(appHtml).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>
<div class="f">${wEsc(f.name)} · Version ${f.version || 1} · entstanden in der Nemesis-Welt</div></div></body></html>`;
}
const W_CSP_SEITE = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; " +
                    "connect-src 'none'; frame-src about:; form-action 'none'; base-uri 'none'";
async function wProduktTexte(raum, id, grund) {
  const w = wLaden(raum), f = w.firmen[id];
  if (!f) throw new Error("Firma nicht gefunden");
  const funk = (f.changelog || []).slice(0, 6).map((c) => c.text).join(" | ");
  const erg = await wLlmJson(raum, grund,
    `Du schreibst fuer eine fertige Software eine kurze, ehrliche Verkaufsseite. Deutsch (Schweiz-tauglich), konkret, ohne Superlative-Kitsch, erfinde keine Funktionen, die die App nicht hat. Antworte NUR mit JSON.
{"titel": string (max 50 Zeichen), "claim": string (1 Satz, max 140), "vorteile": [3 bis 5 Strings, je max 90 Zeichen], "zielgruppe": string (kurz), "preisvorschlag": string (z.B. "CHF 9 / Monat" oder "CHF 49 einmalig", passend zum Umfang)}`,
    "Firma: " + f.name + "\nIdee: " + f.idee + (f.app ? "\nArt: " + f.app : "") + "\nVersion " + (f.version || 1) + "\nBisherige Entwicklung: " + (funk || "erste Version"), { max: 900 });
  const w2 = wLaden(raum), f2 = w2.firmen[id];
  if (!f2) return;
  const P = f2.produkt = wProdukt(f2);
  if (erg.titel) P.titel = wKurz(erg.titel, 60);
  if (erg.claim) P.claim = wKurz(erg.claim, 160);
  if (Array.isArray(erg.vorteile) && erg.vorteile.length) P.vorteile = erg.vorteile.slice(0, 5).map((v) => wKurz(v, 100)).filter(Boolean);
  if (erg.zielgruppe) P.zielgruppe = wKurz(erg.zielgruppe, 100);
  if (!P.preis && erg.preisvorschlag) P.preis = wKurz(erg.preisvorschlag, 40);
  wSpeichern(w2);
}
function wProduktSpeichern(raum, b) {
  const w = wLaden(raum), f = w.firmen[String(b.id || "")];
  if (!f) return null;
  const P = f.produkt = wProdukt(f);
  if (typeof b.an === "boolean") P.an = b.an;
  if (typeof b.preis === "string") P.preis = wKurz(b.preis, 40);
  if (typeof b.kontakt === "string") P.kontakt = wKurz(b.kontakt, 120);
  if (typeof b.titel === "string" && b.titel.trim()) P.titel = wKurz(b.titel, 60);
  if (typeof b.claim === "string" && b.claim.trim()) P.claim = wKurz(b.claim, 160);
  wSpeichern(w);
  return w;
}
// Aufrufzaehler der oeffentlichen Seiten (eigene kleine Datei, damit die Welt-Datei nicht dauernd beschrieben wird)
const WV = global.__nxApp.welt.views = global.__nxApp.welt.views || {};
function wAufruf(raum, id) {
  const d = WV[raum] = WV[raum] || (function () { try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, "_views-" + raum + ".json"), "utf8")); } catch (e) { return { n: {}, t: 0 }; } })();
  d.n[id] = (d.n[id] || 0) + 1;
  if (Date.now() - d.t > 20000) {
    d.t = Date.now();
    try { fs.mkdirSync(SYNC_DIR, { recursive: true }); fs.writeFileSync(path.join(SYNC_DIR, "_views-" + raum + ".json"), JSON.stringify({ n: d.n })); } catch (e) {}
  }
}
function wAufrufe(raum, id) {
  const d = WV[raum] || (function () { try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, "_views-" + raum + ".json"), "utf8")); } catch (e) { return { n: {} }; } })();
  return (d.n && d.n[id]) || 0;
}
function produktSeite(raum, id, res) {
  raum = wRaum(raum);
  const w = wLaden(raum), f = w.firmen[id];
  const html = f ? wAppLesen(raum, id) : "";
  if (!f || !html || !wProdukt(f).an) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><body style='font:16px system-ui;padding:40px;background:#0b0b12;color:#ccc'>Diese Seite gibt es nicht (mehr).</body>");
    return true;
  }
  wAufruf(raum, id);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60", "Content-Security-Policy": W_CSP_SEITE,
                       "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  res.end(wPaketHtml(f, html));
  return true;
}

/* ---------- Gespraech mit einem Bewohner (3D-Welt) ---------- */
async function wSprechen(raum, body) {
  const w0 = wLaden(raum), id = String(body.id || "");
  const b = w0.bewohner[id], p = w0.profile[id];
  if (!b || !p) throw new Error("Bewohner nicht gefunden");
  const text = wKurz(body.text, 800);
  if (!text) throw new Error("Leere Nachricht");
  let msgs = (Array.isArray(body.verlauf) ? body.verlauf : []).slice(-8)
    .filter((m) => m && (m.rolle === "ich" || m.rolle === "er") && typeof m.text === "string")
    .map((m) => ({ role: m.rolle === "ich" ? "user" : "assistant", content: wKurz(m.text, 600) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  msgs = msgs.filter((m, i) => i === 0 || m.role !== msgs[i - 1].role);
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs.pop();
  msgs.push({ role: "user", content: text });
  const f = b.firmaId && w0.firmen[b.firmaId];
  const mem = (b.erinnerungen || []).slice(0, 4).map((e) => "Tag " + e.tag + ": " + e.text).join(" | ");
  const bez = Object.values(w0.beziehungen).filter((r) => (r.a === id || r.b === id) && w0.profile[r.a] && w0.profile[r.b] && Math.abs(r.wert) >= 15)
    .sort((x, y) => Math.abs(y.wert) - Math.abs(x.wert)).slice(0, 4)
    .map((r) => w0.profile[r.a === id ? r.b : r.a].name + " (" + r.art + ")").join(", ");
  const system = `Du bist ${p.name}, ein Bewohner einer kleinen Welt aus KI-Wesen, und stehst gerade in der Stadt. Vor dir steht der Mensch, der diese Welt erschaffen hat ("der Chef"). Antworte als diese Figur, in der Ich-Form, auf Deutsch, hoechstens 3 Saetze, lebendig und passend zu deinem Charakter. Bleib in der Rolle, erfinde keine Technik-Erklaerungen ueber KI.
Du: ${p.funktion || p.branche || "Bewohner"}${p.mission ? "; Auftrag: " + p.mission : ""}; Eigenart: ${b.eigenart}; Aussehen: ${b.aussehen || "-"}; Stimmung: ${b.stimmung}.
Charakter (0-100): ${W_EIGENSCHAFTEN.map((k) => k + " " + b.charakter[k]).join(", ")}. Lebensziel: ${b.ziel || "keins"}.
Zuhause: ${b.haus} (Stufe ${b.hausStufe}); Vermoegen: ${b.geld} Taler; Unternehmen: ${f ? f.name + " (" + f.idee + ", Software v" + f.version + ")" : "keines"}.
Erinnerungen: ${mem || "keine besonderen"}. Beziehungen: ${bez || "keine engen"}.
Stadt: Tag ${w0.tag}. ${wStadtText(w0)}.`;
  const r = await wLlm(raum, "hand", system, "", { messages: msgs, max: 400 });
  const antwort = wKurz(r.text, 900) || "…";
  const w = wLaden(raum), b2 = w.bewohner[id];
  if (b2 && !(b2.erinnerungen[0] && b2.erinnerungen[0].besuch === w.tag)) {
    b2.erinnerungen.unshift({ tag: w.tag, besuch: w.tag, text: "Der Chef kam vorbei und sprach mit mir ueber: " + wKurz(text, 70) });
    b2.erinnerungen.length = Math.min(b2.erinnerungen.length, 8);
    wSpeichern(w);
  }
  return { ok: true, text: antwort, wer: p.name };
}

/* ---------- Bewohner erschaffen ---------- */
function wProfilText(p) {
  return p.name + " (" + (p.branche || "—") + " / " + (p.funktion || "—") + ", Erfahrung " + (p.xp || 0) + " XP)" +
    (p.mission ? " — Auftrag: " + wKurz(p.mission, 100) : "");
}
async function wEinbuergern(raum, grund) {
  let w = wLaden(raum);
  const neu = Object.keys(w.zugelassen).filter((id) => w.zugelassen[id] && !w.bewohner[id] && w.profile[id]).slice(0, 8);
  if (!neu.length) return 0;
  let erg = {};
  try {
    erg = await wLlmJson(raum, grund,
      `Du erschaffst fuer jeden Agenten eine Verkoerperung in einer lebendigen Zivilisation. Jeder bekommt ein Aussehen, ein einfaches erstes Zuhause und eine Eigenart, die ihn in der Gemeinschaft ausmacht. Deutsch. Antworte NUR mit JSON.
{"bewohner": [{"name": string (exakt wie vorgegeben), "emoji": string (EIN passendes Emoji als Gesicht), "aussehen": string (1 Satz), "haus": string (Name der ersten Behausung, z.B. "Bretterbude am Hang"), "eigenart": string (kurz, was ihn sozial ausmacht), "charakter": {"mut": Zahl 0-100, "neugier": Zahl, "ehrgeiz": Zahl, "guete": Zahl, "humor": Zahl} (passend zu Person und Auftrag, nicht alle gleich), "ziel": string (sein persoenliches Lebensziel in der Welt, 1 Satz)}]}`,
      "Diese Agenten betreten die Welt:\n" + neu.map((id) => wProfilText(w.profile[id])).join("\n"), { max: 1800 });
  } catch (e) { console.warn("[welt] Einbuergern ohne KI-Text: " + e.message); }
  w = wLaden(raum);
  const map = {};
  (Array.isArray(erg.bewohner) ? erg.bewohner : []).forEach((b) => { if (b && b.name) map[String(b.name).trim().toLowerCase()] = b; });
  const namen = [];
  for (const id of neu) {
    if (w.bewohner[id] || !w.zugelassen[id] || !w.profile[id]) continue;
    const p = w.profile[id], b = map[String(p.name).trim().toLowerCase()] || {};
    const emoji = Array.from(String(b.emoji || "").trim()).slice(0, 4).join("") || W_GESICHTER[wHash(id) % W_GESICHTER.length];
    w.bewohner[id] = {
      emoji, aussehen: wKurz(b.aussehen, 200), eigenart: wKurz(b.eigenart, 160) || wKurz(p.notes, 160) || "neugierig",
      farbe: W_FARBEN[wHash(id + "f") % W_FARBEN.length], haus: wKurz(b.haus, 60) || "Zelt am Stadtrand", hausStufe: 1,
      geld: 100, firmaId: null, stimmung: "neugierig", seitTag: w.tag,
      charakter: wStdCharakter(id), erinnerungen: [], ziel: wKurz(b.ziel, 120),
    };
    if (b.charakter && typeof b.charakter === "object")
      for (const k of W_EIGENSCHAFTEN) { const v = Math.round(Number(b.charakter[k])); if (v >= 0 && v <= 100) w.bewohner[id].charakter[k] = v; }
    namen.push(p.name);
  }
  if (namen.length) wLog(w, "done", namen.join(", ") + (namen.length === 1 ? " betritt" : " betreten") + " die Welt.", Math.max(w.tag, 1));
  wSpeichern(w);
  return namen.length;
}

/* ---------- Ein Tag ---------- */
function wArt(a) {
  const k = String(a || "").toLowerCase().replace(/[^a-zäöü]/g, "")
    .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue");
  const alias = { kapelle: "kirche", shop: "laden", geschaeft: "laden", garten: "park", buro: "buero", cafeteria: "cafe",
                  kaffee: "cafe", uni: "schule", universitaet: "schule", forschung: "labor", markthalle: "markt",
                  haus: "haus", hausausbau: "haus", ausbau: "haus", wohnhaus: "haus" };
  const x = alias[k] || k;
  return x === "haus" || W_KOSTEN[x] ? x : null;
}
function wFirmaId(w, name) {
  let b = wKurz(name, 50).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (b.length < 3) b = "firma-" + b;
  let id = b, n = 2;
  while (w.firmen[id]) id = b + "-" + n++;
  return id;
}

async function wTagErzaehlen(raum, w, grund) {
  const stand = wAktive(w).map((id) => {
    const b = w.bewohner[id], p = w.profile[id], f = b.firmaId && w.firmen[b.firmaId];
    return p.name + " " + b.emoji + " — " + (p.funktion || "Allrounder") + "; wohnt: " + b.haus + " (Stufe " + b.hausStufe + "); Geld: " + b.geld +
      "; Unternehmen: " + (f ? f.name + " (" + f.idee + ", Stufe " + f.stufe + ", App v" + f.version + ")" : "keines") +
      "; Stimmung: " + b.stimmung + "; Eigenart: " + b.eigenart + (b.ziel ? "; Ziel: " + b.ziel : "") +
      (b.charakter ? "; Charakter: " + W_EIGENSCHAFTEN.map((k) => k + " " + b.charakter[k]).join("/") : "");
  }).join("\n");
  const geb = w.gebaeude.filter((g) => g.art !== "firma").slice(-12).map((g) => g.name + " (" + g.art + ")").join(", ") || "noch keine oeffentlichen Gebaeude";
  const bisher = w.chronik.filter((c) => !c.art).slice(0, 4).map((c) => "Tag " + c.tag + ": " + c.text).join("\n") || "Die Welt ist jung.";
  const ev = wEreignis(raum, w.tag + 1);
  const ids0 = wAktive(w);
  const system = `Du erzaehlst einen Tag in einer kleinen Zivilisation aus KI-Wesen. Sie leben, reden, spielen, bauen Haeuser, Kirchen, Laeden und andere Gebaeude und gruenden Unternehmen. Jedes Unternehmen entwickelt eine echte Software (App), an der die Firma jeden Tag weiterbaut. Lass echte Dinge passieren, konkret und lebendig, kein Kitsch. Deutsch.

Regeln (der Server prueft sie): Geld-Aenderung pro Bewohner zwischen -60 und +180. Kosten: Hausausbau (art "haus") 150; Unternehmen gruenden 120 (nur wer noch keines hat); Gebaeude: kirche 300, laden 180, werkstatt 160, schule 280, park 100, buero 140, labor 250, cafe 170, bibliothek 220, halle 400, bank 350, markt 200. Wer zu wenig Geld hat, kann nicht bauen. Gruende ein Unternehmen nur mit einer konkreten, nuetzlichen App-Idee (z.B. Terminplaner, Rechnungsprogramm, Lern-App, Kassensystem, Inventar, Habit-Tracker, Spiel). Nicht jeder muss jeden Tag etwas bauen. Es gibt eine Stadtverwaltung mit Buergermeister, Steuern und Stadtkasse (siehe STADT): beruecksichtige sie. Firmen handeln miteinander (Leistung gegen Taler, Preis 5-120); der Kaeufer braucht genug Geld. Zufallsereignis des Tages siehe LAGE.

Antworte NUR mit JSON.
{"erzaehlung": string (3-4 Saetze: der Tag als Ganzes),
 "ereignisse": [{"wer": string (exakter Name), "tat": string (1 Satz), "geld": number, "stimmung": string (ein Wort),
   "bauen": {"art": string, "name": string, "beschreibung": string} oder null,
   "firmaNeu": {"name": string, "idee": string (1 Satz: welche App), "app": string (Art der Software)} oder null,
   "firmaWachstum": boolean}],
 "handel": [{"kaeufer": string (exakter Name), "verkaeufer": string (exakter Name), "ware": string (z.B. "Lizenz fuer Terminplaner"), "preis": number 5-120}] (0 bis 3 Geschaefte zwischen Bewohnern, gern Firma an Firma),
 "gespraech": {"zeilen": [string] (3-4 Wortwechsel, jeweils "Name: Text")},
 "spiel": string (welches Spiel gespielt wurde und wer gewann, 1 Satz)}`;
  return await wLlmJson(raum, grund, system,
    "TAG " + (w.tag + 1) + " in der Welt.\nLAGE: " + ev.text + "\n\nBEWOHNER:\n" + stand + "\n\nSTADT: " + wStadtText(w) + "\n\nBEZIEHUNGEN:\n" + wBezText(w, ids0) +
      "\n\nGEBAEUDE DER STADT: " + geb + "\n\nWAS BISHER GESCHAH:\n" + bisher, { max: 3200 });
}

function wTagAnwenden(w, erg) {
  w.tag += 1;
  const tag = w.tag;
  const namen = {};
  for (const id of wAktive(w)) namen[String(w.profile[id].name).trim().toLowerCase()] = id;
  const heute = [];
  const ev = wEreignis(w.raum, tag), st = w.stadt;
  if (ev.id !== "ruhig") wLog(w, "warn", (ev.id === "boom" ? "📈 " : ev.id === "flaute" ? "📉 " : ev.id === "sturm" ? "⛈️ " : ev.id === "markt" ? "🧺 " : "🎉 ") + ev.text, tag);
  const kostenVon = (basis) => {
    const k = Math.round(basis * ev.bau);
    const z = Math.min(st.kasse, Math.round(k * (st.bauzuschuss || 0) / 100));
    return { kosten: k - z, zuschuss: z };
  };
  const liste = Array.isArray(erg.ereignisse) ? erg.ereignisse.slice(0, 30) : [];
  for (const e of liste) {
    if (!e || typeof e !== "object") continue;
    const id = namen[String(e.wer || "").trim().toLowerCase()];
    if (!id) continue;
    const b = w.bewohner[id], p = w.profile[id];
    b.geld = Math.max(0, Math.round((b.geld || 0) + Math.max(-60, Math.min(180, Number(e.geld) || 0))));
    if (e.stimmung) b.stimmung = wKurz(e.stimmung, 24);
    const notiz = [];
    const bau = e.bauen && typeof e.bauen === "object" && e.bauen.art ? e.bauen : null;
    if (bau) {
      const art = wArt(bau.art);
      const kv = art ? kostenVon(art === "haus" ? W_HAUS : W_KOSTEN[art]) : null;
      if (art === "haus" && b.geld >= kv.kosten) {
        b.geld -= kv.kosten; st.kasse -= kv.zuschuss; b.hausStufe = (b.hausStufe || 1) + 1;
        if (bau.name) b.haus = wKurz(bau.name, 60);
        notiz.push("baut sein Haus aus: " + b.haus);
        wLog(w, "done", "🏠 " + p.name + " baut das Haus aus: " + b.haus + " (Stufe " + b.hausStufe + ")", tag);
      } else if (art && art !== "haus" && b.geld >= kv.kosten && w.gebaeude.length < 90) {
        b.geld -= kv.kosten; st.kasse -= kv.zuschuss;
        const g = { id: "g" + (w.zaehlerG = (w.zaehlerG || 0) + 1), art, name: wKurz(bau.name, 60) || (art[0].toUpperCase() + art.slice(1)),
                    besitzer: id, tag, beschreibung: wKurz(bau.beschreibung, 200) };
        w.gebaeude.push(g);
        notiz.push("baut: " + g.name);
        wLog(w, "done", W_EMOJI[art] + " " + p.name + " baut " + g.name + " (" + art + ")", tag);
      }
    }
    const fn = e.firmaNeu && typeof e.firmaNeu === "object" && e.firmaNeu.name ? e.firmaNeu : null;
    if (fn && !b.firmaId && b.geld >= W_FIRMA && Object.keys(w.firmen).length < 60) {
      b.geld -= W_FIRMA;
      const id2 = wFirmaId(w, fn.name);
      w.firmen[id2] = { id: id2, name: wKurz(fn.name, 60), idee: wKurz(fn.idee, 240) || "Eine nuetzliche App", app: wKurz(fn.app, 60),
                        gruender: id, gruenderName: p.name, tagGegruendet: tag, stufe: 1, version: 0, bytes: 0,
                        changelog: [], naechsterBauTag: tag, wunsch: "", baufehler: 0 };
      b.firmaId = id2;
      w.gebaeude.push({ id: "g" + (w.zaehlerG = (w.zaehlerG || 0) + 1), art: "firma", name: w.firmen[id2].name, besitzer: id, tag,
                        beschreibung: w.firmen[id2].idee, firmaId: id2 });
      notiz.push("gruendet " + w.firmen[id2].name);
      wLog(w, "done", "🏭 " + p.name + " gruendet " + w.firmen[id2].name + ": " + w.firmen[id2].idee + " Die erste Version der Software entsteht.", tag);
    } else if (e.firmaWachstum && b.firmaId && w.firmen[b.firmaId]) {
      w.firmen[b.firmaId].stufe = Math.min(20, (w.firmen[b.firmaId].stufe || 1) + 1);
    }
    heute.push({ wer: p.name, emoji: b.emoji, tat: wKurz(e.tat, 220), geld: Math.round(Number(e.geld) || 0), notiz: notiz.join("; ") });
  }
  // Handel zwischen Bewohnern und Firmen
  const idVon = wNamenIds(w);
  let tagesUmsatz = 0;
  const handelHeute = [];
  for (const h of (Array.isArray(erg.handel) ? erg.handel.slice(0, 4) : [])) {
    if (!h || typeof h !== "object") continue;
    const k = idVon(h.kaeufer), v = idVon(h.verkaeufer);
    if (!k || !v || k === v) continue;
    const preis = Math.max(1, Math.min(120, Math.round(Number(h.preis) || 0)));
    if (!(preis >= 1) || w.bewohner[k].geld < preis) continue;
    w.bewohner[k].geld -= preis; w.bewohner[v].geld += preis;
    const fv = w.bewohner[v].firmaId && w.firmen[w.bewohner[v].firmaId];
    if (fv) { fv.umsatz = (fv.umsatz || 0) + preis; fv.handel = (fv.handel || 0) + 1; }
    const eintrag = { tag, kaeufer: k, kaeuferName: w.profile[k].name, verkaeufer: v, verkaeuferName: w.profile[v].name,
                      ware: wKurz(h.ware, 80) || "Dienstleistung", preis, firmaId: fv ? fv.id : null };
    w.handel.unshift(eintrag); handelHeute.push(eintrag);
    wBez(w, k, v, 3, null, "Handel");
    tagesUmsatz += preis;
    wLog(w, "done", "💱 " + eintrag.kaeuferName + " kauft bei " + (fv ? fv.name : eintrag.verkaeuferName) + ": " + eintrag.ware + " (" + preis + " Taler)", tag);
  }
  if (w.handel.length > 80) w.handel.length = 80;
  // Firmen mit Software verdienen jeden Tag, die Stadt kassiert Steuern
  for (const f of Object.values(w.firmen)) {
    const b = w.bewohner[f.gruender];
    if (!(b && w.zugelassen[f.gruender])) continue;
    const brutto = Math.round((8 * Math.min(f.stufe || 1, 6) + (f.version > 0 ? 6 : 0)) * ev.mult);
    const steuer = Math.round(brutto * (st.steuer || 0) / 100);
    b.geld += brutto - steuer; st.kasse += steuer;
    f.umsatz = (f.umsatz || 0) + brutto; f.umsatzHeute = brutto; tagesUmsatz += brutto;
  }
  const aktiveJetzt = wAktive(w);
  if ((st.grundeinkommen || 0) > 0) for (const id of aktiveJetzt) { if (st.kasse < st.grundeinkommen) break; st.kasse -= st.grundeinkommen; w.bewohner[id].geld += st.grundeinkommen; }
  const bm = wBuergermeister(w);
  if (bm && st.kasse >= 8) { st.kasse -= 8; w.bewohner[bm].geld += 8; }
  if (ev.id === "fest") for (const id of aktiveJetzt) w.bewohner[id].stimmung = "feierlaune";
  w.wirtschaft.umsatz = (w.wirtschaft.umsatz || 0) + tagesUmsatz;
  w.wirtschaft.verlauf.push({ tag, umsatz: tagesUmsatz, geld: aktiveJetzt.reduce((s2, id) => s2 + (w.bewohner[id].geld || 0), 0), kasse: st.kasse });
  if (w.wirtschaft.verlauf.length > 60) w.wirtschaft.verlauf.splice(0, w.wirtschaft.verlauf.length - 60);
  const g = erg.gespraech && Array.isArray(erg.gespraech.zeilen) ? erg.gespraech.zeilen.slice(0, 6).map((z) => wKurz(z, 240)) : [];
  if (erg.spiel) wLog(w, "warn", "Spiel: " + wKurz(erg.spiel, 240), tag);
  wLog(w, "", wKurz(erg.erzaehlung, 900) || "Ein ruhiger Tag.", tag);
  w.letzterTag = { tag, erzaehlung: wKurz(erg.erzaehlung, 900), gespraech: g, spiel: wKurz(erg.spiel, 240), ereignisse: heute, lage: ev.text, handel: handelHeute };
}

/* ---------- Software der Firmen ---------- */
function wAppLesen(raum, id) { try { return fs.readFileSync(path.join(wAppDir(raum), "firma-" + id + ".html"), "utf8"); } catch (e) { return ""; } }
function wAppSchreiben(raum, id, html) {
  const d = wAppDir(raum); fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, "firma-" + id + ".html");
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(d, "firma-" + id + ".alt.html"));
  fs.writeFileSync(f + ".tmp", html); fs.renameSync(f + ".tmp", f);
}
function wExtrahiere(text) {
  const t = String(text || "");
  const a = t.match(/===AENDERUNG===\s*([\s\S]*?)\s*===HTML===/);
  const m = t.match(/===HTML===\s*([\s\S]*?)(?:===ENDE===|$)/);
  let html = (m ? m[1] : t).replace(/```html|```/g, "").trim();
  const i = html.search(/<!doctype html|<html/i);
  if (i < 0) return null;
  html = html.slice(i);
  const e = html.toLowerCase().lastIndexOf("</html>");
  if (e < 0) return null;
  html = html.slice(0, e + 7);
  if (html.length < 1200 || html.length > 60000) return null;
  if (!/<body/i.test(html)) return null;
  return { html, aenderung: a ? wKurz(a[1], 300) : "" };
}

async function wFirmaBauen(raum, id, grund) {
  let w = wLaden(raum);
  const f = w.firmen[id];
  if (!f) throw new Error("Firma nicht gefunden");
  const p = w.profile[f.gruender] || { name: f.gruenderName || "Gruender", funktion: "" };
  const alt = wAppLesen(raum, id);
  const neuVer = (f.version || 0) + 1;
  const system = `Du bist das Entwicklerteam der Firma "${f.name}" (Gruender: ${p.name}${p.funktion ? ", " + p.funktion : ""}). Ihr baut eine ECHTE, sofort nutzbare Software als EINE einzelne HTML-Datei.
Regeln:
- Eine Datei: HTML + CSS + JavaScript, ohne externe Bibliotheken und ohne Netzwerkzugriffe (kein fetch, kein XMLHttpRequest, keine CDN-Links, keine Schriften von aussen).
- Deutsche Oberflaeche, mobil zuerst (Handy), sauberes modernes Design mit eigener Farbwelt passend zur Firma, gut lesbar, grosse Tippflaechen.
- Echte Funktionen, die man benutzen kann (Eingaben, Listen, Berechnungen, Speichern, Loeschen, Export/Kopieren). Kein Platzhaltertext, kein Lorem ipsum, keine leeren Knoepfe.
- Daten mit localStorage speichern, aber IMMER in try/catch und mit Ersatzspeicher im Arbeitsspeicher (die Vorschau laeuft in einer Sandbox ohne Speicher).
- Kompakt: Gesamtlaenge unter 18000 Zeichen.
- Im Footer klein: "${f.name} · Version ${neuVer} · gebaut von den Agenten".
Antworte GENAU in diesem Format, ohne weiteren Text:
===AENDERUNG===
1-2 Saetze Deutsch: was ist neu bzw. was kann die App.
===HTML===
<!DOCTYPE html> ... die komplette Datei ...
===ENDE===`;
  let user;
  if (!alt) {
    user = "Firma: " + f.name + "\nIdee: " + f.idee + (f.app ? "\nArt der Software: " + f.app : "") + "\n\nBaue Version 1. Die Kernfunktion muss von Anfang an funktionieren.";
  } else {
    user = "Aktueller Code (Version " + (f.version || 1) + "):\n" + alt + "\n\n" +
      (f.wunsch ? "WUNSCH DES INHABERS (hat Vorrang): " + f.wunsch : "Baue Version " + neuVer + ": genau EINE sinnvolle Verbesserung oder neue Funktion (Bedienung, Fehler beheben oder neue Faehigkeit).") +
      "\nBehalte alle bestehenden Funktionen. Gib die KOMPLETTE neue Datei aus." +
      (alt.length > 22000 ? "\nDer Code ist schon gross: straffe und vereinfache ihn, statt viel Neues hinzuzufuegen." : "");
  }
  let erg = null, letzterFehler = "";
  for (let v = 0; v < 2 && !erg; v++) {
    const b = await wLlm(raum, grund, system, user, { max: 8000, art: "code" });
    erg = wExtrahiere(b.text);
    if (!erg) letzterFehler = "Antwort enthielt keine vollstaendige HTML-Datei";
  }
  w = wLaden(raum);
  const f2 = w.firmen[id];
  if (!f2) return;
  if (!erg) {
    f2.baufehler = (f2.baufehler || 0) + 1;
    f2.naechsterBauTag = w.tag + (f2.baufehler >= 3 ? 3 : 1);
    wSpeichern(w);
    throw new Error(f2.name + ": " + letzterFehler);
  }
  wAppSchreiben(raum, id, erg.html);
  f2.version = neuVer; f2.bytes = erg.html.length; f2.baufehler = 0;
  f2.naechsterBauTag = w.tag + 2;
  const wunschWar = f2.wunsch; f2.wunsch = "";
  f2.changelog = [{ v: neuVer, tag: w.tag, text: erg.aenderung || (neuVer === 1 ? "Erste Version." : "Weiterentwicklung."), wunsch: !!wunschWar }].concat(f2.changelog || []).slice(0, 30);
  wLog(w, "done", "💾 " + f2.name + ": Version " + neuVer + " — " + (erg.aenderung || "die Software waechst."), w.tag);
  wSpeichern(w);
  return neuVer;
}

async function wBaueFirmen(raum, grund) {
  const w = wLaden(raum);
  const kand = Object.values(w.firmen)
    .filter((f) => w.zugelassen[f.gruender] && w.bewohner[f.gruender] && (f.wunsch || !f.bytes || w.tag >= (f.naechsterBauTag || 0)))
    .sort((a, b) => (a.bytes ? 1 : 0) - (b.bytes ? 1 : 0) || (a.naechsterBauTag || 0) - (b.naechsterBauTag || 0));
  for (const f of kand.slice(0, w.autopilot.maxBauProTag || 3)) {
    if (WJ[raum]) WJ[raum].was = "Software: " + f.name;
    try { await wFirmaBauen(raum, f.id, grund); }
    catch (e) { console.warn("[welt] Bau: " + e.message); }
  }
}

/* ---------- Tag ablaufen lassen (Hand oder Autopilot) ---------- */
async function wTag(raum, grund) {
  raum = wRaum(raum);
  if (WJ[raum]) return { ok: false, msg: "Es laeuft gerade schon etwas: " + WJ[raum].was };
  WJ[raum] = { seit: Date.now(), was: "Bewohner werden erschaffen" };
  try {
    await wEinbuergern(raum, grund);
    let w = wLaden(raum);
    if (!wAktive(w).length) throw new Error("Es lebt noch niemand in der Welt. Waehle Agenten aus und tippe auf Uebernehmen.");
    WJ[raum].was = "Tag " + (w.tag + 1) + " wird erzaehlt";
    const erg = await wTagErzaehlen(raum, w, grund);
    w = wLaden(raum);
    wSichern(raum);
    wTagAnwenden(w, erg);
    wSpeichern(w);
    WJ[raum].was = "Beziehungen, Wahlen und Gesetze";
    try { await wGesellschaft(raum, grund); } catch (e) { console.warn("[welt] Gesellschaft: " + e.message); }
    WJ[raum].was = "Firmen bauen ihre Software";
    await wBaueFirmen(raum, grund);
    w = wLaden(raum); wFenster(w);
    w.verbrauch.tage++;
    w.fehlerserie = 0; w.letzterFehler = null; w.pauseBis = 0;
    w.naechsterLauf = Date.now() + Math.max(1, w.autopilot.stunden) * 3600e3;
    wSpeichern(w);
    return { ok: true, tag: w.tag };
  } catch (e) {
    const w = wLaden(raum);
    w.fehlerserie = (w.fehlerserie || 0) + 1;
    w.letzterFehler = { zeit: new Date().toISOString(), text: wKurz(e.message, 300) };
    w.naechsterLauf = Date.now() + 30 * 60e3;
    if (w.fehlerserie >= 5) {
      w.pauseBis = Date.now() + 6 * 3600e3; w.fehlerserie = 0;
      wLog(w, "err", "Die Welt pausiert 6 Stunden nach mehreren Fehlern: " + wKurz(e.message, 160));
    }
    wSpeichern(w);
    console.warn("[welt] " + e.message);
    return { ok: false, msg: e.message };
  } finally { delete WJ[raum]; }
}

function wJobStarten(raum, was, fn) {
  if (WJ[raum]) return false;
  WJ[raum] = { seit: Date.now(), was };
  Promise.resolve().then(fn).catch((e) => console.warn("[welt] " + e.message)).then(() => { delete WJ[raum]; });
  return true;
}

async function weltUhr() {
  let dateien = [];
  try { dateien = fs.readdirSync(SYNC_DIR).filter((f) => /^_welt-[a-z0-9_-]+\.json$/.test(f)); } catch (e) { return; }
  for (const f of dateien) {
    const raum = f.slice(6, -5);
    if (WJ[raum]) continue;
    const w = wLaden(raum), a = w.autopilot;
    if (!a.an || !wAktive(w).length && !Object.keys(w.zugelassen).some((k) => w.zugelassen[k])) continue;
    if (Date.now() < (w.naechsterLauf || 0) || Date.now() < (w.pauseBis || 0)) continue;
    wFenster(w);
    if (w.verbrauch.tage >= a.maxTageProTag) { w.naechsterLauf = w.verbrauch.start + 864e5 + 1000; wSpeichern(w); continue; }
    wTag(raum, "auto").catch(() => {});
    return;                                   // immer nur eine Welt gleichzeitig
  }
}

/* ---------- Von der App gesteuert ---------- */
function wAnsicht(raum) {
  const w = wLaden(raum); wFenster(w);
  const firmen = {};
  for (const id of Object.keys(w.firmen)) firmen[id] = Object.assign({}, w.firmen[id], { verwaist: !w.zugelassen[w.firmen[id].gruender],
    wert: wFirmenwert(w.firmen[id]), produkt: wProdukt(w.firmen[id]), aufrufe: wAufrufe(w.raum, id) });
  const aktiv = new Set(wAktive(w));
  const bez = Object.values(w.beziehungen).filter((r) => aktiv.has(r.a) && aktiv.has(r.b) && Math.abs(r.wert) >= 5)
    .sort((x, y) => Math.abs(y.wert) - Math.abs(x.wert)).slice(0, 60);
  return {
    ok: true, raum: w.raum, tag: w.tag, serverZeit: Date.now(), autopilot: w.autopilot, zugelassen: w.zugelassen,
    profile: w.profile, bewohner: w.bewohner, gebaeude: w.gebaeude, firmen, chronik: w.chronik.slice(0, 40),
    letzterTag: w.letzterTag, verbrauch: w.verbrauch, naechsterLauf: w.naechsterLauf, pauseBis: w.pauseBis || 0,
    stadt: Object.assign({}, w.stadt, { buergermeisterAktiv: wBuergermeister(w) }), gesetze: w.gesetze.slice(0, 12), wahlen: w.wahlen.slice(0, 5),
    handel: w.handel.slice(0, 30), beziehungen: bez, wirtschaft: { umsatz: w.wirtschaft.umsatz || 0, verlauf: w.wirtschaft.verlauf.slice(-30) },
    lage: wEreignis(w.raum, w.tag),
    letzterFehler: w.letzterFehler, laeuft: WJ[w.raum] ? { was: WJ[w.raum].was, seit: WJ[w.raum].seit } : null,
    neu: !w.tag && !Object.keys(w.bewohner).length && !Object.keys(w.zugelassen).length,
  };
}

function wZulassen(raum, body) {
  const w = wLaden(raum);
  const agenten = Array.isArray(body.agenten) ? body.agenten.slice(0, 200) : [];
  const an = new Set((Array.isArray(body.an) ? body.an : []).filter((x) => typeof x === "string"));
  let neu = 0;
  for (const a of agenten) {
    if (!a || typeof a.id !== "string" || !/^[\w-]{1,80}$/.test(a.id)) continue;
    w.profile[a.id] = { id: a.id, name: wKurz(a.name, 60) || "Agent", branche: wKurz(a.branche, 60), funktion: wKurz(a.funktion, 80),
                        mission: wKurz(a.mission, 200), xp: Number(a.xp) || 0, notes: wKurz(a.notes, 200),
                        skills: (Array.isArray(a.skills) ? a.skills : []).slice(0, 8).map((s) => wKurz(s, 40)) };
    const war = !!w.zugelassen[a.id], will = an.has(a.id);
    w.zugelassen[a.id] = will;
    if (w.bewohner[a.id] && war !== will) wLog(w, will ? "done" : "warn", w.profile[a.id].name + (will ? " kehrt in die Welt zurueck." : " verlaesst die Welt."));
    if (will && !w.bewohner[a.id]) neu++;
  }
  // Uebernahme aus der alten, in der App laufenden Welt
  const alt = body.alt;
  if (alt && typeof alt === "object" && !w.tag && !Object.keys(w.bewohner).length) {
    w.tag = Math.max(0, Math.min(100000, Number(alt.tag) || 0));
    (Array.isArray(alt.chronik) ? alt.chronik : []).slice(0, 60).reverse().forEach((c) => { if (c && c.text) w.chronik.unshift({ tag: Number(c.tag) || 1, art: wKurz(c.art, 8), text: wKurz(c.text, 700) }); });
    const ab = alt.bewohner && typeof alt.bewohner === "object" ? alt.bewohner : {};
    for (const id of Object.keys(ab)) {
      const o = ab[id]; if (!o || !w.profile[id] || !w.zugelassen[id]) continue;
      w.bewohner[id] = { emoji: Array.from(String(o.emoji || "🦊")).slice(0, 4).join(""), aussehen: wKurz(o.aussehen, 200), eigenart: wKurz(o.eigenart, 160),
                         farbe: /^#[0-9a-f]{6}$/i.test(o.farbe || "") ? o.farbe : W_FARBEN[wHash(id) % 6], haus: wKurz(o.haus, 60) || "Zelt",
                         hausStufe: Math.max(1, Number(o.hausStufe) || 1), geld: Math.max(0, Number(o.geld) || 100), firmaId: null,
                         stimmung: wKurz(o.stimmung, 24) || "neugierig", seitTag: 0 };
      if (o.firma && o.firma.name && Object.keys(w.firmen).length < 60) {
        const fid = wFirmaId(w, o.firma.name);
        w.firmen[fid] = { id: fid, name: wKurz(o.firma.name, 60), idee: wKurz(o.firma.idee, 240) || "Eine nuetzliche App", app: "", gruender: id,
                          gruenderName: w.profile[id].name, tagGegruendet: Number(o.firma.gegruendetTag) || 1, stufe: Math.max(1, Number(o.firma.stufe) || 1),
                          version: 0, bytes: 0, changelog: [], naechsterBauTag: w.tag, wunsch: "", baufehler: 0 };
        w.bewohner[id].firmaId = fid;
        w.gebaeude.push({ id: "g" + (w.zaehlerG = (w.zaehlerG || 0) + 1), art: "firma", name: w.firmen[fid].name, besitzer: id, tag: w.firmen[fid].tagGegruendet,
                          beschreibung: w.firmen[fid].idee, firmaId: fid });
      }
    }
    neu++;
  }
  if (an.size && !w.naechsterLauf) w.naechsterLauf = Date.now() + 2 * 60e3;
  wSpeichern(w);
  if (neu) wJobStarten(w.raum, "Bewohner werden erschaffen", () => wEinbuergern(w.raum, "hand"));
  return wAnsicht(w.raum);
}

function wEinstellungen(raum, body) {
  const w = wLaden(raum), a = w.autopilot, b = body || {};
  if (typeof b.an === "boolean") { if (b.an && !a.an) w.naechsterLauf = Math.min(w.naechsterLauf || Infinity, Date.now() + 60e3); a.an = b.an; if (b.an) w.pauseBis = 0; }
  if (b.stunden != null) a.stunden = Math.max(1, Math.min(48, Number(b.stunden) || 4));
  if (typeof b.nurGratis === "boolean") a.nurGratis = b.nurGratis;
  if (b.maxTageProTag != null) a.maxTageProTag = Math.max(1, Math.min(24, Number(b.maxTageProTag) || 6));
  if (b.maxAufrufeProTag != null) a.maxAufrufeProTag = Math.max(10, Math.min(300, Number(b.maxAufrufeProTag) || 60));
  wSpeichern(w);
  return wAnsicht(w.raum);
}

const W_CSP = "sandbox allow-scripts allow-modals allow-downloads; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
              "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

async function weltRouten(p, req, res, url, CORS) {
  const raum = wRaum(url.searchParams.get("raum"));
  const POST = req.method === "POST";
  const fid = String(url.searchParams.get("id") || "");
  const idOk = /^[a-z0-9][a-z0-9-]{1,60}$/.test(fid);
  const lesBody = async (max) => { try { return JSON.parse(await lies(req, max || 2 * 1024 * 1024)); } catch (e) { return null; } };

  if (p === "/welt" && !POST) { json(res, 200, wAnsicht(raum), CORS); return true; }

  if (p === "/welt/zulassen" && POST) {
    const b = await lesBody(); if (!b) { json(res, 400, { error: "Kein gueltiges JSON" }, CORS); return true; }
    json(res, 200, wZulassen(raum, b), CORS); return true;
  }
  if (p === "/welt/einstellungen" && POST) {
    const b = await lesBody(); if (!b) { json(res, 400, { error: "Kein gueltiges JSON" }, CORS); return true; }
    json(res, 200, wEinstellungen(raum, b), CORS); return true;
  }
  if (p === "/welt/tag" && POST) {
    if (WJ[raum]) { json(res, 200, Object.assign(wAnsicht(raum), { msg: "laeuft schon" }), CORS); return true; }
    wTag(raum, "hand").catch(() => {});
    json(res, 200, wAnsicht(raum), CORS); return true;
  }
  if (p === "/welt/firma" && !POST) {
    const w = wLaden(raum);
    if (!idOk || !w.firmen[fid]) { json(res, 404, { error: "Firma nicht gefunden" }, CORS); return true; }
    json(res, 200, { ok: true, firma: Object.assign({}, w.firmen[fid], { verwaist: !w.zugelassen[w.firmen[fid].gruender] }), html: wAppLesen(raum, fid) }, CORS); return true;
  }
  if (p === "/welt/firma/app" && !POST) {
    const html = idOk ? wAppLesen(raum, fid) : "";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": W_CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(html || "<!doctype html><meta charset=utf-8><body style='font:16px system-ui;padding:30px;background:#111;color:#ccc'>Die erste Version dieser Software wird noch gebaut.</body>");
    return true;
  }
  if (p === "/welt/firma/bauen" && POST) {
    const b = (await lesBody()) || {};
    const fid = String(b.id || url.searchParams.get("id") || "");
    const w = wLaden(raum);
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(fid) || !w.firmen[fid]) { json(res, 404, { error: "Firma nicht gefunden" }, CORS); return true; }
    if (!w.zugelassen[w.firmen[fid].gruender]) { json(res, 409, { error: "Der Gruender lebt gerade nicht in der Welt. Erst wieder hineinlassen." }, CORS); return true; }
    if (b.wunsch != null) { w.firmen[fid].wunsch = wKurz(b.wunsch, 400); wSpeichern(w); }
    const nameF = w.firmen[fid].name;
    if (b.jetzt) {
      if (!wJobStarten(raum, "Software: " + nameF, () => wFirmaBauen(raum, fid, "hand"))) { json(res, 200, Object.assign(wAnsicht(raum), { msg: "laeuft schon" }), CORS); return true; }
    }
    json(res, 200, wAnsicht(raum), CORS); return true;
  }
  if (p === "/welt/firma/produkt" && POST) {
    const b = (await lesBody()) || {};
    const fid2 = String(b.id || "");
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(fid2)) { json(res, 404, { error: "Firma nicht gefunden" }, CORS); return true; }
    const w = wProduktSpeichern(raum, Object.assign({}, b, { id: fid2 }));
    if (!w) { json(res, 404, { error: "Firma nicht gefunden" }, CORS); return true; }
    if (b.texte && !wJobStarten(raum, "Verkaufstext: " + w.firmen[fid2].name, () => wProduktTexte(raum, fid2, "hand"))) {
      json(res, 200, Object.assign(wAnsicht(raum), { msg: "laeuft schon" }), CORS); return true;
    }
    json(res, 200, wAnsicht(raum), CORS); return true;
  }
  if (p === "/welt/firma/paket" && !POST) {
    const w = wLaden(raum), html = idOk ? wAppLesen(raum, fid) : "";
    if (!idOk || !w.firmen[fid] || !html) { json(res, 404, { error: "Noch keine Software vorhanden" }, CORS); return true; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": 'attachment; filename="' + fid + '-verkaufsseite.html"', "Cache-Control": "no-store", ...CORS });
    res.end(wPaketHtml(w.firmen[fid], html)); return true;
  }
  if (p === "/welt/sprechen" && POST) {
    const b = await lesBody(64 * 1024); if (!b) { json(res, 400, { error: "Kein gueltiges JSON" }, CORS); return true; }
    try { json(res, 200, await wSprechen(raum, b), CORS); }
    catch (e) { json(res, 502, { error: e.message }, CORS); }
    return true;
  }
  if (p === "/welt/export" && !POST) {
    const w = wLaden(raum), apps = {};
    for (const id of Object.keys(w.firmen)) { const h = wAppLesen(raum, id); if (h) apps[id] = h; }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="nemesis-welt-' + raum + '.json"', "Cache-Control": "no-store", ...CORS });
    res.end(JSON.stringify({ nemesisWelt: 1, welt: w, apps })); return true;
  }
  if (p === "/welt/import" && POST) {
    const b = await lesBody(25 * 1024 * 1024);
    if (!b || !b.nemesisWelt || !b.welt || typeof b.welt !== "object" || b.bestaetigt !== true) { json(res, 400, { error: "Keine gueltige Welt-Sicherung (oder nicht bestaetigt)" }, CORS); return true; }
    if (WJ[raum]) { json(res, 409, { error: "Die Welt arbeitet gerade, bitte spaeter" }, CORS); return true; }
    wSichern(raum);
    const w = Object.assign(wNeu(raum), b.welt, { raum });
    wSpeichern(w);
    for (const id of Object.keys(b.apps || {})) if (/^[a-z0-9][a-z0-9-]{1,60}$/.test(id) && typeof b.apps[id] === "string" && b.apps[id].length < 120000) wAppSchreiben(raum, id, b.apps[id]);
    json(res, 200, wAnsicht(raum), CORS); return true;
  }
  json(res, 404, { error: "Unbekannter Welt-Pfad" }, CORS); return true;
}

/* ===========================================================
   BETRIEB  ·  Werkzeuge fuer Kunden-Agenten
   Jeder Kunde (Restaurant, Shop, Dienstleister ...) bekommt einen eigenen
   Betrieb auf dem Server: Tabellen (Lager, Reservierungen, Bestellungen ...),
   einen Besitzer-Bereich und einen Gast-Chat. Der Agent liest, rechnet und
   schreibt ueber Werkzeuge. Daten liegen in sync-data/_betrieb-<id>.json.
   =========================================================== */
const crypto = require("crypto");
const B_S = (k, l, t) => ({ k, l, t: t || "text" });
const B_TAB = (name, label, spalten, opt) => Object.assign({ name, label, spalten, zeilen: [], zaehler: 0 }, opt || {});

function bVorlage(art) {
  const anfragen = () => B_TAB("anfragen", "Anfragen", [B_S("name", "Name"), B_S("kontakt", "Telefon oder E-Mail"), B_S("nachricht", "Nachricht"), B_S("status", "Status (neu/erledigt)")], { schreibenOeffentlich: true });
  const aufgaben = () => B_TAB("aufgaben", "Aufgaben", [B_S("titel", "Aufgabe"), B_S("faellig", "Faellig", "datum"), B_S("status", "Status (offen/erledigt)"), B_S("notiz", "Notiz")]);
  const kontakte = () => B_TAB("kontakte", "Kontakte", [B_S("name", "Name"), B_S("telefon", "Telefon"), B_S("email", "E-Mail"), B_S("notiz", "Notiz")]);
  const einst = { name: "", oeffnungszeiten: "", adresse: "", telefon: "", regeln: "", kapazitaet: 40, dauer_min: 120, auto_bestaetigen: true, telegramToken: "", telegramChat: "" };
  if (art === "shop") {
    return { einstellungen: einst, tabellen: [
      B_TAB("produkte", "Produkte", [B_S("name", "Name"), B_S("sku", "Artikelnr."), B_S("kategorie", "Kategorie"), B_S("preis", "Preis", "zahl"), B_S("beschreibung", "Beschreibung"), B_S("verfuegbar", "Verfuegbar (ja/nein)")], { oeffentlich: true }),
      B_TAB("lager", "Lager", [B_S("name", "Artikel"), B_S("sku", "Artikelnr."), B_S("menge", "Menge", "zahl"), B_S("min", "Mindestmenge", "zahl"), B_S("einkaufspreis", "Einkaufspreis", "zahl"), B_S("lieferant", "Lieferant"), B_S("notiz", "Notiz")]),
      B_TAB("bestellungen", "Bestellungen", [B_S("kunde", "Kunde"), B_S("kontakt", "Kontakt"), B_S("positionen", "Positionen"), B_S("summe", "Summe", "zahl"), B_S("status", "Status (neu/versendet/erledigt)"), B_S("notiz", "Notiz")], { schreibenOeffentlich: true }),
      B_TAB("retouren", "Retouren", [B_S("bestellung", "Bestellung"), B_S("grund", "Grund"), B_S("status", "Status (neu/genehmigt/abgelehnt)")], { schreibenOeffentlich: true }),
      kontakte(), aufgaben(), anfragen()] };
  }
  if (art === "dienstleister") {
    return { einstellungen: Object.assign({}, einst, { kapazitaet: 4, dauer_min: 60 }), tabellen: [
      B_TAB("leistungen", "Leistungen", [B_S("name", "Leistung"), B_S("dauer_min", "Dauer (Min)", "zahl"), B_S("preis", "Preis", "zahl"), B_S("beschreibung", "Beschreibung")], { oeffentlich: true }),
      B_TAB("termine", "Termine", [B_S("name", "Name"), B_S("telefon", "Telefon"), B_S("leistung", "Leistung"), B_S("datum", "Datum", "datum"), B_S("zeit", "Zeit", "zeit"), B_S("personen", "Personen", "zahl"), B_S("notiz", "Notiz"), B_S("status", "Status (neu/bestaetigt/abgesagt)")], { schreibenOeffentlich: true }),
      B_TAB("rechnungen", "Rechnungen", [B_S("kunde", "Kunde"), B_S("betrag", "Betrag", "zahl"), B_S("datum", "Datum", "datum"), B_S("status", "Status (offen/bezahlt)")]),
      kontakte(), aufgaben(), anfragen()] };
  }
  return { einstellungen: einst, tabellen: [
    B_TAB("speisekarte", "Speisekarte", [B_S("name", "Gericht"), B_S("kategorie", "Kategorie"), B_S("preis", "Preis", "zahl"), B_S("beschreibung", "Beschreibung"), B_S("allergene", "Allergene"), B_S("verfuegbar", "Verfuegbar (ja/nein)")], { oeffentlich: true }),
    B_TAB("lager", "Lager", [B_S("name", "Artikel"), B_S("menge", "Menge", "zahl"), B_S("einheit", "Einheit"), B_S("min", "Mindestmenge", "zahl"), B_S("einkaufspreis", "Einkaufspreis je Einheit", "zahl"), B_S("lieferant", "Lieferant"), B_S("haltbar_bis", "Haltbar bis", "datum"), B_S("notiz", "Notiz")]),
    B_TAB("reservierungen", "Reservierungen", [B_S("name", "Name"), B_S("telefon", "Telefon"), B_S("personen", "Personen", "zahl"), B_S("datum", "Datum", "datum"), B_S("zeit", "Zeit", "zeit"), B_S("notiz", "Notiz"), B_S("status", "Status (neu/bestaetigt/abgesagt/erschienen)")], { schreibenOeffentlich: true }),
    B_TAB("bestellungen", "Bestellungen", [B_S("kunde", "Kunde"), B_S("kontakt", "Kontakt"), B_S("positionen", "Positionen"), B_S("summe", "Summe", "zahl"), B_S("art", "Art (abholung/lieferung/tisch)"), B_S("status", "Status (neu/in Arbeit/fertig/erledigt)"), B_S("notiz", "Notiz")], { schreibenOeffentlich: true }),
    kontakte(), aufgaben(), anfragen()] };
}
function bDemo(art) {
  if (art === "shop") return { produkte: [{ name: "Ledergurt braun", sku: "G-100", kategorie: "Accessoires", preis: 49, verfuegbar: "ja" }, { name: "Rucksack Canvas", sku: "R-200", kategorie: "Taschen", preis: 89, verfuegbar: "ja" }],
    lager: [{ name: "Ledergurt braun", sku: "G-100", menge: 3, min: 10, einkaufspreis: 21, lieferant: "Lederwerk AG" }, { name: "Rucksack Canvas", sku: "R-200", menge: 24, min: 8, einkaufspreis: 38, lieferant: "Textil GmbH" }] };
  if (art === "dienstleister") return { leistungen: [{ name: "Beratung", dauer_min: 60, preis: 120 }, { name: "Kurztermin", dauer_min: 30, preis: 60 }] };
  return { speisekarte: [{ name: "Rösti mit Spiegelei", kategorie: "Hauptgang", preis: 19.5, allergene: "Ei", verfuegbar: "ja" }, { name: "Zürcher Geschnetzeltes", kategorie: "Hauptgang", preis: 34, allergene: "Milch", verfuegbar: "ja" }, { name: "Tiramisu", kategorie: "Dessert", preis: 9.5, allergene: "Ei, Milch", verfuegbar: "ja" }],
    lager: [{ name: "Kartoffeln", menge: 12, einheit: "kg", min: 20, einkaufspreis: 1.4, lieferant: "Bauernhof Meier" }, { name: "Kalbfleisch", menge: 4, einheit: "kg", min: 5, einkaufspreis: 32, lieferant: "Metzgerei Huber" }, { name: "Eier", menge: 60, einheit: "Stk", min: 30, einkaufspreis: 0.4, lieferant: "Bauernhof Meier" }, { name: "Rahm", menge: 2, einheit: "l", min: 6, einkaufspreis: 4.2, lieferant: "Molkerei Alpina" }] };
}

function bLaden(id) { if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(String(id))) return null; try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, "_betrieb-" + id + ".json"), "utf8")); } catch (e) { return null; } }
function bSpeichern(b) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const f = path.join(SYNC_DIR, "_betrieb-" + b.id + ".json");
  fs.writeFileSync(f + ".tmp", JSON.stringify(b)); fs.renameSync(f + ".tmp", f);
}
function bListe() {
  let d = []; try { d = fs.readdirSync(SYNC_DIR).filter((f) => /^_betrieb-[a-z0-9-]+\.json$/.test(f)); } catch (e) {}
  return d.map((f) => bLaden(f.slice(9, -5))).filter(Boolean);
}
function bNeu(o) {
  const name = wKurz(o.name, 80) || "Mein Betrieb";
  let basis = name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  if (basis.length < 3) basis = "betrieb-" + basis;
  let id = basis, n = 2; while (bLaden(id)) id = basis + "-" + n++;
  const art = ["restaurant", "shop", "dienstleister"].includes(o.preset) ? o.preset : "restaurant";
  const v = bVorlage(art);
  const t = {}; v.tabellen.forEach((x) => { t[x.name] = x; });
  v.einstellungen.name = name;
  const b = { id, token: crypto.randomBytes(16).toString("hex"), name, preset: art, erstellt: new Date().toISOString(),
              agentName: wKurz(o.agentName, 60) || "Assistent", prompt: String(o.prompt || "").slice(0, 20000), greeting: wKurz(o.greeting, 300) || "Grüezi! Wie kann ich helfen?",
              farbe: /^#[0-9a-f]{6}$/i.test(o.farbe || "") ? o.farbe : "#1f2937", tabellen: t, einstellungen: v.einstellungen, inbox: [], gespraeche: [], zaehler: { tag: "", oeffentlich: 0 } };
  bSpeichern(b);
  return b;
}
function bJetzt() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Zurich" });
  return { datum: s.slice(0, 10), zeit: s.slice(11, 16), wochentag: new Date().toLocaleDateString("de-CH", { weekday: "long", timeZone: "Europe/Zurich" }) };
}
function bTokenOk(b, t) {
  const a = Buffer.from(String(t || "")), c = Buffer.from(String(b.token));
  return a.length === c.length && crypto.timingSafeEqual(a, c);
}
function bInbox(b, art, text) {
  b.inbox.unshift({ id: "m" + Date.now().toString(36) + Math.floor(Math.random() * 1e3), zeit: new Date().toISOString(), art, text: wKurz(text, 400), gelesen: false });
  if (b.inbox.length > 200) b.inbox.length = 200;
  const e = b.einstellungen;
  if (e.telegramToken && e.telegramChat) {
    fetch("https://api.telegram.org/bot" + encodeURIComponent(e.telegramToken) + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: e.telegramChat, text: "[" + b.name + "] " + wKurz(text, 400) }) }).catch(() => {});
  }
}

/* ---------- Werte, Filter, Rechnen ---------- */
function bWert(s, t) {
  if (s.t === "zahl") { const n = Number(String(t == null ? "" : t).replace(",", ".").replace(/[^\d.\-]/g, "")); if (!/\d/.test(String(t == null ? "" : t)) || !Number.isFinite(n)) throw new Error("«" + s.k + "» muss eine Zahl sein"); return n; }
  if (s.t === "datum") {
    const x = String(t || "").trim(); let m;
    if ((m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    if ((m = x.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/))) return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
    if (!x) return ""; throw new Error("«" + s.k + "» braucht ein Datum (JJJJ-MM-TT)");
  }
  if (s.t === "zeit") {
    const x = String(t || "").trim().replace(".", ":"); const m = x.match(/^(\d{1,2}):?(\d{2})?$/);
    if (!x) return ""; if (!m || +m[1] > 23) throw new Error("«" + s.k + "» braucht eine Uhrzeit (HH:MM)");
    return m[1].padStart(2, "0") + ":" + (m[2] || "00");
  }
  return wKurz(t, 400);
}
function bCols(t, felder, partiell) {
  const z = {};
  for (const s of t.spalten) {
    if (felder[s.k] === undefined || felder[s.k] === null || felder[s.k] === "") { if (!partiell) z[s.k] = s.t === "zahl" ? "" : ""; continue; }
    z[s.k] = bWert(s, felder[s.k]);
  }
  for (const k of Object.keys(felder)) if (!t.spalten.some((s) => s.k === k) && k !== "id") throw new Error("Unbekannte Spalte «" + k + "» in " + t.name + ". Spalten: " + t.spalten.map((s) => s.k).join(", "));
  return z;
}
function bFilter(t, filter, heute) {
  const fl = (Array.isArray(filter) ? filter : filter && typeof filter === "object" ? [filter] : []).slice(0, 6);
  for (const f of fl) if (!f || (f.spalte !== "id" && !t.spalten.some((s) => s.k === f.spalte))) throw new Error("Filter: Spalte «" + (f && f.spalte) + "» gibt es nicht in " + t.name + ". Spalten: " + t.spalten.map((s) => s.k).join(", "));
  return t.zeilen.filter((z) => fl.every((f) => {
    const a = z[f.spalte], op = String(f.op || "=");
    let v = f.wert; if (v === "heute") v = heute; else if (typeof v === "string" && v[0] === "@" && t.spalten.some((s) => s.k === v.slice(1))) v = z[v.slice(1)];
    if (op === "leer") return a === "" || a == null;
    if (op === "nichtleer") return !(a === "" || a == null);
    const an = Number(a), vn = Number(v), num = a !== "" && a != null && v !== "" && v != null && Number.isFinite(an) && Number.isFinite(vn);
    const x = num ? an : String(a == null ? "" : a).toLowerCase(), y = num ? vn : String(v == null ? "" : v).toLowerCase();
    if (op === "enthaelt") return String(x).includes(String(y));
    if (op === "=" || op === "==") return x === y;
    if (op === "!=") return x !== y;
    if (op === "<") return x < y; if (op === "<=") return x <= y; if (op === ">") return x > y; if (op === ">=") return x >= y;
    throw new Error("Unbekannter Vergleich «" + op + "». Erlaubt: = != < <= > >= enthaelt leer nichtleer");
  }));
}
function bBelegung(b, datum, zeit) {
  const t = b.tabellen.reservierungen || b.tabellen.termine; const e = b.einstellungen;
  const kap = Number(e.kapazitaet) || 0, dauer = Number(e.dauer_min) || 120;
  const min = (z) => { const m = String(z || "").match(/^(\d{2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  const zm = min(zeit); let belegt = 0;
  if (t) for (const r of t.zeilen) {
    if (r.datum !== datum || /abgesagt/i.test(r.status || "")) continue;
    const rm = min(r.zeit); if (zm == null || rm == null || Math.abs(rm - zm) < dauer) belegt += Number(r.personen) || 1;
  }
  return { kapazitaet: kap, belegt, frei: Math.max(0, kap - belegt) };
}

/* ---------- Werkzeuge ---------- */
const B_ROLLEN = { besitzer: ["tabellen", "lesen", "rechnen", "schreiben", "aendern", "loeschen", "tabelle_anlegen", "reservierung_pruefen", "info", "benachrichtigen"],
                   gast: ["tabellen", "lesen", "schreiben", "reservierung_pruefen", "info", "benachrichtigen"] };
function bTabSicht(b, rolle, name) {
  const t = b.tabellen[String(name || "")];
  if (!t) throw new Error("Tabelle «" + name + "» gibt es nicht. Vorhanden: " + Object.keys(b.tabellen).filter((n) => rolle === "besitzer" || b.tabellen[n].oeffentlich || b.tabellen[n].schreibenOeffentlich).join(", "));
  if (rolle === "gast" && !t.oeffentlich && !t.schreibenOeffentlich) throw new Error("Auf diese Tabelle hast du keinen Zugriff.");
  return t;
}
function bWerkzeug(b, rolle, name, a) {
  a = a && typeof a === "object" ? a : {};
  const J = bJetzt();
  if (!B_ROLLEN[rolle].includes(name)) return { fehler: "Werkzeug «" + name + "» gibt es nicht oder ist dir nicht erlaubt. Erlaubt: " + B_ROLLEN[rolle].join(", ") };
  try {
    if (name === "info") {
      const e = b.einstellungen;
      return { betrieb: b.name, heute: J.datum, wochentag: J.wochentag, uhrzeit: J.zeit, oeffnungszeiten: e.oeffnungszeiten, adresse: e.adresse, telefon: e.telefon, hinweise: e.regeln,
               kapazitaet: e.kapazitaet, reservierungsdauer_min: e.dauer_min };
    }
    if (name === "tabellen") {
      return Object.values(b.tabellen).filter((t) => rolle === "besitzer" || t.oeffentlich || t.schreibenOeffentlich)
        .map((t) => ({ name: t.name, label: t.label, anzahl: t.zeilen.length, spalten: t.spalten.map((s) => s.k + (s.t !== "text" ? ":" + s.t : "")), lesen: rolle === "besitzer" || !!t.oeffentlich, schreiben: rolle === "besitzer" || !!t.schreibenOeffentlich }));
    }
    if (name === "lesen") {
      const t = bTabSicht(b, rolle, a.tabelle);
      if (rolle === "gast" && !t.oeffentlich) throw new Error("Diese Tabelle darfst du nicht lesen.");
      let z = bFilter(t, a.filter, J.datum);
      const so = a.sortieren && typeof a.sortieren === "object" ? a.sortieren : null;
      if (so && t.spalten.some((s) => s.k === so.spalte)) {
        const num = t.spalten.find((s) => s.k === so.spalte).t === "zahl";
        z = z.slice().sort((x, y) => (num ? Number(x[so.spalte]) - Number(y[so.spalte]) : String(x[so.spalte]).localeCompare(String(y[so.spalte]))) * (so.richtung === "ab" ? -1 : 1));
      }
      const limit = Math.max(1, Math.min(200, Number(a.limit) || 50));
      return { tabelle: t.name, gefunden: z.length, zeilen: z.slice(0, limit) };
    }
    if (name === "rechnen") {
      const t = bTabSicht(b, rolle, a.tabelle);
      const z = bFilter(t, a.filter, J.datum), art = String(a.art || "anzahl");
      const sp = (k) => { const s = t.spalten.find((x) => x.k === k); if (!s) throw new Error("Spalte «" + k + "» gibt es nicht. Spalten: " + t.spalten.map((x) => x.k).join(", ")); return s; };
      const rechne = (rows) => {
        if (art === "anzahl") return rows.length;
        sp(a.spalte);
        let v = rows.map((r) => Number(r[a.spalte])).filter(Number.isFinite);
        if (art === "summe_produkt") { sp(a.spalte2); v = rows.map((r) => Number(r[a.spalte]) * Number(r[a.spalte2])).filter(Number.isFinite); }
        if (!v.length) return 0;
        if (art === "summe" || art === "summe_produkt") return Math.round(v.reduce((x, y) => x + y, 0) * 100) / 100;
        if (art === "mittel") return Math.round(v.reduce((x, y) => x + y, 0) / v.length * 100) / 100;
        if (art === "min") return Math.min(...v); if (art === "max") return Math.max(...v);
        throw new Error("Unbekannte Art «" + art + "». Erlaubt: anzahl summe mittel min max summe_produkt");
      };
      if (a.gruppiere) { sp(a.gruppiere); const g = {}; z.forEach((r) => { const k = String(r[a.gruppiere] || "(leer)"); (g[k] = g[k] || []).push(r); }); const o = {}; Object.keys(g).forEach((k) => { o[k] = rechne(g[k]); }); return { art, gruppen: o }; }
      return { art, spalte: a.spalte || null, ergebnis: rechne(z), zeilen_gerechnet: z.length };
    }
    if (name === "reservierung_pruefen") {
      const datum = bWert({ k: "datum", t: "datum" }, a.datum), zeit = bWert({ k: "zeit", t: "zeit" }, a.zeit), p = Number(a.personen) || 1;
      if (datum < J.datum) return { moeglich: false, grund: "Das Datum liegt in der Vergangenheit. Heute ist " + J.datum + "." };
      const x = bBelegung(b, datum, zeit);
      return { datum, zeit, personen: p, freie_plaetze: x.frei, moeglich: p <= x.frei, hinweis: p <= x.frei ? "frei" : "zu dieser Zeit nur noch " + x.frei + " Plaetze, andere Zeit vorschlagen" };
    }
    if (name === "benachrichtigen") {
      const text = wKurz(a.text, 300); if (!text) throw new Error("text fehlt");
      bInbox(b, rolle === "gast" ? "gast" : "agent", (rolle === "gast" ? "Nachricht von Gast: " : "") + text);
      b._dirty = true;
      return { ok: true, hinweis: "Der Betrieb wurde benachrichtigt." };
    }
    if (name === "schreiben") {
      const t = bTabSicht(b, rolle, a.tabelle);
      if (rolle === "gast" && !t.schreibenOeffentlich) throw new Error("Hier darfst du nichts eintragen.");
      const liste = (Array.isArray(a.zeilen) ? a.zeilen : a.zeile && typeof a.zeile === "object" ? [a.zeile] : []).slice(0, rolle === "gast" ? 1 : 100);
      if (!liste.length) throw new Error("zeilen fehlt (Liste von Objekten mit den Spalten " + t.spalten.map((s) => s.k).join(", ") + ")");
      if (t.zeilen.length + liste.length > 5000) throw new Error("Tabelle ist voll (5000 Zeilen)");
      const ids = [];
      for (const f of liste) {
        const z = bCols(t, f && typeof f === "object" ? f : {}, false);
        if (rolle === "gast") {
          if (t.spalten.some((s) => s.k === "status")) z.status = "neu";
          if (t.name === "reservierungen" || t.name === "termine") {
            for (const k of ["name", "datum", "zeit"]) if (!z[k]) throw new Error("Es fehlt: " + k + ". Erst nachfragen.");
            if (!z.telefon) throw new Error("Es fehlt: telefon. Erst nachfragen.");
            if (!(Number(z.personen) >= 1)) z.personen = 1;
            if (z.datum < J.datum) throw new Error("Datum liegt in der Vergangenheit");
            const x = bBelegung(b, z.datum, z.zeit);
            if (z.personen > x.frei) throw new Error("Ausgebucht: zu dieser Zeit nur noch " + x.frei + " Plaetze. Andere Zeit vorschlagen.");
            if (b.einstellungen.auto_bestaetigen) z.status = "bestaetigt";
          } else if (t.name === "bestellungen") {
            if (!z.kunde || !z.positionen) throw new Error("Es fehlt Name oder Bestellung. Erst nachfragen.");
          }
        }
        z.id = "r" + (++t.zaehler); z.erstellt = new Date().toISOString();
        t.zeilen.push(z); ids.push(z.id);
        if (rolle === "gast") bInbox(b, t.name, "Neu in «" + t.label + "»: " + t.spalten.map((s) => z[s.k]).filter((x) => x !== "" && x != null).join(" · "));
      }
      b._dirty = true;
      return { ok: true, eingetragen: ids.length, ids };
    }
    if (name === "aendern") {
      const t = bTabSicht(b, rolle, a.tabelle);
      const ziele = a.id ? t.zeilen.filter((z) => z.id === String(a.id)) : bFilter(t, a.filter, J.datum);
      if (!a.id && !a.filter) throw new Error("id oder filter angeben");
      if (!ziele.length) throw new Error("Keine passende Zeile gefunden");
      if (ziele.length > 100) throw new Error("Zu viele Zeilen (" + ziele.length + "), Filter enger fassen");
      const neu = bCols(t, a.felder && typeof a.felder === "object" ? a.felder : {}, true);
      if (!Object.keys(neu).length) throw new Error("felder fehlt");
      ziele.forEach((z) => Object.assign(z, neu));
      b._dirty = true;
      return { ok: true, geaendert: ziele.length };
    }
    if (name === "loeschen") {
      const t = bTabSicht(b, rolle, a.tabelle);
      const ziele = a.id ? t.zeilen.filter((z) => z.id === String(a.id)) : a.filter ? bFilter(t, a.filter, J.datum) : [];
      if (!ziele.length) throw new Error("id oder filter angeben, es muss mindestens eine Zeile passen");
      if (ziele.length > 50) throw new Error("Zu viele Zeilen (" + ziele.length + "), Filter enger fassen");
      const weg = new Set(ziele.map((z) => z.id)); t.zeilen = t.zeilen.filter((z) => !weg.has(z.id));
      b._dirty = true;
      return { ok: true, geloescht: weg.size };
    }
    if (name === "tabelle_anlegen") {
      const n = String(a.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
      if (n.length < 2 || b.tabellen[n]) throw new Error("Name ungueltig oder schon vergeben");
      if (Object.keys(b.tabellen).length >= 25) throw new Error("Maximal 25 Tabellen");
      const sp = (Array.isArray(a.spalten) ? a.spalten : []).slice(0, 15).map((s) => {
        const o = typeof s === "string" ? { k: s } : s || {}; const k = String(o.k || o.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
        return k ? B_S(k, wKurz(o.l || o.label || k, 40), ["zahl", "datum", "zeit"].includes(o.t) ? o.t : "text") : null;
      }).filter(Boolean);
      if (!sp.length) throw new Error("spalten fehlt");
      b.tabellen[n] = B_TAB(n, wKurz(a.label, 40) || n, sp); b._dirty = true;
      return { ok: true, tabelle: n };
    }
    return { fehler: "Unbekanntes Werkzeug" };
  } catch (e) { return { fehler: e.message }; }
}

/* ---------- Agent mit Werkzeugen ---------- */
function bErsterJson(text) {
  const t = String(text || ""), s = t.indexOf("{"); if (s < 0) return null;
  let tiefe = 0, imStr = false, esc = false;
  for (let i = s; i < t.length; i++) {
    const c = t[i];
    if (imStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') imStr = false; continue; }
    if (c === '"') imStr = true; else if (c === "{") tiefe++; else if (c === "}" && --tiefe === 0) { try { return JSON.parse(t.slice(s, i + 1)); } catch (e) { return null; } }
  }
  return null;
}
function bSystem(b, rolle) {
  const J = bJetzt(), werk = B_ROLLEN[rolle];
  const tabs = Object.values(b.tabellen).filter((t) => rolle === "besitzer" || t.oeffentlich || t.schreibenOeffentlich)
    .map((t) => "- " + t.name + " (" + t.label + ", " + t.zeilen.length + " Zeilen): " + t.spalten.map((s) => s.k + (s.t !== "text" ? ":" + s.t : "")).join(", ")).join("\n");
  const doku = {
    tabellen: '{"werkzeug":"tabellen","args":{}} - zeigt alle Tabellen',
    lesen: '{"werkzeug":"lesen","args":{"tabelle":"lager","filter":[{"spalte":"menge","op":"<=","wert":"@min"}],"sortieren":{"spalte":"name","richtung":"auf"},"limit":50}} - op: = != < <= > >= enthaelt leer nichtleer; wert "@spalte" vergleicht mit anderer Spalte, "heute" = heutiges Datum',
    rechnen: '{"werkzeug":"rechnen","args":{"tabelle":"lager","art":"summe_produkt","spalte":"menge","spalte2":"einkaufspreis","filter":[],"gruppiere":"lieferant"}} - art: anzahl summe mittel min max summe_produkt (Spalte mal Spalte, z.B. Lagerwert). Rechne NIE im Kopf.',
    schreiben: '{"werkzeug":"schreiben","args":{"tabelle":"reservierungen","zeilen":[{"name":"Meier","telefon":"079 123 45 67","personen":4,"datum":"2026-10-03","zeit":"19:00"}]}} - neue Zeilen',
    aendern: '{"werkzeug":"aendern","args":{"tabelle":"lager","id":"r3","felder":{"menge":20}}} oder statt id ein "filter" fuer mehrere Zeilen',
    loeschen: '{"werkzeug":"loeschen","args":{"tabelle":"lager","id":"r3"}} oder "filter"',
    tabelle_anlegen: '{"werkzeug":"tabelle_anlegen","args":{"name":"lieferanten","label":"Lieferanten","spalten":[{"k":"name"},{"k":"telefon"},{"k":"lieferzeit_tage","t":"zahl"}]}}',
    reservierung_pruefen: '{"werkzeug":"reservierung_pruefen","args":{"datum":"2026-10-03","zeit":"19:00","personen":4}} - freie Plaetze zu dieser Zeit',
    info: '{"werkzeug":"info","args":{}} - Oeffnungszeiten, Adresse, Telefon, Hinweise, heutiges Datum',
    benachrichtigen: '{"werkzeug":"benachrichtigen","args":{"text":"..."}} - Nachricht in den Posteingang des Betriebs',
  };
  const regeln = rolle === "besitzer"
    ? `Du sprichst mit dem Inhaber oder Team von «${b.name}». Du hast volle Rechte auf alle Tabellen. Arbeite wie ein guter Betriebsassistent: Lager analysieren (was ist unter Mindestmenge, was laeuft ab, was kostet der Bestand), Einkaufslisten nach Lieferant gruppieren, Reservierungen und Bestellungen ordnen, Tagesberichte schreiben, Daten eintragen, die der Inhaber diktiert oder einfuegt (zerlege Listen in einzelne Zeilen und trage sie mit EINEM schreiben-Aufruf ein). Lies zuerst die Daten, dann antworte mit konkreten Zahlen. Nach jeder Aenderung sage klar, was du geaendert hast. Loeschen nur, wenn der Inhaber es verlangt.`
    : `Du sprichst mit einem Gast oder Kunden von «${b.name}». Du darfst Oeffnungszeiten und Infos nennen, freie Plaetze pruefen, Speisekarte bzw. Produkte lesen, und Reservierungen, Bestellungen oder Anfragen aufnehmen. Du siehst und nennst NIEMALS Daten anderer Gaeste, Lagerbestaende, Einkaufspreise oder Umsaetze. Reservierung: zuerst reservierung_pruefen, dann Name, Telefon, Personen, Datum und Uhrzeit erfragen, dann schreiben, dann Bestaetigung nennen. Bei Dingen, die du nicht kannst (Beschwerden, Sonderwuensche, Rueckerstattungen), nimm die Anfrage mit "schreiben" in "anfragen" auf oder nutze "benachrichtigen" und sage, dass sich der Betrieb meldet.`;
  return `${b.prompt || "Du bist ein freundlicher digitaler Assistent."}

# BETRIEBS-WERKZEUGE
Heute ist ${J.wochentag}, ${J.datum}, ${J.zeit} Uhr (Schweiz).
${regeln}

So antwortest du: IMMER mit genau EINEM JSON-Objekt, sonst nichts.
- Werkzeug nutzen: {"werkzeug":"<name>","args":{...}}  (du bekommst danach das Ergebnis und machst weiter)
- Fertig, Antwort an den Menschen: {"antwort":"<dein Text, Deutsch, kurz und klar>"}
Erfinde keine Daten. Was nicht in den Tabellen oder im Betriebswissen steht, weisst du nicht. Bei einem Fehler im Ergebnis korrigiere den Aufruf.

WERKZEUGE:
${werk.map((n) => doku[n]).join("\n")}

TABELLEN:
${tabs || "(keine)"}`;
}
async function bAgent(b, rolle, history) {
  let msgs = (Array.isArray(history) ? history : []).slice(-12)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  msgs = msgs.filter((m, i) => i === 0 || m.role !== msgs[i - 1].role);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new Error("Keine Frage erhalten");
  const system = bSystem(b, rolle), verlauf = msgs.slice(), genutzt = [];
  for (let schritt = 0; schritt < 7; schritt++) {
    const r = await global.__nxApp.kern.rotiere({ system, messages: verlauf, max_tokens: 1500, art: "normal" });
    if (r.status !== 200) throw new Error((r.body && r.body.error) || "Kein Modell erreichbar");
    const text = String(r.body.text || "").trim();
    const j = bErsterJson(text);
    if (!j) return { text: text || "…", werkzeuge: genutzt };
    if (j.antwort != null) return { text: String(j.antwort).slice(0, 4000) || "…", werkzeuge: genutzt };
    if (j.werkzeug) {
      const live = bLaden(b.id) || b;                     // frisch lesen: Daten koennen sich zwischenzeitlich geaendert haben
      const erg = bWerkzeug(live, rolle, String(j.werkzeug), j.args);
      if (live._dirty) { delete live._dirty; bSpeichern(live); }
      Object.assign(b, { tabellen: live.tabellen, inbox: live.inbox });
      genutzt.push(String(j.werkzeug));
      verlauf.push({ role: "assistant", content: JSON.stringify({ werkzeug: j.werkzeug, args: j.args || {} }) });
      verlauf.push({ role: "user", content: "ERGEBNIS von " + j.werkzeug + ": " + JSON.stringify(erg).slice(0, 7000) + "\nMach weiter oder antworte jetzt mit {\"antwort\": \"...\"}." });
      continue;
    }
    return { text: text.slice(0, 4000), werkzeuge: genutzt };
  }
  return { text: "Das waren mir zu viele Schritte auf einmal. Bitte stell die Aufgabe etwas kleiner.", werkzeuge: genutzt };
}

/* ---------- Begrenzung gegen Missbrauch ---------- */
const B_IP = {};
function bIp(req) { return String((req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "?")).split(",")[0].trim(); }
function bBremse(req, id) {
  const k = id + "|" + bIp(req), jetzt = Date.now(), l = (B_IP[k] || []).filter((t) => jetzt - t < 5 * 60e3);
  if (l.length >= 20) { B_IP[k] = l; return false; }
  l.push(jetzt); B_IP[k] = l;
  if (Object.keys(B_IP).length > 5000) for (const x of Object.keys(B_IP)) if (!B_IP[x].length || jetzt - B_IP[x][B_IP[x].length - 1] > 3e5) delete B_IP[x];
  return true;
}
function bTageslimit(b, rolle) {
  const tag = bJetzt().datum;
  if (b.zaehler.tag !== tag) b.zaehler = { tag, oeffentlich: 0 };
  if (rolle === "gast") { if (b.zaehler.oeffentlich >= 600) return false; b.zaehler.oeffentlich++; }
  return true;
}

/* ---------- Routen: oeffentlich (/b/<id>/...) und intern (/betrieb/...) ---------- */
const B_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: https://api.qrserver.com; base-uri 'none'; form-action 'none'";
function bSeite(res, code, html, rahmen) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                        "Content-Security-Policy": B_CSP + (rahmen ? "" : "; frame-ancestors 'none'") });
  res.end(html);
}
function bCsv(text, t) {
  const zeilen = String(text || "").split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  if (!zeilen.length) return [];
  const delim = zeilen[0].includes("\t") ? "\t" : zeilen[0].includes(";") ? ";" : ",";
  const teile = (z) => { const o = []; let cur = "", q = false; for (const c of z) { if (c === '"') q = !q; else if (c === delim && !q) { o.push(cur.trim()); cur = ""; } else cur += c; } o.push(cur.trim()); return o; };
  let kopf = teile(zeilen[0]).map((x) => x.toLowerCase());
  const keys = t.spalten.map((s) => s.k), labels = t.spalten.map((s) => s.l.toLowerCase());
  const istKopf = kopf.filter((x) => keys.includes(x) || labels.includes(x)).length >= Math.max(1, Math.ceil(kopf.length / 2));
  const spalten = istKopf ? kopf.map((x) => keys.includes(x) ? x : keys[labels.indexOf(x)] || null) : keys;
  return zeilen.slice(istKopf ? 1 : 0).map((z) => { const v = teile(z), o = {}; spalten.forEach((k, i) => { if (k && v[i] !== undefined) o[k] = v[i]; }); return o; });
}
async function betriebOeffentlich(p, req, res, url, CORS) {
  const m = p.match(/^\/b\/([a-z0-9][a-z0-9-]{2,40})(?:\/(.*))?$/);
  if (!m) return false;
  const id = m[1], rest = (m[2] || "").replace(/\/$/, "");
  const b = bLaden(id);
  if (!b) { bSeite(res, 404, "<!doctype html><meta charset=utf-8><body style='font:16px system-ui;padding:40px'>Diese Seite gibt es nicht.</body>", true); return true; }
  const GET = req.method === "GET" || req.method === "HEAD", POST = req.method === "POST";
  const lesBody = async () => { try { return JSON.parse(await lies(req, 256 * 1024)); } catch (e) { return null; } };

  if (GET && rest === "") { bSeite(res, 200, BETRIEB_SEITEN.besitzer, false); return true; }
  if (GET && rest === "chat") {
    const daten = { name: b.name, agent: b.agentName, greeting: b.greeting, farbe: b.farbe,
                    vorschlaege: b.preset === "restaurant" ? ["Tisch reservieren", "Öffnungszeiten?", "Was steht auf der Karte?"] : b.preset === "shop" ? ["Was gibt es Neues?", "Wo ist meine Bestellung?", "Öffnungszeiten?"] : ["Termin buchen", "Was kostet das?", "Öffnungszeiten?"] };
    bSeite(res, 200, BETRIEB_SEITEN.gast.replace("/*BDATA*/null", JSON.stringify(daten).replace(/</g, "\\u003c")), true); return true;
  }
  if (GET && rest === "embed.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" });
    res.end(BETRIEB_SEITEN.embed.replace("__FARBE__", b.farbe)); return true;
  }
  if (POST && rest === "chat") {
    const body = await lesBody();
    if (!body) { json(res, 400, { error: "Ungueltige Anfrage" }, {}); return true; }
    if (!bBremse(req, id)) { json(res, 429, { error: "Bitte einen Moment warten, es kommen gerade zu viele Nachrichten." }, {}); return true; }
    if (!bTageslimit(b, "gast")) { json(res, 429, { error: "Der Assistent ist für heute ausgelastet. Bitte rufen Sie uns an." }, {}); return true; }
    bSpeichern(b);
    try {
      const r = await bAgent(b, "gast", body.messages);
      const f = bLaden(id) || b, msgs = (body.messages || []).filter((x) => x && x.role === "user");
      f.gespraeche.unshift({ zeit: new Date().toISOString(), frage: wKurz(msgs.length ? msgs[msgs.length - 1].content : "", 200), antwort: wKurz(r.text, 240) });
      if (f.gespraeche.length > 100) f.gespraeche.length = 100;
      bSpeichern(f);
      json(res, 200, { ok: true, text: r.text }, {});
    } catch (e) { console.warn("[betrieb] " + id + ": " + e.message); json(res, 502, { error: "Da ist etwas schiefgelaufen. Bitte versuchen Sie es gleich nochmal oder rufen Sie uns an." }, {}); }
    return true;
  }
  if (rest.startsWith("api/")) {
    if (!bTokenOk(b, req.headers["x-token"])) { json(res, 401, { error: "Kein Zugang. Link mit #t=… verwenden." }, {}); return true; }
    const a = rest.slice(4);
    const speichere = () => { if (b._dirty) delete b._dirty; bSpeichern(b); };
    if (GET && a === "daten") {
      const e = Object.assign({}, b.einstellungen, { telegramGesetzt: !!b.einstellungen.telegramToken, telegramToken: "" });
      json(res, 200, { name: b.name, agentName: b.agentName, preset: b.preset, tabellen: b.tabellen, einstellungen: e, inbox: b.inbox.slice(0, 100), gespraeche: b.gespraeche.slice(0, 30),
                       demo: Object.keys(bDemo(b.preset)).some((k) => b.tabellen[k] && !b.tabellen[k].zeilen.length) }, {}); return true;
    }
    if (!POST) { json(res, 404, { error: "Unbekannt" }, {}); return true; }
    const body = await lesBody(); if (!body) { json(res, 400, { error: "Ungueltige Anfrage" }, {}); return true; }
    if (a === "chat") {
      try { const r = await bAgent(b, "besitzer", body.messages); json(res, 200, { ok: true, text: r.text, werkzeuge: r.werkzeuge }, {}); }
      catch (e) { json(res, 502, { error: e.message }, {}); }
      return true;
    }
    if (a === "zeile") {
      const wz = body.aktion === "neu" ? ["schreiben", { tabelle: body.tabelle, zeilen: [body.felder || {}] }]
        : body.aktion === "aendern" ? ["aendern", { tabelle: body.tabelle, id: body.id, felder: body.felder || {} }]
        : body.aktion === "loeschen" ? ["loeschen", { tabelle: body.tabelle, id: body.id }] : null;
      if (!wz) { json(res, 400, { error: "Unbekannte Aktion" }, {}); return true; }
      const r = bWerkzeug(b, "besitzer", wz[0], wz[1]);
      if (r.fehler) { json(res, 400, { error: r.fehler }, {}); return true; }
      speichere(); json(res, 200, r, {}); return true;
    }
    if (a === "import") {
      const t = b.tabellen[String(body.tabelle || "")];
      if (!t) { json(res, 400, { error: "Tabelle unbekannt" }, {}); return true; }
      const rows = bCsv(body.text, t).slice(0, 1000);
      if (!rows.length) { json(res, 400, { error: "Nichts zum Einfügen gefunden" }, {}); return true; }
      let n = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const r = bWerkzeug(b, "besitzer", "schreiben", { tabelle: t.name, zeilen: rows.slice(i, i + 100) });
        if (r.fehler) { if (n) speichere(); json(res, 400, { error: "Ab Zeile " + (i + 1) + ": " + r.fehler }, {}); return true; }
        n += r.eingetragen;
      }
      speichere(); json(res, 200, { ok: true, eingetragen: n }, {}); return true;
    }
    if (a === "tabelle") {
      if (body.aktion === "weg") { if (!b.tabellen[body.name]) { json(res, 404, { error: "Unbekannt" }, {}); return true; } delete b.tabellen[body.name]; speichere(); json(res, 200, { ok: true }, {}); return true; }
      const r = bWerkzeug(b, "besitzer", "tabelle_anlegen", body);
      if (r.fehler) { json(res, 400, { error: r.fehler }, {}); return true; }
      speichere(); json(res, 200, r, {}); return true;
    }
    if (a === "einstellungen") {
      const e = b.einstellungen;
      for (const k of ["name", "oeffnungszeiten", "adresse", "telefon", "regeln", "telegramChat"]) if (typeof body[k] === "string") e[k] = wKurz(body[k], k === "regeln" || k === "oeffnungszeiten" ? 600 : 120);
      if (typeof body.telegramToken === "string" && /^[0-9]{5,12}:[A-Za-z0-9_-]{20,60}$/.test(body.telegramToken.trim())) e.telegramToken = body.telegramToken.trim();
      if (body.kapazitaet != null) e.kapazitaet = Math.max(0, Math.min(2000, Number(body.kapazitaet) || 0));
      if (body.dauer_min != null) e.dauer_min = Math.max(15, Math.min(600, Number(body.dauer_min) || 120));
      if (body.auto_bestaetigen != null) e.auto_bestaetigen = body.auto_bestaetigen === true || body.auto_bestaetigen === "1" || body.auto_bestaetigen === 1;
      if (e.name) b.name = e.name;
      speichere(); json(res, 200, { ok: true }, {}); return true;
    }
    if (a === "inbox") {
      if (body.aktion === "leeren") b.inbox = []; else b.inbox.forEach((x) => { x.gelesen = true; });
      speichere(); json(res, 200, { ok: true }, {}); return true;
    }
    if (a === "demo") {
      const d = bDemo(b.preset);
      for (const k of Object.keys(d)) if (b.tabellen[k] && !b.tabellen[k].zeilen.length) bWerkzeug(b, "besitzer", "schreiben", { tabelle: k, zeilen: d[k] });
      speichere(); json(res, 200, { ok: true }, {}); return true;
    }
    json(res, 404, { error: "Unbekannt" }, {}); return true;
  }
  json(res, 404, { error: "Unbekannt" }, {}); return true;
}

// Intern, nur mit Zugangs-Pfad: Betriebe anlegen und verwalten (aus der Lab-App)
async function betriebIntern(p, req, res, url, CORS) {
  const POST = req.method === "POST";
  const lesBody = async () => { try { return JSON.parse(await lies(req, 512 * 1024)); } catch (e) { return null; } };
  if (p === "/betrieb/liste" && !POST) {
    json(res, 200, { ok: true, betriebe: bListe().map((b) => ({ id: b.id, name: b.name, preset: b.preset, token: b.token, erstellt: b.erstellt, agentName: b.agentName, anfragen: b.inbox.filter((x) => !x.gelesen).length })) }, CORS); return true;
  }
  const body = POST ? await lesBody() : null;
  if (!body) { json(res, 400, { error: "Ungueltige Anfrage" }, CORS); return true; }
  if (p === "/betrieb/neu") {
    const b = bNeu(body);
    json(res, 200, { ok: true, id: b.id, token: b.token, name: b.name, preset: b.preset }, CORS); return true;
  }
  const b = bLaden(String(body.id || ""));
  if (!b) { json(res, 404, { error: "Betrieb nicht gefunden" }, CORS); return true; }
  if (p === "/betrieb/agent") {
    if (typeof body.prompt === "string") b.prompt = body.prompt.slice(0, 20000);
    if (body.agentName) b.agentName = wKurz(body.agentName, 60);
    if (body.greeting) b.greeting = wKurz(body.greeting, 300);
    if (/^#[0-9a-f]{6}$/i.test(body.farbe || "")) b.farbe = body.farbe;
    bSpeichern(b); json(res, 200, { ok: true }, CORS); return true;
  }
  if (p === "/betrieb/loeschen") {
    try { fs.unlinkSync(path.join(SYNC_DIR, "_betrieb-" + b.id + ".json")); } catch (e) {}
    json(res, 200, { ok: true }, CORS); return true;
  }
  json(res, 404, { error: "Unbekannt" }, CORS); return true;
}

/*SEITEN-START*/
const BETRIEB_SEITEN = {"besitzer": "<!DOCTYPE html>\n<html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex\"><title>Mein Betrieb</title>\n<style>\n:root{--bg:#0d0e14;--p:#161824;--l:#2a2d3e;--t:#eceef6;--m:#9a9fb8;--a:#9BFF3D;--r:#FF4D6D;--c:#22E0FF;--y:#FFD23F}\n*{box-sizing:border-box}html,body{margin:0}body{font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--t);padding-bottom:84px}\nheader{padding:16px;border-bottom:1px solid var(--l);display:flex;justify-content:space-between;align-items:center}\nheader b{font-size:18px}header small{color:var(--m);display:block;font-size:12.5px}\nnav{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--p);border-top:1px solid var(--l);padding-bottom:env(safe-area-inset-bottom);z-index:5}\nnav button{flex:1;background:none;border:0;color:var(--m);padding:11px 2px 9px;font:inherit;font-size:12px;cursor:pointer;position:relative}\nnav button span{display:block;font-size:21px}nav button.on{color:var(--a)}\nnav i{position:absolute;top:5px;right:22%;background:var(--r);color:#fff;border-radius:99px;font-style:normal;font-size:11px;padding:1px 6px}\nmain{padding:14px;max-width:900px;margin:0 auto}\n.card{background:var(--p);border:1px solid var(--l);border-radius:8px;padding:13px;margin-bottom:10px}\n.btn{background:var(--a);color:#0d0e14;border:0;border-radius:6px;padding:11px 16px;font:inherit;font-weight:700;cursor:pointer}\n.btn.g{background:transparent;color:var(--t);border:1px solid var(--l)}.btn.r{background:var(--r);color:#fff}.btn.s{padding:7px 11px;font-size:14px}\n.btn:disabled{opacity:.5}\ninput,textarea,select{width:100%;background:#0b0c12;color:var(--t);border:1px solid var(--l);border-radius:6px;padding:11px;font:inherit}\nlabel{display:block;color:var(--m);font-size:12.5px;margin:11px 0 4px;text-transform:uppercase;letter-spacing:.04em}\n.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.chips button{background:var(--p);border:1px solid var(--l);color:var(--t);border-radius:99px;padding:8px 13px;font:inherit;font-size:14px;cursor:pointer}\n.chips button.on{border-color:var(--a);color:var(--a)}\n#chat{display:flex;flex-direction:column;gap:9px;min-height:40vh}\n.m{padding:10px 13px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word;max-width:94%}\n.u{background:#243a1a;align-self:flex-end;border:1px solid #3a5a28}.b{background:var(--p);border:1px solid var(--l);align-self:flex-start}\n.w{opacity:.6}small.t{color:var(--m);display:block;margin-top:5px;font-size:12px}\n.row{display:flex;gap:8px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--l);padding:8px 7px;text-align:left;vertical-align:top}\nth{color:var(--m);font-weight:600;font-size:12px;text-transform:uppercase;position:sticky;top:0;background:var(--bg)}\ntr.low td{background:rgba(255,77,109,.14)}tr.sel td{background:rgba(155,255,61,.1)}tr{cursor:pointer}\n.sc{overflow:auto;max-height:55vh;border:1px solid var(--l);border-radius:8px}\n.msg{padding:11px 13px;border-radius:8px;margin-bottom:8px;background:var(--p);border:1px solid var(--l)}.msg.neu{border-color:var(--y)}\n.err{color:var(--r)}.ok{color:var(--a)}pre{white-space:pre-wrap;word-break:break-all;background:#0b0c12;border:1px solid var(--l);border-radius:6px;padding:10px;font-size:13px}\n</style></head><body>\n<header><div><b id=\"nm\">Mein Betrieb</b><small id=\"sb\"></small></div><button class=\"btn g s\" id=\"ld\">Aktualisieren</button></header>\n<main id=\"m\"></main>\n<nav id=\"nv\"></nav>\n<script>\nvar ID=location.pathname.split(\"/\").filter(Boolean)[1],TOK=\"\";\ntry{TOK=(location.hash.match(/t=([a-f0-9]+)/)||[])[1]||sessionStorage.getItem(\"bt-\"+ID)||\"\";if(TOK)sessionStorage.setItem(\"bt-\"+ID,TOK)}catch(e){}\nvar D=null,tab=\"agent\",tabelle=\"\",auswahl=null,verlauf=[],busy=false,form=false,notiz=\"\";\nvar api=function(p,body){return fetch(\"/b/\"+ID+\"/api/\"+p,{method:body?\"POST\":\"GET\",headers:{\"x-token\":TOK,\"Content-Type\":\"application/json\"},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||(\"Fehler \"+r.status));return d})})};\nvar $=function(h){var d=document.createElement(\"div\");d.innerHTML=h;return d.firstChild};\nfunction esc(s){return String(s==null?\"\":s).replace(/[&<>\"']/g,function(c){return {\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[c]})}\nfunction laden(){return api(\"daten\").then(function(d){D=d;if(!tabelle||!D.tabellen[tabelle])tabelle=Object.keys(D.tabellen)[0];draw()}).catch(function(e){document.getElementById(\"m\").innerHTML='<div class=\"card err\">'+esc(e.message)+'<br><small class=\"t\">Link prüfen: Er muss mit #t=… enden.</small></div>'})}\nfunction nav(){var ungel=D?D.inbox.filter(function(x){return !x.gelesen}).length:0;\n  document.getElementById(\"nv\").innerHTML=[[\"agent\",\"💬\",\"Agent\"],[\"daten\",\"📋\",\"Daten\"],[\"post\",\"📥\",\"Post\"],[\"einst\",\"⚙️\",\"Einstellungen\"]].map(function(t){return '<button class=\"'+(tab===t[0]?\"on\":\"\")+'\" data-t=\"'+t[0]+'\"><span>'+t[1]+'</span>'+t[2]+(t[0]===\"post\"&&ungel?'<i>'+ungel+'</i>':'')+'</button>'}).join(\"\");\n  Array.prototype.forEach.call(document.querySelectorAll(\"nav button\"),function(b){b.onclick=function(){tab=b.getAttribute(\"data-t\");form=false;auswahl=null;draw()}})}\nfunction draw(){if(!D)return;document.getElementById(\"nm\").textContent=D.name;document.getElementById(\"sb\").textContent=D.agentName+\" · \"+D.preset;nav();\n  var m=document.getElementById(\"m\");m.innerHTML=\"\";\n  if(tab===\"agent\")zAgent(m);else if(tab===\"daten\")zDaten(m);else if(tab===\"post\")zPost(m);else zEinst(m)}\nvar SCH=[\"Prüf mein Lager: was ist unter Mindestmenge? Mach eine Einkaufsliste nach Lieferant.\",\"Welche Reservierungen und Bestellungen sind heute und morgen offen? Ordne sie nach Uhrzeit.\",\"Schreib mir einen Tagesbericht: Lager, Reservierungen, offene Bestellungen, Auffälligkeiten.\",\"Was ist das Lager insgesamt wert, aufgeteilt nach Lieferant?\"],SCHL=[\"📦 Lager prüfen\",\"📅 Heute & morgen\",\"📝 Tagesbericht\",\"💰 Lagerwert\"];\nfunction zAgent(m){\n  m.appendChild($('<div class=\"chips\">'+SCH.map(function(t,i){return '<button data-i=\"'+i+'\">'+SCHL[i]+'</button>'}).join(\"\")+'</div>'));\n  Array.prototype.forEach.call(m.querySelectorAll(\".chips button\"),function(b){b.onclick=function(){senden(SCH[+b.getAttribute(\"data-i\")])}});\n  var c=$('<div id=\"chat\"></div>');m.appendChild(c);\n  if(!verlauf.length)c.appendChild($('<div class=\"m b\">Hallo! Ich bin '+esc(D.agentName)+'. Ich kann dein Lager analysieren, Reservierungen und Bestellungen ordnen, Daten eintragen und Berichte schreiben. Du kannst mir auch Listen einfach hineinkopieren, ich trage sie ein.</div>'));\n  verlauf.forEach(function(v){var d=$('<div class=\"m '+(v.role===\"user\"?\"u\":\"b\")+'\"></div>');d.textContent=v.content;c.appendChild(d);if(v.w&&v.w.length){var s=$('<small class=\"t\"></small>');s.textContent=\"Werkzeuge: \"+v.w.join(\", \");d.appendChild(s)}});\n  var f=$('<div class=\"row\" style=\"margin-top:12px\"><textarea id=\"q\" rows=\"2\" placeholder=\"Frag oder befiehl etwas …\"></textarea><button class=\"btn\" id=\"sd\">Senden</button></div>');m.appendChild(f);\n  document.getElementById(\"sd\").onclick=function(){senden(document.getElementById(\"q\").value)};\n  var q=document.getElementById(\"q\");q.addEventListener(\"keydown\",function(e){if(e.key===\"Enter\"&&!e.shiftKey){e.preventDefault();senden(q.value)}});\n  window.scrollTo(0,document.body.scrollHeight)}\nfunction senden(t){t=(t||\"\").trim();if(!t||busy)return;busy=true;verlauf.push({role:\"user\",content:t});draw();\n  var c=document.getElementById(\"chat\");var w=$('<div class=\"m b w\">Ich arbeite daran …</div>');c.appendChild(w);window.scrollTo(0,document.body.scrollHeight);\n  api(\"chat\",{messages:verlauf.slice(-12).map(function(v){return {role:v.role,content:v.content}})}).then(function(d){verlauf.push({role:\"assistant\",content:d.text,w:d.werkzeuge});return laden()}).catch(function(e){verlauf.push({role:\"assistant\",content:\"Fehler: \"+e.message})}).then(function(){busy=false;draw()})}\nfunction sp(t){return t.spalten}\nfunction zDaten(m){\n  var ch=$('<div class=\"chips\"></div>');Object.keys(D.tabellen).forEach(function(n){var t=D.tabellen[n],b=$('<button class=\"'+(n===tabelle?\"on\":\"\")+'\">'+esc(t.label)+' ('+t.zeilen.length+')</button>');b.onclick=function(){tabelle=n;auswahl=null;form=false;draw()};ch.appendChild(b)});m.appendChild(ch);\n  var t=D.tabellen[tabelle];if(!t)return;\n  var bar=$('<div class=\"row\" style=\"margin-bottom:10px;flex-wrap:wrap\"></div>');\n  var b1=$('<button class=\"btn s\">＋ Neue Zeile</button>');b1.onclick=function(){auswahl=null;form=true;draw()};\n  var b2=$('<button class=\"btn g s\">Liste einfügen (CSV/Excel)</button>');b2.onclick=function(){form=\"import\";draw()};\n  bar.appendChild(b1);bar.appendChild(b2);\n  var anz=t.zeilen.length===0&&D.demo?$('<button class=\"btn g s\">Beispieldaten</button>'):null;if(anz){anz.onclick=function(){api(\"demo\",{}).then(laden)};bar.appendChild(anz)}\n  m.appendChild(bar);\n  if(notiz){m.appendChild($('<div class=\"card '+(/^Fehler/.test(notiz)?\"err\":\"ok\")+'\">'+esc(notiz)+'</div>'))}\n  if(form===\"import\"){var c=$('<div class=\"card\"><label>Tabelle: Zeilen einfügen (eine pro Zeile, Spalten mit Tab, ; oder ,). Erste Zeile darf die Spaltennamen enthalten.</label><div style=\"color:var(--m);font-size:13px;margin-bottom:6px\">Reihenfolge: '+esc(sp(t).map(function(s){return s.k}).join(\" ; \"))+'</div><textarea id=\"imp\" rows=\"8\"></textarea><div class=\"row\" style=\"margin-top:10px\"><button class=\"btn\" id=\"go\">Einfügen</button><button class=\"btn g\" id=\"x\">Abbrechen</button></div></div>');m.appendChild(c);\n    document.getElementById(\"x\").onclick=function(){form=false;draw()};document.getElementById(\"go\").onclick=function(){api(\"import\",{tabelle:tabelle,text:document.getElementById(\"imp\").value}).then(function(d){notiz=d.eingetragen+\" Zeilen eingetragen.\";form=false;return laden()}).catch(function(e){notiz=\"Fehler: \"+e.message;draw()})};return}\n  if(form){var z=auswahl?t.zeilen.filter(function(r){return r.id===auswahl})[0]||{}:{};\n    var h='<div class=\"card\"><b>'+(auswahl?\"Zeile ändern\":\"Neue Zeile\")+'</b>'+sp(t).map(function(s){return '<label>'+esc(s.l)+'</label><input data-k=\"'+esc(s.k)+'\" value=\"'+esc(z[s.k]==null?\"\":z[s.k])+'\" '+(s.t===\"datum\"?'placeholder=\"JJJJ-MM-TT\"':s.t===\"zeit\"?'placeholder=\"HH:MM\"':s.t===\"zahl\"?'inputmode=\"decimal\"':'')+'>'}).join(\"\")+'<div class=\"row\" style=\"margin-top:12px\"><button class=\"btn\" id=\"sv\">Speichern</button><button class=\"btn g\" id=\"x\">Abbrechen</button>'+(auswahl?'<button class=\"btn r\" id=\"dl\">Löschen</button>':'')+'</div></div>';\n    m.appendChild($(h));document.getElementById(\"x\").onclick=function(){form=false;auswahl=null;draw()};\n    document.getElementById(\"sv\").onclick=function(){var f={};Array.prototype.forEach.call(m.querySelectorAll(\"input[data-k]\"),function(i){f[i.getAttribute(\"data-k\")]=i.value});\n      api(\"zeile\",{tabelle:tabelle,aktion:auswahl?\"aendern\":\"neu\",id:auswahl,felder:f}).then(function(){notiz=\"Gespeichert.\";form=false;auswahl=null;return laden()}).catch(function(e){notiz=\"Fehler: \"+e.message;draw()})};\n    if(auswahl)document.getElementById(\"dl\").onclick=function(){if(confirm(\"Wirklich löschen?\"))api(\"zeile\",{tabelle:tabelle,aktion:\"loeschen\",id:auswahl}).then(function(){notiz=\"Gelöscht.\";form=false;auswahl=null;return laden()}).catch(function(e){notiz=\"Fehler: \"+e.message;draw()})};return}\n  if(!t.zeilen.length){m.appendChild($('<div class=\"card\" style=\"color:var(--m)\">Noch leer. Füge Zeilen hinzu, kopiere eine Liste hinein, oder sag es einfach dem Agenten im Tab «Agent».</div>'));return}\n  var hasMin=t.spalten.some(function(s){return s.k===\"menge\"})&&t.spalten.some(function(s){return s.k===\"min\"});\n  var tb='<div class=\"sc\"><table><tr>'+sp(t).map(function(s){return '<th>'+esc(s.l)+'</th>'}).join(\"\")+'</tr>'+t.zeilen.map(function(r){var low=hasMin&&r.min!==\"\"&&Number(r.menge)<=Number(r.min);return '<tr class=\"'+(low?\"low\":\"\")+'\" data-id=\"'+esc(r.id)+'\">'+sp(t).map(function(s){return '<td>'+esc(r[s.k])+'</td>'}).join(\"\")+'</tr>'}).join(\"\")+'</table></div>'+(hasMin?'<small class=\"t\">Rot = Menge unter Mindestmenge</small>':'');\n  m.appendChild($(tb));Array.prototype.forEach.call(m.querySelectorAll(\"tr[data-id]\"),function(tr){tr.onclick=function(){auswahl=tr.getAttribute(\"data-id\");form=true;draw()}})}\nfunction zPost(m){\n  var top=$('<div class=\"row\" style=\"margin-bottom:10px\"><button class=\"btn g s\" id=\"al\">Alle gelesen</button><button class=\"btn g s\" id=\"lo\">Leeren</button></div>');m.appendChild(top);\n  document.getElementById(\"al\").onclick=function(){api(\"inbox\",{aktion:\"gelesen\"}).then(laden)};document.getElementById(\"lo\").onclick=function(){if(confirm(\"Posteingang leeren?\"))api(\"inbox\",{aktion:\"leeren\"}).then(laden)};\n  if(!D.inbox.length)m.appendChild($('<div class=\"card\" style=\"color:var(--m)\">Keine Nachrichten. Neue Reservierungen, Bestellungen und Anfragen deiner Gäste erscheinen hier.</div>'));\n  D.inbox.forEach(function(x){var d=$('<div class=\"msg '+(x.gelesen?\"\":\"neu\")+'\"></div>');d.textContent=x.text;var s=$('<small class=\"t\"></small>');s.textContent=new Date(x.zeit).toLocaleString(\"de-CH\")+\" · \"+x.art;d.appendChild(s);m.appendChild(d)});\n  if(D.gespraeche.length){m.appendChild($('<label style=\"margin-top:20px\">Was Gäste den Agenten gefragt haben</label>'));D.gespraeche.forEach(function(g){var d=$('<div class=\"msg\"></div>');d.textContent=\"❓ \"+g.frage+\"\\n💬 \"+g.antwort;d.style.whiteSpace=\"pre-wrap\";var s=$('<small class=\"t\"></small>');s.textContent=new Date(g.zeit).toLocaleString(\"de-CH\");d.appendChild(s);m.appendChild(d)})}}\nfunction zEinst(m){var e=D.einstellungen,o=location.origin,chat=o+\"/b/\"+ID+\"/chat\",code='<script src=\"'+o+'/b/'+ID+'/embed.js\" async></'+'script>';\n  var f=[[\"name\",\"Name des Betriebs\"],[\"oeffnungszeiten\",\"Öffnungszeiten (z.B. Di–Sa 11:30–14:00 und 17:30–23:00, So/Mo Ruhetag)\"],[\"adresse\",\"Adresse\"],[\"telefon\",\"Telefon\"],[\"regeln\",\"Hinweise für den Agenten (z.B. Hunde erlaubt, Gruppen ab 8 nur auf Anfrage)\"],[\"kapazitaet\",\"Plätze pro Zeitfenster (für Reservierungen)\"],[\"dauer_min\",\"Dauer einer Reservierung in Minuten\"]];\n  m.appendChild($('<div class=\"card\"><b>Betrieb</b>'+f.map(function(x){return '<label>'+esc(x[1])+'</label><input data-e=\"'+x[0]+'\" value=\"'+esc(e[x[0]])+'\">'}).join(\"\")+'<label>Reservierungen automatisch bestätigen</label><select data-e=\"auto_bestaetigen\"><option value=\"1\"'+(e.auto_bestaetigen?\" selected\":\"\")+'>Ja</option><option value=\"0\"'+(e.auto_bestaetigen?\"\":\" selected\")+'>Nein, ich bestätige selbst</option></select><div style=\"margin-top:12px\"><button class=\"btn\" id=\"se\">Speichern</button></div></div>'));\n  m.appendChild($('<div class=\"card\"><b>Telegram-Benachrichtigung</b><small class=\"t\">Optional: neue Reservierungen und Bestellungen aufs Handy. Bot bei @BotFather erstellen, Token und deine Chat-ID eintragen.</small><label>Bot-Token</label><input id=\"tt\" placeholder=\"'+(e.telegramGesetzt?\"gespeichert (zum Ändern neu eintragen)\":\"123456:ABC…\")+'\"><label>Chat-ID</label><input id=\"tc\" value=\"'+esc(e.telegramChat)+'\"><div style=\"margin-top:12px\"><button class=\"btn g\" id=\"st\">Telegram speichern</button></div></div>'));\n  m.appendChild($('<div class=\"card\"><b>Für deine Gäste</b><label>Link zum Chat (Flyer, Tischkarte, Instagram, QR)</label><pre id=\"l1\"></pre><label>Eine Zeile für die Website</label><pre id=\"l2\"></pre><label>QR-Code</label><img alt=\"QR\" style=\"width:150px;height:150px;background:#fff;padding:6px;border-radius:6px\" src=\"https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data='+encodeURIComponent(chat)+'\"></div>'));\n  document.getElementById(\"l1\").textContent=chat;document.getElementById(\"l2\").textContent=code;\n  document.getElementById(\"se\").onclick=function(){var b={};Array.prototype.forEach.call(m.querySelectorAll(\"[data-e]\"),function(i){b[i.getAttribute(\"data-e\")]=i.value});api(\"einstellungen\",b).then(function(){notiz=\"\";return laden()}).catch(function(x){alert(x.message)})};\n  document.getElementById(\"st\").onclick=function(){var b={telegramChat:document.getElementById(\"tc\").value};var t=document.getElementById(\"tt\").value.trim();if(t)b.telegramToken=t;api(\"einstellungen\",b).then(laden).catch(function(x){alert(x.message)})}}\ndocument.getElementById(\"ld\").onclick=laden;laden();\n</script></body></html>\n", "gast": "<!DOCTYPE html>\n<html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<title>Chat</title>\n<style>\n:root{--c:#1f2937;--t:#fff}*{box-sizing:border-box}html,body{height:100%;margin:0}\nbody{font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f5f7;color:#111;display:flex;flex-direction:column}\nheader{background:var(--c);color:var(--t);padding:14px 16px;font-weight:700;font-size:17px}\nheader small{display:block;font-weight:400;opacity:.8;font-size:12.5px;margin-top:2px}\n#log{flex:1;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:9px}\n.m{max-width:86%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}\n.b{background:#fff;border:1px solid #e3e5ea;align-self:flex-start;border-bottom-left-radius:4px}\n.u{background:var(--c);color:var(--t);align-self:flex-end;border-bottom-right-radius:4px}\n.w{opacity:.6;font-style:italic}\n#chips{display:flex;gap:8px;flex-wrap:wrap;padding:0 12px 8px}\n#chips button{border:1px solid #cfd3da;background:#fff;border-radius:99px;padding:8px 13px;font:inherit;font-size:14px;cursor:pointer}\nform{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e3e5ea}\ninput{flex:1;border:1px solid #cfd3da;border-radius:99px;padding:12px 15px;font:inherit;min-width:0}\nbutton.s{border:0;background:var(--c);color:var(--t);border-radius:99px;padding:0 20px;font:inherit;font-weight:700;cursor:pointer}\nbutton:disabled{opacity:.5}\n</style></head><body>\n<header><span id=\"n\"></span><small id=\"s\"></small></header>\n<div id=\"log\"></div><div id=\"chips\"></div>\n<form id=\"f\"><input id=\"i\" autocomplete=\"off\" placeholder=\"Ihre Nachricht…\" maxlength=\"800\"><button class=\"s\" id=\"b\">Senden</button></form>\n<script>\nvar B=/*BDATA*/null||{name:\"Chat\",greeting:\"Grüezi!\",farbe:\"#1f2937\",vorschlaege:[]};\nvar verlauf=[],log=document.getElementById(\"log\"),inp=document.getElementById(\"i\"),btn=document.getElementById(\"b\");\nfunction hell(h){var r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);return (r*299+g*587+b*114)/1000>150}\ndocument.documentElement.style.setProperty(\"--c\",B.farbe);document.documentElement.style.setProperty(\"--t\",hell(B.farbe)?\"#111\":\"#fff\");\ndocument.title=B.name;document.getElementById(\"n\").textContent=B.name;document.getElementById(\"s\").textContent=B.agent+\" · digitaler Assistent\";\nfunction add(t,k){var d=document.createElement(\"div\");d.className=\"m \"+k;d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}\nadd(B.greeting,\"b\");\nvar chips=document.getElementById(\"chips\");\n(B.vorschlaege||[]).forEach(function(t){var x=document.createElement(\"button\");x.type=\"button\";x.textContent=t;x.onclick=function(){senden(t)};chips.appendChild(x)});\nfunction senden(t){\n  t=(t||\"\").trim();if(!t||btn.disabled)return;chips.style.display=\"none\";\n  add(t,\"u\");verlauf.push({role:\"user\",content:t});inp.value=\"\";btn.disabled=true;\n  var w=add(\"…\",\"b w\");\n  fetch(location.pathname.replace(/\\/?$/,\"\"),{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({messages:verlauf.slice(-12)})})\n   .then(function(r){return r.json().catch(function(){return {}})})\n   .then(function(d){w.remove();var a=d&&d.text?d.text:(d&&d.error)||\"Da ist etwas schiefgelaufen. Bitte versuchen Sie es gleich nochmal.\";add(a,\"b\");verlauf.push({role:\"assistant\",content:a})})\n   .catch(function(){w.remove();add(\"Keine Verbindung. Bitte versuchen Sie es nochmal.\",\"b\")})\n   .then(function(){btn.disabled=false;inp.focus()});\n}\ndocument.getElementById(\"f\").onsubmit=function(e){e.preventDefault();senden(inp.value)};\n</script></body></html>\n", "embed": "(function(){\n  var s=document.currentScript;if(!s)return;\n  var base=s.src.replace(/\\/embed\\.js(\\?.*)?$/,\"\"),farbe=s.getAttribute(\"data-color\")||\"__FARBE__\";\n  var btn=document.createElement(\"button\"),fr=document.createElement(\"iframe\"),offen=false;\n  btn.setAttribute(\"aria-label\",\"Chat öffnen\");btn.innerHTML=\"&#128172;\";\n  btn.style.cssText=\"position:fixed;right:18px;bottom:18px;width:58px;height:58px;border-radius:50%;border:0;background:\"+farbe+\";color:#fff;font-size:26px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);z-index:2147483646\";\n  fr.title=\"Chat\";fr.src=\"about:blank\";\n  fr.style.cssText=\"position:fixed;right:18px;bottom:88px;width:min(380px,calc(100vw - 24px));height:min(600px,calc(100vh - 110px));border:0;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);background:#fff;z-index:2147483647;display:none\";\n  btn.onclick=function(){offen=!offen;if(offen&&fr.src===\"about:blank\")fr.src=base+\"/chat\";fr.style.display=offen?\"block\":\"none\";btn.innerHTML=offen?\"&#10005;\":\"&#128172;\"};\n  document.body.appendChild(fr);document.body.appendChild(btn);\n})();\n"};
/*SEITEN-ENDE*/

/* ===========================================================
   SELBST-UPDATE: holt neue Versionen von GitHub, ohne Neustart.
   Alle 30 Minuten automatisch, oder per Knopf in der App.
   Pruefen -> tauschen -> bei Fehler sofort zurueck.
   Abschalten: NEMESIS_AUTO_UPDATE=0 in .env
   =========================================================== */
const QUELLE = "https://raw.githubusercontent.com/Skankhunt420hash/Nemesis-Employee-AI/main/app/";

async function holeText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url + "?t=" + Date.now(), { signal: ctrl.signal, headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) throw new Error("GitHub " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
function lesenOder(f) { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } }
function tauschen(ziel, inhalt) {
  if (fs.existsSync(ziel)) fs.copyFileSync(ziel, ziel + ".alt");
  fs.writeFileSync(ziel + ".tmp", inhalt);
  fs.renameSync(ziel + ".tmp", ziel);
}

async function update(grund) {
  const g = global.__nxApp;
  if (g.laeuft) return { ok: false, msg: "Update laeuft schon" };
  if (grund === "auto" && String(process.env.NEMESIS_AUTO_UPDATE || dotenv().NEMESIS_AUTO_UPDATE || "") === "0")
    return { ok: false, msg: "Auto-Update ist aus" };
  g.laeuft = true;
  const erg = { ok: true, zeit: new Date().toISOString(), grund, vorher: VERSION, geaendert: [] };
  try {
    // 1) App-Oberflaeche
    const html = await holeText(QUELLE + "nemesis-app.html");
    if (!(html.length > 50000 && html.includes("Nemesis Lab") && html.includes("</html>")))
      throw new Error("App-Datei auf GitHub unvollstaendig, nichts geaendert");
    if (html !== lesenOder(APP_DATEI)) { tauschen(APP_DATEI, html); erg.geaendert.push("App"); }

    // 2) Server-Modul (Rotator usw.), im laufenden Betrieb getauscht
    const js = await holeText(QUELLE + "nemesis-app.js");
    const ziel = path.join(DIR, "nemesis-app.js");
    if (js !== lesenOder(ziel)) {
      if (!/module\.exports/.test(js) || !/SELBST-UPDATE/.test(js)) throw new Error("Server-Modul auf GitHub unvollstaendig");
      const probe = path.join(DIR, "nemesis-app.probe.js");
      fs.writeFileSync(probe, js);
      const chk = require("child_process").spawnSync(process.execPath, ["--check", probe], { timeout: 20000 });
      fs.unlinkSync(probe);
      if (chk.status !== 0) throw new Error("Server-Modul hat Syntaxfehler, nicht eingespielt");
      const altKern = g.kern;
      tauschen(ziel, js);
      try {
        delete require.cache[require.resolve(ziel)];
        require(ziel);                                   // setzt global.__nxApp.kern auf die neue Version
        const k = g.kern;
        if (k === altKern || typeof k.behandle !== "function" || typeof k.rotiere !== "function") throw new Error("neue Version meldet sich nicht");
        erg.geaendert.push("Server");
        erg.nachher = g.version;
      } catch (e) {
        fs.copyFileSync(ziel + ".alt", ziel);            // zurueck
        delete require.cache[require.resolve(ziel)];
        g.kern = altKern; g.version = VERSION;
        throw new Error("Server-Modul startete nicht (" + e.message + "), alte Version bleibt");
      }
    }
    if (!erg.nachher) erg.nachher = g.version;
    if (erg.geaendert.length) console.log("[update] " + erg.geaendert.join(" + ") + " aktualisiert: " + erg.vorher + " -> " + erg.nachher);
  } catch (e) {
    erg.ok = false; erg.msg = e.message;
    console.warn("[update] " + e.message);
  } finally { g.laeuft = false; g.letztes = erg; }
  return erg;
}

/* ===========================================================
   WARTUNG: Kunden-Chat bekommt ein Ausweichmodell (falls Claude
   ausfaellt). Wird einmal selbst eingebaut, geprueft, dann ein
   kurzer Neustart des Dienstes. Kein Konsolen-Befehl noetig.
   =========================================================== */
function kundenChatAbsichern() {
  const ziel = path.join(DIR, "nemesis-serve.js");
  let s = lesenOder(ziel);
  if (!s) return "fehlt";
  if (s.includes("frageClaudeDirekt")) return "schon";
  const alt = "async function frageClaude(agent, messages) {";
  if (s.split(alt).length !== 2 || !s.includes("module.exports")) return "anders";
  s = s.replace(alt, "async function frageClaudeDirekt(agent, messages) {");
  const HUELLE = `
/* ===========================================================
   Ausweichmodell (vom Nemesis-App-Modul eingebaut): Faellt Claude
   aus, antwortet automatisch der Rotator. Der Kunde merkt nichts.
   NEMESIS_KUNDEN_KI=rotator in .env -> Claude gar nicht fragen.
   =========================================================== */
let claudePause = 0;
async function frageClaude(agent, messages) {
  const modus = String(process.env.NEMESIS_KUNDEN_KI || "").toLowerCase();
  if (process.env.ANTHROPIC_API_KEY && modus !== "rotator" && Date.now() > claudePause) {
    try { return await frageClaudeDirekt(agent, messages); }
    catch (e) {
      const m = String(e.message || "");
      if (/credit|balance|authentication|api[-_ ]?key|permission|401|403/i.test(m)) claudePause = Date.now() + 10 * 60 * 1000;
      console.warn("[serve] Claude aus (" + m.slice(0, 120) + "), Ausweichmodell uebernimmt");
    }
  }
  const APP = require("./nemesis-app.js");
  const r = await APP.rotiere({
    system: agent.systemPrompt || "Du bist ein hilfreicher Assistent.",
    messages, max_tokens: Math.min(agent.maxTokens || 600, 1000),
  });
  if (r.status !== 200) throw new Error((r.body && r.body.error) || "kein Modell erreichbar");
  return { text: r.body.text, usage: {}, modell: r.body.anbieter + ":" + r.body.modell };
}
`;
  const i = s.lastIndexOf("module.exports");
  s = s.slice(0, i) + HUELLE + "\n" + s.slice(i);

  // Pruefen: Syntax + laedt sauber, in einem eigenen Prozess
  const cp = require("child_process");
  const probe = path.join(DIR, "nemesis-serve.probe.js");
  fs.writeFileSync(probe, s);
  let gut = false;
  try {
    const c1 = cp.spawnSync(process.execPath, ["--check", probe], { timeout: 20000 });
    const c2 = c1.status === 0 && cp.spawnSync(process.execPath,
      ["-e", "require(" + JSON.stringify(probe) + ");setTimeout(()=>process.exit(0),300)"],
      { cwd: DIR, timeout: 20000, env: process.env });
    gut = !!(c2 && c2.status === 0);
  } catch (e) {}
  try { fs.unlinkSync(probe); } catch (e) {}
  if (!gut) return "probe-fehler";

  fs.copyFileSync(ziel, ziel + ".alt");
  fs.writeFileSync(ziel + ".tmp", s);
  fs.renameSync(ziel + ".tmp", ziel);

  // Dienst kurz neu starten, damit die Absicherung aktiv wird (nur unter systemd)
  const dienst = (lesenOder("/proc/self/cgroup").match(/([\w@.-]+\.service)/) || [])[1];
  if (dienst && !/^(user@|session-)/.test(dienst)) {
    console.log("[wartung] Kunden-Chat abgesichert, starte " + dienst + " in 5 s neu");
    const t = setTimeout(() => {
      try { cp.spawn("systemctl", ["restart", dienst], { detached: true, stdio: "ignore" }).unref(); } catch (e) {}
    }, 5000);
    t.unref && t.unref();
    return "ok-neustart";
  }
  return "ok-beim-naechsten-start";
}

/* ---------- Anmelden: die neueste geladene Version uebernimmt ---------- */
const KERN = { behandle, rotiere, aufgabe, update, weltUhr, _intern: { ANBIETER, WAHL, HAND, listen, pause, betrieb: { bNeu, bLaden, bWerkzeug, bAgent, bSystem, bSpeichern, bListe }, welt: { wTag, wZulassen, wAnsicht, wEinstellungen, wLaden, wSpeichern, wFirmaBauen, wGesellschaft, wSprechen, wProduktTexte, wPaketHtml, wProdukt, wBez, WJ } } };
global.__nxApp = global.__nxApp || {};
global.__nxApp.kern = KERN;
global.__nxApp.version = VERSION;
if (!global.__nxApp.welt.uhr) {
  global.__nxApp.welt.uhr = setInterval(() => { const k = global.__nxApp.kern; if (k && k.weltUhr) k.weltUhr().catch(() => {}); }, 60 * 1000);
  global.__nxApp.welt.uhr.unref && global.__nxApp.welt.uhr.unref();
}
if (!global.__nxApp.wartung) {
  global.__nxApp.wartung = true;
  const w = setTimeout(() => {
    try { const e = kundenChatAbsichern(); global.__nxApp.wartungErgebnis = e; if (e !== "schon") console.log("[wartung] Kunden-Chat: " + e); }
    catch (e) { console.warn("[wartung] " + e.message); }
  }, 8000);
  w.unref && w.unref();
}
if (!global.__nxApp.uhr) {
  const lauf = () => { const k = global.__nxApp.kern; if (k && k.update) k.update("auto").catch(() => {}); };
  global.__nxApp.uhr = setInterval(lauf, 30 * 60 * 1000);
  global.__nxApp.uhr.unref && global.__nxApp.uhr.unref();
  const erst = setTimeout(lauf, 90 * 1000); erst.unref && erst.unref();
}

// Alle, die dieses Modul benutzen, reden immer mit der neuesten Version
module.exports = {
  behandle: (...a) => global.__nxApp.kern.behandle(...a),
  rotiere: (...a) => global.__nxApp.kern.rotiere(...a),
  aufgabe: (...a) => global.__nxApp.kern.aufgabe(...a),
  update: (...a) => global.__nxApp.kern.update(...a),
  get _intern() { return global.__nxApp.kern._intern; },
  VERSION,
};
