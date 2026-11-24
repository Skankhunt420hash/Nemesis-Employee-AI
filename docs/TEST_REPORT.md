# Testbericht (tatsächliche Ergebnisse)

**Letzter Lauf: 24.11.2026.** `npm test`: **61 bestanden, 0 fehlgeschlagen, 0 übersprungen** (≈43 s).
Umgebung: Node 22.23.5, Docker 29 (Image `node:22`), echter OpenHands Agent Server 1.64.0 (lokal), echtes OmniRoute 3.8.54 (headless, lokal).
Befehl: `NX_ECHT_OPENHANDS_URL=… NX_ECHT_OPENHANDS_KEY=… NX_ECHT_OMNIROUTE_URL=… NX_ECHT_OMNIROUTE_KEY=… NX_TEST_CA=… npm test`.
Ohne diese Variablen werden die zwei ECHT-Tests übersprungen (und nicht als bestanden gezählt), ohne `dockerd` die zwei Sandbox-Tests.

Kennzeichnung: **E** = gegen einen echten externen Dienst · **P** = echter eigener Prozess/Server/Container · **V** = Vertragstest (lokaler Server bildet die dokumentierten Antworten nach) · **S** = KI-Entscheidungen vorgeskriptet (kein Modell-Schlüssel), Werkzeuge echt

## Ergebnisse pro Datei
| Datei | Tests | Art | Inhalt |
|---|---|---|---|
| `start-stack.test.js` | 3 | P | Server wie vom Installer aufgebaut (nemesis-sync + Patches) startet als eigener Prozess ohne Fehler im Log; Lab, Zentrale, Modelle, Betriebe, Schloss, Integrationen (standardmäßig aus), Systemstatus; kein Absturz ohne Modell-Schlüssel |
| `integrationen.test.js` | 9 | E, V, P | URL-Regel; Verwaltung (Verschlüsselung, Persistenz, An/Aus); OpenHands/OmniRoute/OpenClaw-Vertrag (ok, offen = Fehler, falscher Schlüssel = Warnung, Dienst aus = verständlicher Fehler, Preisklassen); OpenClaw-Konfiguration aus einer Quelle inkl. Migration; Selbstheilung; **ECHT OpenHands** (Version 1.64.0, 33 Werkzeuge, Schutz 401, Anmeldung 200); **ECHT OmniRoute** (Health, 247 Modelle mit Preisen, falscher Schlüssel erkannt) |
| `engine.test.js` | 18 | S, P | Rechte-Matrix; echte Dateien; gesperrte Werkzeuge; Pfad-Ausbruch; Freigaben; Prompt-Injection-Sperre; Delegation (Rechte-Schnittmenge); Stopp < 3 s; Notaus; Audit-Hash-Kette; Tresor; Mandanten-Token; SSRF; SMTP gegen lokalen Server; **Coiffeur-Website in Docker** (Build, Testfehler, Korrektur, Tests grün, Git, Vorschau); Sandbox (kein Netz, Zeitlimit, Befehls-Freigabeliste, Host unsichtbar); Kontingent-Pause und Fortsetzung |
| `modelle.test.js` | 10 | V, P | Kosten-Gate; Rate-Limits; Preis-Verifikation; über den echten Rotator mit gezählten HTTP-Aufrufen: Gratis-Aufruf, Rotation bei 429, **0 OpenAI-Aufrufe** bei erschöpftem Gratis-Kontingent trotz Schlüssel, Bezahlmodell ohne Freigabe 403, mit Freigabe nur bei ausdrücklicher Wahl; Kunden-Chat ohne Claude; Admin-API nur für den Betreiber |
| `openclaw.test.js` | 3 | V | Adapter-Vertrag; Browser nur freigeschaltet, Profil erzwungen, interne URLs gesperrt, Handeln braucht Freigabe; Computer-Auftrag braucht immer Freigabe |
| `zentrale-http.test.js` | 9 | P | Pilotkunden per API; Mandanten-Trennung (403/401); Kunde kann Limits nicht erhöhen; Rechteänderung im Audit; Kontaktformular; Freigabe-Center; Sicherheits-Header; bestehende Routen; Löschung |
| `laufzeit-logik.test.js` | 8 | P | `logic.js` isoliert (Kindprozess): Funktion, 5 Ausbruchsversuche blockiert, Endlosschleife, Syntaxfehler |

## Manuell/automatisiert im Browser (Playwright, Chromium)
- Command Center: Integrationen, Systemstatus, Modelle & Kosten, alle Seiten. Desktop 1440 px und iPhone 13 ohne JavaScript-Fehler, ohne horizontales Scrollen.
- **Gefundener und behobener Fehler:** Am Handy waren Kunden/Modelle/Integrationen/System nicht erreichbar. Neu gibt es das „Mehr“-Menü; mit Tap-Test geprüft.
- Lab (`nemesis-app.html`): **nicht im Browser testbar** in dieser Umgebung (cdnjs gesperrt). Ersatzweise kompilieren alle 4 Skripte fehlerfrei mit Babel.

## Nicht getestet / blockiert
| Punkt | Grund |
|---|---|
| Echter KI-Aufruf über einen Gratis-Anbieter | Kein Anbieter-Schlüssel in der Entwicklungsumgebung. Die Gratis-Modelle von OmniRoute im Werkszustand (`ddgw`) sind keine offizielle API und werden nicht genutzt |
| Echtes OpenClaw-Gateway | Node ≥ 24.16 nötig; Download in dieser Umgebung blockiert |
| OpenHands-Programmierauftrag | Phase 3 (Adapter noch nicht gebaut; braucht zudem ein Modell) |
| Lasttest, Backup-Wiederherstellung auf dem echten Server | späterer Schritt |
