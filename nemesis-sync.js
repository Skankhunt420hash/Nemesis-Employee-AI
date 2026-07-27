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

  if (url.pathname !== "/state") {
    res.writeHead(404, CORS); return res.end("nur /state");
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
