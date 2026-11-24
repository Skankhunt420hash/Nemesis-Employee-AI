# Fortschritt (Master Development Plan V1.0)

**Stand: 24.11.2026** · Branch `ccr-45791acd-iy1q1j` · Checkpoint-Tag lokal: `checkpoint-vor-masterplan-v1` (Push des Tags vom Git-Proxy abgelehnt; der Stand ist über Commit `3b57462` erreichbar).
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
**Phase 2: OmniRoute Intelligence Network.**
1. OmniRoute als Anbieter `omniroute` im Router (`app/agenten/modelle/router.js`) und Transport in `rotiere()`: Kandidaten aus `/v1/models` (über den Adapter `integrationen/omniroute.js`), nur Preis 0 **und** Anbieter-Präfix aus einer Freigabeliste offizieller APIs (`ddgw` u.ä. gesperrt), nie `auto/*`.
2. Modi FREE (Standard) / LOCAL (Ollama/OpenAI-kompatibel lokal) / PREMIUM (Freigabe + Budget) als globale Einstellung im Router, mit UI.
3. Anfrage-Protokoll (jede Modellanfrage: Zeit, Aufrufer, Anbieter, Modell, Tokens, Kosten, Ergebnis), Leistungstest pro Modell (Antwortzeit, JSON, Tool Calling), Modellwahl pro Mitarbeiter mit Alternativen.
4. Free-Modell-Bibliothek (Seite im Command Center).
5. Echter Gratis-Test: über OmniRoute mit einem verbundenen offiziellen Gratis-Anbieter **oder** direkt (Groq/Gemini/OpenRouter `:free`). Ohne Schlüssel: BLOCKED dokumentieren.
