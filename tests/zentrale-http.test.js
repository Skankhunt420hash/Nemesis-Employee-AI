// Zentrale ueber den echten Server (nemesis-app.js): Mandanten-Trennung, Rollen, bestehende Funktionen.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nx-http-"));
process.env.DATA_DIR = DATA;
process.env.NEMESIS_ZUGANG = "testzugang-1234567890abcdef";
process.env.NEMESIS_AUTO_UPDATE = "0";
process.env.NEMESIS_SANDBOX = "aus";
const app = require("../app/nemesis-app.js");
let base, srv;
const Z = "/k/" + process.env.NEMESIS_ZUGANG;

test.before(async () => {
  srv = http.createServer(async (req, res) => { const ok = await app.behandle(req, res, new URL(req.url, "http://x"), {}); if (!ok) { res.writeHead(404); res.end("nicht hier"); } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + srv.address().port;
});
test.after(() => { srv.close(); setTimeout(() => process.exit(0), 50).unref(); });

async function f(m, p, b, token, extra) {
  const h = Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}, extra || {});
  const r = await fetch(base + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined, redirect: "manual" });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, j, t, h: r.headers };
}

let A, B;
test("Admin legt zwei Pilotkunden an (ohne Code, per API)", async () => {
  let r = await f("POST", Z + "/zentrale/api/mandanten", { name: "Treuhand Alpha", branche: "Treuhand", demo: true, agenten: ["office"] });
  assert.strictEqual(r.status, 200, r.t); A = r.j;
  r = await f("POST", Z + "/zentrale/api/mandanten", { name: "Garage Beta", demo: true, agenten: ["office", "developer"] });
  assert.strictEqual(r.status, 200, r.t); B = r.j;
  assert.match(A.token, /^nxm_/);
  r = await f("GET", Z + "/zentrale/api/mandanten");
  assert.strictEqual(r.j.mandanten.length, 2);
  assert.ok(!JSON.stringify(r.j).includes("tokenHash"), "kein Token-Hash nach aussen");
});

test("8: Kunden koennen nicht aufeinander zugreifen", async () => {
  const a = A.mandant.id, b = B.mandant.id;
  assert.strictEqual((await f("GET", "/zentrale/api/m/" + a + "/uebersicht", null, A.token)).status, 200);
  for (const pfad of ["/uebersicht", "/agenten", "/office", "/audit", "/export", "/laeufe", "/geheimnisse"]) {
    const r = await f("GET", "/zentrale/api/m/" + b + pfad, null, A.token);
    assert.strictEqual(r.status, 403, pfad + " -> " + r.status);
  }
  const r2 = await f("POST", "/zentrale/api/m/" + b + "/laeufe", { agent: "Nora", ziel: "Fremde Daten lesen" }, A.token);
  assert.strictEqual(r2.status, 403);
  assert.strictEqual((await f("GET", "/zentrale/api/m/" + a + "/uebersicht")).status, 401, "ohne Token");
  assert.strictEqual((await f("GET", "/zentrale/api/m/" + a + "/uebersicht", null, "nxm_gefaelschtestokenxxxxxxxxxxxxxx")).status, 401);
  assert.strictEqual((await f("GET", "/zentrale/api/mandanten", null, A.token)).status, 403, "Kunde sieht keine anderen Kunden");
  assert.strictEqual((await f("POST", "/zentrale/api/mandanten", { name: "Hack" }, A.token)).status, 403);
  assert.strictEqual((await f("POST", "/zentrale/api/notaus", { an: true }, A.token)).status, 403);
  assert.strictEqual((await f("GET", "/zentrale/api/m/..%2f" + b + "/agenten", null, A.token)).status >= 400, true);
});

test("Kunde kann eigene Limits/Politik nicht erhoehen", async () => {
  const a = A.mandant.id;
  const r = await f("POST", "/zentrale/api/m/" + a + "/einstellungen", { limits: { llmProTag: 999999 }, politik: { externAutonom: true } }, A.token);
  assert.strictEqual(r.status, 200);
  assert.notStrictEqual(r.j.mandant.limits.llmProTag, 999999);
  assert.strictEqual(r.j.mandant.politik.externAutonom, false);
});

test("Kunde kann Agenten-Rechte nur ueber die API (Mensch) aendern, Aenderung landet im Audit", async () => {
  const a = A.mandant.id;
  const ag = (await f("GET", "/zentrale/api/m/" + a + "/agenten", null, A.token)).j.agenten[0];
  const r = await f("POST", "/zentrale/api/m/" + a + "/agenten", { id: ag.id, werkzeuge: { antwort_senden: "aus", unsinn_tool: "autonom" } }, A.token);
  assert.strictEqual(r.status, 200, r.t);
  assert.strictEqual(r.j.agent.werkzeuge.antwort_senden, "aus");
  assert.ok(!("unsinn_tool" in r.j.agent.werkzeuge), "unbekannte Werkzeuge werden verworfen");
  const au = (await f("GET", "/zentrale/api/m/" + a + "/audit", null, A.token)).j;
  assert.ok(au.pruefung.ok);
  assert.ok(au.eintraege.some((e) => e.aktion === "agent.geaendert" && e.d.werkzeuge));
});

test("Oeffentliches Kontaktformular landet nur beim richtigen Kunden", async () => {
  const a = A.mandant.id, b = B.mandant.id;
  const r = await f("POST", "/zentrale/oeffentlich/" + a + "/anfrage", { email: "kunde@test.ch", name: "Test", nachricht: "Bitte um Offerte fuer Buchhaltung" });
  assert.strictEqual(r.status, 200, r.t);
  const oa = (await f("GET", "/zentrale/api/m/" + a + "/office", null, A.token)).j;
  const ob = (await f("GET", "/zentrale/api/m/" + b + "/office", null, B.token)).j;
  assert.ok(oa.posteingang.some((m) => m.von === "kunde@test.ch"));
  assert.ok(!ob.posteingang.some((m) => m.von === "kunde@test.ch"));
  assert.strictEqual((await f("POST", "/zentrale/oeffentlich/" + a + "/anfrage", { email: "x@y.ch", nachricht: "hi", website: "bot" })).status, 200, "Honeypot still verworfen");
  assert.strictEqual((await f("POST", "/zentrale/oeffentlich/gibtsnicht/anfrage", { email: "x@y.ch", nachricht: "hallo" })).status, 404);
});

test("Freigabe-Center: Entwurf freigeben sendet im Demo-Modus nur protokolliert", async () => {
  const a = A.mandant.id;
  // Entwurf direkt ueber das Werkzeug erzeugen ist Sache des Agenten; hier pruefen wir den Menschen-Pfad
  const eng = global.__nxApp.agenten.engine;
  const mail = eng.office(a).posteingang[0];
  const e = eng._officeAendern(a, (o) => { const x = { id: "e" + "a1b2c3d4e5f6", mailId: mail.id, an: mail.von, betreff: "Re: " + mail.betreff, text: "Guten Tag", status: "entwurf", erstellt: new Date().toISOString(), von: "Nora" }; o.entwuerfe.push(x); return x; });
  const fr = (await f("GET", "/zentrale/api/m/" + a + "/freigaben", null, A.token)).j.freigaben;
  assert.ok(fr.some((x) => x.id === e.id));
  assert.strictEqual((await f("POST", "/zentrale/api/m/" + B.mandant.id + "/office/entwurf/" + e.id + "/senden", {}, B.token)).status, 400, "anderer Kunde findet den Entwurf nicht");
  const r = await f("POST", "/zentrale/api/m/" + a + "/office/entwurf/" + e.id + "/senden", { text: "Guten Tag, angepasst." }, A.token);
  assert.strictEqual(r.status, 200, r.t); assert.strictEqual(r.j.kanal, "demo");
  const o = (await f("GET", "/zentrale/api/m/" + a + "/office", null, A.token)).j;
  assert.strictEqual(o.ausgang[0].text, "Guten Tag, angepasst.");
});

test("Seiten: Zentrale fuer Admin und Kunde, Sicherheits-Header", async () => {
  const r = await f("GET", "/zentrale"); assert.strictEqual(r.status, 200); assert.match(r.t, /NEMESIS/);
  assert.match(r.h.get("content-security-policy"), /default-src 'self'/); assert.strictEqual(r.h.get("x-frame-options"), "DENY");
  const r2 = await f("GET", Z + "/zentrale"); assert.strictEqual(r2.status, 200);
  const ich = await f("GET", Z + "/zentrale/api/ich"); assert.strictEqual(ich.j.rolle, "admin");
  const ich2 = await f("GET", "/zentrale/api/ich", null, A.token); assert.strictEqual(ich2.j.rolle, "mandant");
});

test("9: Bestehende Funktionen bleiben erhalten (App, Schloss, LLM-Status, Betrieb-Liste)", async () => {
  const app1 = await f("GET", Z + "/app"); assert.strictEqual(app1.status, 200); assert.match(app1.t, /Nemesis Lab/);
  assert.strictEqual((await f("GET", "/app")).status, 401, "App ohne Zugang gesperrt");
  assert.strictEqual((await f("GET", "/llm/status")).status, 401);
  assert.strictEqual((await f("GET", Z + "/llm/status")).status, 200);
  assert.strictEqual((await f("GET", Z + "/betrieb/liste")).status, 200);
  assert.strictEqual((await f("GET", Z + "/bg/status?id=x")).status < 500, true);
  assert.strictEqual((await f("GET", "/apps/liste")).status, 401);
});

test("Kunde loeschen: nur Betreiber, nur mit Bestaetigung, Daten wirklich weg", async () => {
  const b = B.mandant.id;
  assert.strictEqual((await f("POST", "/zentrale/api/m/" + b + "/loeschen", { bestaetigung: b }, B.token)).status, 403);
  assert.strictEqual((await f("POST", Z + "/zentrale/api/m/" + b + "/loeschen", { bestaetigung: "falsch" })).status, 400);
  assert.strictEqual((await f("POST", Z + "/zentrale/api/m/" + b + "/loeschen", { bestaetigung: b })).status, 200);
  assert.ok(!fs.existsSync(path.join(DATA, "_agenten", "mandanten", b)));
  assert.strictEqual((await f("GET", "/zentrale/api/m/" + b + "/uebersicht", null, B.token)).status, 401, "Token des geloeschten Kunden ungueltig");
});
