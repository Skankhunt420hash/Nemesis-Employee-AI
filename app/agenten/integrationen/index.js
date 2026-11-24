/* =====================================================================
   NEMESIS INTEGRATIONSVERWALTUNG  (app/agenten/integrationen/index.js)
   Jede externe Engine ist ein austauschbares Modul mit: META, adapter(cfg).test()
   - einzeln aktivieren/deaktivieren, Adresse wechseln (z.B. Worker-PC), ohne den Rest zu beruehren
   - Schluessel verschluesselt (Tresor), nie im Klartext zurueckgegeben
   - Status: aus | nicht_konfiguriert | ok | warnung | fehler  (+ Meldung + Loesungshinweis)
   - Gesundheitspruefung aktiver Integrationen in festem Abstand (fuer Systemstatus/Self-Healing)
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { pruefeUrl } = require("./basis.js");

const MODULE = {
  omniroute: require("./omniroute.js"),
  openhands: require("./openhands.js"),
  openclaw: require("./openclaw.js"),
};

function createIntegrationen(opt) {
  opt = opt || {};
  const datei = opt.datei;
  const T = opt.tresor;
  const jetzt = opt.jetzt || (() => Date.now());
  let K = {};
  try { if (datei) K = JSON.parse(fs.readFileSync(datei, "utf8")); } catch (e) {}
  const zustand = {}; // id -> letzter Test
  const speichern = () => { if (!datei) return; fs.mkdirSync(path.dirname(datei), { recursive: true }); const t = datei + ".tmp"; fs.writeFileSync(t, JSON.stringify(K, null, 1), { mode: 0o600 }); fs.renameSync(t, datei); };
  const modul = (id) => { const m = MODULE[id]; if (!m) throw Object.assign(new Error("Unbekannte Integration: " + id), { code: 404 }); return m; };

  /** Konfiguration inkl. entschluesseltem Token (nur intern) */
  function konfig(id) {
    modul(id); const c = K[id] || {};
    return Object.assign({}, c.extra || {}, { url: c.url || "", aktiv: !!c.aktiv, token: c.token && T ? T.auf(c.token, "integration:" + id) : "" });
  }
  function oeffentlich(id) {
    const m = modul(id), c = K[id] || {}, z = zustand[id] || null;
    return {
      id, name: m.META.name, rolle: m.META.rolle, lizenz: m.META.lizenz, quelle: m.META.quelle, getestetMit: m.META.getestetMit, start: m.META.start,
      felder: m.META.felder, url: c.url || "", standardUrl: m.META.standardUrl, aktiv: !!c.aktiv, tokenGesetzt: !!c.token, extra: c.extra || {},
      status: !c.aktiv ? "aus" : !c.url ? "nicht_konfiguriert" : z ? z.status : "ungeprueft",
      letzterTest: z, geaendert: c.geaendert || null,
    };
  }
  function liste() { return Object.keys(MODULE).map(oeffentlich); }

  function setze(id, b, akteur) {
    modul(id); b = b || {};
    const c = Object.assign({}, K[id] || {});
    if (b.url !== undefined) c.url = b.url ? pruefeUrl(b.url) : "";
    if (b.token === null || b.token === "") c.token = null;
    else if (typeof b.token === "string") { if (!T) throw new Error("Kein Tresor"); c.token = T.zu(b.token.trim(), "integration:" + id); }
    if (b.aktiv !== undefined) {
      if (b.aktiv && !c.url) throw Object.assign(new Error("Erst eine Adresse eintragen"), { code: 400 });
      c.aktiv = !!b.aktiv;
    }
    if (b.extra && typeof b.extra === "object") c.extra = Object.assign({}, c.extra || {}, b.extra);
    c.geaendert = { von: akteur || "admin", am: new Date(jetzt()).toISOString() };
    K[id] = c; delete zustand[id]; speichern();
    if (opt.protokoll) opt.protokoll(akteur || "admin", "integration." + id + ".geaendert", { url: c.url, aktiv: c.aktiv, tokenGesetzt: !!c.token });
    return oeffentlich(id);
  }

  async function teste(id) {
    const m = modul(id), c = konfig(id);
    if (!c.url) return (zustand[id] = { status: "nicht_konfiguriert", meldung: "Keine Adresse eingetragen.", hilfe: "Standard: " + m.META.standardUrl, zeit: new Date(jetzt()).toISOString(), schritte: [] });
    let r;
    try { r = await m.adapter(c).test(); } catch (e) { r = { status: "fehler", meldung: String(e.message || e), schritte: [] }; }
    r.zeit = new Date(jetzt()).toISOString();
    zustand[id] = r;
    return r;
  }
  function adapter(id) {
    const c = konfig(id);
    if (!c.aktiv) throw Object.assign(new Error(modul(id).META.name + " ist deaktiviert (Zentrale → Integrationen)"), { code: 423 });
    if (!c.url) throw Object.assign(new Error(modul(id).META.name + " ist nicht eingerichtet"), { code: 423 });
    return modul(id).adapter(c);
  }
  // Gesundheitspruefung aktiver Integrationen (nur aktive, nacheinander)
  let uhr = null;
  if (opt.pruefIntervallMs) {
    uhr = setInterval(async () => { for (const id of Object.keys(MODULE)) if (K[id] && K[id].aktiv && K[id].url) { try { await teste(id); } catch (e) {} } }, opt.pruefIntervallMs);
    if (uhr.unref) uhr.unref();
  }
  return { liste, oeffentlich, setze, teste, konfig, adapter, stop: () => uhr && clearInterval(uhr), MODULE };
}

module.exports = { createIntegrationen, MODULE };
