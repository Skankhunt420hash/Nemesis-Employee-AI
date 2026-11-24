/* OpenHands-Adapter (Agent Server, MIT, getestet gegen openhands-agent-server 1.64.0).
   Nur Endpunkte aus der OpenAPI-Spezifikation des Agent Servers (docs/integrationen/openhands-endpunkte.md):
     GET /alive, /ready, /server_info              Lebenszeichen, Bereitschaft, Version/Werkzeuge (oeffentlich)
     GET /api/conversations/count                  braucht Header X-Session-API-Key (Pruefung, ob Schutz aktiv ist)
   Spaeter (Phase 3): POST /api/conversations, /run, /pause, /interrupt, /events, /git/diff. */
"use strict";
const { anfrage, fehlerText, HTTP_TEXT } = require("./basis.js");

const META = {
  id: "openhands", name: "OpenHands", rolle: "Software-Entwicklung (Agent Server: Code, Terminal, Tests, Git)", lizenz: "MIT",
  quelle: "https://github.com/OpenHands/software-agent-sdk", getestetMit: "1.64.0", standardUrl: "http://127.0.0.1:8000",
  felder: [{ id: "url", name: "Adresse des Agent Servers", typ: "url" }, { id: "token", name: "Session-API-Key (OH_SESSION_API_KEYS_0)", typ: "geheim" }],
  start: "OH_SESSION_API_KEYS_0=<geheim> python -m openhands.agent_server --host 127.0.0.1 --port 8000   (Python >= 3.12; besser auf einem Worker-PC, nicht auf dem 4-GB-Server)",
};

function adapter(cfg) {
  const h = cfg.token ? { "X-Session-API-Key": cfg.token } : {};
  return {
    async test() {
      const out = { schritte: [] };
      try {
        const a = await anfrage(cfg.url, "GET", "/alive", { ms: 8000 });
        out.schritte.push({ name: "Lebenszeichen (/alive)", ok: a.status === 200, info: a.status === 200 ? "ok" : (HTTP_TEXT[a.status] || "HTTP " + a.status) });
        if (a.status !== 200) return Object.assign(out, { status: "fehler", meldung: "Kein OpenHands Agent Server unter dieser Adresse (HTTP " + a.status + ")", hilfe: "Start: " + META.start });
        const i = await anfrage(cfg.url, "GET", "/server_info", { ms: 8000 });
        if (i.status === 200 && i.j) { out.version = i.j.version || null; out.werkzeuge = Array.isArray(i.j.usable_tools) ? i.j.usable_tools.length : null; out.laufzeit = i.j.conversation_runtime || null; }
        out.schritte.push({ name: "Version (/server_info)", ok: i.status === 200, info: out.version ? "v" + out.version + ", " + out.werkzeuge + " Werkzeuge, Laufzeit " + out.laufzeit : "HTTP " + i.status });
        const r = await anfrage(cfg.url, "GET", "/ready", { ms: 8000 });
        out.schritte.push({ name: "Bereit (/ready)", ok: r.status === 200, info: r.status === 200 ? "ok" : (HTTP_TEXT[r.status] || "HTTP " + r.status) });
        const ohne = await anfrage(cfg.url, "GET", "/api/conversations/count", { ms: 8000 });
        const geschuetzt = ohne.status === 401 || ohne.status === 403;
        out.schritte.push({ name: "Schutz ohne Schluessel", ok: geschuetzt, info: geschuetzt ? "gesperrt (gut)" : "OFFEN – jeder kann Code ausfuehren lassen!" });
        if (!geschuetzt) return Object.assign(out, { status: "fehler", meldung: "Der Agent Server ist ohne Schluessel erreichbar. Das ist gefaehrlich.", hilfe: "Server mit OH_SESSION_API_KEYS_0=<geheim> starten und denselben Schluessel hier eintragen." });
        const mit = await anfrage(cfg.url, "GET", "/api/conversations/count", { headers: h, ms: 8000 });
        out.schritte.push({ name: "Anmeldung mit Schluessel", ok: mit.status === 200, info: mit.status === 200 ? "ok" : (HTTP_TEXT[mit.status] || "HTTP " + mit.status) });
        if (mit.status !== 200) return Object.assign(out, { status: "warnung", meldung: "Server laeuft, aber der Session-API-Key stimmt nicht.", hilfe: "Denselben Schluessel wie OH_SESSION_API_KEYS_0 beim Start eintragen." });
        if (r.status !== 200) return Object.assign(out, { status: "warnung", meldung: "Verbunden, aber noch nicht bereit (/ready).", hilfe: "Kurz warten und erneut testen." });
        return Object.assign(out, { status: "ok", meldung: "Verbunden mit OpenHands Agent Server v" + (out.version || "?") + "." });
      } catch (e) { return Object.assign(out, { status: "fehler" }, fehlerText(e, "OpenHands")); }
    },
  };
}

module.exports = { META, adapter };
