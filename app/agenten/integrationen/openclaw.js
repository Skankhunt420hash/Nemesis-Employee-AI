/* OpenClaw-Adapter (MIT, Doku aus openclaw@2026.11.6 gelesen; ein echtes Gateway braucht Node >= 24.16).
   Nur dokumentierte Schnittstellen:
     GET  /healthz, /readyz                 Laufzeitstatus (docs/gateway/health.md)
     POST /tools/invoke                     ein Werkzeug (docs/gateway/tools-invoke-http-api.md), Bearer-Token
     POST /v1/chat/completions              Agentenlauf, model "openclaw/<agentId>" (docs/gateway/openai-http-api.md, standardmaessig aus)
   Sicherheit: Das Gateway-Token ist ein Betreiber-Schluessel mit vollen Rechten (laut Doku). Gateway nur loopback/privat. */
"use strict";
const { pruefeUrl, anfrage, fehlerText, HTTP_TEXT } = require("./basis.js");
const kurz = (s, n) => String(s == null ? "" : s).slice(0, n);

const META = {
  id: "openclaw", name: "OpenClaw", rolle: "Agenten, Werkzeuge, Automationen (Gateway)", lizenz: "MIT",
  quelle: "https://github.com/openclaw/openclaw", getestetMit: "Vertragstest gegen Doku 2026.11.6 (kein echtes Gateway)", standardUrl: "http://127.0.0.1:18789",
  felder: [{ id: "url", name: "Gateway-Adresse", typ: "url" }, { id: "token", name: "Gateway-Token (OPENCLAW_GATEWAY_TOKEN)", typ: "geheim" }, { id: "agentId", name: "Agent fuer Auftraege (optional)", typ: "text" }],
  start: "openclaw gateway --port 18789   (Node >= 24.16; besser auf einem Worker-PC)",
};

function openclawAdapter(cfg) {
  const basis = pruefeUrl(cfg.url);
  const kopf = () => Object.assign({ "Content-Type": "application/json" }, cfg.token ? { Authorization: "Bearer " + cfg.token } : {});
  async function rufe(methode, pfad, body, ms, signal) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms || 60000);
    if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const r = await fetch(basis + pfad, { method: methode, headers: kopf(), body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
      return { status: r.status, j, text: kurz(text, 4000), retryAfter: r.headers.get("retry-after") };
    } finally { clearTimeout(t); }
  }
  const httpFehler = (r) => {
    const m = r.j && r.j.error ? (r.j.error.message || r.j.error.type || JSON.stringify(r.j.error)) : r.text;
    return ({ 401: "Gateway-Anmeldung fehlgeschlagen (Token pruefen)", 403: "Von der OpenClaw-Policy blockiert", 404: "Werkzeug im Gateway nicht verfuegbar/erlaubt", 429: "Gateway bremst (Retry-After " + (r.retryAfter || "?") + ")" }[r.status] || "OpenClaw-Fehler " + r.status) + (m ? ": " + kurz(m, 300) : "");
  };
  return {
    async test() {
      const out = { schritte: [] };
      try {
        const h = await anfrage(basis, "GET", "/healthz", { ms: 8000 });
        out.schritte.push({ name: "Lebenszeichen (/healthz)", ok: h.status === 200, info: h.status === 200 ? "ok" : (HTTP_TEXT[h.status] || "HTTP " + h.status) });
        if (h.status !== 200) return Object.assign(out, { status: "fehler", meldung: "Kein OpenClaw-Gateway unter dieser Adresse (HTTP " + h.status + ")", hilfe: "Start: " + META.start });
        const r = await anfrage(basis, "GET", "/readyz", { ms: 8000 });
        out.schritte.push({ name: "Bereit (/readyz)", ok: r.status === 200, info: r.status === 200 ? "ok" : (HTTP_TEXT[r.status] || "HTTP " + r.status) });
        const ohne = await anfrage(basis, "POST", "/tools/invoke", { body: { tool: "sessions_list", args: {} }, ms: 8000 });
        const geschuetzt = ohne.status === 401;
        out.schritte.push({ name: "Schutz ohne Token", ok: geschuetzt, info: geschuetzt ? "gesperrt (gut)" : "HTTP " + ohne.status + " – Gateway ohne Anmeldung erreichbar!" });
        if (!geschuetzt) return Object.assign(out, { status: "fehler", meldung: "Das Gateway nimmt Werkzeug-Aufrufe ohne Token an.", hilfe: "gateway.auth.mode=token setzen und Token hier eintragen." });
        const mit = await anfrage(basis, "POST", "/tools/invoke", { headers: kopf(), body: { tool: "sessions_list", args: {} }, ms: 10000 });
        out.schritte.push({ name: "Anmeldung mit Token", ok: mit.status === 200, info: mit.status === 200 ? "ok" : (HTTP_TEXT[mit.status] || "HTTP " + mit.status) });
        if (mit.status === 401) return Object.assign(out, { status: "warnung", meldung: "Gateway laeuft, aber das Token stimmt nicht.", hilfe: "OPENCLAW_GATEWAY_TOKEN eintragen." });
        if (r.status !== 200) return Object.assign(out, { status: "warnung", meldung: "Verbunden, aber noch nicht bereit (/readyz).", hilfe: "" });
        return Object.assign(out, { status: "ok", meldung: "Verbunden mit OpenClaw-Gateway." });
      } catch (e) { return Object.assign(out, { status: "fehler" }, fehlerText(e, "OpenClaw")); }
    },
    async status() {
      const out = { url: basis };
      try { const h = await rufe("GET", "/healthz", null, 5000); out.live = h.status === 200; } catch (e) { out.live = false; out.fehler = e.message; }
      try { const r = await rufe("GET", "/readyz", null, 5000); out.bereit = r.status === 200; } catch (e) { out.bereit = false; }
      return out;
    },
    async werkzeug(tool, args, o) {
      o = o || {};
      const body = { tool, args: args || {} };
      if (o.sessionKey) body.sessionKey = o.sessionKey;
      if (o.agentId) body.agentId = o.agentId;
      if (o.idempotencyKey) body.idempotencyKey = o.idempotencyKey;
      const r = await rufe("POST", "/tools/invoke", body, o.ms || 120000, o.signal);
      if (r.status === 200 && r.j && r.j.ok) return r.j.result;
      throw new Error(httpFehler(r));
    },
    async agentLauf(text, o) {
      o = o || {};
      const r = await rufe("POST", "/v1/chat/completions", { model: "openclaw/" + (o.agentId || "default"), messages: [{ role: "user", content: String(text) }], user: o.user }, o.ms || 900000, o.signal);
      if (r.status === 200 && r.j && r.j.choices && r.j.choices[0]) return { text: String(r.j.choices[0].message && r.j.choices[0].message.content || ""), modell: r.j.model };
      throw new Error(httpFehler(r));
    },
  };
}

module.exports = { META, adapter: openclawAdapter };
