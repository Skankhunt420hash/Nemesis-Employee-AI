# CLAUDE.md: Dauerhafte Entwicklungsregeln für NEMESIS Employee

Ziel: NEMESIS Employee wird eine persönliche digitale KI-Firma (ein Benutzer: der Betreiber). Steuerung vom Smartphone aus.
Grundlage: **NEMESIS (Hauptsystem) + OmniRoute (Modell-Gateway) + OpenHands (Software-Ausführung) + OpenClaw (Agenten/Automationen)**.
Plan und Stand: `docs/MASTERPLAN.md` (Master Development Plan V1.0) und `docs/PROGRESS.md`. **Vor jeder Arbeit `docs/PROGRESS.md` lesen**; dort steht der nächste Schritt.

## Nicht verhandelbar
1. Bestehendes erhalten. Keine neue App, keine zweite Agentenplattform. Neues ist standardmäßig **aus** und abschaltbar.
2. Echte Integrationen, nur dokumentierte APIs (Quellen in `docs/INTEGRATIONS.md`). Keine erfundenen Endpunkte, keine Buttons ohne Funktion, keine simulierten Ergebnisse, die als echt erscheinen.
3. Kosten: Standard ist FREE MODE. Bezahlte Modelle nur nach ausdrücklicher Freigabe (Budget) **und** ausdrücklicher Wahl, nie als automatischer Fallback. Unbekannter Preis = kostenpflichtig. Nur offizielle API-Zugänge (keine Web-Scraping-Anbieter).
4. Keine Zugangsdaten im Code. Geheimnisse liegen im Tresor (`app/agenten/tresor.js`, AES-256-GCM) oder in `.env` auf dem Server.
5. Keine Veröffentlichung, keine produktive Bereitstellung, keine externen Aktionen ohne Freigabe. **`main` = Produktion**: Der Server aktualisiert sich alle 30 Minuten selbst von `main`, ein Merge ist ein Deploy.
6. Code von Agenten läuft nie im Server-Prozess, nur in der Sandbox (Docker) oder in isolierten Diensten. Agenten können sich keine Rechte geben. Rechte werden bei jeder Ausführung serverseitig geprüft (`entscheide()`).
7. Mobil zuerst: Jede Seite muss bei 375 px ohne horizontales Scrollen bedienbar sein.
8. Ehrlich dokumentieren: implementiert / automatisch getestet / mit echtem Dienst getestet / nicht getestet / blockiert / fehlt.

## Projektaufbau (kurz)
| Pfad | Inhalt |
|---|---|
| `app/nemesis-app.js` | Server-Modul (Router `behandle()`, Modell-Rotator `rotiere()`, Betriebe, Telegram, Code-Schmiede, Systemstatus) |
| `app/nemesis-app.html` | Nemesis Lab (React ohne Build) |
| `app/agenten/` | Agenten-Plattform: `engine.js` (Runtime), `http.js` (API `/zentrale/api`), `zentrale.html` (Command Center), `modelle/router.js` (Kosten-Gate), `integrationen/*` (OmniRoute, OpenHands, OpenClaw), `tresor.js` |
| `app/laufzeit/runtime.js` | Laufzeit für generierte Apps (`logic.js` isoliert) |
| `build/` | Installer-Bausteine; `bash build/build.sh` bettet alles in `app/nemesis-app.js` und `install-app.sh` ein |
| `tests/` | `npm test` (node:test, keine Abhängigkeiten) |
| `docs/` | MASTERPLAN, ARCHITECTURE, INTEGRATIONS, PROGRESS, SECURITY, TEST_REPORT, DEPLOYMENT, CHANGELOG, FEATURE_INVENTORY, ZENTRALE |

## Arbeitsablauf
1. `docs/PROGRESS.md` lesen, Stand prüfen (`git log`, `npm test`).
2. Offizielle Doku der betroffenen Integration prüfen (Version, Lizenz, Endpunkte) und in `docs/INTEGRATIONS.md` festhalten.
3. Ändern. Nach Änderungen an `app/agenten/**` oder `app/laufzeit/**`: `python3 build/einbetten.py` (oder `bash build/build.sh`).
4. Testen: `npm test`. Docker-Tests brauchen einen laufenden `dockerd`; Tests gegen echte Dienste über `NX_ECHT_OPENHANDS_URL/KEY`, `NX_ECHT_OMNIROUTE_URL/KEY`; Sandbox-Netz hinter einem Proxy über `NX_TEST_CA=/pfad/ca.crt`.
5. `docs/PROGRESS.md`, `docs/TEST_REPORT.md` und `docs/CHANGELOG.md` aktualisieren, committen, auf den Entwicklungsbranch pushen. Nie direkt auf `main`.
6. Bei Kontextende: Den genauen nächsten Schritt in `docs/PROGRESS.md` unter „Nächster Schritt“ eintragen.

## Sprache und Stil
Oberfläche und Doku auf Deutsch (ohne ß/Umlaute in Code-Bezeichnern). Code ohne Abhängigkeiten (Node ≥ 18). Neue Module als CommonJS mit relativen `require`-Aufrufen innerhalb von `app/agenten/`.
