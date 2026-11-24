// Masterplan V1.0 Phase 2: OmniRoute Intelligence Network
// A) Router-Einheit (Klassen, Modi), B) E2E ueber den echten Rotator gegen einen Server, der die
// dokumentierte OmniRoute-API nachbildet, C) ECHTES OmniRoute (wenn NX_ECHT_OMNIROUTE_* gesetzt).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nx-omni-"));
const ECHT = { url: process.env.NX_ECHT_OMNIROUTE_URL, key: process.env.NX_ECHT_OMNIROUTE_KEY, modell: process.env.NX_ECHT_OMNIROUTE_EIGENMODELL };
process.env.DATA_DIR = DATA;
process.env.NEMESIS_ZUGANG = "omnitest-1234567890abcdef";
process.env.NEMESIS_AUTO_UPDATE = "0";
process.env.NEMESIS_SANDBOX = "aus";
for (const k of Object.keys(process.env)) if (/_(API_)?KEY$|NVAPI|_TOKEN$/.test(k) && !/^NX_/.test(k)) delete process.env[k];
process.env.OPENAI_API_KEY = "sk-test-openai-key-1234567890";   // vorhanden, darf nie genutzt werden

const { createRouter } = require("../app/agenten/modelle/router.js");
const app = require("../app/nemesis-app.js");

const treffer = { omni: [], lokal: 0, openai: 0 };
let omni429 = new Set();
const KATALOG = [
  { id: "ddgw/gpt-5.4-mini", pricing: { prompt: "0", completion: "0" } },
  { id: "groq/llama-3.3-70b-versatile", pricing: { prompt: "0", completion: "0" } },
  { id: "groq/qwen3-32b", pricing: { prompt: "0", completion: "0" } },
  { id: "openai/gpt-4o", pricing: { prompt: "0.0000025", completion: "0.00001" } },
  { id: "auto/best-free" },
];
let fake, base, lokalSrv, lokalBase, srv, sbase;
test.before(async () => {
  fake = http.createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
    r.setHeader("Content-Type", "application/json");
    if (q.url === "/api/monitoring/health") return r.end('{"status":"healthy"}');
    if (q.headers.authorization !== "Bearer omni-key") { r.statusCode = 401; return r.end('{"error":{"message":"Authentication required"}}'); }
    if (q.url.startsWith("/v1/models")) return r.end(JSON.stringify({ object: "list", data: KATALOG }));
    if (q.url === "/v1/chat/completions") {
      const j = JSON.parse(b); treffer.omni.push(j.model);
      if (omni429.has(j.model)) { r.statusCode = 429; r.setHeader("retry-after", "1"); return r.end('{"error":{"message":"rate"}}'); }
      r.setHeader("X-OmniRoute-Decision", "strategy=single; provider=" + j.model.split("/")[0] + "; latency_ms=5");
      const frage = String(j.messages[j.messages.length - 1].content);
      const text = /17\+25/.test(frage) ? '{"ok":true,"summe":42}' : "OMNI " + j.model;
      return r.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
    }
    r.statusCode = 404; r.end("{}");
  }); });
  await new Promise((ok) => fake.listen(0, "127.0.0.1", ok)); base = "http://127.0.0.1:" + fake.address().port;
  lokalSrv = http.createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
    r.setHeader("Content-Type", "application/json");
    if (q.url === "/v1/models") return r.end('{"data":[{"id":"qwen3:4b"}]}');
    treffer.lokal++; r.end(JSON.stringify({ choices: [{ message: { content: "LOKAL " + JSON.parse(b).model } }] }));
  }); });
  await new Promise((ok) => lokalSrv.listen(0, "127.0.0.1", ok)); lokalBase = "http://127.0.0.1:" + lokalSrv.address().port;
  srv = http.createServer(async (q, r) => { if (!(await app.behandle(q, r, new URL(q.url, "http://x"), {}))) { r.writeHead(404); r.end(); } });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok)); sbase = "http://127.0.0.1:" + srv.address().port + "/k/" + process.env.NEMESIS_ZUGANG + "/zentrale/api";
  app._intern.ANBIETER.openai.url = base + "/openai-darf-nie";   // falls doch: wuerde 401 liefern und auffallen
});
test.after(() => { fake.close(); lokalSrv.close(); srv.close(); setTimeout(() => process.exit(0), 50).unref(); });
const api = async (p, b) => { const r = await fetch(sbase + p, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status }); return j; };
const frage = (x) => app.rotiere(Object.assign({ messages: [{ role: "user", content: "Hallo" }], max_tokens: 30 }, x || {}));

/* ---------- A) Router-Einheit ---------- */
test("Router: OmniRoute-Klassen (Preis 0 + offizieller Praefix, eigene Modelle, auto/unbekannt gesperrt)", () => {
  const R = createRouter({});
  R.verifiziereListe("omniroute", KATALOG);
  assert.strictEqual(R.klasse("omniroute", "ddgw/gpt-5.4-mini"), "inoffiziell");
  assert.strictEqual(R.pruefe("omniroute", "ddgw/gpt-5.4-mini").code, "INOFFIZIELL");
  assert.strictEqual(R.klasse("omniroute", "auto/best-free"), "unbekannt");
  assert.strictEqual(R.pruefe("omniroute", "auto/best-free").code, "NICHT_BESTAETIGT");
  assert.strictEqual(R.klasse("omniroute", "openai/gpt-4o"), "kostenpflichtig");
  assert.throws(() => R.setze({ omniroutePraefix: { praefix: "groq", erlauben: true, notiz: "kurz" } }, "admin"), /10 Zeichen/);
  R.setze({ omniroutePraefix: { praefix: "groq", erlauben: true, notiz: "Groq ist eine offizielle API mit Free Tier" } }, "admin");
  assert.strictEqual(R.pruefe("omniroute", "groq/qwen3-32b").ok, true);
  assert.deepStrictEqual(R.omnirouteModelle().sort(), ["groq/llama-3.3-70b-versatile", "groq/qwen3-32b"]);
  assert.throws(() => R.setze({ omnirouteEigen: { id: "auto/x", notiz: "das ist frei, glaub mir" } }, "admin"), /auto/);
  R.setze({ omnirouteEigen: { id: "meinserver/llama", notiz: "Eigener Server, keine API-Kosten" } }, "admin");
  assert.strictEqual(R.klasse("omniroute", "meinserver/llama"), "gratis-bestaetigt");
});

test("Router: Modi FREE / LOCAL / PREMIUM / AUS", () => {
  const R = createRouter({});
  assert.strictEqual(R.modus, "free");
  assert.strictEqual(R.pruefe("lokal", "qwen3:4b").code, "NICHT_EINGERICHTET");
  R.setze({ lokalUrl: "http://127.0.0.1:11434/v1" }, "admin");
  assert.strictEqual(R.pruefe("lokal", "qwen3:4b").ok, true, "lokal auch im FREE MODE erlaubt (keine API-Kosten)");
  R.setze({ modus: "lokal" }, "admin");
  assert.strictEqual(R.pruefe("groq", "llama").code, "MODUS");
  assert.strictEqual(R.pruefe("lokal", "qwen3:4b").ok, true);
  R.setze({ modus: "aus" }, "admin");
  assert.strictEqual(R.pruefe("lokal", "qwen3:4b").code, "AUS");
  assert.throws(() => R.setze({ modus: "turbo" }, "admin"), /Unbekannter Modus/);
  assert.throws(() => R.setze({ lokalUrl: "ftp://x" }, "admin"), /Lokale Adresse/);
  const alt = createRouter({ datei: (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nx-r-")), "m.json"); fs.writeFileSync(f, JSON.stringify({ modus: "nur-gratis" })); return f; })() });
  assert.strictEqual(alt.modus, "free", "alter Modus wird uebernommen");
});

/* ---------- B) E2E ueber den echten Rotator ---------- */
test("E2E: OmniRoute eingerichtet, Katalog geprueft: ddgw (Web) und auto/* gesperrt, nichts erlaubt -> 403, OpenAI nie", async () => {
  await api("/integrationen/omniroute", { url: base, token: "omni-key", aktiv: true });
  const v = await api("/modelle/verifizieren", { anbieter: "omniroute" });
  assert.deepStrictEqual([v.ergebnis.gratis, v.ergebnis.bezahlt], [3, 1]);
  assert.deepStrictEqual(v.ergebnis.praefixe, { ddgw: 1, groq: 2 });
  const r = await frage();
  assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, "KEIN_FREIGEGEBENES_MODELL");
  assert.ok(r.body.abgelehnt.every((a) => a.anbieter === "openai" ? true : !/ddgw/.test(a.modell) || a.code === "INOFFIZIELL"));
  assert.deepStrictEqual(treffer.omni, []); assert.strictEqual(treffer.openai, 0);
});

test("E2E: Praefix 'groq' freigegeben -> Anfrage laeuft ueber OmniRoute, Routing-Nachweis im Protokoll", async () => {
  await api("/modelle", { omniroutePraefix: { praefix: "groq", erlauben: true, notiz: "Groq: offizielle API, Free Tier geprueft" } });
  const r = await frage({ quelle: "test" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.anbieter, "omniroute"); assert.match(r.body.modell, /^groq\//); assert.match(r.body.entscheidung, /provider=groq/);
  const p = (await api("/modelle/anfragen?n=5")).anfragen[0];
  assert.strictEqual(p.anbieter, "omniroute"); assert.ok(p.ok); assert.match(p.entscheidung, /strategy=single/); assert.ok(p.ms >= 0);
  assert.ok(treffer.omni.every((m) => /^groq\//.test(m)), "nur freigegebene Modelle angefragt: " + treffer.omni);
});

test("E2E: Rotation innerhalb OmniRoute (erstes Modell 429 -> naechstes), nie Bezahlmodell", async () => {
  const reihe = global.__nxApp.modellRouter.omnirouteModelle();   // Reihenfolge der Rotation
  treffer.omni = []; omni429 = new Set([reihe[0]]);
  const r = await frage();
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.modell, reihe[1], "zweites Modell uebernimmt: " + treffer.omni);
  assert.strictEqual(treffer.omni[0], reihe[0]); assert.strictEqual(treffer.omni[treffer.omni.length - 1], reihe[1]);
  treffer.omni = []; const r2 = await frage();
  assert.strictEqual(r2.body.modell, reihe[1]); assert.ok(!treffer.omni.includes(reihe[0]), "pausiertes Modell wird uebersprungen, das Gateway bleibt nutzbar");
  assert.ok(!treffer.omni.some((m) => /openai|auto|ddgw/.test(m)));
  omni429 = new Set();
  const bez = await frage({ modell: "omniroute:openai/gpt-4o" });
  assert.ok(!treffer.omni.includes("openai/gpt-4o"), "Bezahlmodell nie angefragt");
  assert.strictEqual(bez.body.ersatzFuer, "omniroute:openai/gpt-4o", "Ersatz durch Gratis-Modell wird offen ausgewiesen");
  assert.match(bez.body.ersatzGrund, /FREE MODE|kostenpflichtig/);
  const streng = await frage({ modell: "omniroute:openai/gpt-4o", keinFallback: true });
  assert.strictEqual(streng.status, 403, "ohne Ersatz: Bezahlmodell im FREE MODE technisch gesperrt");
});

test("Leistungstest: misst Antwortzeit und prueft strukturierte Ausgabe (JSON), ohne Fallback", async () => {
  const r = (await api("/modelle/leistungstest", { anbieter: "omniroute", modell: global.__nxApp.modellRouter.omnirouteModelle()[1] })).ergebnis;
  assert.strictEqual(r.ok, true); assert.strictEqual(r.json, true); assert.strictEqual(r.korrekt, true); assert.ok(r.ms >= 0);
  const m2 = global.__nxApp.modellRouter.omnirouteModelle()[1];
  assert.strictEqual(r.genutzt, "omniroute:" + m2);
  const st = (await api("/modelle")).modelle;
  assert.ok(st.leistung["omniroute:" + m2].korrekt);
  const n = (await api("/modelle/leistungstest", { anbieter: "omniroute", modell: "ddgw/gpt-5.4-mini" })).ergebnis;
  assert.strictEqual(n.ok, false, "gesperrtes Modell wird nicht getestet (kein Umweg)");
});

test("Bibliothek: listet Modelle mit Klasse, Freigabe-Status und Faehigkeiten", async () => {
  const b = await api("/modelle/bibliothek");
  const ids = b.modelle.filter((m) => m.anbieter === "omniroute").map((m) => m.id + ":" + m.erlaubt);
  assert.ok(ids.includes("groq/qwen3-32b:true"));
  assert.ok(b.modelle.every((m) => m.anbieter !== "openai" || !m.erlaubt), "OpenAI nie als erlaubt gelistet");
  assert.strictEqual(b.omnirouteKatalog.praefixe.ddgw, 1);
});

test("LOCAL MODE: nur das lokale Modell wird genutzt, OmniRoute nicht", async () => {
  await api("/modelle", { lokalUrl: lokalBase + "/v1" });
  await api("/modelle", { modus: "lokal" });
  treffer.omni = [];
  const r = await frage();
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.anbieter, "lokal"); assert.match(r.body.text, /LOKAL qwen3:4b/);
  assert.deepStrictEqual(treffer.omni, []);
  await api("/modelle", { modus: "free" });
});

/* ---------- C) ECHTES OmniRoute ---------- */
test("ECHT: Anfrage ueber das echte OmniRoute (eigener Test-Anbieter, vom Admin als kostenlos bestaetigt)", { skip: !(ECHT.url && ECHT.key && ECHT.modell) && "NX_ECHT_OMNIROUTE_URL/_KEY/_EIGENMODELL nicht gesetzt" }, async () => {
  await api("/integrationen/omniroute", { url: ECHT.url, token: ECHT.key, aktiv: true });
  await api("/modelle", { lokalUrl: "" });
  await api("/modelle", { omnirouteEigen: { id: ECHT.modell, notiz: "Lokaler Test-Anbieter hinter OmniRoute, keine API-Kosten" } });
  const v = await api("/modelle/verifizieren", { anbieter: "omniroute" });
  console.log("# echter Katalog:", JSON.stringify(v.ergebnis.praefixe));
  const r = await frage({ modell: "omniroute:" + ECHT.modell, keinFallback: true });
  console.log("# echte Antwort:", JSON.stringify({ status: r.status, modell: r.body.modell, entscheidung: r.body.entscheidung, text: String(r.body.text).slice(0, 80) }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.entscheidung, /strategy=/, "X-OmniRoute-Decision vom echten OmniRoute");
  const ddgw = await frage({ modell: "omniroute:ddgw/gpt-5.4-mini", keinFallback: true });
  assert.strictEqual(ddgw.status, 403, "inoffizieller Web-Zugang wird auch beim echten OmniRoute nicht angefragt");
});
