#!/usr/bin/env node
/* Nemesis App-Laufzeit — ein Server ohne Abhaengigkeiten.
   Liest app.spec.json (+ optional logic.js, public/) und liefert: REST-API, Login, Datenspeicher, Frontend.
   Standalone:  node server.js      (PORT, DATA_DIR optional)
   Eingebettet: createApp({dir, spec, logic, cors}) -> async handler(req, res, pfad)  */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
const TYPEN = ["text", "longtext", "number", "bool", "date", "select", "email", "url"];
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/* ---------- Spezifikation pruefen / normalisieren ---------- */
function normSpec(spec) {
  if (!spec || typeof spec !== "object") throw new Error("Spezifikation fehlt");
  const out = { name: String(spec.name || "App").slice(0, 60), auth: !!spec.auth, entities: [] };
  const seen = new Set();
  for (const e of Array.isArray(spec.entities) ? spec.entities : []) {
    const name = slug(e.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const plural = slug(e.plural) || (name.endsWith("s") ? name : name + "s");
    const fields = [], fs_ = new Set();
    for (const f of Array.isArray(e.fields) ? e.fields : []) {
      const fn = slug(f.name);
      if (!fn || fs_.has(fn) || ["id", "created", "updated", "owner"].includes(fn)) continue;
      fs_.add(fn);
      const typ = TYPEN.includes(f.type) ? f.type : "text";
      fields.push({ name: fn, type: typ, required: !!f.required,
        options: typ === "select" ? (Array.isArray(f.options) ? f.options.map(String).slice(0, 40) : []) : undefined,
        default: f.default });
    }
    out.entities.push({ name, plural, fields, owner: out.auth && e.owner !== false, publicRead: !!e.publicRead });
  }
  const plurals = new Set();
  for (const e of out.entities) { if (plurals.has(e.plural) || e.plural === "auth" || e.plural === "health" || e.plural === "spec") e.plural += "_liste"; plurals.add(e.plural); }
  return out;
}

/* ---------- Datenspeicher: eine JSON-Datei, atomar geschrieben ---------- */
function speicher(datei) {
  let db = { users: [], sessions: [], tabellen: {}, zaehler: {} };
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(datei, "utf8"))); } catch (e) {}
  let timer = null, schreibt = false, nochmal = false;
  const sichern = () => {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (schreibt) { nochmal = true; return; }
      schreibt = true;
      try {
        fs.mkdirSync(path.dirname(datei), { recursive: true });
        const tmp = datei + ".tmp";
        await fs.promises.writeFile(tmp, JSON.stringify(db));
        await fs.promises.rename(tmp, datei);
      } catch (e) { console.warn("[app-laufzeit] speichern: " + e.message); }
      schreibt = false;
      if (nochmal) { nochmal = false; sichern(); }
    }, 150);
  };
  const jetzt = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { fs.mkdirSync(path.dirname(datei), { recursive: true }); fs.writeFileSync(datei + ".tmp", JSON.stringify(db)); fs.renameSync(datei + ".tmp", datei); } catch (e) {}
  };
  return { db, sichern, jetzt };
}

/* ---------- Wertepruefung ---------- */
function pruefe(entity, body, vorhanden) {
  const out = {}, fehler = [];
  for (const f of entity.fields) {
    let v = body[f.name];
    const fehlt = v === undefined || v === null || v === "";
    if (fehlt) {
      if (vorhanden && body[f.name] === undefined) continue;
      if (f.required && f.type !== "bool") { fehler.push(f.name + " fehlt"); continue; }
      if (f.default !== undefined && !vorhanden) out[f.name] = f.default;
      else if (f.type === "bool") out[f.name] = false;
      else if (body[f.name] === null || body[f.name] === "") out[f.name] = f.type === "number" ? null : "";
      continue;
    }
    if (f.type === "number") { v = Number(String(v).replace(",", ".")); if (!isFinite(v)) { fehler.push(f.name + " ist keine Zahl"); continue; } }
    else if (f.type === "bool") v = v === true || v === "true" || v === 1 || v === "1" || v === "on";
    else {
      v = String(v);
      if (v.length > (f.type === "longtext" ? 20000 : 1000)) { fehler.push(f.name + " zu lang"); continue; }
      if (f.type === "select" && f.options && f.options.length && !f.options.includes(v)) { fehler.push(f.name + ": ungueltige Auswahl"); continue; }
      if (f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { fehler.push(f.name + ": keine gueltige E-Mail"); continue; }
      if (f.type === "url" && !/^https?:\/\//i.test(v)) { fehler.push(f.name + ": URL muss mit http(s):// beginnen"); continue; }
      if (f.type === "date" && isNaN(Date.parse(v))) { fehler.push(f.name + ": kein Datum"); continue; }
    }
    out[f.name] = v;
  }
  return { out, fehler };
}

/* ---------- Passwoerter ---------- */
const hashPw = (pw, salt) => { salt = salt || crypto.randomBytes(16).toString("hex"); return salt + ":" + crypto.scryptSync(String(pw), salt, 32).toString("hex"); };
const pwOk = (pw, h) => { try { const [s, x] = String(h).split(":"); const y = hashPw(pw, s).split(":")[1]; return crypto.timingSafeEqual(Buffer.from(x, "hex"), Buffer.from(y, "hex")); } catch (e) { return false; } };

/* ---------- Eigene Logik: isolierter Kindprozess ----------
   Frueher lief logic.js per vm im Server-Prozess. vm ist KEINE Sicherheitsgrenze
   (Object.constructor("return process")() kam an den echten Prozess). Jetzt:
   1) eigener Prozess, leere Umgebung, Node-Permission-Model (kein fs, keine Kindprozesse, keine Worker),
   2) gefaehrliche Prozess-Schnittstellen vor dem Laden geloescht,
   3) im vm-Kontext gibt es KEINE Host-Objekte (globales Objekt ohne Prototyp, Daten als JSON-Text),
   4) Schreibzugriffe kommen als Operationen zurueck und werden hier geprueft (pruefe) und angewendet. */
function logikWorkerMain() {
  "use strict";
  const vm = require("vm");
  const send = process.send ? process.send.bind(process) : null;
  for (const k of ["require", "module", "exports", "__filename", "__dirname"]) { try { delete globalThis[k]; } catch (e) {} }
  for (const k of ["binding", "_linkedBinding", "dlopen", "getBuiltinModule", "mainModule", "chdir", "kill", "setuid", "setgid", "_debugProcess"]) { try { process[k] = undefined; } catch (e) {} }
  const KERN = `
    var __ops = [], __daten = null, __user = null, __erg = undefined, __fertig = false, __fehler = "";
    var module = { exports: {} }, exports = module.exports;
    var console = { log: function () {}, warn: function () {}, error: function () {} };
    function __tab(p) { if (!__daten.tabellen[p]) { __daten.tabellen[p] = []; } return __daten.tabellen[p]; }
    function __kopie(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
    var __db = {
      list: function (p, f) { return __tab(p).filter(function (r) { return !f || Object.keys(f).every(function (k) { return r[k] === f[k]; }); }).map(__kopie); },
      get: function (p, id) { var r = __tab(p).find(function (x) { return x.id === Number(id); }); return r ? __kopie(r) : null; },
      insert: function (p, o) {
        if (__daten.plurals.indexOf(p) < 0) throw new Error("Unbekannte Tabelle " + p);
        __daten.zaehler[p] = (__daten.zaehler[p] || 0) + 1;
        var t = new Date().toISOString(), r = Object.assign({}, __kopie(o || {}), { id: __daten.zaehler[p], created: t, updated: t });
        if (__daten.owner[p] && __user) r.owner = __user.id;
        __tab(p).push(r); __ops.push({ op: "insert", plural: p, obj: __kopie(o || {}) }); return __kopie(r);
      },
      update: function (p, id, o) { var r = __tab(p).find(function (x) { return x.id === Number(id); }); if (!r) return null; Object.assign(r, __kopie(o || {}), { updated: new Date().toISOString() }); __ops.push({ op: "update", plural: p, id: Number(id), obj: __kopie(o || {}) }); return __kopie(r); },
      remove: function (p, id) { var t = __tab(p), i = t.findIndex(function (x) { return x.id === Number(id); }); if (i < 0) return false; t.splice(i, 1); __ops.push({ op: "remove", plural: p, id: Number(id) }); return true; }
    };
    function __ruf(key, ctxJson, datenJson) {
      __ops = []; __erg = undefined; __fertig = false; __fehler = "";
      __daten = JSON.parse(datenJson); var c = JSON.parse(ctxJson); __user = c.user; c.db = __db;
      var fn = (module.exports.routes || {})[key];
      try {
        var w = fn(c);
        if (w && typeof w.then === "function") w.then(function (v) { __erg = v; __fertig = true; }, function (e) { __fehler = String((e && e.message) || e); __fertig = true; });
        else { __erg = w; __fertig = true; }
      } catch (e) { __fehler = String((e && e.message) || e); __fertig = true; }
    }
    function __stand() { return JSON.stringify({ fertig: __fertig, fehler: __fehler, wert: __erg === undefined ? null : __erg, leer: __erg === undefined, ops: __ops }); }
    function __routen() { var r = module.exports.routes || {}; return JSON.stringify(Object.keys(r).filter(function (k) { return typeof r[k] === "function"; }).map(function (k) { return { key: k, oeffentlich: !!r[k].oeffentlich }; })); }
  `;
  let ctx = null;
  function laden(logic) {
    const g = Object.create(null);
    ctx = vm.createContext(g, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(KERN, ctx, { timeout: 1000 });
    vm.runInContext(String(logic), ctx, { timeout: 1000, filename: "logic.js" });
    return JSON.parse(vm.runInContext("__routen()", ctx, { timeout: 500 }));
  }
  async function rufe(m) {
    vm.runInContext("__ruf(" + JSON.stringify(m.key) + "," + JSON.stringify(JSON.stringify(m.ctx)) + "," + JSON.stringify(JSON.stringify(m.daten)) + ")", ctx, { timeout: 1500 });
    const bis = Date.now() + 3000;
    for (;;) {
      const s = JSON.parse(vm.runInContext("__stand()", ctx, { timeout: 500 }));
      if (s.fertig) return s;
      if (Date.now() > bis) return { fertig: true, fehler: "Zeitueberschreitung", ops: [] };
      await new Promise((r) => setTimeout(r, 2));
    }
  }
  if (process.argv.includes("--analyse")) {
    let roh = ""; process.stdin.on("data", (c) => (roh += c));
    process.stdin.on("end", () => {
      try { process.stdout.write(JSON.stringify({ ok: true, routen: laden(JSON.parse(roh).logic) })); }
      catch (e) { process.stdout.write(JSON.stringify({ ok: false, fehler: String(e.message || e).slice(0, 300) })); }
    });
    return;
  }
  process.on("message", async (m) => {
    try {
      if (m.t === "laden") { laden(m.logic); return send({ id: m.id, ok: true }); }
      if (m.t === "ruf") { const s = await rufe(m); return send({ id: m.id, ok: !s.fehler, fehler: s.fehler, wert: s.wert, leer: s.leer, ops: s.ops || [] }); }
    } catch (e) { send({ id: m.id, ok: false, fehler: String(e.message || e).slice(0, 300), ops: [] }); }
  });
}
function workerArgs(extra) {
  const f = process.allowedNodeEnvironmentFlags;
  const perm = f.has("--permission") ? ["--permission"] : f.has("--experimental-permission") ? ["--experimental-permission"] : [];
  return perm.concat(["--max-old-space-size=96", "-e", "(" + logikWorkerMain.toString() + ")()", "--"]).concat(extra || []);
}
function logikAnalyse(logic) {
  const r = require("child_process").spawnSync(process.execPath, workerArgs(["--analyse"]), { input: JSON.stringify({ logic: String(logic) }), env: {}, timeout: 8000, maxBuffer: 1 << 20 });
  try { return JSON.parse(String(r.stdout || "")); } catch (e) { return { ok: false, fehler: "Logik-Pruefung fehlgeschlagen" + (r.error ? ": " + r.error.message : "") }; }
}
function logikProzess(logic) {
  let kind = null, n = 0, warte = new Map(), kette = Promise.resolve();
  const start = () => {
    kind = require("child_process").spawn(process.execPath, workerArgs([]), { env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    kind.on("message", (m) => { const w = warte.get(m.id); if (w) { warte.delete(m.id); w(m); } });
    kind.on("exit", () => { for (const w of warte.values()) w({ ok: false, fehler: "Logik-Prozess beendet", ops: [] }); warte.clear(); kind = null; });
    kind.send({ t: "laden", id: ++n, logic: String(logic) });
  };
  const frage = (m) => new Promise((ok) => {
    if (!kind) start();
    const id = ++n; m.id = id;
    const t = setTimeout(() => { if (warte.has(id)) { warte.delete(id); try { kind && kind.kill("SIGKILL"); } catch (e) {} ok({ ok: false, fehler: "Zeitueberschreitung", ops: [] }); } }, 5000);
    warte.set(id, (x) => { clearTimeout(t); ok(x); });
    kind.send(m);
  });
  return {
    // nacheinander, damit Zaehler und Daten konsistent bleiben
    ruf: (m) => { const p = kette.then(() => frage(m)); kette = p.catch(() => {}); return p; },
    stop: () => { try { kind && kind.kill("SIGKILL"); } catch (e) {} },
  };
}

/* ---------- Die App ---------- */
function createApp(opt) {
  const spec = normSpec(opt.spec);
  const dir = opt.dir;
  const st = speicher(path.join(opt.dataDir || dir, "daten.json"));
  const db = st.db;
  const publicDir = path.join(dir, "public");
  const cors = !!opt.cors;
  const ents = Object.fromEntries(spec.entities.map((e) => [e.plural, e]));
  for (const e of spec.entities) { db.tabellen[e.plural] = db.tabellen[e.plural] || []; db.zaehler[e.plural] = db.zaehler[e.plural] || 0; }
  const bremse = new Map();
  const zuViel = (key, max, fenster) => {
    const n = Date.now(), l = (bremse.get(key) || []).filter((t) => n - t < fenster);
    if (l.length >= max) { bremse.set(key, l); return true; }
    l.push(n); bremse.set(key, l); return false;
  };
  setInterval(() => { const n = Date.now(); for (const [k, v] of bremse) if (!v.some((t) => n - t < 600000)) bremse.delete(k); }, 300000).unref();

  /* eigene Logik: isolierter Kindprozess (siehe logikWorkerMain) */
  const routen = [];
  let logikFehler = "", logik = null;
  if (opt.logic && String(opt.logic).trim()) {
    const an = logikAnalyse(opt.logic);
    if (!an.ok) logikFehler = an.fehler || "Logik laedt nicht";
    else {
      for (const r of an.routen || []) {
        const m = String(r.key).match(/^(GET|POST|PUT|DELETE)\s+(\/api\/[A-Za-z0-9_\-\/:]+)$/);
        if (m) routen.push({ key: r.key, methode: m[1], teile: m[2].split("/").filter(Boolean), oeffentlich: !!r.oeffentlich });
      }
      logik = logikProzess(opt.logic);
    }
  }
  // Operationen aus dem Logik-Prozess pruefen und anwenden (alles oder nichts)
  const opsAnwenden = (ops, user) => {
    const plan = [];
    for (const o of Array.isArray(ops) ? ops.slice(0, 500) : []) {
      const e = ents[o.plural]; if (!e) throw new Error("Unbekannte Tabelle " + o.plural);
      if (o.op === "insert") { const { out, fehler } = pruefe(e, o.obj || {}, false); if (fehler.length) throw new Error(fehler.join(", ")); plan.push({ o, e, out }); }
      else if (o.op === "update") { const { out, fehler } = pruefe(e, o.obj || {}, true); if (fehler.length) throw new Error(fehler.join(", ")); plan.push({ o, e, out }); }
      else if (o.op === "remove") plan.push({ o, e });
    }
    for (const { o, e, out } of plan) {
      const t = tabelle(e.plural);
      if (o.op === "insert") { const r = Object.assign({ id: ++db.zaehler[e.plural], created: new Date().toISOString(), updated: new Date().toISOString() }, out); if (e.owner && user) r.owner = user.id; t.push(r); }
      else if (o.op === "update") { const r = t.find((x) => x.id === Number(o.id)); if (r) Object.assign(r, out, { updated: new Date().toISOString() }); }
      else { const i = t.findIndex((x) => x.id === Number(o.id)); if (i >= 0) t.splice(i, 1); }
    }
    if (plan.length) st.sichern();
  };
  const tabelle = (plural) => db.tabellen[plural] || (db.tabellen[plural] = []);


  const sende = (res, code, obj, extra) => {
    const b = JSON.stringify(obj);
    res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, cors ? CORS : {}, extra || {}));
    res.end(b);
  };
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Max-Age": "86400" };
  const lies = (req) => new Promise((ok, nein) => {
    let n = 0; const teile = [];
    req.on("data", (c) => { n += c.length; if (n > 1048576) { nein(Object.assign(new Error("Anfrage zu gross"), { code: 413 })); req.destroy(); } else teile.push(c); });
    req.on("end", () => {
      if (!n) return ok({});
      try { const o = JSON.parse(Buffer.concat(teile).toString("utf8")); ok(o && typeof o === "object" ? o : {}); }
      catch (e) { nein(Object.assign(new Error("Ungueltiges JSON"), { code: 400 })); }
    });
    req.on("error", nein);
  });
  const userVon = (req) => {
    const h = String(req.headers.authorization || "");
    const t = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!t) return null;
    const hash = crypto.createHash("sha256").update(t).digest("hex");
    const s = db.sessions.find((x) => x.h === hash && x.bis > Date.now());
    return s ? db.users.find((u) => u.id === s.user) || null : null;
  };
  const oeff = (u) => u && { id: u.id, name: u.name, email: u.email, admin: !!u.admin };
  const neueSitzung = (u) => {
    const t = crypto.randomBytes(32).toString("hex");
    db.sessions = db.sessions.filter((x) => x.bis > Date.now()).slice(-500);
    db.sessions.push({ h: crypto.createHash("sha256").update(t).digest("hex"), user: u.id, bis: Date.now() + 30 * 86400000 });
    st.sichern(); return t;
  };

  async function api(req, res, teile, url) {
    const M = req.method;
    const ip = String(req.socket && req.socket.remoteAddress || "");
    if (M === "OPTIONS") { res.writeHead(204, cors ? CORS : {}); return res.end(); }
    if (teile[1] === "health") return sende(res, 200, { ok: true, name: spec.name, logik: !logikFehler, logikFehler: logikFehler || undefined });
    if (teile[1] === "spec") return sende(res, 200, { name: spec.name, auth: spec.auth, entities: spec.entities });
    const user = userVon(req);

    if (teile[1] === "auth") {
      if (!spec.auth) return sende(res, 404, { error: "Diese App hat keinen Login" });
      if (teile[2] === "me" && M === "GET") return user ? sende(res, 200, { user: oeff(user) }) : sende(res, 401, { error: "Nicht angemeldet" });
      if (teile[2] === "logout" && M === "POST") {
        const t = String(req.headers.authorization || "").slice(7);
        if (t) { const h = crypto.createHash("sha256").update(t).digest("hex"); db.sessions = db.sessions.filter((x) => x.h !== h); st.sichern(); }
        return sende(res, 200, { ok: true });
      }
      if ((teile[2] === "register" || teile[2] === "login") && M === "POST") {
        if (zuViel("auth:" + ip, 20, 600000)) return sende(res, 429, { error: "Zu viele Versuche, kurz warten" });
        const b = await lies(req);
        const email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
        if (teile[2] === "register") {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sende(res, 400, { error: "Ungueltige E-Mail" });
          if (pw.length < 6) return sende(res, 400, { error: "Passwort: mindestens 6 Zeichen" });
          if (db.users.length >= 5000) return sende(res, 400, { error: "Registrierung geschlossen" });
          if (db.users.some((u) => u.email === email)) return sende(res, 409, { error: "E-Mail ist schon registriert" });
          const u = { id: (db.users.reduce((m, x) => Math.max(m, x.id), 0)) + 1, email, name: String(b.name || email.split("@")[0]).slice(0, 60), pw: hashPw(pw), admin: db.users.length === 0, created: new Date().toISOString() };
          db.users.push(u); st.sichern();
          return sende(res, 201, { token: neueSitzung(u), user: oeff(u) });
        }
        const u = db.users.find((x) => x.email === email);
        if (!u || !pwOk(pw, u.pw)) return sende(res, 401, { error: "E-Mail oder Passwort falsch" });
        return sende(res, 200, { token: neueSitzung(u), user: oeff(u) });
      }
      return sende(res, 404, { error: "Unbekannt" });
    }

    // eigene Routen zuerst
    for (const r of routen) {
      if (r.methode !== M || r.teile.length !== teile.length) continue;
      const params = {}; let passt = true;
      r.teile.forEach((t, i) => { if (t.startsWith(":")) params[t.slice(1)] = decodeURIComponent(teile[i]); else if (t !== teile[i]) passt = false; });
      if (!passt) continue;
      if (spec.auth && !user && !r.oeffentlich) return sende(res, 401, { error: "Bitte anmelden" });
      const body = M === "GET" || M === "DELETE" ? {} : await lies(req);
      const query = Object.fromEntries(url.searchParams);
      const daten = { tabellen: db.tabellen, zaehler: db.zaehler, plurals: Object.keys(ents), owner: Object.fromEntries(spec.entities.map((x) => [x.plural, !!x.owner])) };
      const a = await logik.ruf({ t: "ruf", key: r.key, ctx: { body, query, params, user: oeff(user) }, daten });
      if (!a.ok) return sende(res, 400, { error: String(a.fehler || "Fehler").slice(0, 300) });
      try { opsAnwenden(a.ops, user); } catch (x) { return sende(res, 400, { error: String(x.message).slice(0, 300) }); }
      return sende(res, 200, a.leer ? { ok: true } : a.wert);
    }

    const e = ents[teile[1]];
    if (!e) return sende(res, 404, { error: "Unbekannte Ressource" });
    const lesen = M === "GET", id = teile[2] !== undefined ? Number(teile[2]) : null;
    if (spec.auth && !user && !(lesen && e.publicRead)) return sende(res, 401, { error: "Bitte anmelden" });
    const eigene = (r) => !e.owner || !user || user.admin || r.owner === user.id || (lesen && e.publicRead);
    const t = tabelle(e.plural);

    if (teile.length === 2 && lesen) {
      let liste = t.filter(eigene);
      for (const f of e.fields) { const v = url.searchParams.get(f.name); if (v !== null && v !== "") liste = liste.filter((r) => String(r[f.name]) === v); }
      const q = (url.searchParams.get("q") || "").toLowerCase();
      if (q) liste = liste.filter((r) => e.fields.some((f) => String(r[f.name] == null ? "" : r[f.name]).toLowerCase().includes(q)));
      const sort = url.searchParams.get("sort") || "-id", desc = sort[0] === "-", sf = sort.replace(/^-/, "");
      if (sf === "id" || sf === "created" || sf === "updated" || e.fields.some((f) => f.name === sf))
        liste = liste.slice().sort((a, b) => { const x = a[sf], y = b[sf]; return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
      const gesamt = liste.length, off = Math.max(0, parseInt(url.searchParams.get("offset")) || 0), lim = Math.min(500, parseInt(url.searchParams.get("limit")) || 200);
      return sende(res, 200, { items: liste.slice(off, off + lim), total: gesamt });
    }
    if (teile.length === 2 && M === "POST") {
      const b = await lies(req);
      const { out, fehler } = pruefe(e, b, false);
      if (fehler.length) return sende(res, 400, { error: fehler.join(", ") });
      if (t.length >= 50000) return sende(res, 400, { error: "Speicher voll" });
      const r = Object.assign({ id: ++db.zaehler[e.plural], created: new Date().toISOString(), updated: new Date().toISOString() }, out);
      if (e.owner && user) r.owner = user.id;
      t.push(r); st.sichern();
      return sende(res, 201, r);
    }
    if (teile.length === 3 && id) {
      const r = t.find((x) => x.id === id);
      if (!r || !eigene(r)) return sende(res, 404, { error: "Nicht gefunden" });
      if (lesen) return sende(res, 200, r);
      if (M === "PUT" || M === "POST") {
        if (e.owner && user && !user.admin && r.owner !== user.id) return sende(res, 403, { error: "Nicht erlaubt" });
        const { out, fehler } = pruefe(e, await lies(req), true);
        if (fehler.length) return sende(res, 400, { error: fehler.join(", ") });
        Object.assign(r, out, { updated: new Date().toISOString() }); st.sichern();
        return sende(res, 200, r);
      }
      if (M === "DELETE") {
        if (e.owner && user && !user.admin && r.owner !== user.id) return sende(res, 403, { error: "Nicht erlaubt" });
        t.splice(t.indexOf(r), 1); st.sichern();
        return sende(res, 200, { ok: true });
      }
    }
    return sende(res, 405, { error: "Methode nicht erlaubt" });
  }

  function statisch(req, res, pfad) {
    let rel = pfad === "/" ? "/index.html" : pfad;
    let datei;
    try { datei = path.normalize(path.join(publicDir, decodeURIComponent(rel))); } catch (e) { res.writeHead(400); return res.end(); }
    if (datei !== publicDir && !datei.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end(); }
    let s; try { s = fs.statSync(datei); if (s.isDirectory()) { datei = path.join(datei, "index.html"); s = fs.statSync(datei); } } catch (e) { s = null; }
    if (!s) {
      if (path.extname(rel)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Nicht gefunden"); }
      datei = path.join(publicDir, "index.html");
      try { s = fs.statSync(datei); } catch (e) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Kein Frontend vorhanden"); }
    }
    const h = { "Content-Type": MIME[path.extname(datei).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
    if (opt.headerExtra) Object.assign(h, opt.headerExtra);
    res.writeHead(200, h);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(datei).pipe(res);
  }

  async function handler(req, res, pfad) {
    try {
      const url = new URL(req.url, "http://x");
      const p = pfad || url.pathname;
      if (p === "/api" || p.startsWith("/api/")) {
        const teile = p.split("/").filter(Boolean);
        return await api(req, res, teile, url);
      }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      return statisch(req, res, p);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch (x) {} return; }
      sende(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : "Serverfehler" });
    }
  }
  return { handler, spec, logikFehler, stop: () => { st.jetzt(); if (logik) logik.stop(); }, db };
}

/* ---------- Standalone ---------- */
function startStandalone() {
  const dir = __dirname;
  let spec; try { spec = JSON.parse(fs.readFileSync(path.join(dir, "app.spec.json"), "utf8")); } catch (e) { console.error("app.spec.json fehlt oder ist kaputt: " + e.message); process.exit(1); }
  let logic = ""; try { logic = fs.readFileSync(path.join(dir, "logic.js"), "utf8"); } catch (e) {}
  const app = createApp({ dir, spec, logic, dataDir: process.env.DATA_DIR || path.join(dir, "data"), cors: process.env.CORS !== "0" });
  if (app.logikFehler) console.warn("[logic.js] " + app.logikFehler);
  const port = Number(process.env.PORT) || 3000;
  const srv = require("http").createServer((req, res) => app.handler(req, res));
  srv.listen(port, () => console.log(spec.name + " laeuft auf http://localhost:" + port));
  const ende = () => { app.stop(); process.exit(0); };
  process.on("SIGINT", ende); process.on("SIGTERM", ende);
}

module.exports = { createApp, normSpec, startStandalone };
if (require.main === module) startStandalone();
