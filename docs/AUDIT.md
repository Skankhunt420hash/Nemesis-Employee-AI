# Audit: NEMESIS Employee (Stand 21.11.2026, Branch `ccr-45791acd-iy1q1j`)

## 1. Bestandsaufnahme

| Bereich | Wo | Befund |
|---|---|---|
| Frontend „Nemesis Lab“ | `app/nemesis-app.html` (≈500 KB, eine Datei) | React wird im Browser übersetzt (Babel). Rund 45 „Werkbank“-Werkzeuge (`TOOLS`, ab etwa Zeile 2904). Die meisten sind **ein einzelner Prompt**, keine Aktion. Die Agenten werden im Browser verwaltet und per Sync gesichert. |
| Server-Modul | `app/nemesis-app.js` (≈320 KB) | Ein einziger Router `behandle()`: Modell-Rotator `/llm`, Betriebe `/b/`, Apps `/x/`, Telegram, Hintergrund-Aufträge `/bg/`, Welt, Stripe. Keine Abhängigkeiten, Daten als JSON in `sync-data/`. |
| Authentifizierung | `mitSchluessel()`, `vonAussen()` in `app/nemesis-app.js` | **Ein** geheimer Pfad `/k/<NEMESIS_ZUGANG>/` für den Betreiber. Es gibt keine Benutzer, keine Rollen und keine Mandanten. Betriebe haben ein eigenes Besitzer-Token. |
| Modellanbieter | `ANBIETER`, `rotiere()` | Zuerst Gratis-Anbieter (Groq, Gemini, OpenRouter …), OpenAI nur als Rettung. Die Schlüssel liegen in `.env` (chmod 600). Funktioniert, das wird weiterverwendet. |
| „Missionen“ | `bgMission()` in `app/nemesis-app.js` | Plan aus 3–8 Schritten, **jeder Schritt ist ein einzelner Textaufruf ohne Werkzeuge**. Das Zeitbudget ist nur ein Abbruchzeitpunkt. **Das ist kein Agent.** |
| Echte Werkzeuge | Telegram-Zentrale (`mission_starten`, Web lesen mit SSRF-Schutz …) | Das waren die einzigen Agenten mit echten Aktionen. Die Rechte waren grob (lesend/schreibend), die Sperre nach Web-Zugriff war schon vorhanden (gute Idee, in der Engine übernommen). |
| Code-Schmiede | `app/laufzeit/runtime.js`, `aSelbsttest()` | Erzeugt echte Apps (REST, Login, JSON-DB) mit echtem Probelauf vor dem Livegang. Guter Baustein. |
| Automationen | Hintergrund-Aufträge `/bg/`, Telegram-Zeitpläne, Welt-Autopilot, Abo-Uhr | Laufen serverseitig weiter und überstehen einen Neustart. |
| Bezahlung | Stripe-Checkout und Webhook (Signatur geprüft) | In Ordnung. |
| Tests | – | **Vorher keine.** |
| Deployment | `install-app.sh` (eingebettet), `update()` | **Selbst-Update alle 30 Minuten von `main` auf GitHub**, ohne Signatur. |

## 2. Kritische Befunde

| # | Schwere | Befund | Status |
|---|---|---|---|
| K1 | **kritisch** | **Ausbruch aus der Sandbox in `logic.js`**: Von der KI erzeugter App-Code lief per `vm` im Server-Prozess. `Object.constructor("return process")()` lieferte den echten Prozess, also Zugriff auf Dateien, `.env`-Schlüssel und Befehle. Nachgewiesen mit einem Test. | **behoben**: eigener Kindprozess mit Node-Permission-Model, kein Host-Objekt im Kontext, `eval` aus, Schreibzugriffe werden als geprüfte Operationen angewendet (`app/laufzeit/runtime.js`, `tests/laufzeit-logik.test.js`). |
| K2 | **kritisch** | **Selbst-Update von `main` ohne Signatur**: Jeder Push oder Merge auf `main` (oder ein übernommenes GitHub-Konto) läuft innerhalb von 30 Minuten als Code auf dem Server. | **offen, bewusst nicht geändert** (das würde das Produktionsverhalten ändern). Empfehlung: `NEMESIS_AUTO_UPDATE=0` setzen und nur von Hand aktualisieren, oder signierte Releases einführen. **Wichtig: Diesen Branch erst nach Prüfung mergen, denn ein Merge ist ein Deploy.** |
| K3 | hoch | Das Admin-Geheimnis steht im URL-Pfad (Browser-Verlauf, Proxy-Logs). | offen. In der Zentrale ist die Vorschau absichtlich **nicht** unter `/k/<Zugang>/` erreichbar, damit von Agenten gebauter Code das Geheimnis nicht aus der eigenen URL lesen kann. Empfehlung: Login mit Sitzungscookie für den Betreiber. |
| K4 | hoch | Es gab keine Mandantentrennung. | **für die Zentrale gelöst**: eigener Ordner und eigenes Token pro Kunde, jede API-Anfrage wird serverseitig geprüft (getestet). |
| K5 | mittel | Die Engine hielt bei jedem Werkzeugaufruf einen Zeitgeber offen (bis zu 6 Stunden), und ein KI-Aufruf war nicht abbrechbar, wenn der Anbieter das Signal ignoriert. | **behoben** (im Test gefunden). |
| K6 | mittel | Die Docker-Sandbox läuft mit dem Image `node:22` (Debian, 1,6 GB). Image-Updates kommen von Docker Hub. | Hinweis: Image-Version pinnen (Digest). |

## 3. Umsetzungsplan und Stand

| Prio | Inhalt | Stand |
|---|---|---|
| P0 | Audit, kritische Fehler | K1 behoben, K5 behoben, K2/K3 dokumentiert |
| P1 | Echter ausführbarer Agent mit sicheren Werkzeugen | **fertig**: `app/agenten/engine.js` |
| P2 | NEMESIS Office, Ende-zu-Ende-Demo, Pilotkunde ohne Code | **fertig** (ohne IMAP-Abruf, siehe offene Punkte) |
| P3 | OpenClaw-Integration | **Adapter fertig**, Vertragstests grün, ein Test gegen ein echtes Gateway ist noch offen |
| P4 | Computer Use, Software Builder | Builder fertig (Docker-Sandbox, Build/Test/Korrektur, Git, Vorschau). Computer Use nur über einen OpenClaw-Agenten, standardmäßig aus. GitHub-Push fehlt. |
| P5 | Teams, Avatar Studio, SaaS-Verwaltung | Delegation mit Schnittmenge der Rechte, Avatar Studio und Kundenverwaltung fertig. Benutzerkonten pro Kunde (statt Token) fehlen. |
