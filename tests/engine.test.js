// Agent-Engine: echte Werkzeuge, echte Sandbox, echte Rechtepruefung.
// Das Modell ist hier ein Skript (kein API-Schluessel im Test) – alles andere laeuft wirklich.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net"), cp = require("child_process");
const { createEngine, entscheide, webLesen, smtpSenden, W } = require("../app/agenten/engine.js");

const DOCKER = (() => { try { return cp.spawnSync("docker", ["info"], { timeout: 8000 }).status === 0; } catch (e) { return false; } })();
const BILD = process.env.NX_TEST_BILD || "node:22";

/** Skript-Modell: pro Agent-Name eine Liste von Antworten. Erste Antwort = Plan. */
function skriptLlm(skripte, protokoll) {
  const pos = {};
  return async ({ system, messages, signal }) => {
    const name = (system.match(/^Du bist ([^,]+),/) || [])[1];
    pos[name] = pos[name] || 0;
    const liste = skripte[name] || [];
    let r = liste[pos[name]++];
    if (protokoll) protokoll.push({ name, letzte: messages[messages.length - 1].content, alle: messages });
    if (typeof r === "function") r = await r(messages, signal);
    if (r === undefined) r = { fertig: true, ergebnis: "Skript zu Ende" };
    return { text: typeof r === "string" ? r : JSON.stringify(r), modell: "skript" };
  };
}
const plan = (...p) => ({ analyse: "Test", plan: p.length ? p : ["Arbeiten"] });
const tu = (werkzeug, args) => ({ gedanke: "Test: " + werkzeug, aktion: { werkzeug, args: args || {} } });

function neueEngine(skripte, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-engine-"));
  const protokoll = [];
  const e = createEngine(Object.assign({ dir, llm: skriptLlm(skripte, protokoll), sandbox: { modus: DOCKER ? "docker" : "aus", bild: BILD, caDatei: process.env.NX_TEST_CA || "" } }, extra || {}));
  return { e, dir, protokoll };
}
async function warteBis(e, tid, id, stati, ms) {
  const bis = Date.now() + (ms || 60000);
  for (;;) {
    const l = e.laufLaden(tid, id);
    if (stati.includes(l.status)) return l;
    if (Date.now() > bis) throw new Error("Timeout, Status " + l.status + "\n" + JSON.stringify(l.log.slice(-5), null, 1));
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("Rechte-Entscheid: Matrix", () => {
  const w = (art, x) => Object.assign({ art }, x || {});
  assert.strictEqual(entscheide({ werkzeug: w("schreiben"), modus: "aus", autonomie: 3 }).erlaubt, false);
  assert.strictEqual(entscheide({ werkzeug: w("schreiben"), modus: "lesen", autonomie: 3 }).erlaubt, false);
  assert.strictEqual(entscheide({ werkzeug: w("lesen"), modus: "lesen", autonomie: 0 }).erlaubt, true);
  assert.deepStrictEqual(entscheide({ werkzeug: w("schreiben"), modus: "autonom", autonomie: 2 }), { erlaubt: true, freigabe: false, grund: "" });
  assert.strictEqual(entscheide({ werkzeug: w("schreiben"), modus: "autonom", autonomie: 0 }).freigabe, true, "Autonomie 0 -> Freigabe");
  assert.strictEqual(entscheide({ werkzeug: w("schreiben"), modus: "bestaetigung", autonomie: 3 }).freigabe, true);
  assert.strictEqual(entscheide({ werkzeug: w("destruktiv"), modus: "begrenzt", autonomie: 3 }).freigabe, true);
  assert.strictEqual(entscheide({ werkzeug: w("extern"), modus: "autonom", autonomie: 3, politik: {} }).freigabe, true, "extern immer Freigabe ohne Politik");
  assert.strictEqual(entscheide({ werkzeug: w("extern"), modus: "autonom", autonomie: 3, politik: { externAutonom: true } }).freigabe, false);
  assert.strictEqual(entscheide({ werkzeug: w("extern", { immerFreigabe: true }), modus: "autonom", autonomie: 3, politik: { externAutonom: true } }).freigabe, true);
  assert.strictEqual(entscheide({ werkzeug: w("destruktiv"), modus: "autonom", autonomie: 3, fremdGelesen: true }).freigabe, true, "Prompt-Injection-Sperre");
  assert.strictEqual(entscheide({ werkzeug: w("schreiben"), modus: "unsinn", autonomie: 3 }).erlaubt, false, "unbekannter Modus = aus");
});

test("1+3: Agent erzeugt wirklich Dateien; gesperrtes Werkzeug laesst sich nicht ausfuehren", async () => {
  const { e } = neueEngine({ Tim: [plan("Datei schreiben"), tu("datei_schreiben", { pfad: "notiz/hallo.txt", inhalt: "Hallo Welt" }), tu("datei_loeschen", { pfad: "notiz/hallo.txt" }), tu("rechte_setzen", { datei_loeschen: "autonom" }), tu("datei_lesen", { pfad: "notiz/hallo.txt" }), { fertig: true, ergebnis: "Datei liegt in notiz/hallo.txt" }] });
  const { mandant } = e.mandantNeu({ name: "Test AG", demo: true, demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Tim", autonomie: 2, werkzeuge: { datei_schreiben: "autonom", datei_lesen: "autonom", datei_loeschen: "aus" } }, "test");
  const l0 = e.laufStarten(mandant.id, { agent: "Tim", ziel: "Schreibe eine Notiz", stunden: 0.1 }, "test");
  const l = await warteBis(e, mandant.id, l0.id, ["fertig", "fehler"]);
  assert.strictEqual(l.status, "fertig", l.fehler);
  const f = path.join(e._mandantDir(mandant.id), "projekte", l.projekt, "notiz/hallo.txt");
  assert.strictEqual(fs.readFileSync(f, "utf8"), "Hallo Welt", "Datei existiert wirklich");
  const gesperrt = l.log.filter((x) => x.typ === "gesperrt").map((x) => x.werkzeug);
  assert.deepStrictEqual(gesperrt, ["datei_loeschen", "rechte_setzen"]);
  assert.ok(fs.existsSync(f), "Loeschen wurde nicht ausgefuehrt");
  assert.strictEqual(e.agentHolen(mandant.id, "Tim").werkzeuge.datei_loeschen, "aus", "Agent konnte sich keine Rechte geben");
  const au = e.auditLesen(mandant.id).map((x) => x.aktion);
  assert.ok(au.includes("werkzeug.gesperrt") && au.includes("werkzeug.ausgefuehrt") && au.includes("lauf.fertig"));
});

test("Nur-Lesen: Schreibversuch wird abgelehnt", async () => {
  const { e } = neueEngine({ Lea: [plan(), tu("datei_schreiben", { pfad: "x.txt", inhalt: "x" }), { fertig: true, ergebnis: "nichts" }] });
  const { mandant } = e.mandantNeu({ name: "Lese GmbH", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Lea", autonomie: 3, werkzeuge: { datei_schreiben: "lesen" } }, "test");
  const l = await warteBis(e, mandant.id, e.laufStarten(mandant.id, { agent: "Lea", ziel: "Versuch zu schreiben", stunden: 0.1 }, "t").id, ["fertig", "fehler"]);
  assert.ok(l.log.some((x) => x.typ === "gesperrt" && /Nur Leserecht/.test(x.x)));
  assert.ok(!fs.existsSync(path.join(e._mandantDir(mandant.id), "projekte", l.projekt, "x.txt")));
});

test("Pfade: kein Ausbruch aus dem Arbeitsordner, kein .git", async () => {
  const { e } = neueEngine({ Pia: [plan(), tu("datei_schreiben", { pfad: "../../mandant.json", inhalt: "{}" }), tu("datei_schreiben", { pfad: ".git/config", inhalt: "[core]\nfsmonitor=evil" }), tu("datei_lesen", { pfad: "/etc/passwd" }), { fertig: true, ergebnis: "-" }] });
  const { mandant } = e.mandantNeu({ name: "Pfad AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Pia", autonomie: 3, werkzeuge: { datei_schreiben: "autonom", datei_lesen: "autonom" } }, "t");
  const l = await warteBis(e, mandant.id, e.laufStarten(mandant.id, { agent: "Pia", ziel: "Ausbruch versuchen", stunden: 0.1 }, "t").id, ["fertig", "fehler"]);
  const fehler = l.log.filter((x) => x.typ === "werkzeugfehler").map((x) => x.x);
  assert.strictEqual(fehler.length, 3, JSON.stringify(fehler));
  assert.ok(e.mandantLaden(mandant.id).name === "Pfad AG", "mandant.json unversehrt");
  const dl = l.log.find((x) => x.typ === "werkzeugfehler" && /passwd|Pfad|ausserhalb/.test(x.x));
  assert.ok(dl);
});

test("Freigabe: Senden wartet auf Menschen, Ablehnen verhindert Senden, Freigeben sendet (Demo-Ausgang)", async () => {
  const { e } = neueEngine({
    Nora: [plan("Posteingang", "Entwurf", "Senden"),
      (msgs) => tu("posteingang", {}),
      (msgs) => { const id = /"id":"(m[0-9a-f]+)"/.exec(msgs[msgs.length - 2].content)[1]; return tu("antwort_entwerfen", { mailId: id, text: "Guten Tag Frau Keller, gerne melden wir uns morgen telefonisch. Freundliche Gruesse" }); },
      (msgs) => { const id = /"entwurf":"(e[0-9a-f]+)"/.exec(msgs[msgs.length - 2].content)[1]; return tu("antwort_senden", { entwurfId: id }); },
      (msgs) => { assert.match(msgs[msgs.length - 2].content, /gesendet/); return { fertig: true, ergebnis: "Antwort gesendet" }; }],
  });
  const { mandant } = e.mandantNeu({ name: "Office Demo AG", demo: true, vorlage: "office" });
  assert.strictEqual(e.office(mandant.id).posteingang.length, 5, "Demo-Daten geladen");
  const l0 = e.laufStarten(mandant.id, { agent: "Nora", ziel: "Beantworte die erste Anfrage", stunden: 0.2 }, "t");
  let l = await warteBis(e, mandant.id, l0.id, ["wartet_freigabe", "fehler", "fertig"]);
  assert.strictEqual(l.status, "wartet_freigabe", l.fehler);
  assert.strictEqual(l.freigabe.werkzeug, "antwort_senden");
  assert.strictEqual(e.office(mandant.id).ausgang.length, 0, "noch nichts gesendet");
  const fr = e.freigabenListe(mandant.id);
  assert.ok(fr.some((x) => x.werkzeug === "antwort_senden"));
  e.freigabeEntscheiden(mandant.id, l0.id, { entscheid: "ja", id: l.freigabe.id }, "mandant");
  l = await warteBis(e, mandant.id, l0.id, ["fertig", "fehler"]);
  assert.strictEqual(l.status, "fertig", l.fehler);
  const aus = e.office(mandant.id).ausgang;
  assert.strictEqual(aus.length, 1); assert.strictEqual(aus[0].kanal, "demo"); assert.strictEqual(aus[0].an, "sandra.keller@beispiel-mail.ch");
});

test("Prompt-Injection: nach Lesen von Fremdinhalt braucht Loeschen eine Freigabe, auch autonom", async () => {
  const { e } = neueEngine({ Ivo: [plan(), tu("datei_schreiben", { pfad: "a.txt", inhalt: "a" }), tu("posteingang", {}), tu("datei_loeschen", { pfad: "a.txt" })] });
  const { mandant } = e.mandantNeu({ name: "Inject AG", demo: true });
  e.agentSpeichern(mandant.id, { name: "Ivo", autonomie: 3, werkzeuge: { datei_schreiben: "autonom", datei_loeschen: "autonom", posteingang: "autonom" } }, "t");
  const l0 = e.laufStarten(mandant.id, { agent: "Ivo", ziel: "Arbeite den Posteingang ab", stunden: 0.1 }, "t");
  const l = await warteBis(e, mandant.id, l0.id, ["wartet_freigabe", "fertig", "fehler"]);
  assert.strictEqual(l.status, "wartet_freigabe");
  assert.match(l.freigabe.grund, /Prompt-Injection/);
  e.freigabeEntscheiden(mandant.id, l0.id, { entscheid: "nein", notiz: "nein" }, "mandant");
  const l2 = await warteBis(e, mandant.id, l0.id, ["fertig", "fehler"]);
  assert.ok(fs.existsSync(path.join(e._mandantDir(mandant.id), "projekte", l2.projekt, "a.txt")), "Datei nicht geloescht");
});

test("Delegation: Unteragent bekommt nie mehr Rechte als der Auftraggeber", async () => {
  const { e } = neueEngine({
    Leo: [plan("Delegieren"), tu("delegieren", { agent: "Kai", auftrag: "Schreibe datei.txt" }), (m) => ({ fertig: true, ergebnis: m[m.length - 2].content })],
    Kai: [plan(), tu("datei_schreiben", { pfad: "datei.txt", inhalt: "x" }), { fertig: true, ergebnis: "versucht" }],
  });
  const { mandant } = e.mandantNeu({ name: "Team AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Kai", autonomie: 3, werkzeuge: { datei_schreiben: "autonom" } }, "t");
  e.agentSpeichern(mandant.id, { name: "Leo", autonomie: 3, werkzeuge: { delegieren: "autonom", datei_schreiben: "lesen" } }, "t");
  const l = await warteBis(e, mandant.id, e.laufStarten(mandant.id, { agent: "Leo", ziel: "Lass Kai eine Datei schreiben", stunden: 0.2 }, "t").id, ["fertig", "fehler"]);
  assert.strictEqual(l.status, "fertig", l.fehler);
  const kind = e.laeufeListe(mandant.id).find((x) => x.eltern === l.id);
  const kl = e.laufLaden(mandant.id, kind.id);
  assert.strictEqual(kl.rechte.datei_schreiben, "lesen", "Schnittmenge");
  assert.ok(kl.log.some((x) => x.typ === "gesperrt" && x.werkzeug === "datei_schreiben"));
  assert.ok(!fs.existsSync(path.join(e._mandantDir(mandant.id), "projekte", l.projekt, "datei.txt")));
});

test("7: Laufender Agent laesst sich sofort stoppen (auch waehrend Modell-Aufruf)", async () => {
  const { e } = neueEngine({ Max: [plan(), (m, signal) => new Promise((ok) => { const t = setTimeout(() => ok(tu("datei_lesen", { pfad: "x" })), 30000); signal.addEventListener("abort", () => { clearTimeout(t); ok("{}"); }); })] });
  const { mandant } = e.mandantNeu({ name: "Stopp AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Max", autonomie: 2, werkzeuge: { datei_lesen: "autonom" } }, "t");
  const l0 = e.laufStarten(mandant.id, { agent: "Max", ziel: "Lange arbeiten", stunden: 1 }, "t");
  await warteBis(e, mandant.id, l0.id, ["laeuft"]);
  await new Promise((r) => setTimeout(r, 200));
  const t0 = Date.now();
  e.stoppe(mandant.id, l0.id, "test");
  const l = await warteBis(e, mandant.id, l0.id, ["gestoppt"], 5000);
  for (let i = 0; i < 40 && e.aktive.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(Date.now() - t0 < 3000, "Stopp dauerte " + (Date.now() - t0) + " ms");
  assert.strictEqual(e.aktive.length, 0, "Slot freigegeben");
  assert.strictEqual(l.status, "gestoppt");
});

test("NOTAUS: stoppt alles und blockiert neue Laeufe", async () => {
  const { e } = neueEngine({ Ole: [plan(), () => new Promise(() => {})] });
  const { mandant } = e.mandantNeu({ name: "Notaus AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Ole", werkzeuge: {} }, "t");
  const l0 = e.laufStarten(mandant.id, { agent: "Ole", ziel: "Haengt fest", stunden: 1 }, "t");
  await warteBis(e, mandant.id, l0.id, ["laeuft"]);
  e.notaus(true, "admin");
  await warteBis(e, mandant.id, l0.id, ["gestoppt"], 3000);
  assert.throws(() => e.laufStarten(mandant.id, { agent: "Ole", ziel: "Neuer Versuch", stunden: 1 }, "t"), /NOTAUS/);
  e.notaus(false, "admin");
});

test("Audit-Log: Hash-Kette, Manipulation wird erkannt", () => {
  const { e } = neueEngine({});
  const { mandant } = e.mandantNeu({ name: "Audit AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Ada", werkzeuge: { datei_lesen: "autonom" } }, "admin");
  assert.deepStrictEqual(e.auditPruefen(mandant.id).ok, true);
  const f = path.join(e._mandantDir(mandant.id), "audit.jsonl");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"admin"', '"jemand"'));
  assert.strictEqual(e.auditPruefen(mandant.id).ok, false);
});

test("Zugangsdaten liegen verschluesselt auf der Platte", () => {
  const { e } = neueEngine({});
  const { mandant } = e.mandantNeu({ name: "Tresor AG", demoDaten: false });
  e.geheimSetzen(mandant.id, "smtp_passwort", "SuperGeheim123!", "admin");
  const roh = fs.readFileSync(path.join(e._mandantDir(mandant.id), "tresor.json"), "utf8");
  assert.ok(!roh.includes("SuperGeheim"));
  assert.strictEqual(e._geheim(mandant.id, "smtp_passwort"), "SuperGeheim123!");
  assert.deepStrictEqual(e.geheimNamen(mandant.id).map((x) => x.name), ["smtp_passwort"]);
});

test("Mandanten-Token: nur der eigene Mandant wird erkannt", () => {
  const { e } = neueEngine({});
  const a = e.mandantNeu({ name: "Alpha AG", demoDaten: false }), b = e.mandantNeu({ name: "Beta AG", demoDaten: false });
  assert.strictEqual(e.mandantPerToken(a.token), a.mandant.id);
  assert.strictEqual(e.mandantPerToken(b.token), b.mandant.id);
  assert.strictEqual(e.mandantPerToken("nxm_falschfalschfalschfalschfalsch"), null);
  const neu = e.tokenNeu(a.mandant.id, "admin");
  assert.strictEqual(e.mandantPerToken(a.token), null, "altes Token ungueltig");
  assert.strictEqual(e.mandantPerToken(neu), a.mandant.id);
});

test("Web lesen: interne Adressen gesperrt (SSRF)", async () => {
  for (const u of ["http://127.0.0.1/", "http://localhost:80/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/", "file:///etc/passwd", "http://example.com:8080/"]) {
    await assert.rejects(webLesen(u), /gesperrt|erlaubt|nicht gefunden/i, u);
  }
});

test("SMTP: echte Uebertragung an lokalen SMTP-Server", async () => {
  const empfangen = [];
  const srv = net.createServer((s) => {
    s.write("220 test\r\n"); let buf = "", data = false, body = "";
    s.on("data", (c) => {
      buf += c;
      let i; while ((i = buf.indexOf("\r\n")) >= 0) {
        const z = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (z === ".") { data = false; empfangen.push(body); s.write("250 ok\r\n"); } else body += z + "\n"; continue; }
        if (/^EHLO/.test(z)) s.write("250-test\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/.test(z)) s.write(Buffer.from(z.slice(11), "base64").toString().includes("geheim") ? "235 ok\r\n" : "535 nein\r\n");
        else if (/^MAIL|^RCPT/.test(z)) s.write("250 ok\r\n");
        else if (z === "DATA") { data = true; s.write("354 go\r\n"); }
        else if (z === "QUIT") { s.write("221 bye\r\n"); s.end(); }
      }
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await smtpSenden({ host: "127.0.0.1", port: srv.address().port, starttls: false, benutzer: "u", passwort: "geheim", von: "office@test.ch" }, { an: "kunde@test.ch", betreff: "Grüezi", text: "Hallo Welt" });
    assert.ok(r.messageId);
    assert.strictEqual(empfangen.length, 1);
    assert.match(empfangen[0], /To: kunde@test.ch/);
    assert.match(Buffer.from(empfangen[0].split("\n\n")[1].replace(/\s/g, ""), "base64").toString(), /Hallo Welt/);
    await assert.rejects(smtpSenden({ host: "127.0.0.1", port: srv.address().port, starttls: false, benutzer: "u", passwort: "falsch", von: "o@t.ch" }, { an: "k@t.ch", betreff: "x", text: "y" }), /535/);
  } finally { srv.close(); }
});

test("4+5+Beispiel Coiffeur: Developer baut, testet, findet Fehler, korrigiert, stellt Vorschau bereit (Docker-Sandbox)", { skip: !DOCKER && "Docker nicht verfuegbar" }, async () => {
  const pkg = JSON.stringify({ name: "coiffeur-salon", version: "1.0.0", private: true, scripts: { build: "node build.js", test: "node test.js" } }, null, 1);
  const build = "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});const t=fs.readFileSync('src/index.html','utf8');fs.writeFileSync('dist/index.html',t.replace('{{JAHR}}',String(new Date().getFullYear())));fs.copyFileSync('src/style.css','dist/style.css');console.log('build ok');";
  const testJs = "const fs=require('fs');const h=fs.readFileSync('dist/index.html','utf8');const f=[];if(!/Salon Schnittpunkt/.test(h))f.push('Name fehlt');if(!/Termin buchen/.test(h))f.push('Termin-Button fehlt');if(/\\{\\{/.test(h))f.push('Platzhalter nicht ersetzt');if(!fs.existsSync('dist/style.css'))f.push('CSS fehlt');if(f.length){console.error('FEHLER: '+f.join(', '));process.exit(1)}console.log('alle Tests bestanden');";
  const html = "<!doctype html><html lang=de><head><meta charset=utf-8><title>Salon Schnittpunkt</title><link rel=stylesheet href=style.css></head><body><h1>Salon Schnittpunkt</h1><p>Ihr Coiffeur in Zuerich</p><footer>© {{JAHR}}</footer></body></html>";
  const css = "body{font-family:system-ui;background:#111;color:#eee}";
  const { e } = neueEngine({
    Kai: [plan("Anforderungen", "Projekt anlegen", "Bauen", "Testen", "Korrigieren", "Vorschau"),
      tu("datei_schreiben", { pfad: "package.json", inhalt: pkg }),
      tu("datei_schreiben", { pfad: "build.js", inhalt: build }),
      tu("datei_schreiben", { pfad: "test.js", inhalt: testJs }),
      tu("datei_schreiben", { pfad: "src/index.html", inhalt: html }),
      tu("datei_schreiben", { pfad: "src/style.css", inhalt: css }),
      tu("pakete_installieren", {}),
      tu("build_ausfuehren", {}),
      (m) => { assert.match(m[m.length - 2].content, /build ok/); return tu("tests_ausfuehren", {}); },
      (m) => { assert.match(m[m.length - 2].content, /Termin-Button fehlt/, "echter Testfehler kommt zurueck"); return tu("datei_ersetzen", { pfad: "src/index.html", alt: "<p>Ihr Coiffeur in Zuerich</p>", neu: "<p>Ihr Coiffeur in Zuerich</p><a href=\"#termin\">Termin buchen</a>" }); },
      tu("build_ausfuehren", {}),
      tu("tests_ausfuehren", {}),
      (m) => { assert.match(m[m.length - 2].content, /alle Tests bestanden/); return tu("version_speichern", { nachricht: "Coiffeur-Website v1" }); },
      tu("vorschau_bereitstellen", { ordner: "dist" }),
      { fertig: true, ergebnis: "Website gebaut, getestet, Vorschau bereit." }],
  });
  const { mandant } = e.mandantNeu({ name: "Salon Schnittpunkt", demoDaten: false, vorlage: "developer" });
  const l0 = e.laufStarten(mandant.id, { agent: "Kai", ziel: "Erstelle eine Website fuer einen Coiffeursalon", stunden: 0.5 }, "t");
  const l = await warteBis(e, mandant.id, l0.id, ["fertig", "fehler", "wartet_freigabe"], 600000);
  assert.strictEqual(l.status, "fertig", l.fehler + "\n" + JSON.stringify(l.log.slice(-6), null, 1));
  const pr = l.log.find((x) => x.typ === "pruefung");
  assert.ok(pr && pr.ok, "Abschlusspruefung (echter Build + Tests) bestanden");
  const fehlerLauf = l.log.find((x) => x.typ === "werkzeugfehler" && x.werkzeug === "tests_ausfuehren");
  assert.ok(fehlerLauf, "erster Testlauf schlug wirklich fehl");
  const d = path.join(e._mandantDir(mandant.id), "projekte", l.projekt);
  assert.match(fs.readFileSync(path.join(d, "dist/index.html"), "utf8"), /Termin buchen/);
  assert.ok(fs.existsSync(path.join(d, ".git")), "Git-Repo angelegt");
  assert.ok(l.vorschau && l.vorschau.token);
  assert.ok(e.vorschauDatei(mandant.id, l.id, l.vorschau.token, "index.html"));
  assert.strictEqual(e.vorschauDatei(mandant.id, l.id, "falsch", "index.html"), null);
});

test("Sandbox: kein Netz bei Befehlen, Zeitlimit, nicht erlaubte Befehle", { skip: !DOCKER && "Docker nicht verfuegbar" }, async () => {
  const { e } = neueEngine({});
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nx-sb-"));
  fs.writeFileSync(path.join(d, "netz.js"), "require('https').get('https://registry.npmjs.org',r=>{console.log('NETZ '+r.statusCode)}).on('error',e=>{console.log('KEIN NETZ '+e.code)})");
  const r = await e.sandbox.fuehreAus({ ordner: d, argv: ["node", "netz.js"], netz: false, timeoutMs: 30000 });
  assert.match(r.stdout, /KEIN NETZ/);
  fs.writeFileSync(path.join(d, "lang.js"), "setTimeout(()=>{},60000)");
  const t0 = Date.now();
  const r2 = await e.sandbox.fuehreAus({ ordner: d, argv: ["node", "lang.js"], netz: false, timeoutMs: 3000 });
  assert.ok(Date.now() - t0 < 15000); assert.match(r2.stderr, /Zeitlimit/);
  await assert.rejects(e.sandbox.fuehreAus({ ordner: d, argv: ["sh", "-c", "id"] }), /nicht erlaubt/);
  await assert.rejects(e.sandbox.fuehreAus({ ordner: d, argv: ["curl", "x"] }), /nicht erlaubt/);
  fs.writeFileSync(path.join(d, "host.js"), "const fs=require('fs');console.log(fs.existsSync('/home/user')?'HOST SICHTBAR':'ISOLIERT')");
  const r3 = await e.sandbox.fuehreAus({ ordner: d, argv: ["node", "host.js"], netz: false, timeoutMs: 30000 });
  assert.match(r3.stdout, /ISOLIERT/);
});

test("Werkzeugkatalog vollstaendig klassifiziert", () => {
  for (const w of Object.values(W)) { assert.ok(["lesen", "schreiben", "ausfuehren", "destruktiv", "extern"].includes(w.art), w.name); assert.ok(w.timeoutMs > 0); assert.ok(typeof w.run === "function"); }
});

test("Phase 1: Gratis-Kontingent erschoepft -> Lauf pausiert (kein Fehler, kein Bezahl-Fallback) und laeuft automatisch weiter", async () => {
  let n = 0, aufrufe = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-kont-"));
  const e = createEngine({ dir, sandbox: { modus: "aus" }, kontingentPruefMs: 50, kontingentMinPauseMs: 0, llm: async () => {
    aufrufe++;
    if (n++ === 1) throw Object.assign(new Error("Gratis-Kontingente erschoepft"), { code: "KONTINGENT", grund: "KONTINGENT_ERSCHOEPFT", wiederAb: Date.now() + 300 });
    return { text: JSON.stringify(n === 1 ? plan("a") : n === 3 ? tu("datei_schreiben", { pfad: "x.txt", inhalt: "ok" }) : { fertig: true, ergebnis: "fertig nach Pause" }) };
  } });
  const { mandant } = e.mandantNeu({ name: "Kontingent AG", demoDaten: false });
  e.agentSpeichern(mandant.id, { name: "Kim", autonomie: 3, werkzeuge: { datei_schreiben: "autonom" } }, "t");
  const l0 = e.laufStarten(mandant.id, { agent: "Kim", ziel: "Datei schreiben trotz Limit", stunden: 0.1 }, "t");
  const p = await warteBis(e, mandant.id, l0.id, ["wartet_kontingent", "fehler", "fertig"], 5000);
  assert.strictEqual(p.status, "wartet_kontingent", p.fehler);
  assert.ok(p.log.some((x) => x.typ === "pause"));
  assert.strictEqual(e.aktive.length, 0, "pausierter Lauf belegt keinen Slot");
  const l = await warteBis(e, mandant.id, l0.id, ["fertig", "fehler"], 5000);
  assert.strictEqual(l.status, "fertig", l.fehler);
  assert.strictEqual(aufrufe, 4, "keine wiederholten Versuche waehrend der Pause");
  assert.ok(e.auditLesen(mandant.id).some((a) => a.aktion === "lauf.pausiert_kontingent"));
});
