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
const VERSION = "2026-09-29.2";
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
    system, messages: [{ role: "user", content: user }], max_tokens: opt.max || 2500,
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
{"bewohner": [{"name": string (exakt wie vorgegeben), "emoji": string (EIN passendes Emoji als Gesicht), "aussehen": string (1 Satz), "haus": string (Name der ersten Behausung, z.B. "Bretterbude am Hang"), "eigenart": string (kurz, was ihn sozial ausmacht)}]}`,
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
    };
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
      "; Stimmung: " + b.stimmung + "; Eigenart: " + b.eigenart;
  }).join("\n");
  const geb = w.gebaeude.filter((g) => g.art !== "firma").slice(-12).map((g) => g.name + " (" + g.art + ")").join(", ") || "noch keine oeffentlichen Gebaeude";
  const bisher = w.chronik.filter((c) => !c.art).slice(0, 4).map((c) => "Tag " + c.tag + ": " + c.text).join("\n") || "Die Welt ist jung.";
  const system = `Du erzaehlst einen Tag in einer kleinen Zivilisation aus KI-Wesen. Sie leben, reden, spielen, bauen Haeuser, Kirchen, Laeden und andere Gebaeude und gruenden Unternehmen. Jedes Unternehmen entwickelt eine echte Software (App), an der die Firma jeden Tag weiterbaut. Lass echte Dinge passieren, konkret und lebendig, kein Kitsch. Deutsch.

Regeln (der Server prueft sie): Geld-Aenderung pro Bewohner zwischen -60 und +180. Kosten: Hausausbau (art "haus") 150; Unternehmen gruenden 120 (nur wer noch keines hat); Gebaeude: kirche 300, laden 180, werkstatt 160, schule 280, park 100, buero 140, labor 250, cafe 170, bibliothek 220, halle 400, bank 350, markt 200. Wer zu wenig Geld hat, kann nicht bauen. Gruende ein Unternehmen nur mit einer konkreten, nuetzlichen App-Idee (z.B. Terminplaner, Rechnungsprogramm, Lern-App, Kassensystem, Inventar, Habit-Tracker, Spiel). Nicht jeder muss jeden Tag etwas bauen.

Antworte NUR mit JSON.
{"erzaehlung": string (3-4 Saetze: der Tag als Ganzes),
 "ereignisse": [{"wer": string (exakter Name), "tat": string (1 Satz), "geld": number, "stimmung": string (ein Wort),
   "bauen": {"art": string, "name": string, "beschreibung": string} oder null,
   "firmaNeu": {"name": string, "idee": string (1 Satz: welche App), "app": string (Art der Software)} oder null,
   "firmaWachstum": boolean}],
 "gespraech": {"zeilen": [string] (3-4 Wortwechsel, jeweils "Name: Text")},
 "spiel": string (welches Spiel gespielt wurde und wer gewann, 1 Satz)}`;
  return await wLlmJson(raum, grund, system,
    "TAG " + (w.tag + 1) + " in der Welt.\n\nBEWOHNER:\n" + stand + "\n\nGEBAEUDE DER STADT: " + geb + "\n\nWAS BISHER GESCHAH:\n" + bisher, { max: 2800 });
}

function wTagAnwenden(w, erg) {
  w.tag += 1;
  const tag = w.tag;
  const namen = {};
  for (const id of wAktive(w)) namen[String(w.profile[id].name).trim().toLowerCase()] = id;
  const heute = [];
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
      if (art === "haus" && b.geld >= W_HAUS) {
        b.geld -= W_HAUS; b.hausStufe = (b.hausStufe || 1) + 1;
        if (bau.name) b.haus = wKurz(bau.name, 60);
        notiz.push("baut sein Haus aus: " + b.haus);
        wLog(w, "done", "🏠 " + p.name + " baut das Haus aus: " + b.haus + " (Stufe " + b.hausStufe + ")", tag);
      } else if (art && art !== "haus" && b.geld >= W_KOSTEN[art] && w.gebaeude.length < 90) {
        b.geld -= W_KOSTEN[art];
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
  // Firmen mit Software verdienen jeden Tag
  for (const f of Object.values(w.firmen)) {
    const b = w.bewohner[f.gruender];
    if (b && w.zugelassen[f.gruender]) b.geld += 8 * Math.min(f.stufe || 1, 6) + (f.version > 0 ? 6 : 0);
  }
  const g = erg.gespraech && Array.isArray(erg.gespraech.zeilen) ? erg.gespraech.zeilen.slice(0, 6).map((z) => wKurz(z, 240)) : [];
  if (erg.spiel) wLog(w, "warn", "Spiel: " + wKurz(erg.spiel, 240), tag);
  wLog(w, "", wKurz(erg.erzaehlung, 900) || "Ein ruhiger Tag.", tag);
  w.letzterTag = { tag, erzaehlung: wKurz(erg.erzaehlung, 900), gespraech: g, spiel: wKurz(erg.spiel, 240), ereignisse: heute };
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
  for (const id of Object.keys(w.firmen)) firmen[id] = Object.assign({}, w.firmen[id], { verwaist: !w.zugelassen[w.firmen[id].gruender] });
  return {
    ok: true, raum: w.raum, tag: w.tag, serverZeit: Date.now(), autopilot: w.autopilot, zugelassen: w.zugelassen,
    profile: w.profile, bewohner: w.bewohner, gebaeude: w.gebaeude, firmen, chronik: w.chronik.slice(0, 40),
    letzterTag: w.letzterTag, verbrauch: w.verbrauch, naechsterLauf: w.naechsterLauf, pauseBis: w.pauseBis || 0,
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
const KERN = { behandle, rotiere, aufgabe, update, weltUhr, _intern: { ANBIETER, WAHL, HAND, listen, pause, welt: { wTag, wZulassen, wAnsicht, wEinstellungen, wLaden, wSpeichern, wFirmaBauen, WJ } } };
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
