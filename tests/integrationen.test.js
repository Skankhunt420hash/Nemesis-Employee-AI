// Masterplan V1.0 Phase 1: Integrationsverwaltung (OmniRoute, OpenHands, OpenClaw) + Selbstheilung.
// Teil A: Vertragstests gegen lokale Server, die die DOKUMENTIERTEN Antworten nachbilden.
// Teil B: ECHTE Dienste, wenn per Umgebung angegeben (sonst uebersprungen, nicht als bestanden gezaehlt):
//   NX_ECHT_OPENHANDS_URL / NX_ECHT_OPENHANDS_KEY   (openhands-agent-server)
//   NX_ECHT_OMNIROUTE_URL / NX_ECHT_OMNIROUTE_KEY   (omniroute serve --headless)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { createIntegrationen } = require("../app/agenten/integrationen/index.js");
const { pruefeUrl } = require("../app/agenten/integrationen/basis.js");
const { preisKlasse } = require("../app/agenten/integrationen/omniroute.js");
const { tresor } = require("../app/agenten/tresor.js");
const { createEngine } = require("../app/agenten/engine.js");

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function server(handler) { return new Promise((ok) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => ok({ s, url: "http://127.0.0.1:" + s.address().port })); }); }
const json = (res, code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
function neueIG() { const d = tmp("nx-ig-"); return { d, IG: createIntegrationen({ datei: path.join(d, "ig.json"), tresor: tresor(d) }) }; }

test("URL-Regel: http nur lokal/privat, sonst https; keine Zugangsdaten/Pfade", () => {
  assert.strictEqual(pruefeUrl("http://127.0.0.1:8000"), "http://127.0.0.1:8000");
  assert.strictEqual(pruefeUrl("http://192.168.1.20:8000/"), "http://192.168.1.20:8000");
  assert.strictEqual(pruefeUrl("https://worker.beispiel.ch"), "https://worker.beispiel.ch");
  assert.throws(() => pruefeUrl("http://worker.beispiel.ch"), /https/);
  assert.throws(() => pruefeUrl("http://user:pw@127.0.0.1"), /Zugangsdaten/);
  assert.throws(() => pruefeUrl("file:///etc/passwd"), /http/);
  assert.throws(() => pruefeUrl("http://127.0.0.1:8000/api"), /Basis-Adresse/);
});

test("Verwaltung: Schluessel verschluesselt, aktiv nur mit Adresse, deaktiviert = nicht nutzbar", () => {
  const { d, IG } = neueIG();
  assert.strictEqual(IG.liste().length, 3);
  assert.deepStrictEqual(IG.liste().map((x) => x.status), ["aus", "aus", "aus"]);
  assert.throws(() => IG.setze("openhands", { aktiv: true }), /Adresse/);
  const o = IG.setze("openhands", { url: "http://127.0.0.1:8000", token: "geheim-oh-12345", aktiv: true }, "admin");
  assert.strictEqual(o.tokenGesetzt, true); assert.ok(!("token" in o), "Token nie nach aussen");
  assert.ok(!fs.readFileSync(path.join(d, "ig.json"), "utf8").includes("geheim-oh-12345"), "verschluesselt auf der Platte");
  assert.strictEqual(IG.konfig("openhands").token, "geheim-oh-12345");
  IG.setze("openhands", { aktiv: false }, "admin");
  assert.throws(() => IG.adapter("openhands"), /deaktiviert/);
  assert.throws(() => IG.setze("gibtsnicht", {}), /Unbekannte/);
  // Neu laden: Konfiguration bleibt (persistent)
  const IG2 = createIntegrationen({ datei: path.join(d, "ig.json"), tresor: tresor(d) });
  assert.strictEqual(IG2.konfig("openhands").token, "geheim-oh-12345");
});

test("OpenHands-Adapter (Vertrag): ok, offener Server = Fehler, falscher Schluessel = Warnung, Dienst aus = verstaendlicher Fehler", async () => {
  let schutz = true;
  const { s, url } = await server((req, res) => {
    if (req.url === "/alive" || req.url === "/ready") return json(res, 200, { status: "ok" });
    if (req.url === "/server_info") return json(res, 200, { version: "1.64.0", usable_tools: ["terminal", "file_editor"], conversation_runtime: "local" });
    if (req.url === "/api/conversations/count") return schutz && req.headers["x-session-api-key"] !== "richtig" ? json(res, 401, { detail: "Unauthorized" }) : json(res, 200, 0);
    json(res, 404, {});
  });
  try {
    const { IG } = neueIG();
    IG.setze("openhands", { url, token: "richtig", aktiv: true }, "admin");
    let r = await IG.teste("openhands");
    assert.strictEqual(r.status, "ok", JSON.stringify(r)); assert.strictEqual(r.version, "1.64.0");
    IG.setze("openhands", { token: "falsch" }, "admin");
    r = await IG.teste("openhands"); assert.strictEqual(r.status, "warnung"); assert.match(r.meldung, /Session-API-Key/);
    schutz = false;
    r = await IG.teste("openhands"); assert.strictEqual(r.status, "fehler"); assert.match(r.meldung, /ohne Schluessel/);
  } finally { s.close(); }
  const frei = await server(() => {}); const zu = frei.url; await new Promise((r) => frei.s.close(r)); // Port sicher geschlossen
  const { IG } = neueIG();
  IG.setze("openhands", { url: zu, aktiv: true }, "admin");
  const r = await IG.teste("openhands");
  assert.strictEqual(r.status, "fehler"); assert.match(r.meldung, /nicht erreichbar/); assert.ok(r.hilfe.length > 0);
});

test("OmniRoute-Adapter (Vertrag): Preisklassen - nur Preis 0 ist gratis, fehlender Preis = unbekannt", async () => {
  assert.strictEqual(preisKlasse({ pricing: { prompt: "0", completion: "0" } }), "gratis");
  assert.strictEqual(preisKlasse({ pricing: { prompt: "0.000001", completion: "0" } }), "kostenpflichtig");
  assert.strictEqual(preisKlasse({ id: "auto/best" }), "unbekannt");
  const { s, url } = await server((req, res) => {
    if (req.url === "/api/monitoring/health") return json(res, 200, { status: "healthy" });
    if (req.url === "/v1/models") return req.headers.authorization === "Bearer ok-key" ? json(res, 200, { object: "list", data: [{ id: "a/frei", pricing: { prompt: "0", completion: "0" } }, { id: "b/teuer", pricing: { prompt: "0.000002", completion: "0.00001" } }, { id: "auto/x" }] }) : json(res, 401, { error: { message: "Authentication required" } });
    json(res, 404, {});
  });
  try {
    const { IG } = neueIG();
    IG.setze("omniroute", { url, token: "ok-key", aktiv: true }, "admin");
    const r = await IG.teste("omniroute");
    assert.strictEqual(r.status, "ok", JSON.stringify(r));
    assert.deepStrictEqual([r.modelle.gesamt, r.modelle.gratis, r.modelle.kostenpflichtig, r.modelle.unbekannt], [3, 1, 1, 1]);
    IG.setze("omniroute", { token: "falsch" }, "admin");
    assert.strictEqual((await IG.teste("omniroute")).status, "warnung");
  } finally { s.close(); }
});

test("OpenClaw-Adapter (Vertrag): healthz/readyz + Schutzpruefung ueber /tools/invoke", async () => {
  let offen = false;
  const { s, url } = await server((req, res) => {
    if (req.url === "/healthz" || req.url === "/readyz") return json(res, 200, { ok: true });
    if (req.url === "/tools/invoke") return offen || req.headers.authorization === "Bearer gw" ? json(res, 200, { ok: true, result: [] }) : json(res, 401, { ok: false });
    json(res, 404, {});
  });
  try {
    const { IG } = neueIG();
    IG.setze("openclaw", { url, token: "gw", aktiv: true, extra: { mandanten: [] } }, "admin");
    assert.strictEqual((await IG.teste("openclaw")).status, "ok");
    offen = true;
    const r = await IG.teste("openclaw"); assert.strictEqual(r.status, "fehler"); assert.match(r.meldung, /ohne Token/);
  } finally { s.close(); }
});

test("Engine nutzt die OpenClaw-Konfiguration der Integrationsverwaltung (eine Quelle) und uebernimmt alte Einstellungen", () => {
  const d = tmp("nx-ocmig-");
  // alte Konfiguration im global.json der Engine
  const e1 = createEngine({ dir: d, sandbox: { modus: "aus" } });
  const { mandant } = e1.mandantNeu({ name: "Mig AG", demoDaten: false });
  e1.openclawSetzen({ url: "http://127.0.0.1:18789", token: "alt-token-123", aktiv: true, mandanten: [mandant.id] }, "admin");
  const IG = createIntegrationen({ datei: path.join(d, "ig.json"), tresor: tresor(d) });
  const e2 = createEngine({ dir: d, sandbox: { modus: "aus" }, integrationen: IG });
  assert.strictEqual(IG.konfig("openclaw").url, "http://127.0.0.1:18789");
  assert.strictEqual(IG.konfig("openclaw").token, "alt-token-123");
  assert.deepStrictEqual(IG.konfig("openclaw").mandanten, [mandant.id]);
  assert.ok(e2.openclaw(mandant.id).adapter);
  IG.setze("openclaw", { aktiv: false }, "admin");
  assert.throws(() => e2.openclaw(mandant.id), /nicht eingerichtet/);
});

test("Selbstheilung: haengender Auftrag wird neu eingereiht, verwaister Unterauftrag gestoppt (statt doppelt zu arbeiten)", async () => {
  const d = tmp("nx-heil-");
  let n = 0;
  const e = createEngine({ dir: d, sandbox: { modus: "aus" }, llm: async () => ({ text: JSON.stringify(n++ === 0 ? { plan: ["x"] } : { fertig: true, ergebnis: "ok" }) }) });
  const { mandant } = e.mandantNeu({ name: "Heil AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Hans", werkzeuge: {} }, "t");
  // Simulierter Absturz: Lauf-Dateien direkt anlegen (Status "laeuft", aber kein Prozess)
  const ld = path.join(e._mandantDir(mandant.id), "laeufe"); fs.mkdirSync(ld, { recursive: true });
  const ag = e.agentHolen(mandant.id, "Hans");
  const basis = (id, extra) => Object.assign({ id, mandant: mandant.id, agentId: ag.id, agentName: "Hans", ziel: "Test nach Absturz", stunden: 0.1, projekt: id, erstellt: new Date().toISOString(), start: Date.now(), deadline: Date.now() + 360000, status: "laeuft", phase: "planung", plan: [], log: [], verlauf: [], zaehler: { schritte: 0, werkzeuge: 0, llm: 0, tokens: 0, fehlerInFolge: 0, korrekturen: 0 }, rechte: {}, autonomie: 1, freigaben: [] }, extra || {});
  fs.writeFileSync(path.join(ld, "laaaaaaaaaaaa.json"), JSON.stringify(basis("laaaaaaaaaaaa")));
  fs.writeFileSync(path.join(ld, "lbbbbbbbbbbbb.json"), JSON.stringify(basis("lbbbbbbbbbbbb", { eltern: "lcccccccccccc", status: "laeuft" })));
  const b = e.selbstheilung("test");
  assert.deepStrictEqual(b.neuEingereiht, ["laaaaaaaaaaaa"]);
  assert.deepStrictEqual(b.verwaistGestoppt, ["lbbbbbbbbbbbb"]);
  for (let i = 0; i < 100 && e.laufLaden(mandant.id, "laaaaaaaaaaaa").status !== "fertig"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(e.laufLaden(mandant.id, "laaaaaaaaaaaa").status, "fertig", "nach Absturz fertig gearbeitet");
  assert.strictEqual(e.laufLaden(mandant.id, "lbbbbbbbbbbbb").status, "gestoppt");
  assert.ok(e.auditLesen(mandant.id).some((a) => a.aktion === "selbstheilung"));
  assert.strictEqual(e.gesundheit().offeneLaeufe, 0);
});

/* ---------- Teil B: echte Dienste ---------- */
const OH = process.env.NX_ECHT_OPENHANDS_URL, OM = process.env.NX_ECHT_OMNIROUTE_URL;
test("ECHT: OpenHands Agent Server (Verbindung, Version, Schutz, Anmeldung)", { skip: !OH && "NX_ECHT_OPENHANDS_URL nicht gesetzt" }, async () => {
  const { IG } = neueIG();
  IG.setze("openhands", { url: OH, token: process.env.NX_ECHT_OPENHANDS_KEY || "", aktiv: true }, "admin");
  const r = await IG.teste("openhands");
  console.log("# OpenHands echt:", JSON.stringify({ status: r.status, version: r.version, werkzeuge: r.werkzeuge, schritte: r.schritte.map((x) => x.name + "=" + x.ok) }));
  assert.strictEqual(r.status, "ok", JSON.stringify(r));
  assert.match(r.version, /^\d+\.\d+/);
});
test("ECHT: OmniRoute (Health, Modellkatalog mit Preisen, Schluessel)", { skip: !OM && "NX_ECHT_OMNIROUTE_URL nicht gesetzt" }, async () => {
  const { IG } = neueIG();
  IG.setze("omniroute", { url: OM, token: process.env.NX_ECHT_OMNIROUTE_KEY || "", aktiv: true }, "admin");
  const r = await IG.teste("omniroute");
  console.log("# OmniRoute echt:", JSON.stringify({ status: r.status, modelle: r.modelle, schritte: r.schritte.map((x) => x.name + "=" + x.ok) }));
  assert.ok(["ok", "warnung"].includes(r.status), JSON.stringify(r));
  assert.ok(r.modelle && r.modelle.gesamt > 0, "Katalog geladen");
  IG.setze("omniroute", { token: "falscher-schluessel" }, "admin");
  assert.strictEqual((await IG.teste("omniroute")).status, "warnung", "falscher Schluessel wird erkannt");
});
