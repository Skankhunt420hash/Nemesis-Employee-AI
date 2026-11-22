/* =====================================================================
   NEMESIS MODELL-ROUTER · app/agenten/modelle/router.js  (Phase 1)
   Zentrale Provider-Registry + serverseitiges Kosten-Gate + Kontingente.

   Kostenregeln (hart im Code, nicht im Prompt):
   - Standard ist Free-only. Erlaubt sind nur Modelle der Klasse
       "gratis-verifiziert"  (Anbieter-API meldet Preis 0, oder OpenRouter-Kennzeichnung ":free")
       "gratis-bestaetigt"   (Admin hat fuer diesen Anbieter/dieses Konto bestaetigt: API-Kosten 0)
     "gratis-annahme" (alte statische Annahme) ist NICHT erlaubt, bis der Admin bestaetigt.
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

const KLASSEN = { "gratis-verifiziert": "Gratis (vom Anbieter bestaetigt)", "gratis-bestaetigt": "Gratis (vom Admin bestaetigt)", "gratis-annahme": "Gratis nur angenommen – gesperrt bis bestaetigt", "kostenpflichtig": "Kostenpflichtig", "unbekannt": "Unbekannt – gesperrt" };

const tag = () => new Date().toISOString().slice(0, 10);
const kurz = (s, n) => String(s == null ? "" : s).slice(0, n);

function createRouter(opt) {
  opt = opt || {};
  const datei = opt.datei;
  const jetzt = opt.jetzt || (() => Date.now());
  const leer = { modus: "nur-gratis", bestaetigt: {}, freigaben: [], limits: {}, verifiziert: {}, verbrauch: { tag: tag(), anbieter: {}, kostenChf: {} }, protokoll: [] };
  let K = leer;
  try { if (datei) K = Object.assign({}, leer, JSON.parse(fs.readFileSync(datei, "utf8"))); } catch (e) {}
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
    if (A.kosten === "pro-modell") {
      const v = (K.verifiziert || {})[anbieter];
      if (v && Array.isArray(v.gratis) && v.gratis.includes(modell)) return "gratis-verifiziert";
      if (v && Array.isArray(v.bezahlt) && v.bezahlt.includes(modell)) return "kostenpflichtig";
      if (anbieter === "openrouter" && A.gratisMuster.test(modell)) return "gratis-verifiziert"; // OpenRouter-Kennzeichnung ":free"
      if (A.gratisMuster && A.gratisMuster.test(modell)) return K.bestaetigt[anbieter] ? "gratis-bestaetigt" : "gratis-annahme";
      return "kostenpflichtig";
    }
    return K.bestaetigt[anbieter] ? "gratis-bestaetigt" : "gratis-annahme";
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
    if (k === "kostenpflichtig") {
      const fr = freigabeFuer(anbieter, modell);
      if (!fr) return { ok: false, code: "NICHT_FREIGEGEBEN", grund: (ANBIETER[anbieter] || {}).name + " " + modell + " ist kostenpflichtig und nicht freigegeben", klasse: k };
      if (!ctx.explizit) return { ok: false, code: "KEIN_AUTO_BEZAHLT", grund: "Kostenpflichtige Modelle werden nie automatisch als Fallback genutzt", klasse: k };
      const v = verbrauch(); const schon = v.kostenChf[fr.id] || 0;
      if (schon >= fr.budgetChfTag) return { ok: false, code: "BUDGET", grund: "Tagesbudget CHF " + fr.budgetChfTag + " fuer " + fr.muster + " erreicht", klasse: k, wiederAb: morgen() };
    } else if (k !== "gratis-verifiziert" && k !== "gratis-bestaetigt") {
      return { ok: false, code: "NICHT_BESTAETIGT", grund: (ANBIETER[anbieter] || { name: anbieter }).name + ": Gratisnutzung nicht bestaetigt", klasse: k };
    } else if (K.modus === "aus") {
      return { ok: false, code: "AUS", grund: "Modellzugang vom Admin ausgeschaltet", klasse: k };
    }
    const q = kontingent(anbieter);
    if (!q.ok) return Object.assign({ klasse: k }, q);
    return { ok: true, klasse: k, freigabe: k === "kostenpflichtig" ? freigabeFuer(anbieter, modell).id : null };
  }
  function morgen() { const d = new Date(jetzt()); d.setUTCHours(24, 0, 5, 0); return d.getTime(); }
  function kontingent(anbieter) {
    const n = jetzt(), L = limitsVon(anbieter);
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
    if (r.status === 429) pausen[anbieter] = jetzt() + Math.min(Math.max(Number(r.warteSek) || 60, 30), 900) * 1000;
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
    if (b.modus && ["nur-gratis", "aus"].includes(b.modus)) { K.modus = b.modus; protokoll(akteur, "modus", b.modus); }
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
      modus: K.modus, klassen: KLASSEN,
      anbieter: Object.entries(ANBIETER).map(([id, A]) => ({
        id, name: A.name, kosten: A.kosten, hinweis: A.hinweis, schluessel: schluesselDa ? !!schluesselDa(id) : null,
        bestaetigt: K.bestaetigt[id] || null, limits: limitsVon(id), verbrauch: v.anbieter[id] || { anfragen: 0, ok: 0, fehler: 0, tokens: 0 },
        pauseBis: pausen[id] > jetzt() ? new Date(pausen[id]).toISOString() : null,
        verifiziert: K.verifiziert[id] ? { zeit: K.verifiziert[id].zeit, gratis: K.verifiziert[id].gratis.length } : null,
        preisPruefung: !!A.preisPruefung,
      })),
      freigaben: (K.freigaben || []).map((f) => Object.assign({}, f, { heuteChf: v.kostenChf[f.id] || 0 })),
      protokoll: (K.protokoll || []).slice(-50).reverse(),
    };
  }

  return { pruefe, klasse, kontingent, vorAufruf, nachAufruf, naechsteFreigabe, setze, verifiziere, status, faehigkeiten,
    erlaubtAnbieter: (a, ctx) => { const k = ANBIETER[a]; if (!k) return false; if (k.kosten === "bezahlt") return !!(K.freigaben || []).find((f) => f.anbieter === a) && !!(ctx && ctx.explizit); return k.kosten === "pro-modell" ? true : !!K.bestaetigt[a]; },
    get konfig() { return JSON.parse(JSON.stringify(K)); } };
}

module.exports = { createRouter, ANBIETER, KLASSEN, faehigkeiten };
