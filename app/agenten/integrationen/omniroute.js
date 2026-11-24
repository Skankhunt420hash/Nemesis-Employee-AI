/* OmniRoute-Adapter (MIT, getestet gegen 3.8.54).
   Nur dokumentierte Schnittstellen (docs/reference/API_REFERENCE.md, docs/guides/HEADLESS.md):
     GET  /api/monitoring/health       oeffentlich, Lebenszeichen
     GET  /v1/models                   Katalog inkl. "pricing" (USD/Token als Text). Fehlt "pricing" -> Preis unbekannt
     POST /v1/chat/completions         OpenAI-kompatibel; Header X-OmniRoute-Decision nennt den genutzten Anbieter
   Kostenregel: "auto"/Kombis haben laut Doku KEINEN Preis -> gelten als potenziell kostenpflichtig. */
"use strict";
const { anfrage, fehlerText, HTTP_TEXT } = require("./basis.js");

const META = {
  id: "omniroute", name: "OmniRoute", rolle: "Modell-Gateway (KI-Routing ueber viele Anbieter)", lizenz: "MIT",
  quelle: "https://github.com/cheaper-inference/OmniRoute", getestetMit: "3.8.54", standardUrl: "http://127.0.0.1:20128",
  felder: [{ id: "url", name: "Adresse", typ: "url" }, { id: "token", name: "OmniRoute-API-Schluessel (Dashboard → Endpoints)", typ: "geheim" }],
  start: "npx omniroute serve --headless --port 20128   (oder Docker diegosouzapw/omniroute, nur an 127.0.0.1 binden)",
};

/** Ein Modell ist nur gratis, wenn OmniRoute selbst Preis 0 meldet. Kein Preis = unbekannt = gesperrt. */
function preisKlasse(m) {
  const p = m && m.pricing;
  if (!p) return "unbekannt";
  const werte = [p.prompt, p.completion].filter((x) => x !== undefined && x !== null).map(Number);
  if (!werte.length || werte.some((x) => !isFinite(x))) return "unbekannt";
  return werte.every((x) => x === 0) ? "gratis" : "kostenpflichtig";
}

function adapter(cfg) {
  const h = cfg.token ? { Authorization: "Bearer " + cfg.token } : {};
  return {
    async test() {
      const out = { schritte: [] };
      try {
        const g = await anfrage(cfg.url, "GET", "/api/monitoring/health", { ms: 8000 });
        out.schritte.push({ name: "Lebenszeichen (/api/monitoring/health)", ok: g.status === 200, info: g.status === 200 ? "ok" : (HTTP_TEXT[g.status] || "HTTP " + g.status) });
        if (g.status !== 200) return Object.assign(out, { status: "fehler", meldung: "OmniRoute meldet kein Lebenszeichen (HTTP " + g.status + ")", hilfe: "Laeuft OmniRoute? Start: " + META.start });
        if (g.j && (g.j.version || (g.j.app && g.j.app.version))) out.version = g.j.version || g.j.app.version;
      } catch (e) { return Object.assign(out, { status: "fehler" }, fehlerText(e, "OmniRoute")); }
      try {
        const m = await anfrage(cfg.url, "GET", "/v1/models", { headers: h, ms: 20000 });
        if (m.status === 401) { out.schritte.push({ name: "Modelle (/v1/models)", ok: false, info: "Schluessel fehlt oder falsch" }); return Object.assign(out, { status: "warnung", meldung: "Verbunden, aber der OmniRoute-Schluessel fehlt oder ist falsch.", hilfe: "Schluessel im OmniRoute-Dashboard unter Endpoints kopieren." }); }
        const liste = (m.j && Array.isArray(m.j.data)) ? m.j.data : [];
        const k = { gratis: 0, kostenpflichtig: 0, unbekannt: 0 };
        for (const x of liste) k[preisKlasse(x)]++;
        out.modelle = { gesamt: liste.length, gratis: k.gratis, kostenpflichtig: k.kostenpflichtig, unbekannt: k.unbekannt, gratisBeispiele: liste.filter((x) => preisKlasse(x) === "gratis").slice(0, 10).map((x) => x.id) };
        out.schritte.push({ name: "Modelle (/v1/models)", ok: m.status === 200, info: m.status === 200 ? liste.length + " Modelle, davon " + k.gratis + " mit Preis 0" : (HTTP_TEXT[m.status] || "HTTP " + m.status) });
        if (m.status !== 200) return Object.assign(out, { status: "warnung", meldung: "Lebenszeichen ok, Modell-Liste nicht abrufbar (HTTP " + m.status + ")", hilfe: "" });
        if (!k.gratis) return Object.assign(out, { status: "warnung", meldung: "Verbunden, aber kein Modell mit Preis 0 sichtbar.", hilfe: "Im OmniRoute-Dashboard einen Anbieter mit Gratis-Stufe verbinden (Providers)." });
        return Object.assign(out, { status: "ok", meldung: "Verbunden. " + k.gratis + " Gratis-Modelle verfuegbar." });
      } catch (e) { return Object.assign(out, { status: "fehler" }, fehlerText(e, "OmniRoute")); }
    },
    async modelle() {
      const m = await anfrage(cfg.url, "GET", "/v1/models", { headers: h, ms: 20000 });
      if (m.status !== 200) throw new Error("OmniRoute /v1/models: " + (HTTP_TEXT[m.status] || "HTTP " + m.status));
      return (m.j && Array.isArray(m.j.data) ? m.j.data : []).map((x) => ({ id: x.id, besitzer: x.owned_by || "", kontext: x.context_length || null, klasse: preisKlasse(x), pricing: x.pricing || null }));
    },
    async chat(body, o) {
      o = o || {};
      const r = await anfrage(cfg.url, "POST", "/v1/chat/completions", { headers: h, body, ms: o.ms || 120000, signal: o.signal });
      return { status: r.status, j: r.j, text: r.text, entscheidung: r.kopf("x-omniroute-decision") || "" };
    },
  };
}

module.exports = { META, adapter, preisKlasse };
