// Phase 1: Free Model Router. Kosten-Gate, kein Bezahl-Fallback, Kontingente, Pause, Admin-Rechte.
// Die Anbieter sind ein lokaler OpenAI-kompatibler Testserver (echte HTTP-Aufrufe, gezaehlt pro Anbieter).
// Ein Live-Aufruf bei einem echten Gratis-Anbieter ist BLOCKED (kein Schluessel in dieser Umgebung).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nx-modelle-"));
process.env.DATA_DIR = DATA;
process.env.NEMESIS_ZUGANG = "modelltest-1234567890abcdef";
process.env.NEMESIS_AUTO_UPDATE = "0";
process.env.NEMESIS_SANDBOX = "aus";
process.env.GROQ_API_KEY = "gsk_test_groq_key_1234567890";
process.env.OPENROUTER_API_KEY = "sk-or-test-key-1234567890";
process.env.OPENAI_API_KEY = "sk-test-openai-key-1234567890";   // vorhanden, aber KEINE Freigabe
process.env.ANTHROPIC_API_KEY = "sk-ant-test-1234567890";        // vorhanden, aber KEINE Freigabe
for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "COHERE_API_KEY", "MISTRAL_API_KEY", "TOGETHER_API_KEY", "NVIDIA_API_KEY"]) delete process.env[k];

const { createRouter } = require("../app/agenten/modelle/router.js");
const app = require("../app/nemesis-app.js");

/* ---------- Fake-Anbieter ---------- */
const treffer = { groq: 0, openai: 0, openrouter: 0 };
const verhalten = { groq: "ok", openai: "ok", openrouter: "ok" };
const MODELLE = { groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"], openai: ["gpt-5.5", "gpt-4o-mini"], openrouter: ["meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-4o"] };
let fake, base;
test.before(async () => {
  fake = http.createServer((req, res) => {
    const anb = req.url.split("/")[1];
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: MODELLE[anb].map((id) => ({ id })) }));
      treffer[anb]++;
      if (verhalten[anb] === "429") { res.statusCode = 429; res.setHeader("retry-after", "60"); return res.end(JSON.stringify({ error: { message: "rate limit" } })); }
      const j = JSON.parse(b);
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Antwort von " + anb + " (" + j.model + ")" } }] }));
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + fake.address().port;
  const A = app._intern.ANBIETER;
  for (const a of ["groq", "openai", "openrouter"]) { A[a].url = base + "/" + a + "/chat"; A[a].liste = base + "/" + a + "/models"; }
});
test.after(() => { fake.close(); setTimeout(() => process.exit(0), 50).unref(); });
const nullen = () => { for (const k of Object.keys(treffer)) treffer[k] = 0; };
const frage = (x) => app.rotiere(Object.assign({ messages: [{ role: "user", content: "Hallo, wie geht es?" }], max_tokens: 50 }, x || {}));

/* ---------- Router als Einheit ---------- */
test("Router: Kostenklassen und Gate (Einheit)", () => {
  const R = createRouter({});
  assert.strictEqual(R.klasse("openrouter", "x/y:free"), "gratis-verifiziert");
  assert.strictEqual(R.klasse("openrouter", "openai/gpt-4o"), "kostenpflichtig");
  assert.strictEqual(R.klasse("groq", "llama"), "gratis-stufe");
  assert.strictEqual(R.klasse("openai", "gpt-4o-mini"), "kostenpflichtig");
  assert.strictEqual(R.pruefe("groq", "llama").ok, true, "Gratis-Anbieter sind standardmaessig aktiv");
  R.setze({ schalten: { anbieter: "groq", aus: true } }, "admin");
  assert.strictEqual(R.pruefe("groq", "llama").code, "DEAKTIVIERT");
  R.setze({ schalten: { anbieter: "groq", aus: false } }, "admin");
  assert.strictEqual(R.pruefe("openai", "gpt-4o-mini", { explizit: true }).code, "NICHT_FREIGEGEBEN");
  assert.throws(() => R.setze({ bestaetigen: { anbieter: "groq", notiz: "ok" } }, "admin"), /mind. 10/);
  R.setze({ bestaetigen: { anbieter: "groq", notiz: "Free Tier, kein Zahlungsmittel hinterlegt" } }, "admin");
  assert.strictEqual(R.pruefe("groq", "llama").ok, true);
  assert.throws(() => R.setze({ freigabe: { anbieter: "openai", muster: "gpt-4o-mini", budgetChfTag: 1, chfPro1MTokens: 1 } }, "admin"), /Ich erlaube Kosten/);
  assert.throws(() => R.setze({ bestaetigen: { anbieter: "openai", notiz: "ist doch gratis, bitte" } }, "admin"), /kann nicht als gratis/, "bezahlte Anbieter koennen nicht als gratis bestaetigt werden");
  assert.strictEqual(R.pruefe("openai", "gpt-4o-mini", { explizit: true }).code, "NICHT_FREIGEGEBEN");
  R.setze({ freigabe: { anbieter: "openai", muster: "gpt-4o-mini", budgetChfTag: 0.01, chfPro1MTokens: 10, bestaetigung: "Ich erlaube Kosten" } }, "admin");
  assert.strictEqual(R.pruefe("openai", "gpt-4o-mini", { explizit: true }).code, "NICHT_FREIGEGEBEN", "FREE MODE sperrt Bezahlmodelle technisch, auch mit Freigabe");
  assert.throws(() => R.setze({ modus: "premium" }, "admin"), /PREMIUM/, "Premium nur mit Bestaetigung");
  R.setze({ modus: "premium", bestaetigung: "PREMIUM" }, "admin");
  assert.strictEqual(R.pruefe("openai", "gpt-4o-mini", { explizit: false }).code, "KEIN_AUTO_BEZAHLT", "nie als Fallback");
  assert.strictEqual(R.pruefe("openai", "gpt-4o-mini", { explizit: true }).ok, true);
  R.vorAufruf("openai"); R.nachAufruf("openai", "gpt-4o-mini", { ok: true, tokens: 2000 }); // 2000 Tok * 10 CHF/1M = 0.02 > 0.01
  assert.strictEqual(R.pruefe("openai", "gpt-4o-mini", { explizit: true }).code, "BUDGET");
  assert.strictEqual(R.pruefe("openai", "gpt-5.5", { explizit: true }).code, "NICHT_FREIGEGEBEN", "Muster greift nur exakt");
  assert.strictEqual(R.pruefe("groq", "llama", { anforderungen: ["json"] }).ok, true);
});

test("Router: Rate-Limits pro Minute und Tag, 429-Pause", () => {
  let t = Date.UTC(2026, 10, 22, 10, 0, 0);
  const R = createRouter({ jetzt: () => t });
  R.setze({ limits: { openrouter: { rpm: 2, rpd: 3 } } }, "admin");
  const m = "a/b:free";
  for (let i = 0; i < 2; i++) { assert.ok(R.pruefe("openrouter", m).ok); R.vorAufruf("openrouter"); R.nachAufruf("openrouter", m, { ok: true }); }
  let p = R.pruefe("openrouter", m); assert.strictEqual(p.code, "KONTINGENT"); assert.match(p.grund, /Minute/);
  t += 61000; assert.ok(R.pruefe("openrouter", m).ok); R.vorAufruf("openrouter"); R.nachAufruf("openrouter", m, { ok: true });
  t += 61000; p = R.pruefe("openrouter", m); assert.strictEqual(p.code, "KONTINGENT"); assert.match(p.grund, /Tag/);
  assert.ok(p.wiederAb > t, "Pause bis morgen");
  const R2 = createRouter({ jetzt: () => t });
  R2.nachAufruf("openrouter", m, { ok: false, status: 429, warteSek: 120 });
  assert.strictEqual(R2.pruefe("openrouter", m).code, "KONTINGENT");
  t += 121000; assert.ok(R2.pruefe("openrouter", m).ok);
});

test("Router: Preis-Verifikation ueber die Modell-Liste (OpenRouter-Format)", async () => {
  const R = createRouter({});
  const r = await R.verifiziere("openrouter", async () => ({ data: [{ id: "a/x:free", pricing: { prompt: "0", completion: "0" } }, { id: "a/teuer", pricing: { prompt: "0.000002", completion: "0.000008" } }, { id: "a/gratis-ohne-suffix", pricing: { prompt: "0", completion: "0", request: "0" } }] }));
  assert.deepStrictEqual([r.gratis, r.bezahlt], [2, 1]);
  assert.strictEqual(R.klasse("openrouter", "a/gratis-ohne-suffix"), "gratis-verifiziert");
  assert.strictEqual(R.klasse("openrouter", "a/teuer"), "kostenpflichtig");
  await assert.rejects(R.verifiziere("groq", async () => ({})), /manuell/);
});

/* ---------- Ende-zu-Ende ueber den echten Rotator ---------- */
test("E2E: Gratis-Aufruf erfolgreich, OpenAI wird nie angefragt", async () => {
  nullen();
  const r = await frage();
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.anbieter, "groq"); assert.strictEqual(r.body.frei, true);
  assert.deepStrictEqual(treffer, { groq: 1, openai: 0, openrouter: 0 });
});

test("E2E: Rotation - Groq leer (429) -> OpenRouter :free uebernimmt", async () => {
  nullen(); verhalten.groq = "429";
  const r = await frage();
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.anbieter, "openrouter"); assert.match(r.body.modell, /:free$/);
  assert.strictEqual(treffer.openai, 0);
  nullen(); const r2 = await frage();
  assert.strictEqual(r2.body.anbieter, "openrouter"); assert.strictEqual(treffer.groq, 0, "pausierter Anbieter wird uebersprungen");
});

test("E2E: Alle Gratis leer -> KEIN Fallback auf OpenAI, obwohl Schluessel vorhanden -> Kontingent-Fehler", async () => {
  nullen(); verhalten.openrouter = "429";
  const r = await frage();
  assert.strictEqual(r.status, 429, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, "KONTINGENT_ERSCHOEPFT");
  assert.ok(r.body.wiederAb > Date.now());
  assert.strictEqual(treffer.openai, 0, "OpenAI wurde nie aufgerufen");
  nullen(); const r2 = await frage();
  assert.strictEqual(r2.body.code, "KONTINGENT_ERSCHOEPFT"); assert.deepStrictEqual(treffer, { groq: 0, openai: 0, openrouter: 0 });
});

test("E2E: Ausdruecklich gewaehltes Bezahlmodell ohne Freigabe wird verweigert (trotz Schluessel)", async () => {
  nullen();
  const r = await frage({ modell: "gpt55" });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, "KEIN_FREIGEGEBENES_MODELL");
  assert.strictEqual(treffer.openai, 0);
  const r2 = await frage({ modell: "openai:gpt-4o-mini" });
  assert.strictEqual(r2.status, 403); assert.strictEqual(treffer.openai, 0);
});

test("E2E: Admin schaltet einen Gratis-Anbieter ab -> er wird nicht mehr genutzt", async () => {
  const R = global.__nxApp.modellRouter;
  R.setze({ schalten: { anbieter: "openrouter", aus: true } }, "admin");
  nullen();
  const r = await frage();
  assert.notStrictEqual(r.body.anbieter, "openrouter"); assert.strictEqual(treffer.openrouter, 0); assert.strictEqual(treffer.openai, 0);
  R.setze({ schalten: { anbieter: "openrouter", aus: false } }, "admin");
});

test("E2E: Bezahlmodell mit Freigabe nur im PREMIUM MODE und nur bei ausdruecklicher Wahl, nie automatisch", async () => {
  const R = global.__nxApp.modellRouter;
  R.setze({ modus: "premium", bestaetigung: "PREMIUM" }, "admin");
  R.setze({ freigabe: { anbieter: "openai", muster: "gpt-5.5", budgetChfTag: 2, chfPro1MTokens: 10, bestaetigung: "Ich erlaube Kosten" } }, "admin");
  verhalten.groq = "429"; verhalten.openrouter = "429";
  nullen();
  const auto = await frage();
  assert.strictEqual(auto.status, 429, "auto faellt NICHT auf das freigegebene Bezahlmodell"); assert.strictEqual(treffer.openai, 0);
  nullen();
  const exp = await frage({ modell: "gpt55" });
  assert.strictEqual(exp.status, 200, JSON.stringify(exp.body)); assert.strictEqual(exp.body.anbieter, "openai"); assert.strictEqual(exp.body.frei, false);
  assert.strictEqual(treffer.openai, 1);
  R.setze({ modus: "free" }, "admin");
  nullen(); const wiederFrei = await frage({ modell: "gpt55" });
  assert.strictEqual(wiederFrei.status, 403, "zurueck im FREE MODE wieder gesperrt"); assert.strictEqual(treffer.openai, 0);
  verhalten.groq = "ok"; verhalten.openrouter = "ok";
});

test("Kunden-Chat: Claude ist ohne Freigabe abgeschaltet (Rotator), trotz ANTHROPIC_API_KEY", () => {
  assert.strictEqual(process.env.NEMESIS_KUNDEN_KI, "rotator");
  const R = global.__nxApp.modellRouter;
  const st = R.setze({ freigabe: { anbieter: "anthropic", muster: "*", budgetChfTag: 1, chfPro1MTokens: 5, bestaetigung: "Ich erlaube Kosten" } }, "admin");
  assert.ok(!R.erlaubtAnbieter("anthropic", { explizit: true }), "im FREE MODE trotz Freigabe nicht erlaubt");
  R.setze({ modus: "premium", bestaetigung: "PREMIUM" }, "admin");
  assert.ok(R.erlaubtAnbieter("anthropic", { explizit: true }));
  R.setze({ modus: "free" }, "admin");
  R.setze({ freigabe: { entfernen: st.freigaben.find((f) => f.anbieter === "anthropic").id } }, "admin");
  assert.ok(!R.erlaubtAnbieter("anthropic", { explizit: true }));
});

test("Admin-API: nur Betreiber sieht und aendert Modelle; Kunde bekommt 403", async () => {
  const srv = http.createServer(async (req, res) => { if (!(await app.behandle(req, res, new URL(req.url, "http://x"), {}))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const b = "http://127.0.0.1:" + srv.address().port, Z = "/k/" + process.env.NEMESIS_ZUGANG;
  try {
    const st = await (await fetch(b + Z + "/zentrale/api/modelle")).json();
    assert.strictEqual(st.modelle.modus, "free");
    const gr = st.modelle.anbieter.find((a) => a.id === "groq"); assert.strictEqual(gr.schluessel, true); assert.strictEqual(gr.aus, false);
    const oa = st.modelle.anbieter.find((a) => a.id === "openai"); assert.strictEqual(oa.kosten, "bezahlt");
    const m = await (await fetch(b + Z + "/zentrale/api/mandanten", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Kunde Modelltest", demoDaten: false }) })).json();
    const k = await fetch(b + "/zentrale/api/modelle", { headers: { Authorization: "Bearer " + m.token } });
    assert.strictEqual(k.status, 403);
    const k2 = await fetch(b + "/zentrale/api/modelle", { method: "POST", headers: { Authorization: "Bearer " + m.token, "Content-Type": "application/json" }, body: JSON.stringify({ freigabe: { anbieter: "openai", muster: "*", budgetChfTag: 999, chfPro1MTokens: 1, bestaetigung: "Ich erlaube Kosten" } }) });
    assert.strictEqual(k2.status, 403, "Kunde kann keine Kosten freigeben");
    assert.strictEqual((await fetch(b + "/zentrale/api/modelle")).status, 401, "ohne Zugang");
    const datei = fs.readFileSync(path.join(DATA, "_modelle.json"), "utf8");
    assert.ok(!/sk-test|gsk_test/.test(datei), "keine Schluessel in der Router-Datei");
  } finally { srv.close(); }
});
