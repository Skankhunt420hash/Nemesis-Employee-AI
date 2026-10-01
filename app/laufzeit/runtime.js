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

  /* eigene Logik in einer Sandbox (vm): nur db-Zugriff, kein require/fs/Netz */
  const routen = [];
  let logikFehler = "";
  if (opt.logic && String(opt.logic).trim()) {
    try {
      const mod = { exports: {} };
      const sandbox = { module: mod, exports: mod.exports, console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Number, String, Array, Object, Boolean, parseInt, parseFloat, isNaN, isFinite, RegExp, Map, Set, Intl };
      vm.createContext(sandbox);
      vm.runInContext(String(opt.logic), sandbox, { timeout: 1000, filename: "logic.js" });
      const r = (mod.exports && mod.exports.routes) || {};
      for (const k of Object.keys(r)) {
        const m = k.match(/^(GET|POST|PUT|DELETE)\s+(\/api\/[A-Za-z0-9_\-\/:]+)$/);
        if (!m || typeof r[k] !== "function") continue;
        routen.push({ methode: m[1], teile: m[2].split("/").filter(Boolean), fn: r[k], sandbox });
      }
    } catch (e) { logikFehler = e.message; }
  }
  const tabelle = (plural) => db.tabellen[plural] || (db.tabellen[plural] = []);
  const dbApi = (user) => ({
    list: (plural, filter) => tabelle(plural).filter((r) => !filter || Object.keys(filter).every((k) => r[k] === filter[k])).map((r) => JSON.parse(JSON.stringify(r))),
    get: (plural, id) => { const r = tabelle(plural).find((x) => x.id === Number(id)); return r ? JSON.parse(JSON.stringify(r)) : null; },
    insert: (plural, obj) => {
      const e = ents[plural]; if (!e) throw new Error("Unbekannte Tabelle " + plural);
      const { out, fehler } = pruefe(e, obj || {}, false); if (fehler.length) throw new Error(fehler.join(", "));
      const r = Object.assign({ id: ++db.zaehler[plural], created: new Date().toISOString(), updated: new Date().toISOString() }, out);
      if (e.owner && user) r.owner = user.id;
      tabelle(plural).push(r); st.sichern(); return JSON.parse(JSON.stringify(r));
    },
    update: (plural, id, obj) => {
      const e = ents[plural]; const r = tabelle(plural).find((x) => x.id === Number(id)); if (!e || !r) return null;
      const { out, fehler } = pruefe(e, obj || {}, true); if (fehler.length) throw new Error(fehler.join(", "));
      Object.assign(r, out, { updated: new Date().toISOString() }); st.sichern(); return JSON.parse(JSON.stringify(r));
    },
    remove: (plural, id) => { const t = tabelle(plural), i = t.findIndex((x) => x.id === Number(id)); if (i < 0) return false; t.splice(i, 1); st.sichern(); return true; },
  });

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
      if (spec.auth && !user && !(r.fn.oeffentlich)) return sende(res, 401, { error: "Bitte anmelden" });
      const body = M === "GET" || M === "DELETE" ? {} : await lies(req);
      const query = Object.fromEntries(url.searchParams);
      r.sandbox.__ctx = { body, query, params, user: oeff(user), db: dbApi(user) };
      r.sandbox.__fn = r.fn;
      try {
        const erg = vm.runInContext("__fn(__ctx)", r.sandbox, { timeout: 1500 });
        const wert = erg && typeof erg.then === "function" ? await Promise.race([erg, new Promise((_, no) => setTimeout(() => no(new Error("Zeitueberschreitung")), 3000))]) : erg;
        return sende(res, 200, wert === undefined ? { ok: true } : wert);
      } catch (e) { return sende(res, 400, { error: String(e.message || e).slice(0, 300) }); }
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
  return { handler, spec, logikFehler, stop: () => st.jetzt(), db };
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
