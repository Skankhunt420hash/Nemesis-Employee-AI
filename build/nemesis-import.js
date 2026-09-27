/* ===========================================================
   NEMESIS IMPORT  ·  nemesis-import.js
   Website eines Betriebs einlesen.

   Holt die Startseite, findet die relevanten Unterseiten
   (Speisekarte, Kontakt, Zeiten, Reservation ...) und gibt
   sauberen Text pro Seite zurueck — mit Quell-URL, damit
   spaeter nachvollziehbar ist, woher jede Angabe stammt.

   Diese Datei extrahiert KEINE Fakten. Sie liefert nur Rohtext.
   Das Strukturieren macht das Sprachmodell in der App, weil es
   dort geprueft und bestaetigt werden kann.

   Wird von nemesis-sync.js eingebunden.
   =========================================================== */

const MAX_SEITEN = 9;          // Startseite + 8 Unterseiten
const ZEICHEN_PRO_SEITE = 14000;
const ZEICHEN_GESAMT = 90000;
const TIMEOUT_MS = 12000;

/* ---------- Was ist relevant, was ist Muell ---------- */

const WICHTIG = [
  // Speisekarte
  [/\b(speisekarte|menu|menue|karte|carte|gerichte|food|essen|kuche|kueche|cucina)\b/i, 100],
  [/\b(mittagsmenu|lunch|tagesmenu|business-lunch)\b/i, 90],
  [/\b(getranke|getraenke|drinks|wein|weinkarte|bar|boissons)\b/i, 85],
  // Betrieb
  [/\b(kontakt|contact|contatti|anfahrt|standort|location|adresse)\b/i, 95],
  [/\b(offnungszeiten|oeffnungszeiten|opening|hours|zeiten|horaires|orari)\b/i, 95],
  [/\b(reservation|reservieren|reservierung|tisch|booking|buchen|prenota)\b/i, 90],
  [/\b(lieferung|delivery|takeaway|take-away|bestellen|order)\b/i, 80],
  // Zusatz
  [/\b(faq|haufige|haeufige|fragen|questions)\b/i, 85],
  [/\b(uber-uns|ueber-uns|about|wir|team|philosophie|geschichte|histoire)\b/i, 60],
  [/\b(events|anlasse|anlaesse|aktuelles|news|angebote|aktionen)\b/i, 55],
  [/\b(impressum|legal)\b/i, 40],   // enthaelt oft die genaue Firmenadresse
];

const MUELL = /\b(cookie|datenschutz|privacy|agb|terms|conditions|login|logout|admin|wp-admin|wp-json|cart|warenkorb|checkout|kasse|feed|rss|sitemap|search|suche|tag|category|author|password|register|newsletter-abmelden|unsubscribe)\b/i;

const MUELL_ENDUNG = /\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|avi|doc|docx|xls|xlsx|ics|css|js|json|xml)(\?|$)/i;

/* ---------- Schutz: kein Zugriff auf interne Adressen ----------
   Ohne das koennte jemand ueber diesen Endpunkt dein eigenes
   Netzwerk abfragen. */

function istPrivateAdresse(host) {
  const h = String(host || "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "[::1]" || h === "::1") return true;
  if (h === "metadata.google.internal") return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;              // Cloud-Metadaten
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  return false;
}

function pruefeUrl(roh) {
  let u;
  try { u = new URL(String(roh).trim()); } catch (e) { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (istPrivateAdresse(u.hostname)) return null;
  return u;
}

/* ---------- HTML zu Text ---------- */

function titelAus(html) {
  const m = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  return m ? entity(m[1]).replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  szlig: "ß", eacute: "é", Eacute: "É", egrave: "è", Egrave: "È",
  agrave: "à", Agrave: "À", ccedil: "ç", Ccedil: "Ç", ugrave: "ù",
  ocirc: "ô", ecirc: "ê", icirc: "î", agr: "à",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…",
  euro: "€", deg: "°", middot: "·", bull: "•", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', times: "×", frac12: "½",
};

function entity(s) {
  return String(s)
    // Benannte Entities: Gross- und Kleinschreibung sind bedeutungstragend,
    // deshalb KEIN /i-Flag. Sonst wird aus &Ouml; ein kleines ö.
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,10});/g, (ganz, name) => {
      if (Object.prototype.hasOwnProperty.call(ENTITIES, name)) return ENTITIES[name];
      const klein = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, klein) ? ENTITIES[klein] : ganz;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return " "; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch (e) { return " "; }
    });
}

function textAus(html) {
  return entity(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Blockelemente zu Zeilenumbruechen, damit Preise und Zeilen nicht verkleben
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|br)[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- Links finden und bewerten ---------- */

function linksAus(html, basis) {
  const gefunden = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || /^(#|javascript:|mailto:|tel:|data:)/i.test(href)) continue;

    let u;
    try { u = new URL(href, basis); } catch (e) { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.hostname !== new URL(basis).hostname) continue;      // nur eigene Domain
    if (MUELL_ENDUNG.test(u.pathname)) continue;

    u.hash = "";
    const clean = u.toString().replace(/\/$/, "");
    if (clean === String(basis).replace(/\/$/, "")) continue;   // Startseite selbst

    const linktext = textAus(m[2]).slice(0, 80);
    const pruefText = decodeURIComponent(u.pathname) + " " + linktext;

    if (MUELL.test(pruefText)) continue;

    let punkte = 0;
    for (const [muster, p] of WICHTIG) {
      if (muster.test(pruefText.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
        punkte = Math.max(punkte, p);
      }
    }
    if (!punkte) continue;

    // Tiefe Pfade sind meist Detailseiten, leicht abwerten
    const tiefe = u.pathname.split("/").filter(Boolean).length;
    punkte -= Math.max(0, tiefe - 2) * 8;

    const alt = gefunden.get(clean);
    if (!alt || alt.punkte < punkte) gefunden.set(clean, { url: clean, punkte, linktext });
  }
  return [...gefunden.values()].sort((a, b) => b.punkte - a.punkte);
}

/* ---------- Eine Seite holen ---------- */

async function holeSeite(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NemesisBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-CH,de;q=0.9,fr;q=0.7,en;q=0.5",
      },
    });
    const typ = r.headers.get("content-type") || "";
    if (!r.ok) return { url, fehler: "HTTP " + r.status };
    if (typ && !/text\/html|application\/xhtml/i.test(typ)) {
      return { url, fehler: "Kein HTML (" + typ.split(";")[0] + ")" };
    }
    // Ziel-URL nach Weiterleitung erneut pruefen
    const ziel = pruefeUrl(r.url || url);
    if (!ziel) return { url, fehler: "Weiterleitung auf unerlaubte Adresse" };

    const html = await r.text();
    return { url: r.url || url, html, titel: titelAus(html), text: textAus(html) };
  } catch (e) {
    return { url, fehler: e.name === "AbortError" ? "Zeitueberschreitung" : e.message };
  } finally { clearTimeout(t); }
}

/* ---------- Der ganze Durchlauf ---------- */

async function importiere(startUrl) {
  const start = pruefeUrl(startUrl);
  if (!start) throw new Error("Ungueltige oder nicht erlaubte Adresse");

  const heim = await holeSeite(start.toString());
  if (heim.fehler) throw new Error("Startseite nicht erreichbar: " + heim.fehler);

  const kandidaten = linksAus(heim.html, heim.url).slice(0, MAX_SEITEN - 1);

  // Unterseiten parallel, aber in kleinen Wellen damit die Zielseite nicht ueberrannt wird
  const unterseiten = [];
  for (let i = 0; i < kandidaten.length; i += 3) {
    const welle = kandidaten.slice(i, i + 3);
    const ergebnisse = await Promise.all(welle.map((k) => holeSeite(k.url)));
    ergebnisse.forEach((e, j) => {
      e.punkte = welle[j].punkte;
      e.linktext = welle[j].linktext;
      unterseiten.push(e);
    });
  }

  const alle = [heim, ...unterseiten];
  const seiten = [];
  const uebersprungen = [];
  let gesamt = 0;

  for (const s of alle) {
    if (s.fehler) { uebersprungen.push({ url: s.url, grund: s.fehler }); continue; }
    if (!s.text || s.text.length < 60) {
      uebersprungen.push({ url: s.url, grund: "kaum Text" });
      continue;
    }
    let text = s.text.slice(0, ZEICHEN_PRO_SEITE);
    if (gesamt + text.length > ZEICHEN_GESAMT) text = text.slice(0, Math.max(0, ZEICHEN_GESAMT - gesamt));
    if (!text) break;
    gesamt += text.length;
    seiten.push({ url: s.url, titel: s.titel || "", text });
  }

  return {
    ok: true,
    start: heim.url,
    gefundeneLinks: kandidaten.length,
    seiten,
    uebersprungen,
    zeichen: gesamt,
  };
}

/* ---------- Router-Anschluss ---------- */

async function behandle(req, res, url, CORS) {
  if (url.pathname !== "/import") return false;
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(), true; }

  const ziel = url.searchParams.get("url");
  const kopf = { "Content-Type": "application/json", ...CORS };

  if (!ziel) {
    res.writeHead(400, kopf);
    return res.end(JSON.stringify({ error: "Parameter url fehlt" })), true;
  }
  try {
    const daten = await importiere(ziel);
    res.writeHead(200, kopf);
    res.end(JSON.stringify(daten));
  } catch (e) {
    res.writeHead(502, kopf);
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}

module.exports = { behandle, importiere, pruefeUrl, textAus, linksAus, istPrivateAdresse };
