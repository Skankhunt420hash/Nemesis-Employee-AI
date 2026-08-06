/* ===========================================================
   NEMESIS CLOUD-SYNC  ·  nemesis-sync.js
   Speichert den App-Zustand (Agenten, Modelle, alles) zentral
   auf dem Droplet. Damit sind deine Agenten überall gleich —
   Handy, Laptop, egal welche Adresse.

   Node 18+, keine Abhängigkeiten.
   Start:  PORT=3400 node nemesis-sync.js

   Die App spricht mit:
     GET  /state?raum=<name>   -> gespeicherter Zustand (oder {})
     POST /state?raum=<name>   -> Zustand speichern
   "raum" ist dein privater Schlüssel — wer ihn kennt, sieht die
   Agenten. Standard ist "nemesis", du kannst in der App einen
   eigenen setzen.
   =========================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3400;
const DIR = process.env.DATA_DIR || path.join(__dirname, "sync-data");
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function safeRaum(r) {
  return String(r || "nemesis").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "nemesis";
}
function datei(raum) {
  return path.join(DIR, safeRaum(raum) + ".json");
}

function lesen(raum) {
  try { return fs.readFileSync(datei(raum), "utf8"); } catch (e) { return "{}"; }
}
function schreiben(raum, inhalt) {
  const f = datei(raum);
  fs.writeFileSync(f + ".tmp", inhalt);
  fs.renameSync(f + ".tmp", f);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  const url = new URL(req.url, "http://x");
  const raum = safeRaum(url.searchParams.get("raum"));

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    return res.end(JSON.stringify({ ok: true, raeume: fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).length }));
  }

  if (url.pathname === "/fetch") {
    const ziel = url.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(ziel)) { res.writeHead(400, { "Content-Type": "application/json", ...CORS }); return res.end(JSON.stringify({ error: "url fehlt oder ungueltig" })); }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(ziel, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 NemesisBot" } });
      clearTimeout(t);
      let html = await r.text();
      // Text aus HTML herausschaelen: Scripts/Styles weg, Tags weg, Whitespace normalisieren
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12000);
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ ok: true, text, laenge: text.length }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "konnte Seite nicht laden: " + e.message }));
    }
  }

  // ── /proxy  ──────────────────────────────────────────────────────────────
  // Leitet LLM-Anfragen weiter: Browser → dieser Server → LLM-Anbieter
  // Löst CORS-Problem für OpenAI, Groq, Gemini, Mistral etc.
  if (url.pathname === "/proxy") {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    if (req.method !== "POST") { res.writeHead(405, CORS); return res.end("POST erwartet"); }
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 20 * 1024 * 1024) req.destroy(); });
    await new Promise((r) => req.on("end", r));
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "Kein gueltiges JSON" }));
    }
    const { endpoint, key, body: llmBody, headers: extraHeaders } = parsed;
    if (!endpoint || !/^https?:\/\//.test(endpoint)) {
      res.writeHead(400, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "endpoint fehlt oder ungueltig" }));
    }
    const ALLOWED = [
      "api.anthropic.com","api.openai.com","api.groq.com",
      "openrouter.ai","generativelanguage.googleapis.com",
      "api.mistral.ai","api.cohere.com","api.together.xyz",
      "api.together.ai","api.perplexity.ai","api.deepseek.com"
    ];
    const host = new URL(endpoint).hostname;
    if (!ALLOWED.some((a) => host === a || host.endsWith("." + a))) {
      res.writeHead(403, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "Anbieter nicht erlaubt: " + host }));
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90000);
      const fwdHeaders = { "Content-Type": "application/json" };
      if (key) {
        if (host === "api.anthropic.com") {
          fwdHeaders["x-api-key"] = key;
          fwdHeaders["anthropic-version"] = "2023-06-01";
        } else {
          fwdHeaders["Authorization"] = "Bearer " + key;
        }
      }
      if (extraHeaders) Object.assign(fwdHeaders, extraHeaders);
      const upstream = await fetch(endpoint, {
        method: "POST", headers: fwdHeaders,
        body: JSON.stringify(llmBody), signal: ctrl.signal
      });
      clearTimeout(t);
      const upBody = await upstream.text();
      res.writeHead(upstream.status, { "Content-Type": "application/json", ...CORS });
      return res.end(upBody);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "Proxy-Fehler: " + e.message }));
    }
  }

  if (url.pathname !== "/state") {
    res.writeHead(404, CORS); return res.end("nur /state, /fetch oder /proxy");
  }

  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    return res.end(lesen(raum));
  }

  if (req.method === "POST") {
    let body = "";
    for await (const c of req) {
      body += c;
      if (body.length > 12 * 1024 * 1024) { res.writeHead(413, CORS); return res.end("zu gross"); }
    }
    try {
      JSON.parse(body);                 // Gültigkeit prüfen
      schreiben(raum, body);
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ ok: true, raum }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "kaputtes JSON" }));
    }
  }

  res.writeHead(405, CORS); res.end("nur GET oder POST");
});

server.listen(PORT, () => console.log("Nemesis Cloud-Sync auf Port " + PORT + ", Daten in " + DIR));
