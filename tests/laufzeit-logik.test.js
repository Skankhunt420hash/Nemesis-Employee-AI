// P0: logic.js darf nicht aus der Sandbox ausbrechen, muss aber weiter funktionieren.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const rt = require("../app/laufzeit/runtime.js");

function starte(logic, spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lz-"));
  const app = rt.createApp({ dir, spec: spec || { name: "t", entities: [{ name: "kunde", plural: "kunden", fields: [{ name: "name", type: "text", required: true }, { name: "mail", type: "email" }] }] }, logic });
  const srv = http.createServer((q, r) => app.handler(q, r));
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ app, srv, base: "http://127.0.0.1:" + srv.address().port })));
}
async function f(base, m, p, b) {
  const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, j: await r.json().catch(() => null) };
}
const ende = (x) => { x.app.stop(); x.srv.close(); };

test("logic.js: Routen, sync db, insert mit Pruefung, async", async () => {
  const x = await starte(`module.exports = { routes: {
    "POST /api/neu": (ctx) => ({ k: ctx.db.insert("kunden", { name: ctx.body.name }) }),
    "GET /api/zahl": (ctx) => ({ n: ctx.db.list("kunden").length, q: ctx.query.a }),
    "GET /api/spaet": async (ctx) => { await null; return { ok: 1 }; },
    "POST /api/kaputt": (ctx) => ctx.db.insert("kunden", { mail: "keine-mail" }),
  } };`);
  try {
    assert.strictEqual(x.app.logikFehler, "");
    let r = await f(x.base, "POST", "/api/neu", { name: "Anna" });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.j.k.name, "Anna"); assert.strictEqual(r.j.k.id, 1);
    r = await f(x.base, "GET", "/api/zahl?a=7"); assert.deepStrictEqual(r.j, { n: 1, q: "7" });
    r = await f(x.base, "GET", "/api/kunden"); assert.strictEqual(r.j.total, 1);
    r = await f(x.base, "GET", "/api/spaet"); assert.deepStrictEqual(r.j, { ok: 1 }, JSON.stringify(r.j));
    r = await f(x.base, "POST", "/api/kaputt", {}); assert.strictEqual(r.status, 400, "ungueltige Daten werden serverseitig abgelehnt");
    r = await f(x.base, "GET", "/api/kunden"); assert.strictEqual(r.j.total, 1, "nichts eingefuegt");
  } finally { ende(x); }
});

const AUSBRUECHE = {
  "Object.constructor": `return Object.constructor("return process")().pid`,
  "this.constructor": `return this.constructor.constructor("return process")().pid`,
  "ctx.db.list.constructor": `return ctx.db.list.constructor("return process")().pid`,
  "eval": `return eval("1+1")`,
  "globalThis.process": `return typeof process + typeof require`,
};
for (const [name, code] of Object.entries(AUSBRUECHE)) {
  test("Ausbruch blockiert: " + name, async () => {
    const x = await starte(`module.exports = { routes: { "GET /api/x": function (ctx) { ${code}; } } };`);
    try {
      const r = await f(x.base, "GET", "/api/x");
      const txt = JSON.stringify(r.j);
      assert.ok(!/"\d{2,}"|^\d+$/.test(String(r.j)) && !(typeof r.j === "number"), "kein pid: " + txt);
      if (name === "globalThis.process") assert.strictEqual(r.j, "undefinedundefined");
      else assert.strictEqual(r.status, 400, txt);
    } finally { ende(x); }
  });
}

test("Endlosschleife legt den Server nicht lahm", async () => {
  const x = await starte(`module.exports = { routes: { "GET /api/loop": () => { while (true) {} }, "GET /api/ok": () => ({ ok: true }) } };`);
  try {
    const r = await f(x.base, "GET", "/api/loop"); assert.strictEqual(r.status, 400);
    const r2 = await f(x.base, "GET", "/api/ok"); assert.deepStrictEqual(r2.j, { ok: true });
  } finally { ende(x); }
});

test("Syntaxfehler in logic.js wird gemeldet", async () => {
  const x = await starte(`module.exports = { routes: { "GET /api/x": () => { ` );
  try { assert.ok(x.app.logikFehler.length > 0); } finally { ende(x); }
});
