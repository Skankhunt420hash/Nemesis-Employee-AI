# Feature-Inventar NEMESIS Employee (Stand 22.11.2026, ergänzt 24.11.2026)

> Aktueller Gesamtstand: [PROGRESS.md](PROGRESS.md). Neu seit 24.11.: Integrationsverwaltung (OmniRoute ✅ echt getestet, OpenHands ✅ echt getestet, OpenClaw ⛔ nur Vertrag), Systemstatus, Selbstheilung.

Branch `ccr-45791acd-iy1q1j` (Entwicklungsbranch; `main` ist unverändert und entspricht der Produktion).

**Status:** ✅ funktionierend · 🟡 teilweise implementiert · ❌ fehlerhaft · 📋 nur geplant
**Nachweis:** **T** = automatischer Test im Repo (`npm test`), **C** = nur Code-Review (kein Test, Funktion nicht selbst ausgeführt), **–** = nicht vorhanden

## 1. Agenten

| Funktion | Ort | Status | Nachweis | Bemerkung |
|---|---|---|---|---|
| Lab-Agenten (Generator, Persona, Skills, XP/Level, Abstammung) | `app/nemesis-app.html` (Zustand `localStorage nemesis:lab:v9` + Sync `/state?raum=`) | 🟡 | C | Agenten existieren **nur im Browser** und als JSON im Sync. Ihre „Fähigkeiten“ sind Prompt-Text, es gibt keine Werkzeuge. Zweite, konkurrierende Agentenwelt zur Zentrale. |
| Zentrale-Agenten (Identität, Rolle, Persönlichkeit, Modell, Wissen, Gedächtnis, Rechte, Avatar) | `app/agenten/engine.js` | ✅ | T | Grundlage der künftigen Universal Runtime |
| Avatar Studio (SVG-Figuren) | `app/agenten/zentrale.html` | ✅ | C + Browser-Screenshot | |
| Agenten-Arbeitsschleife (Plan → Werkzeug → Ergebnis → Korrektur → Abschlussprüfung) | `engine.js` `schleife()` | ✅ | T | Mit echtem Modell **nicht getestet** (in den Tests ist das Modell vorgeskriptet) |
| Alte „Missionen“ (Lab + `/bg/` `bgMission`) | `nemesis-app.js` `bgMission()` | ❌ als Agent | C | Jeder Schritt ist ein Textaufruf **ohne Werkzeuge**. Wird durch die Runtime ersetzt (Phase 2). |
| Delegation / Teams | `engine.js` `_delegieren()` | 🟡 | T | Schnittmenge der Rechte getestet. Kein Agent-Directory, keine Nachrichten, kein Reviewer-Ablauf. Nach einem Neustart kann eine Delegation doppelt laufen. |
| Pause / Resume | `engine.js` | 🟡 | T | Stopp, Notaus und Wiederaufnahme nach Neustart funktionieren. **Echtes Pausieren durch den Benutzer fehlt** (nur Freigabe/Rückfrage pausiert). |
| Lab-Werkbank (≈45 Werkzeuge: Zuchtkammer, Arena, Traum-Modus, Mutations-Reaktor …) | `nemesis-app.html` `TOOLS` | 🟡 | C | **Fast alles reine Prompt-Skills**, keine ausführbaren Werkzeuge. Echte Ausnahmen: Code-Schmiede, Telegram-Zentrale, KI-Schlüssel, Kunden & Abos, Gastro. |

## 2. Werkzeuge (vier getrennte Systeme)

| System | Werkzeuge | Status | Nachweis | Rechte-Modell |
|---|---|---|---|---|
| **Zentrale/Engine** | Dateien (liste/lesen/schreiben/ersetzen/löschen), befehl, pakete_installieren, tests/build, version_speichern (git), vorschau, web_lesen, wissen, gedächtnis, Aufgaben, Posteingang/Mail/Entwurf/Senden, Dokumente, Aktivität, delegieren, browser_lesen/handeln + openclaw_auftrag | ✅ | T | 5 Modi pro Werkzeug + Autonomie 0–3, Prüfung bei jeder Ausführung |
| **Telegram-Zentrale** | zeit, rechnen, notiz_*, erinnern, job_*, betriebe_liste, betrieb_auftrag, apps_liste, app_lesen, app_bauen, mission_starten, auftraege_liste, agent_fragen, web lesen/suchen | ✅ (laut Code) | C | Nur lesend/schreibend; Sperre nach Web-Zugriff |
| **Betrieb (Restaurant/Shop)** | tabellen, lesen, rechnen, schreiben, ändern, löschen, tabelle_anlegen, reservierung_prüfen, info, benachrichtigen | ✅ (laut Code) | C | Feste Rollen Besitzer/Gast (`B_ROLLEN`) |
| **Lab-Werkbank** | siehe oben | 🟡 Prompt | C | keines |

→ **Befund:** Es gibt drei ausführbare Werkzeug-Systeme mit drei verschiedenen Rechte-Modellen. Ziel ist **eine** Registry (Phase 4).

## 3. Entwicklung / Code

| Funktion | Ort | Status | Nachweis | Bemerkung |
|---|---|---|---|---|
| Code-Schmiede 2.0 (Beschreibung → Spec → UI → logic.js → Selbstprüfung → Deploy `/x/`) | `nemesis-app.js` (`bgApp`, `aSelbsttest`), `app/laufzeit/runtime.js` | ✅ (laut Code) | C + T (Laufzeit) | Eingebauter Probelauf vor dem Livegang. Die Laufzeit selbst ist getestet. |
| logic.js-Isolation | `runtime.js` `logikWorkerMain` | ✅ | T | Behoben im letzten Auftrag. Rest-Risiko: siehe Sicherheitsbefund S6. |
| ZIP-Export, Android-APK über GitHub Actions | `nemesis-app.js` `/apps/export` | 🟡 | C | APK braucht ein GitHub-Token, nicht getestet |
| Engine-Builder (Docker-Sandbox, npm build/test, git, Vorschau, Korrekturschleife) | `engine.js` | ✅ | T (Coiffeur-Ende-zu-Ende) | Ohne IDE-Oberfläche: Datei-Explorer nur lesend, kein Code-Editor, kein interaktives Terminal |
| OpenCode | – | 📋 | – | `opencode-ai` / `@opencode-ai/sdk` 1.19.6 (MIT) existieren auf npm. Noch nicht geprüft und nicht integriert (Phase 3). |
| GitHub-Push durch Agenten | – | 📋 | – | |

## 4. Modelle

| Funktion | Ort | Status | Nachweis | Bemerkung |
|---|---|---|---|---|
| Gratis-Rotator mit Anbieterwechsel, Pause bei 429/401, Denk-Modell-Wiederholung | `nemesis-app.js` `rotiere()`, `ANBIETER`, `WAHL` | ✅ (seit Phase 1 mit Kosten-Gate) | T | **Jede Kette endet automatisch bei OpenAI** (`WAHL` + `RETTUNG`); ein vorhandener Schlüssel gilt als Erlaubnis. Verstößt gegen die neue Kostenregel. |
| „Gratis“-Kennzeichnung | `ANBIETER[x].frei` | 🟡 | C | Statische Annahme, **nicht verifiziert** (siehe S3) |
| Free-only (Router) | `app/agenten/modelle/router.js` | ✅ | T | Standard und serverseitig; Bezahlmodelle nur mit Freigabe und ausdrücklicher Wahl (Phase 1) |
| Schlüssel-Zentrale (Erkennen, Live-Prüfung, `.env`) | `nemesis-app.js` `sk*` | ✅ (laut Code) | C | |
| Lab: direkte Anbieter-Aufrufe aus dem Browser (Anthropic, OpenAI …) mit Schlüssel im Browser | `nemesis-app.html` `ask()`, `nx:cfg` | 🟡 | C | Schlüssel im `localStorage`. Kein serverseitiges Kosten-Gate. |
| Öffentlicher Kunden-Chat `/api/chat`: Claude zuerst, Rotator als Ausweichmodell | `build/nemesis-serve.js` + `build/patch-serve.js` | ✅ technisch / ❌ Kostenregel | C | **Kostenpflichtiges Modell an einem öffentlichen Endpunkt**, sobald `ANTHROPIC_API_KEY` gesetzt ist |
| Modellwahl pro Agent | Zentrale (`agent.modell`) | 🟡 | C | Wird an den Rotator weitergereicht, **ohne Kostenprüfung** |
| Kostenzählung | Zentrale `kosten.json` (Schätzung), Rotator `zaehler.frei/bezahlt` | 🟡 | T (Zentrale) | Keine echten Quoten der Anbieter, nur Schätzungen |

## 5. Automationen, Kanäle, Kunden

| Funktion | Ort | Status | Nachweis |
|---|---|---|---|
| Hintergrund-Aufträge `/bg/` (max. 2 parallel, Neustart-fest, Telegram-Meldung) | `nemesis-app.js` | ✅ (laut Code) | C |
| Zentrale-Läufe (Warteschlange, Limits pro Mandant, Wiederaufnahme) | `engine.js` | ✅ | T |
| Telegram-Bot (Kopplung, Jobs, Zeitpläne, Befehle) | `nemesis-app.js` `tg*` | ✅ (laut Code) | C |
| Betriebe: Besitzer-Bereich, Gast-Chat, Embed, PWA, Tischkarte, Tagesangebot | `nemesis-app.js` `b*`, `app/betrieb-seiten/` | ✅ (laut Code) | C + T (Route `/betrieb/liste`) |
| Stripe-Abo (Test, Checkout, Webhook mit Signatur, Sperre) | `nemesis-app.js` | ✅ (laut Code) | C |
| Zentrale-Mandanten (Token, Trennung, Limits, Export, Löschung) | `engine.js`, `http.js` | ✅ | T |
| NEMESIS Office (Formular-Eingang, Einordnen, Entwürfe, Freigabe, SMTP, Aufgaben, Dokumente, Demo) | `engine.js` | 🟡 | T | Kein IMAP-Abruf |
| Website-Import | `build/nemesis-import.js` | ✅ (laut Code) | C |
| Die Welt (Simulation, Wirtschaft, Politik, 3D) | `nemesis-app.js` `w*`, `nemesis-app.html` `Welt3D` | ✅ (laut Code) | C |
| OpenClaw-Adapter (Browser, Agentenauftrag) | `engine.js` | 🟡 | T (nur Vertragstest) | Kein echtes Gateway getestet. **Eine Gateway-Instanz für alle Kunden.** Widerspricht der neuen Regel in Phase 5. |

## 6. Daten, Auth, Hosting, Sicherheit

| Funktion | Ort | Status | Nachweis |
|---|---|---|---|
| Speicherung | JSON-Dateien in `sync-data/` (Sync, Betriebe, Welt, Telegram, Apps, `_agenten/`) | ✅ einfach | C. Keine Datenbank, kein Schema, Backup = Ordnerkopie |
| Betreiber-Auth | `/k/<NEMESIS_ZUGANG>/`, `schutz()` in `nemesis-serve.js`, `vonAussen()` in `nemesis-app.js` | 🟡 | T (Regression) |
| Kunden-Auth | Betrieb-Token, Zentrale-Token `nxm_…`, Telegram-Kopplung | 🟡 | T (Zentrale) | Keine Benutzerkonten, keine Rollen innerhalb eines Kunden |
| Hosting | DigitalOcean-Droplet, Caddy (HTTPS), systemd, `install.sh`/`install-app.sh` | ✅ (laut Code) | C |
| Selbst-Update alle 30 Minuten von `main` | `nemesis-app.js` `update()` | ❌ Sicherheit | C |
| Tests | `tests/*.test.js` (37) | ✅ | T. Gelten **nur** für Zentrale, Laufzeit und Routen-Regression |
| Training / Fine-Tuning | – | 📋 | Keine GPU in der Entwicklungsumgebung (kein `nvidia-smi`, kein `torch`) |
| Medien (Bild/Video/Audio) | – | 📋 | – |
| Marketplace / Lizenzen | Lab „Agent Marketplace“ (JSON Import/Export) | 🟡 | C. Keine Lizenzen, keine serverseitigen Freischaltungen |
