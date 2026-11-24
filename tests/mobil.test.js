// Mobil zuerst (Regel A10): Jede Seite des Command Centers auf einem iPhone 13 (390 px)
// ohne Verbreiterung des Layouts, ohne JavaScript-Fehler, und jeder Bereich ueber "Mehr" erreichbar.
// Braucht Playwright + Chromium (in der Entwicklungsumgebung vorhanden); sonst uebersprungen.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");

let playwright = null; try { playwright = require("playwright"); } catch (e) {}
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nx-mobil-"));
process.env.DATA_DIR = DATA; process.env.NEMESIS_ZUGANG = "mobiltest-1234567890abcdef"; process.env.NEMESIS_AUTO_UPDATE = "0"; process.env.NEMESIS_SANDBOX = "aus";
const SEITEN = ["uebersicht", "agenten", "auftraege", "freigaben", "office", "dateien", "kosten", "audit", "einstellungen", "mandanten", "modelle", "bibliothek", "integrationen", "system"];

test("Command Center am iPhone: alle Seiten 390 px breit, ohne JS-Fehler, alles ueber 'Mehr' erreichbar", { skip: !playwright && "Playwright nicht installiert", timeout: 180000 }, async () => {
  const app = require("../app/nemesis-app.js");
  const srv = http.createServer(async (q, r) => { if (!(await app.behandle(q, r, new URL(q.url, "http://x"), {}))) { r.writeHead(404); r.end(); } });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const Z = "http://127.0.0.1:" + srv.address().port + "/k/" + process.env.NEMESIS_ZUGANG + "/zentrale";
  // Demo-Kunde mit Office-Agent, damit die Seiten echte Inhalte haben
  await fetch(Z + "/api/mandanten", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Mobil Test GmbH", demo: true, agenten: ["office", "developer"] }) });
  const browser = await playwright.chromium.launch();
  const fehler = [], breit = [];
  try {
    const ctx = await browser.newContext({ ...playwright.devices["iPhone 13"] });
    const p = await ctx.newPage(); p.on("pageerror", (e) => fehler.push(e.message));
    await p.goto(Z); await p.waitForSelector("[data-mehr]");
    for (const s of SEITEN) {
      await p.tap("[data-mehr]"); await p.waitForSelector(`[data-mseite="${s}"]`);
      await p.tap(`[data-mseite="${s}"]`);
      await p.waitForFunction(() => document.querySelector("main h1"));
      await p.waitForTimeout(400);
      const w = await p.evaluate(() => innerWidth);
      if (w !== 390) breit.push(s + "=" + w);
    }
  } finally { await browser.close(); srv.close(); }
  assert.deepStrictEqual(fehler, [], "JavaScript-Fehler");
  assert.deepStrictEqual(breit, [], "Seiten breiter als der Bildschirm (Browser zoomt heraus)");
});
test.after(() => setTimeout(() => process.exit(0), 50).unref());
