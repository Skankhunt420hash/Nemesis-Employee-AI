/* =====================================================================
   NEMESIS MODELL-ROUTER · app/agenten/modelle/router.js  (Phase 1)
   Zentrale Provider-Registry + serverseitiges Kosten-Gate + Kontingente.

   Kostenregeln (hart im Code, nicht im Prompt):
   - Standard ist Free-only. Erlaubt sind nur Modelle der Klasse
       "gratis-verifiziert"  (Anbieter-API meldet Preis 0, oder OpenRouter-Kennzeichnung ":free")
       "gratis-bestaetigt"   (Admin hat fuer diesen Anbieter/dieses Konto bestaetigt: API-Kosten 0)
       "gratis-stufe"        (Gratis-Stufe des Anbieters, z.B. Groq/Gemini/Mistral) - standardmaessig AN, abschaltbar
   - Ein vorhandener API-Schluessel ist KEINE Kostenfreigabe.
   - Kostenpflichtige Modelle nur wenn (a) der Admin sie freigegeben hat (Muster + Tagesbudget),
     (b) der Aufruf sie AUSDRUECKLICH verlangt (Agent-/Benutzerwahl) – nie als automatischer Fallback,
     (c) das Tagesbudget nicht erschoepft ist.
   - Fallbacks nur innerhalb erlaubter Modelle. Sind Kontingente erschoepft: Fehlercode KONTINGENT_ERSCHOEPFT
     (Auftraege pausieren), nie Ausweichen auf bezahlt.
   Keine Abhaengigkeiten. Speichert in einer JSON-Datei (chmod 600).
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

/* ---------- Registry: Anbieter ---------- */
// limits: Standardwerte fuer das eigene Kontingent (pro Minute / pro Tag). Herstellerwerte aendern sich und
// haengen vom Konto ab -> im Admin anpassbar. Die Werte hier sind bewusst vorsichtig und NICHT verifiziert.
const ANBIETER = {
  openrouter: { name: "OpenRouter", kosten: "pro-modell", gratisMuster: /:free$/i, preisPruefung: "openrouter", limits: { rpm: 18, rpd: 45 },
    hinweis: "Nur Modelle mit Endung :free (Preis 0 laut Modell-Liste). Ohne gekaufte Credits ca. 50 Anfragen/Tag." },
  groq:       { name: "Groq", kosten: "konto", limits: { rpm: 25, rpd: 900 }, hinweis: "Gratis-Stufe des Kontos. Admin muss bestaetigen, dass das Konto keinen bezahlten Tarif hat." },
  gemini:     { name: "Google Gemini", kosten: "konto", limits: { rpm: 8, rpd: 200 }, hinweis: "Gratis nur, wenn im Google-Cloud-Projekt KEIN Billing aktiv ist. Sonst wird derselbe Schluessel abgerechnet." },
  cohere:     { name: "Cohere", kosten: "konto", limits: { rpm: 15, rpd: 30 }, hinweis: "Trial-Schluessel sind gratis (stark begrenzt), Produktions-Schluessel kosten." },
  mistral:    { name: "Mistral", kosten: "konto", limits: { rpm: 20, rpd: 500 }, hinweis: "Nur mit Gratis-Tarif (Experiment) kostenlos." },
  together:   { name: "Together", kosten: "pro-modell", gratisMuster: /free/i, preisPruefung: "together", limits: { rpm: 10, rpd: 200 }, hinweis: "Nur ausdruecklich kostenlose Modelle." },
  nvidia:     { name: "NVIDIA NIM", kosten: "konto", limits: { rpm: 20, rpd: 500 }, hinweis: "Entwickler-Zugang; Bedingungen des Kontos pruefen." },
  omniroute:  { name: "OmniRoute (Gateway)", kosten: "pro-modell", preisPruefung: "omniroute", limits: { rpm: 60, rpd: 5000 },
    hinweis: "Nur Katalog-Modelle mit Preis 0 von freigegebenen Anbieter-Praefixen (offizielle APIs) oder vom Admin bestaetigte eigene Modelle. 'auto'/Kombis und Modelle ohne Preis sind gesperrt." },
  lokal:      { name: "Lokales Modell (Ollama, LM Studio, OpenAI-kompatibel)", kosten: "lokal", limits: { rpm: 0, rpd: 0 }, hinweis: "Laeuft auf eigener Hardware: keine API-Kosten. Adresse unter Modelle & Kosten." },
  openai:     { name: "OpenAI", kosten: "bezahlt", limits: { rpm: 30, rpd: 1000 }, hinweis: "Immer kostenpflichtig. Nur mit Freigabe und ausdruecklicher Wahl." },
  anthropic:  { name: "Anthropic Claude", kosten: "bezahlt", limits: { rpm: 30, rpd: 1000 }, hinweis: "Immer kostenpflichtig (Kunden-Chat). Nur mit Freigabe." },
};

/* ---------- Registry: Modellfaehigkeiten (Herstellerangaben/Annahmen je Familie) ---------- */
// json: liefert verlaesslich JSON auf Anweisung · tools: natives Function-Calling · vision: Bilder · kontext: Tokens
const FAEHIGKEITEN = [
  [/gpt-oss-120b/i, { json: true, tools: true, vision: false, kontext: 131072 }],
  [/gpt-oss/i, { json: true, tools: true, vision: false, kontext: 131072 }],
  [/llama-3\.3-70b/i, { json: true, tools: true, vision: false, kontext: 131072 }],
  [/qwen.*coder/i, { json: true, tools: true, vision: false, kontext: 262144 }],
  [/qwen/i, { json: true, tools: true, vision: false, kontext: 131072 }],
  [/gemini.*flash/i, { json: true, tools: true, vision: true, kontext: 1000000 }],
  [/nemotron/i, { json: true, tools: true, vision: false, kontext: 131072 }],
  [/deepseek/i, { json: true, tools: true, vision: false, kontext: 128000 }],
  [/command-a|command-r/i, { json: true, tools: true, vision: false, kontext: 128000 }],
  [/mistral|codestral|devstral/i, { json: true, tools: true, vision: false, kontext: 128000 }],
  [/gpt-4o|gpt-4\.1|gpt-5/i, { json: true, tools: true, vision: true, kontext: 128000 }],
  [/claude/i, { json: true, tools: true, vision: true, kontext: 200000 }],
];
function faehigkeiten(id) { for (const [re, f] of FAEHIGKEITEN) if (re.test(id)) return Object.assign({ quelle: "Familie (Annahme)" }, f); return { json: null, tools: null, vision: null, kontext: null, quelle: "unbekannt" }; }

const MODI = { free: "FREE: nur Gratis-Modelle (Standard)", lokal: "LOCAL: nur lokale Modelle", premium: "PREMIUM: zusaetzlich freigegebene Bezahlmodelle (nur bei ausdruecklicher Wahl, mit Budget)", aus: "AUS: kein Modellzugang" };
const KLASSEN = { "lokal": "Lokal (eigene Hardware)", "inoffiziell": "Kein offizieller API-Zugang – gesperrt", "gratis-verifiziert": "Gratis (vom Anbieter bestaetigt)", "gratis-bestaetigt": "Gratis (vom Admin bestaetigt)", "gratis-stufe": "Gratis-Stufe des Anbieters (aktiv, abschaltbar)", "kostenpflichtig": "Kostenpflichtig", "unbekannt": "Unbekannt – gesperrt" };

const tag = () => new Date().toISOString().slice(0, 10);
const kurz = (s, n) => String(s == null ? "" : s).slice(0, n);

function createRouter(opt) {
  opt = opt || {};
  const datei = opt.datei;
  const jetzt = opt.jetzt || (() => Date.now());
  const leer = { modus: "free", omniroute: { praefixe: [], eigene: [] }, lokalUrl: "", leistung: {}, bestaetigt: {}, deaktiviert: {}, freigaben: [], limits: {}, verifiziert: {}, verbrauch: { tag: tag(), anbieter: {}, kostenChf: {} }, protokoll: [] };
  let K = leer;
  try { if (datei) K = Object.assign({}, leer, JSON.parse(fs.readFileSync(datei, "utf8"))); } catch (e) {}
  if (K.modus === "nur-gratis") K.modus = "free";          // Uebernahme aus Version 22.11.
  K.omniroute = Object.assign({ praefixe: [], eigene: [] }, K.omniroute || {});
  // Anfrage-Protokoll: jede Modellanfrage nachvollziehbar (Speicher + JSONL-Datei, rotiert)
  const PROTO_DATEI = opt.protokollDatei || (datei ? datei.replace(/\.json$/, "") + "-anfragen.jsonl" : null);
  const anfragenLog = [];
  const minute = new Map(); // anbieter -> [zeitpunkte]
  const pausen = {};        // anbieter -> bis (ms), z.B. nach 429

  function speichern() {
    if (!datei) return;
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    const tmp = datei + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(K, null, 1), { mode: 0o600 }); fs.renameSync(tmp, datei);
  }
  function protokoll(akteur, aktion, d) { K.protokoll = (K.protokoll || []).concat([{ t: new Date(jetzt()).toISOString(), akteur, aktion, d }]).slice(-300); }
  function verbrauch() { if (K.verbrauch.tag !== tag()) K.verbrauch = { tag: tag(), anbieter: {}, kostenChf: {} }; return K.verbrauch; }
  const limitsVon = (a) => Object.assign({}, (ANBIETER[a] || {}).limits || {}, (K.limits || {})[a] || {});

  /** Kostenklasse eines konkreten Modells */
  function klasse(anbieter, modell) {
    const A = ANBIETER[anbieter]; if (!A) return "unbekannt";
    if (A.kosten === "bezahlt") return "kostenpflichtig";
    if (A.kosten === "lokal") return "lokal";
    if (anbieter === "omniroute") {
      const id = String(modell || "");
      if ((K.omniroute.eigene || []).some((e) => e.id === id)) return "gratis-bestaetigt";
      const v = (K.verifiziert || {}).omniroute;
      if (v && Array.isArray(v.bezahlt) && v.bezahlt.includes(id)) return "kostenpflichtig";
      if (v && Array.isArray(v.gratis) && v.gratis.includes(id)) return (K.omniroute.praefixe || []).includes(id.split("/")[0]) ? "gratis-verifiziert" : "inoffiziell";
      return "unbekannt";   // auto/*-Kombis, Modelle ohne Preis, ungepruefter Katalog
    }
    if (A.kosten === "pro-modell") {
      const v = (K.verifiziert || {})[anbieter];
      if (v && Array.isArray(v.gratis) && v.gratis.includes(modell)) return "gratis-verifiziert";
      if (v && Array.isArray(v.bezahlt) && v.bezahlt.includes(modell)) return "kostenpflichtig";
      if (anbieter === "openrouter" && A.gratisMuster.test(modell)) return "gratis-verifiziert"; // OpenRouter-Kennzeichnung ":free"
      if (A.gratisMuster && A.gratisMuster.test(modell)) return K.bestaetigt[anbieter] ? "gratis-bestaetigt" : "gratis-stufe";
      return "kostenpflichtig";
    }
    // Gratis-Stufe des Anbieters: standardmaessig AN (App muss nach einem Update weiterlaufen). Admin kann abschalten.
    return K.bestaetigt[anbieter] ? "gratis-bestaetigt" : "gratis-stufe";
  }
  function freigabeFuer(anbieter, modell) {
    const n = jetzt();
    return (K.freigaben || []).find((f) => f.anbieter === anbieter && (!f.bis || Date.parse(f.bis) > n) && (f.muster === "*" || modell === f.muster || (f.muster.endsWith("*") && modell.startsWith(f.muster.slice(0, -1)))));
  }

  /** Das Kosten-Gate. ctx: { explizit: bool (Benutzer/Agent hat genau dieses Modell gewaehlt), anforderungen: ["json",...] } */
  function pruefe(anbieter, modell, ctx) {
    ctx = ctx || {};
    const k = klasse(anbieter, modell);
    const f = faehigkeiten(modell);
    for (const a of ctx.anforderungen || []) if (f[a] === false) return { ok: false, code: "FAEHIGKEIT", grund: modell + " kann kein " + a, klasse: k };
    if (K.modus === "aus") return { ok: false, code: "AUS", grund: "Modellzugang vom Admin ausgeschaltet", klasse: k };
    if (K.modus === "lokal" && k !== "lokal") return { ok: false, code: "MODUS", grund: "LOCAL MODE: nur lokale Modelle erlaubt", klasse: k };
    if (k === "lokal") {
      if (!K.lokalUrl) return { ok: false, code: "NICHT_EINGERICHTET", grund: "Kein lokales Modell eingerichtet", klasse: k };
    } else if (k === "kostenpflichtig") {
      if (K.modus !== "premium") return { ok: false, code: "NICHT_FREIGEGEBEN", grund: (ANBIETER[anbieter] || {}).name + " " + modell + " ist kostenpflichtig. Im FREE MODE technisch gesperrt.", klasse: k };
      const fr = freigabeFuer(anbieter, modell);
      if (!fr) return { ok: false, code: "NICHT_FREIGEGEBEN", grund: (ANBIETER[anbieter] || {}).name + " " + modell + " ist kostenpflichtig und nicht freigegeben", klasse: k };
      if (!ctx.explizit) return { ok: false, code: "KEIN_AUTO_BEZAHLT", grund: "Kostenpflichtige Modelle werden nie automatisch als Fallback genutzt", klasse: k };
      const v = verbrauch(); const schon = v.kostenChf[fr.id] || 0;
      if (schon >= fr.budgetChfTag) return { ok: false, code: "BUDGET", grund: "Tagesbudget CHF " + fr.budgetChfTag + " fuer " + fr.muster + " erreicht", klasse: k, wiederAb: morgen() };
    } else if (k === "inoffiziell") {
      return { ok: false, code: "INOFFIZIELL", grund: "OmniRoute-Anbieter '" + String(modell).split("/")[0] + "' ist nicht als offizieller API-Zugang freigegeben", klasse: k };
    } else if (!["gratis-verifiziert", "gratis-bestaetigt", "gratis-stufe"].includes(k)) {
      return { ok: false, code: "NICHT_BESTAETIGT", grund: (ANBIETER[anbieter] || { name: anbieter }).name + " " + modell + ": Preis unbekannt (gilt als kostenpflichtig)", klasse: k };
    } else if ((K.deaktiviert || {})[anbieter]) {
      return { ok: false, code: "DEAKTIVIERT", grund: (ANBIETER[anbieter] || {}).name + " vom Admin abgeschaltet", klasse: k };
    }
    const q = kontingent(anbieter, modell);
    if (!q.ok) return Object.assign({ klasse: k }, q);
    return { ok: true, klasse: k, freigabe: k === "kostenpflichtig" ? freigabeFuer(anbieter, modell).id : null };
  }
  function morgen() { const d = new Date(jetzt()); d.setUTCHours(24, 0, 5, 0); return d.getTime(); }
  // Gateways (OmniRoute) buendeln viele Upstream-Anbieter: ein 429 betrifft dort nur das eine Modell
  const pauseSchluessel = (anbieter, modell) => (anbieter === "omniroute" && modell ? anbieter + ":" + modell : anbieter);
  function kontingent(anbieter, modell) {
    const n = jetzt(), L = limitsVon(anbieter);
    if (modell && pausen[pauseSchluessel(anbieter, modell)] > n) return { ok: false, code: "KONTINGENT", grund: (ANBIETER[anbieter] || {}).name + " " + modell + " pausiert (Anbieter-Limit)", wiederAb: pausen[pauseSchluessel(anbieter, modell)] };
    if (pausen[anbieter] > n) return { ok: false, code: "KONTINGENT", grund: (ANBIETER[anbieter] || {}).name + " pausiert (Anbieter-Limit)", wiederAb: pausen[anbieter] };
    const m = (minute.get(anbieter) || []).filter((t) => n - t < 60000); minute.set(anbieter, m);
    if (L.rpm && m.length >= L.rpm) return { ok: false, code: "KONTINGENT", grund: (ANBIETER[anbieter] || {}).name + ": " + L.rpm + " Anfragen/Minute erreicht", wiederAb: m[0] + 60000 };
    const v = verbrauch(), a = v.anbieter[anbieter] || { anfragen: 0 };
    if (L.rpd && a.anfragen >= L.rpd) return { ok: false, code: "KONTINGENT", grund: (ANBIETER[anbieter] || {}).name + ": Tageskontingent " + L.rpd + " erreicht", wiederAb: morgen() };
    return { ok: true };
  }
  /** vor jedem echten Aufruf (zaehlt fuer das Minutenfenster) */
  function vorAufruf(anbieter) { const m = minute.get(anbieter) || []; m.push(jetzt()); minute.set(anbieter, m); }
  /** nach jedem Aufruf: Zaehler, Kosten, Pausen */
  function nachAufruf(anbieter, modell, r) {
    r = r || {};
    const v = verbrauch(); const a = v.anbieter[anbieter] = v.anbieter[anbieter] || { anfragen: 0, ok: 0, fehler: 0, tokens: 0, letzterFehler: null };
    a.anfragen++; if (r.ok) { a.ok++; a.tokens += r.tokens || 0; } else { a.fehler++; a.letzterFehler = kurz((r.status || "") + " " + (r.fehler || ""), 160); }
    const eintrag = { t: new Date(jetzt()).toISOString(), anbieter, modell, ok: !!r.ok, status: r.status || (r.ok ? 200 : 0), tokens: r.tokens || 0, ms: r.ms || null, quelle: kurz(r.quelle || "", 40), klasse: klasse(anbieter, modell), entscheidung: kurz(r.entscheidung || "", 200), fehler: r.ok ? "" : kurz(r.fehler || "", 160) };
    anfragenLog.push(eintrag); if (anfragenLog.length > 500) anfragenLog.shift();
    if (PROTO_DATEI) { try { fs.appendFileSync(PROTO_DATEI, JSON.stringify(eintrag) + "\n", { mode: 0o600 }); const g = fs.statSync(PROTO_DATEI).size; if (g > 5 * 1048576) fs.renameSync(PROTO_DATEI, PROTO_DATEI + ".1"); } catch (e) {} }
    if (r.status === 429) pausen[pauseSchluessel(anbieter, modell)] = jetzt() + Math.min(Math.max(Number(r.warteSek) || 60, 30), 900) * 1000;
    if (r.ok && klasse(anbieter, modell) === "kostenpflichtig") {
      const fr = freigabeFuer(anbieter, modell);
      if (fr) { const chf = (r.tokens || 0) / 1e6 * (fr.chfPro1MTokens || 10); v.kostenChf[fr.id] = Math.round(((v.kostenChf[fr.id] || 0) + chf) * 1e6) / 1e6; }
    }
    speichernSpaeter();
  }
  let uhr = null;
  function speichernSpaeter() { if (uhr) return; uhr = setTimeout(() => { uhr = null; try { speichern(); } catch (e) {} }, 2000); if (uhr.unref) uhr.unref(); }

  /** naechster Zeitpunkt, an dem irgendein erlaubter Anbieter wieder frei ist (fuer Pausen) */
  function naechsteFreigabe(anbieterListe) {
    let t = Infinity;
    for (const a of anbieterListe) { const q = kontingent(a); if (q.ok) return jetzt(); if (q.wiederAb) t = Math.min(t, q.wiederAb); }
    return t === Infinity ? jetzt() + 15 * 60000 : t;
  }

  /* ---------- Admin ---------- */
  function setze(b, akteur) {
    b = b || {};
    if (b.modus) {
      const m = b.modus === "nur-gratis" ? "free" : b.modus;
      if (!MODI[m]) throw Object.assign(new Error("Unbekannter Modus"), { code: 400 });
      if (m === "premium" && b.bestaetigung !== "PREMIUM") throw Object.assign(new Error("Zur Bestaetigung genau 'PREMIUM' eingeben"), { code: 400 });
      K.modus = m; protokoll(akteur, "modus", m);
    }
    if (b.lokalUrl !== undefined) {
      const u = String(b.lokalUrl || "").trim().replace(/\/+$/, "");
      if (u && !/^https?:\/\/[^/]+(\/v1)?$/.test(u)) throw Object.assign(new Error("Lokale Adresse z.B. http://127.0.0.1:11434/v1"), { code: 400 });
      K.lokalUrl = u; protokoll(akteur, "lokal", { url: u });
    }
    if (b.omniroutePraefix) {
      const x = b.omniroutePraefix, pr = String(x.praefix || "").trim();
      if (!/^[a-z0-9][a-z0-9_.-]{0,60}$/i.test(pr)) throw Object.assign(new Error("Praefix ungueltig"), { code: 400 });
      const L = new Set(K.omniroute.praefixe || []);
      if (x.erlauben) { if (String(x.notiz || "").trim().length < 10) throw Object.assign(new Error("Bitte notieren, warum dieser Anbieter ein offizieller API-Zugang ist (mind. 10 Zeichen)"), { code: 400 }); L.add(pr); } else L.delete(pr);
      K.omniroute.praefixe = [...L]; protokoll(akteur, x.erlauben ? "omniroute.praefix.erlaubt" : "omniroute.praefix.entfernt", { praefix: pr, notiz: kurz(x.notiz, 200) });
    }
    if (b.omnirouteEigen) {
      const x = b.omnirouteEigen, id = String(x.id || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:\/-]{1,150}$/.test(id) || /^auto\//i.test(id)) throw Object.assign(new Error("Modell-ID ungueltig (auto/* ist nicht erlaubt)"), { code: 400 });
      K.omniroute.eigene = (K.omniroute.eigene || []).filter((e) => e.id !== id);
      if (!x.entfernen) {
        if (String(x.notiz || "").trim().length < 10) throw Object.assign(new Error("Bitte notieren, warum dieses Modell nichts kostet (z.B. eigener Server), mind. 10 Zeichen"), { code: 400 });
        K.omniroute.eigene.push({ id, notiz: kurz(x.notiz, 200), von: akteur, am: new Date(jetzt()).toISOString() });
      }
      protokoll(akteur, x.entfernen ? "omniroute.eigen.entfernt" : "omniroute.eigen", { id });
    }
    if (b.bestaetigen && (!ANBIETER[b.bestaetigen.anbieter] || ANBIETER[b.bestaetigen.anbieter].kosten === "bezahlt"))
      throw Object.assign(new Error((b.bestaetigen.anbieter || "?") + " ist kostenpflichtig und kann nicht als gratis bestaetigt werden (dafuer gibt es Freigaben mit Budget)"), { code: 400 });
    if (b.bestaetigen) {
      const x = b.bestaetigen;
      if (x.zuruecknehmen) { delete K.bestaetigt[x.anbieter]; protokoll(akteur, "bestaetigung.zurueck", { anbieter: x.anbieter }); }
      else {
        if (String(x.notiz || "").trim().length < 10) throw Object.assign(new Error("Bitte notieren, wie die Gratisnutzung geprueft wurde (mind. 10 Zeichen)"), { code: 400 });
        K.bestaetigt[x.anbieter] = { von: akteur, am: new Date(jetzt()).toISOString(), notiz: kurz(x.notiz, 300) };
        protokoll(akteur, "bestaetigung", { anbieter: x.anbieter, notiz: kurz(x.notiz, 300) });
      }
    }
    if (b.schalten && ANBIETER[b.schalten.anbieter]) {
      K.deaktiviert = K.deaktiviert || {};
      if (b.schalten.aus) K.deaktiviert[b.schalten.anbieter] = { von: akteur, am: new Date(jetzt()).toISOString() }; else delete K.deaktiviert[b.schalten.anbieter];
      protokoll(akteur, b.schalten.aus ? "anbieter.aus" : "anbieter.an", { anbieter: b.schalten.anbieter });
    }
    if (b.freigabe) {
      const f = b.freigabe;
      if (f.entfernen) { K.freigaben = K.freigaben.filter((x) => x.id !== f.entfernen); protokoll(akteur, "freigabe.entfernt", { id: f.entfernen }); }
      else {
        if (!ANBIETER[f.anbieter]) throw Object.assign(new Error("Unbekannter Anbieter"), { code: 400 });
        const muster = String(f.muster || "").trim(); if (!/^[A-Za-z0-9._:\/*-]{1,80}$/.test(muster)) throw Object.assign(new Error("Modell-Muster ungueltig (z.B. gpt-4o-mini oder gpt-5*)"), { code: 400 });
        const budget = Number(f.budgetChfTag); if (!(budget > 0 && budget <= 1000)) throw Object.assign(new Error("Tagesbudget in CHF angeben (0 < x <= 1000)"), { code: 400 });
        const preis = Number(f.chfPro1MTokens); if (!(preis > 0)) throw Object.assign(new Error("Preis pro 1 Mio. Tokens (CHF, Schaetzung fuer das Budget) angeben"), { code: 400 });
        if (f.bestaetigung !== "Ich erlaube Kosten") throw Object.assign(new Error("Zur Bestaetigung genau 'Ich erlaube Kosten' eingeben"), { code: 400 });
        const fr = { id: "f" + Math.random().toString(36).slice(2, 10), anbieter: f.anbieter, muster, budgetChfTag: budget, chfPro1MTokens: preis, bis: f.bis || null, von: akteur, am: new Date(jetzt()).toISOString() };
        K.freigaben.push(fr); protokoll(akteur, "freigabe", fr);
      }
    }
    if (b.limits && typeof b.limits === "object") for (const [a, l] of Object.entries(b.limits)) if (ANBIETER[a]) {
      K.limits[a] = {}; for (const x of ["rpm", "rpd"]) if (l && l[x] != null && isFinite(+l[x])) K.limits[a][x] = Math.max(0, Math.floor(+l[x]));
      protokoll(akteur, "limits", { anbieter: a, limits: K.limits[a] });
    }
    speichern();
    return status();
  }

  /** OmniRoute-Katalog uebernehmen (Liste von {id, pricing}) */
  function verifiziereListe(anbieter, liste) {
    const gratis = [], bezahlt = [];
    for (const m of liste || []) {
      const p = m.pricing; if (!p || !m.id) continue;
      const w = [p.prompt, p.completion].filter((x) => x !== undefined && x !== null).map(Number);
      if (!w.length || w.some((x) => !isFinite(x))) continue;
      (w.every((x) => x === 0) ? gratis : bezahlt).push(String(m.id));
    }
    K.verifiziert[anbieter] = { zeit: new Date(jetzt()).toISOString(), gratis, bezahlt };
    protokoll("system", "verifiziert", { anbieter, gratis: gratis.length, bezahlt: bezahlt.length });
    speichern();
    const praefixe = {};
    for (const id of gratis) { const pr = id.split("/")[0]; praefixe[pr] = (praefixe[pr] || 0) + 1; }
    return { anbieter, gratis: gratis.length, bezahlt: bezahlt.length, praefixe };
  }
  /** Erlaubte OmniRoute-Modelle (fuer die Rotation) */
  function omnirouteModelle() {
    const v = (K.verifiziert || {}).omniroute || { gratis: [] };
    const ids = (K.omniroute.eigene || []).map((e) => e.id).concat((v.gratis || []).filter((id) => (K.omniroute.praefixe || []).includes(id.split("/")[0])));
    return [...new Set(ids)];
  }
  function leistungSetzen(anbieter, modell, r) { K.leistung[anbieter + ":" + modell] = Object.assign({ zeit: new Date(jetzt()).toISOString() }, r); speichern(); }
  /** Preis-Pruefung ueber die Modell-Liste des Anbieters (nur wo die API Preise liefert) */
  async function verifiziere(anbieter, holeJSON) {
    const A = ANBIETER[anbieter]; if (!A || !A.preisPruefung) throw Object.assign(new Error("Fuer " + anbieter + " liefert die API keine Preise – bitte manuell bestaetigen"), { code: 400 });
    const url = anbieter === "openrouter" ? "https://openrouter.ai/api/v1/models" : "https://api.together.xyz/v1/models";
    const d = await holeJSON(url, anbieter);
    if (!d) throw Object.assign(new Error("Modell-Liste nicht abrufbar"), { code: 502 });
    const roh = Array.isArray(d) ? d : d.data || [];
    const gratis = [], bezahlt = [];
    for (const m of roh) {
      const p = m.pricing || {}; const id = String(m.id || "");
      const werte = anbieter === "openrouter" ? [p.prompt, p.completion, p.request] : [p.input, p.output];
      const zahlen = werte.filter((x) => x !== undefined && x !== null).map(Number);
      if (!id || !zahlen.length || zahlen.some((x) => !isFinite(x))) continue;
      (zahlen.every((x) => x === 0) ? gratis : bezahlt).push(id);
    }
    K.verifiziert[anbieter] = { zeit: new Date(jetzt()).toISOString(), gratis, bezahlt };
    protokoll("system", "verifiziert", { anbieter, gratis: gratis.length, bezahlt: bezahlt.length });
    speichern();
    return { anbieter, gratis: gratis.length, bezahlt: bezahlt.length, beispiele: gratis.slice(0, 8) };
  }

  function status(schluesselDa) {
    const v = verbrauch();
    return {
      modus: K.modus, modi: MODI, klassen: KLASSEN, lokalUrl: K.lokalUrl || "", leistung: K.leistung || {},
      omniroute: { praefixe: K.omniroute.praefixe || [], eigene: K.omniroute.eigene || [], katalog: (K.verifiziert.omniroute ? { zeit: K.verifiziert.omniroute.zeit, gratis: K.verifiziert.omniroute.gratis.length, bezahlt: K.verifiziert.omniroute.bezahlt.length, praefixe: K.verifiziert.omniroute.gratis.reduce((o, id) => { const pr = id.split("/")[0]; o[pr] = (o[pr] || 0) + 1; return o; }, {}) } : null) },
      anbieter: Object.entries(ANBIETER).map(([id, A]) => ({
        id, name: A.name, kosten: A.kosten, hinweis: A.hinweis, schluessel: schluesselDa ? !!schluesselDa(id) : null,
        bestaetigt: K.bestaetigt[id] || null, aus: !!(K.deaktiviert || {})[id], limits: limitsVon(id), verbrauch: v.anbieter[id] || { anfragen: 0, ok: 0, fehler: 0, tokens: 0 },
        pauseBis: pausen[id] > jetzt() ? new Date(pausen[id]).toISOString() : null,
        verifiziert: K.verifiziert[id] ? { zeit: K.verifiziert[id].zeit, gratis: K.verifiziert[id].gratis.length } : null,
        preisPruefung: !!A.preisPruefung,
      })),
      freigaben: (K.freigaben || []).map((f) => Object.assign({}, f, { heuteChf: v.kostenChf[f.id] || 0 })),
      protokoll: (K.protokoll || []).slice(-50).reverse(),
    };
  }

  return { pruefe, klasse, kontingent, vorAufruf, nachAufruf, naechsteFreigabe, setze, verifiziere, verifiziereListe, status, faehigkeiten, omnirouteModelle, leistungSetzen,
    anfragen: (n) => anfragenLog.slice(-(n || 100)).reverse(), get modus() { return K.modus; }, get lokalUrl() { return K.lokalUrl || ""; },
    erlaubtAnbieter: (a, ctx) => { const k = ANBIETER[a]; if (!k) return false; if (k.kosten === "bezahlt") return K.modus === "premium" && !!(K.freigaben || []).find((f) => f.anbieter === a) && !!(ctx && ctx.explizit); return !(K.deaktiviert || {})[a]; },
    get konfig() { return JSON.parse(JSON.stringify(K)); } };
}

module.exports = { createRouter, ANBIETER, KLASSEN, MODI, faehigkeiten };
