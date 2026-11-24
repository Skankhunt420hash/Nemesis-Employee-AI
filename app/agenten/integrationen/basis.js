/* Gemeinsame Hilfen fuer externe Integrationen (OmniRoute, OpenHands, OpenClaw).
   - HTTP mit Zeitlimit und Abbruch
   - URL-Regel: http nur fuer lokale/private Adressen (eigener Rechner, Heimnetz, VPN), sonst https
   - verstaendliche deutsche Fehlermeldungen mit Loesungshinweis */
"use strict";
const net = require("net");

function privaterHost(h) {
  h = String(h || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h === "host.docker.internal") return true;
  if (net.isIPv4(h)) { const [a, b] = h.split(".").map(Number); return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127); }
  if (net.isIPv6(h)) return h === "::1" || h.startsWith("fd") || h.startsWith("fc");
  return false;
}
function pruefeUrl(url) {
  let u; try { u = new URL(String(url || "").trim()); } catch (e) { throw Object.assign(new Error("Adresse ungueltig. Beispiel: http://127.0.0.1:20128"), { code: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error("Nur http:// oder https:// erlaubt"), { code: 400 });
  if (u.username || u.password) throw Object.assign(new Error("Keine Zugangsdaten in der Adresse. Bitte das Feld 'Schluessel' verwenden."), { code: 400 });
  if (u.protocol === "http:" && !privaterHost(u.hostname)) throw Object.assign(new Error("Unverschluesseltes http nur fuer lokale/private Adressen. Fuer Server im Internet https:// verwenden."), { code: 400 });
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) throw Object.assign(new Error("Nur die Basis-Adresse angeben (ohne Pfad), z.B. http://127.0.0.1:8000"), { code: 400 });
  return u.origin;
}
function fehlerText(e, dienst) {
  const ursache = e && e.cause ? (e.cause.errors && e.cause.errors[0]) || e.cause : null;
  const c = (ursache && ursache.code) || (e && e.code) || "";
  const m = String((e && e.message) || e) + (ursache && ursache.message ? " (" + ursache.message + ")" : "");
  if (e && e.name === "AbortError" || /Zeitlimit|aborted/i.test(m)) return { meldung: dienst + " antwortet nicht (Zeitlimit).", hilfe: "Laeuft der Dienst? Ist der Rechner erreichbar? Bei einem Worker-PC: Firewall/VPN pruefen." };
  if (c === "ECONNREFUSED") return { meldung: dienst + " ist unter dieser Adresse nicht erreichbar (Verbindung abgelehnt).", hilfe: "Dienst starten oder Port pruefen." };
  if (c === "ENOTFOUND" || c === "EAI_AGAIN") return { meldung: "Rechnername nicht gefunden.", hilfe: "Adresse pruefen (Tippfehler?)." };
  if (/certificate|SSL|TLS/i.test(m + c)) return { meldung: "Verschluesselung (TLS) fehlgeschlagen.", hilfe: "Zertifikat des Servers pruefen oder lokale Adresse mit http:// verwenden." };
  return { meldung: dienst + ": " + m.slice(0, 200), hilfe: "" };
}
async function anfrage(basis, methode, pfad, o) {
  o = o || {};
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), o.ms || 10000);
  if (o.signal) o.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const h = Object.assign({}, o.body !== undefined ? { "Content-Type": "application/json" } : {}, o.headers || {});
    const r = await fetch(basis + pfad, { method: methode, headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: ctrl.signal, redirect: "manual" });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
    return { status: r.status, j, text: text.slice(0, 4000), kopf: (n) => r.headers.get(n) };
  } finally { clearTimeout(t); }
}
const HTTP_TEXT = { 401: "Schluessel fehlt oder falsch", 403: "Zugriff verweigert", 404: "Endpunkt nicht gefunden (falsche Version oder falscher Dienst?)", 429: "Zu viele Anfragen", 500: "Interner Fehler des Dienstes", 502: "Dienst hinter Proxy nicht erreichbar", 503: "Dienst noch nicht bereit" };

module.exports = { pruefeUrl, privaterHost, anfrage, fehlerText, HTTP_TEXT };
