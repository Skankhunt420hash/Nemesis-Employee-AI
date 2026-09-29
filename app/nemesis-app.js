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
const VERSION = "2026-09-29.1";
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
  let { system, messages, max_tokens, modell } = einsatz;
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

  const art = aufgabe(system, messages);
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
                     /^\/a\/[^/]+\/?$/, /^\/favicon\.ico$/, /^\/robots\.txt$/];
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
  const unsere = p === "/app" || p === "/app/" || p === "/llm" || p === "/llm/status" || p === "/update"
              || p === "/manifest.webmanifest" || p === "/icon.svg";
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
const KERN = { behandle, rotiere, aufgabe, update, _intern: { ANBIETER, WAHL, HAND, listen, pause } };
global.__nxApp = global.__nxApp || {};
global.__nxApp.kern = KERN;
global.__nxApp.version = VERSION;
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
