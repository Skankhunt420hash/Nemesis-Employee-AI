// "Die bestehende Anwendung startet fehlerfrei": baut den Server wie der Installer (install-app.sh) auf
// - nemesis-sync.js + nemesis-serve.js + nemesis-import.js, App-Modul daneben, patch-app.js und patch-serve.js angewendet -
// startet ihn als ECHTEN eigenen Node-Prozess und prueft die Kernrouten (alt und neu).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), net = require("net");

const ROOT = path.join(__dirname, "..");
const ZUGANG = "starttest-1234567890abcdef";
let kind, base, ausgabe = "";

function freierPort() { return new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); }); }

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-stack-"));
  for (const f of ["nemesis-sync.js", "nemesis-serve.js", "nemesis-import.js"]) fs.copyFileSync(path.join(ROOT, "build", f), path.join(dir, f));
  for (const f of ["nemesis-app.js", "nemesis-app.html"]) fs.copyFileSync(path.join(ROOT, "app", f), path.join(dir, f));
  const p1 = cp.spawnSync(process.execPath, [path.join(ROOT, "build/patch-app.js"), path.join(dir, "nemesis-sync.js")]).stdout.toString().trim();
  assert.strictEqual(p1, "OK", "patch-app"); fs.renameSync(path.join(dir, "nemesis-sync.js.neu"), path.join(dir, "nemesis-sync.js"));
  const p2 = cp.spawnSync(process.execPath, [path.join(ROOT, "build/patch-serve.js"), path.join(dir, "nemesis-serve.js")]).stdout.toString().trim();
  assert.strictEqual(p2, "OK", "patch-serve"); fs.renameSync(path.join(dir, "nemesis-serve.js.neu"), path.join(dir, "nemesis-serve.js"));
  for (const f of ["nemesis-sync.js", "nemesis-serve.js"]) assert.strictEqual(cp.spawnSync(process.execPath, ["--check", path.join(dir, f)]).status, 0, f + " Syntax");
  const port = await freierPort();
  const env = { PATH: process.env.PATH, PORT: String(port), NEMESIS_ZUGANG: ZUGANG, NEMESIS_AUTO_UPDATE: "0", NEMESIS_SANDBOX: "aus", DATA_DIR: path.join(dir, "sync-data") };
  kind = cp.spawn(process.execPath, ["nemesis-sync.js"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  kind.stdout.on("data", (c) => (ausgabe += c)); kind.stderr.on("data", (c) => (ausgabe += c));
  base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + "/health"); if (r.ok) return; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht:\n" + ausgabe);
});
test.after(() => { if (kind) kind.kill("SIGTERM"); });

const get = async (p, o) => { const r = await fetch(base + p, o); return { s: r.status, t: await r.text() }; };

test("Server startet als eigener Prozess ohne Fehler im Log", async () => {
  assert.ok(!/Error|TypeError|ReferenceError|SyntaxError/.test(ausgabe.replace(/\[[a-z]+\] [^\n]*warn[^\n]*/gi, "")), "keine Fehler im Startlog:\n" + ausgabe);
  assert.strictEqual((await get("/health")).s, 200);
});
test("Kernfunktionen erreichbar: Lab, Zentrale, Modelle, Betriebe, Schloss", async () => {
  const Z = "/k/" + ZUGANG;
  const app = await get(Z + "/app"); assert.strictEqual(app.s, 200); assert.match(app.t, /Nemesis Lab/);
  assert.strictEqual((await get("/app")).s, 401, "Lab ohne Zugang gesperrt");
  assert.strictEqual((await get(Z + "/llm/status")).s, 200);
  assert.strictEqual((await get(Z + "/betrieb/liste")).s, 200);
  const zen = await get(Z + "/zentrale"); assert.strictEqual(zen.s, 200); assert.match(zen.t, /NEMESIS/);
  const ich = JSON.parse((await get(Z + "/zentrale/api/ich")).t); assert.strictEqual(ich.rolle, "admin");
  const ig = JSON.parse((await get(Z + "/zentrale/api/integrationen")).t);
  assert.deepStrictEqual(ig.integrationen.map((i) => i.id + ":" + i.status), ["omniroute:aus", "openhands:aus", "openclaw:aus"], "alle Integrationen standardmaessig aus");
  const sys = JSON.parse((await get(Z + "/zentrale/api/system")).t);
  assert.ok(sys.pruefungen.find((p) => p.name === "Daten schreibbar").status === "ok");
  assert.strictEqual((await get("/zentrale/api/system")).s, 401, "Systemstatus ohne Zugang gesperrt");
  assert.strictEqual((await get("/zentrale/api/integrationen")).s, 401);
  const m = JSON.parse((await get(Z + "/zentrale/api/modelle")).t); assert.strictEqual(m.modelle.modus, "free");
});
test("Kunden-Chat-Schutz: ohne Claude-Freigabe auf Gratis-Rotation (Prozess-Umgebung)", async () => {
  const r = await get("/k/" + ZUGANG + "/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
  assert.ok([503, 429, 403].includes(r.s), "ohne Schluessel kein Modell, aber kein Absturz: " + r.s + " " + r.t.slice(0, 200));
  assert.strictEqual((await get("/health")).s, 200, "Server laeuft weiter");
});
