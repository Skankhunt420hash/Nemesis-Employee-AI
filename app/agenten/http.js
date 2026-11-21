/* =====================================================================
   NEMESIS ZENTRALE · HTTP-API  (app/agenten/http.js)
   Alle Routen unter /zentrale/api/...
   Rollen (vom Host festgestellt, nie vom Client behauptet):
     admin   = Betreiber (Zugangs-Pfad /k/<NEMESIS_ZUGANG>/) -> alle Mandanten
     mandant = Kunde mit Token "Authorization: Bearer nxm_..." -> NUR der eigene Mandant
   Oeffentlich (ohne Login): POST /zentrale/oeffentlich/<mandant>/anfrage (Kontaktformular, gebremst)
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".woff2": "font/woff2" };

function createHttp(engine, opt) {
  opt = opt || {};
  const bremse = new Map();
  const zuViel = (k, max, ms) => { const n = Date.now(), l = (bremse.get(k) || []).filter((t) => n - t < ms); l.push(n); bremse.set(k, l); return l.length > max; };
  setInterval(() => { const n = Date.now(); for (const [k, v] of bremse) if (!v.some((t) => n - t < 3600000)) bremse.delete(k); }, 600000).unref();

  const sende = (res, code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(obj));
  };
  const lies = (req, max) => new Promise((ok, no) => {
    let n = 0; const t = [];
    req.on("data", (c) => { n += c.length; if (n > (max || 1048576)) { no(Object.assign(new Error("Anfrage zu gross"), { code: 413 })); req.destroy(); } else t.push(c); });
    req.on("end", () => { if (!n) return ok({}); try { const o = JSON.parse(Buffer.concat(t).toString("utf8")); ok(o && typeof o === "object" ? o : {}); } catch (e) { no(Object.assign(new Error("Ungueltiges JSON"), { code: 400 })); } });
    req.on("error", no);
  });

  /** Stellt fest, wer anfragt. adminVomHost: true, wenn der Host den Betreiber-Zugang bestaetigt hat. */
  function wer(req, adminVomHost) {
    if (adminVomHost) return { rolle: "admin", akteur: "admin" };
    const h = String(req.headers.authorization || "");
    const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    const tid = t ? engine.mandantPerToken(t) : null;
    return tid ? { rolle: "mandant", tid, akteur: "mandant:" + tid } : null;
  }
  const darf = (w, tid) => w && (w.rolle === "admin" || (w.rolle === "mandant" && w.tid === tid));

  async function oeffentlich(req, res, p) {
    const m = p.match(/^\/zentrale\/oeffentlich\/([a-z0-9][a-z0-9-]{2,40})\/anfrage$/);
    if (!m) return false;
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" }); res.end(); return true; }
    if (req.method !== "POST") { sende(res, 405, { error: "POST erwartet" }); return true; }
    const ip = String(req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "");
    if (zuViel("anfrage:" + ip, 10, 3600000) || zuViel("anfrage-m:" + m[1], 200, 86400000)) { sende(res, 429, { error: "Zu viele Anfragen" }); return true; }
    try {
      const b = await lies(req, 64 * 1024);
      if (b.website) { sende(res, 200, { ok: true }); return true; } // Honeypot
      engine.mandantLaden(m[1]);
      const r = engine.mailEingang(m[1], { von: b.email, name: b.name, betreff: b.betreff || "Anfrage ueber Webseite", text: b.nachricht || b.text, quelle: "formular" }, "oeffentlich:" + ip.replace(/[^0-9a-f.:]/gi, "").slice(0, 40));
      res.setHeader("Access-Control-Allow-Origin", "*");
      sende(res, 200, { ok: true, id: r.id });
    } catch (e) { sende(res, e.code === 404 ? 404 : 400, { error: e.code === 404 ? "Unbekannt" : e.message }); }
    return true;
  }

  async function vorschau(req, res, p) {
    const m = p.match(/^\/zentrale\/vorschau\/([a-z0-9][a-z0-9-]{2,40})\/(l[0-9a-f]{12})\/([0-9a-f]{32})(\/.*)?$/);
    if (!m) return false;
    let f = null; try { f = engine.vorschauDatei(m[1], m[2], m[3], decodeURIComponent((m[4] || "/").slice(1)) || "index.html"); } catch (e) {}
    if (!f) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Nicht gefunden"); return true; }
    if (!m[4]) { res.writeHead(302, { Location: p + "/" }); res.end(); return true; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups; default-src 'self' 'unsafe-inline' data: https:; connect-src 'none'", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
    fs.createReadStream(f).pipe(res);
    return true;
  }

  async function handle(req, res, p, adminVomHost) {
    if (await oeffentlich(req, res, p)) return true;
    if (await vorschau(req, res, p)) return true;
    if (p === "/zentrale" || p === "/zentrale/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-src 'self'; connect-src 'self'" });
      res.end(opt.html ? opt.html() : "<h1>Zentrale</h1>");
      return true;
    }
    if (!p.startsWith("/zentrale/api/")) return false;
    const w = wer(req, adminVomHost);
    if (!w) { sende(res, 401, { error: "Nicht angemeldet" }); return true; }
    const ip = String((req.socket && req.socket.remoteAddress) || "");
    if (zuViel("api:" + (w.tid || "admin") + ":" + ip, 600, 60000)) { sende(res, 429, { error: "Zu viele Anfragen" }); return true; }
    const url = new URL(req.url, "http://x");
    const M = req.method, POST = M === "POST", r = p.slice("/zentrale/api".length);
    try {
      // ----- global -----
      if (r === "/ich" && !POST) return sende(res, 200, { rolle: w.rolle, mandant: w.tid || null, notaus: engine.notausAn, sandbox: engine.sandbox.info(), version: engine.VERSION, openclaw: w.rolle === "admin" ? engine.openclawInfo() : { verfuegbar: (engine.openclawInfo().mandanten || []).includes(w.tid) && engine.openclawInfo().aktiv } }), true;
      if (r === "/katalog" && !POST) return sende(res, 200, { werkzeuge: engine.werkzeugKatalog(), modi: engine.MODI.map((m) => ({ id: m, text: engine.MODUS_TEXT[m] })), autonomie: engine.AUTONOMIE, vorlagen: Object.keys(engine.VORLAGEN), vorlagenDaten: engine.VORLAGEN, modelle: opt.modelle ? opt.modelle() : ["auto"] }), true;
      if (r === "/mandanten" && !POST) { if (w.rolle !== "admin") return sende(res, 403, { error: "Nur Betreiber" }), true; return sende(res, 200, { mandanten: engine.mandanten().map((m) => Object.assign(m, { offeneFreigaben: engine.freigabenListe(m.id).length, aktiv: engine.laeufeListe(m.id).filter((l) => ["laeuft", "wartet"].includes(l.status)).length })) }), true; }
      if (r === "/mandanten" && POST) { if (w.rolle !== "admin") return sende(res, 403, { error: "Nur Betreiber" }), true; return sende(res, 200, engine.mandantNeu(await lies(req), "admin")), true; }
      if (r === "/openclaw") {
        if (w.rolle !== "admin") return sende(res, 403, { error: "Nur Betreiber" }), true;
        if (POST) return sende(res, 200, { openclaw: engine.openclawSetzen(await lies(req), "admin") }), true;
        return sende(res, 200, { openclaw: await engine.openclawStatus() }), true;
      }
      if (r === "/notaus" && POST) { if (w.rolle !== "admin") return sende(res, 403, { error: "Nur Betreiber" }), true; const b = await lies(req); return sende(res, 200, engine.notaus(b.an !== false, "admin")), true; }

      // ----- pro Mandant: /m/<tid>/... -----
      const mm = r.match(/^\/m\/([a-z0-9][a-z0-9-]{2,40})(\/.*)$/);
      if (!mm) return sende(res, 404, { error: "Unbekannt" }), true;
      const tid = mm[1], q = mm[2];
      if (!darf(w, tid)) return sende(res, 403, { error: "Kein Zugriff auf diesen Mandanten" }), true;
      const A = w.akteur;
      let x;
      if (q === "/uebersicht" && !POST) {
        const laeufe = engine.laeufeListe(tid);
        return sende(res, 200, { mandant: engine.mandantLaden(tid), agenten: engine.agentenLaden(tid).map((a) => ({ id: a.id, name: a.name, rolle: a.rolle, avatar: a.avatar, autonomie: a.autonomie, statistik: a.statistik, aktiv: laeufe.some((l) => l.agentId === a.id && ["laeuft", "wartet", "wartet_freigabe"].includes(l.status)) })),
          laeufe: laeufe.slice(0, 30), freigaben: engine.freigabenListe(tid).length, kosten: engine.kosten(tid).heute, limits: engine.mandantLaden(tid).limits, office: engine.aktivitaet(tid, 7) }), true;
      }
      if (q === "/agenten" && !POST) return sende(res, 200, { agenten: engine.agentenLaden(tid) }), true;
      if (q === "/agenten" && POST) return sende(res, 200, { agent: engine.agentSpeichern(tid, await lies(req, 2 * 1048576), A) }), true;
      if ((x = q.match(/^\/agenten\/(ag[0-9a-f]{12})\/loeschen$/)) && POST) return sende(res, 200, engine.agentLoeschen(tid, x[1], A)), true;
      if (q === "/laeufe" && !POST) return sende(res, 200, { laeufe: engine.laeufeListe(tid) }), true;
      if (q === "/laeufe" && POST) return sende(res, 200, { lauf: engine.laufStarten(tid, await lies(req), A) }), true;
      if ((x = q.match(/^\/laeufe\/(l[0-9a-f]{12})$/)) && !POST) {
        const l = engine.laufLaden(tid, x[1]);
        const { verlauf, ...rest } = l; if (rest.vorschau) rest.vorschauUrl = "vorschau/" + tid + "/" + l.id + "/" + rest.vorschau.token + "/";
        if (rest.freigabe) rest.freigabe = Object.assign({}, rest.freigabe, { antwort: undefined });
        return sende(res, 200, { lauf: rest }), true;
      }
      if ((x = q.match(/^\/laeufe\/(l[0-9a-f]{12})\/stopp$/)) && POST) return sende(res, 200, engine.stoppe(tid, x[1], A)), true;
      if ((x = q.match(/^\/laeufe\/(l[0-9a-f]{12})\/freigabe$/)) && POST) return sende(res, 200, { lauf: engine.freigabeEntscheiden(tid, x[1], await lies(req), A) }), true;
      if (q === "/stopp-alle" && POST) return sende(res, 200, engine.stoppeAlle(tid, A)), true;
      if (q === "/freigaben" && !POST) return sende(res, 200, { freigaben: engine.freigabenListe(tid) }), true;
      if (q === "/dateien" && !POST) return sende(res, 200, { dateien: engine.dateien(tid, url.searchParams.get("projekt") || "") }), true;
      if (q === "/datei" && !POST) return sende(res, 200, { inhalt: engine.dateiLesen(tid, url.searchParams.get("projekt") || "", url.searchParams.get("pfad") || "") }), true;
      if (q === "/dokumente" && !POST) return sende(res, 200, { dokumente: engine.dokumente(tid) }), true;
      if (q === "/dokument" && !POST) return sende(res, 200, { inhalt: engine.dokumentLesen(tid, url.searchParams.get("pfad") || "") }), true;
      if (q === "/office" && !POST) return sende(res, 200, engine.office(tid)), true;
      if (q === "/office/demo" && POST) return sende(res, 200, engine.demoLaden(tid, A)), true;
      if (q === "/office/eingang" && POST) return sende(res, 200, engine.mailEingang(tid, await lies(req), A)), true;
      if ((x = q.match(/^\/office\/entwurf\/(e[0-9a-f]{12})\/senden$/)) && POST) return sende(res, 200, await engine.entwurfSenden(tid, x[1], A, await lies(req))), true;
      if ((x = q.match(/^\/office\/entwurf\/(e[0-9a-f]{12})\/verwerfen$/)) && POST) return sende(res, 200, engine.entwurfVerwerfen(tid, x[1], A)), true;
      if (q === "/audit" && !POST) return sende(res, 200, { eintraege: engine.auditLesen(tid, Math.min(2000, Number(url.searchParams.get("n")) || 300)), pruefung: engine.auditPruefen(tid) }), true;
      if (q === "/kosten" && !POST) return sende(res, 200, engine.kosten(tid)), true;
      if (q === "/einstellungen" && POST) {
        const b = await lies(req);
        // Limits und Politik setzt nur der Betreiber; der Kunde darf nur den Namen aendern
        if (w.rolle !== "admin") { delete b.limits; delete b.politik; }
        return sende(res, 200, { mandant: engine.mandantEinstellungen(tid, b, A) }), true;
      }
      if (q === "/smtp" && POST) return sende(res, 200, { smtp: engine.smtpSetzen(tid, (await lies(req)).smtp || null, A) }), true;
      if (q === "/geheimnisse" && !POST) return sende(res, 200, { geheimnisse: engine.geheimNamen(tid) }), true;
      if (q === "/geheimnisse" && POST) { const b = await lies(req); engine.geheimSetzen(tid, b.name, b.wert, A); return sende(res, 200, { ok: true }), true; }
      if (q === "/export" && !POST) return sende(res, 200, engine.exportieren(tid)), true;
      if (q === "/token" && POST) { if (w.rolle !== "admin") return sende(res, 403, { error: "Nur Betreiber" }), true; return sende(res, 200, { token: engine.tokenNeu(tid, A) }), true; }
      if (q === "/loeschen" && POST) { if (w.rolle !== "admin") return sende(res, 403, { error: "Nur Betreiber" }), true; return sende(res, 200, engine.mandantLoeschen(tid, (await lies(req)).bestaetigung, A)), true; }
      return sende(res, 404, { error: "Unbekannt" }), true;
    } catch (e) {
      const code = [400, 403, 404, 409, 413, 423].includes(e.code) ? e.code : 400;
      sende(res, code, { error: String(e.message || e).slice(0, 400) });
      return true;
    }
  }
  return { handle, wer };
}

module.exports = { createHttp };
