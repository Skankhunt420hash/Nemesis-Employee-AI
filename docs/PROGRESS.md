# Fortschritt (Master Development Plan V1.0)

**Stand: 24.11.2026 (Phase 1 COMPLETED, Phase 2 TESTED)** · Branch `ccr-45791acd-iy1q1j` · Checkpoint-Tag lokal: `checkpoint-vor-masterplan-v1` (Push des Tags vom Git-Proxy abgelehnt; der Stand ist über Commit `3b57462` erreichbar).
`main` (= Produktion) ist **unverändert**. Nichts davon ist deployed.

Legende: ✅ fertig · 🧪A automatisch getestet · 🌐E mit echtem externem Dienst getestet · ⏳ nicht getestet · ⛔ blockiert · ❌ fehlt

## Phase 1: Foundation & Self-Healing: **COMPLETED** (24.11.2026)
| Teilaufgabe | Stand |
|---|---|
| Analyse der App (Frontend, Backend, Daten, Agenten, APIs, Modelle, Auth, Sicherheit, Bugs) | ✅ [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md), [SECURITY.md](SECURITY.md), [ARCHITECTURE.md](ARCHITECTURE.md) |
| Prüfung OmniRoute / OpenHands / OpenClaw (Version, Lizenz, API) | ✅ [INTEGRATIONS.md](INTEGRATIONS.md) |
| Modulare Integrationsschicht `app/agenten/integrationen/` (einzeln aktivierbar, austauschbar, Worker-fähig) | ✅ 🧪A 🌐E (OpenHands, OmniRoute) · ⛔ OpenClaw echt |
| Zentrale Integrationsverwaltung: Status, Konfiguration, Verbindungstest, verständliche Fehler | ✅ 🧪A 🌐E · UI „Integrationen“ |
| Systemstatus mit echten Messwerten + Reparaturfunktionen | ✅ 🧪A (Startstack) · UI „Systemstatus“ |
| Selbstheilung (hängende Aufträge neu einreihen, verwaiste Unteraufträge stoppen; alle 2 min + nach Neustart) | ✅ 🧪A |
| Bugfixes: Namenskollision im OpenClaw-Adapter (Test fand sie), Handy-Navigation (Admin-Seiten unerreichbar), verwaiste Delegationen nach Neustart (S13), Fehlertexte bei Verbindungsfehlern | ✅ 🧪A |
| Basistests inkl. Start des echten Server-Stacks | ✅ 61/61 ([TEST_REPORT.md](TEST_REPORT.md)) |
| Doku: CLAUDE.md, MASTERPLAN, ARCHITECTURE, INTEGRATIONS, PROGRESS, SECURITY, TEST_REPORT, DEPLOYMENT, CHANGELOG | ✅ |

Erfolgskriterien Phase 1:
- App startet fehlerfrei: ✅ (echter Prozess)
- Kernfunktionen laufen: ✅ (Routen-Regression)
- Architektur dokumentiert: ✅
- Basistests vorhanden: ✅
- Für die 3 Integrationen vorbereitet: ✅

## Phase 2: OmniRoute Intelligence Network: **TESTED** (Kriterium „echte Gratis-Cloud-Anfrage“ ⛔ BLOCKED)
| Teilaufgabe | Stand |
|---|---|
| Gemeinsamer Model Provider Service: Router `modelle/router.js` + Transport `rotiere()` für NEMESIS-Mitarbeiter; OmniRoute als zentrale Quelle für alle (OpenHands/OpenClaw beziehen ihre Modelle ab Phase 3/4 über OmniRoute `/v1`) | ✅ 🧪A 🌐E |
| OmniRoute als Anbieter: Katalog prüfen (`/v1/models` mit Preisen), nur Preis 0 + freigegebener offizieller Präfix oder vom Admin bestätigte eigene Modelle; `auto/*`, unbekannte Preise und Web-Zugänge (`ddgw`) gesperrt | ✅ 🧪A 🌐E |
| Echte Anfrage NEMESIS → **OmniRoute 3.8.54** → lokaler Test-Anbieter (Routing-Nachweis `X-OmniRoute-Decision`) | ✅ 🌐E |
| Modi FREE (Standard) / LOCAL (Ollama/LM Studio) / PREMIUM (nur mit Bestätigung, Freigabe, Budget, ausdrücklicher Wahl) / AUS | ✅ 🧪A |
| Fallback/Rotation: über Gratis-Anbieter und über mehrere OmniRoute-Modelle; Pausen bei OmniRoute **pro Modell** | ✅ 🧪A |
| Rate-Limit-Erkennung (429 → Pause, eigene Minuten-/Tageskontingente) | ✅ 🧪A |
| Kosten: Bezahlmodelle im FREE MODE technisch gesperrt (auch mit Freigabe); Ersatz durch Gratis-Modell wird offen ausgewiesen (`ersatzFuer`, `ersatzGrund`) | ✅ 🧪A |
| Nachvollziehbarkeit: Anfrage-Protokoll jeder Modellanfrage (Zeit, Quelle, Anbieter, Modell, Klasse, Status, Dauer, Tokens, Routing), Datei `sync-data/_modelle-anfragen.jsonl` | ✅ 🧪A |
| Leistungstest pro Modell (Antwortzeit, strukturierte JSON-Ausgabe, Rechenprobe), ohne Fallback | ✅ 🧪A 🌐E (über echtes OmniRoute) |
| Modell-Bibliothek (alle Modelle mit Klasse, Fähigkeiten, Leistung; gesperrte mit Grund) + Auswahl im Avatar Studio | ✅ 🧪A |
| Token-/Kostenübersicht pro Anbieter und Tag | ✅ (seit Phase 1 des alten Plans) |
| Prüfung Tool Calling / Kontextlänge | ⏳ Kontext und Tools sind Familien-Annahmen; ein echter Tool-Calling-Test fehlt |
| Alternative Modelle pro Mitarbeiter (eigene Ausweichliste) | ❌ heute: automatische Gratis-Rotation |
| **Echte Gratis-Cloud-Anfrage** (Groq/Gemini/OpenRouter `:free` direkt oder über OmniRoute) | ⛔ kein Anbieter-Schlüssel in der Entwicklungsumgebung |

Erfolgskriterien Phase 2:
- Gratis-Cloud-Modell mit echter Anfrage: ⛔ BLOCKED. Die Strecke über das echte OmniRoute ist mit einem lokalen Test-Anbieter bewiesen.
- Ausfälle kontrolliert: ✅
- Bezahlanfragen im FREE MODE technisch blockiert: ✅
- Alle Anfragen nachvollziehbar: ✅

## Vorarbeiten aus früheren Aufträgen (zählen in spätere Phasen)
- Agent-Runtime mit echten Werkzeugen, Rechten, Freigaben, Notaus, Audit, Tresor (🧪A, Modell vorgeskriptet). Ein echtes Modell fehlt noch.
- Kosten-Gate `modelle/router.js`, FREE MODE als Standard, kein Bezahl-Fallback (🧪A, ⏳ echter Gratis-Aufruf).
- Docker-Builder (Coiffeur-Ende-zu-Ende, 🧪A).
- Command Center (Zentrale) inkl. Office, Avatar Studio, Freigabe-Center.

## Offene Blocker
| Blocker | Wirkung | Was es braucht |
|---|---|---|
| Kein Gratis-Modell-Schlüssel in der Entwicklungsumgebung | Phase-2-Kriterium „echte Gratis-Anfrage“ | Einen Gratis-Schlüssel (z.B. Groq, Gemini oder OpenRouter) als Umgebungs-Credential **oder** den Test auf dem Server/Worker ausführen |
| Node 24 für OpenClaw nicht verfügbar | Echter OpenClaw-Test (Phase 4) | Node ≥ 24.16 auf dem Worker-PC/Server oder das offizielle Container-Image |
| 4-GB-Server | OpenHands/OpenClaw nicht auf dem Server | Worker-PC (siehe DEPLOYMENT) |

## Nächster Schritt (für eine neue Sitzung)
1. **Phase 2 abschließen:** Einen offiziellen Gratis-Anbieter verbinden (Schlüssel z.B. Groq/Gemini/OpenRouter in Lab → KI-Schlüssel, oder in OmniRoute), dann in der Zentrale unter Modell-Bibliothek „Testen“ drücken. Bei Erfolg Phase 2 → COMPLETED.
2. **Phase 3: OpenHands Engine.** Adapter `integrationen/openhands.js` erweitern um (alle Endpunkte stehen in `docs/integrationen/openhands-endpunkte.md`):
   - `POST /api/conversations`: `workspace` = isolierter Projektordner; `agent_settings.llm` mit `base_url` auf OmniRoute `/v1` und einem freigegebenen Gratis-Modell; kein Bezahl-Schlüssel.
   - `POST …/run`, `/pause`, `/interrupt`, `GET …/events` (Live-Protokoll), `GET …/git/diff`, Datei-Download.
   - Neues Engine-Werkzeug `openhands_auftrag` (Art „ausfuehren“, eigene Freigabestufe), Ergebnis (Diff, Tests) im Auftrag anzeigen, Abbruch über den Notaus.
   - Vorher prüfen: Laufzeit `local` vs. Docker-Workspace (Sicherheitsbefund I1); Agent Server nur auf einem Worker.
   - Test mit dem echten Agent Server (läuft lokal mit `OH_SESSION_API_KEYS_0`). Ein Modell für einen echten Auftrag braucht einen Gratis-Schlüssel, sonst BLOCKED dokumentieren.
