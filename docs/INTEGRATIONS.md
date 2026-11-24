# Integrationen

Alle externen Engines sind austauschbare Module unter `app/agenten/integrationen/`. Jede Engine ist einzeln aktivierbar, testbar und auf einen anderen Rechner verlegbar (z.B. einen Worker-PC).
Die Verwaltung liegt in der Zentrale unter **Integrationen**, die API unter `/zentrale/api/integrationen` (nur Betreiber).
Konfiguration: `sync-data/_integrationen.json` (chmod 600; Schlüssel mit dem Tresor verschlüsselt). Status pro Integration: `aus | nicht_konfiguriert | ungeprueft | ok | warnung | fehler`, jeweils mit Meldung und Lösungshinweis.
Adress-Regel: `http://` nur für lokale/private Adressen (127.x, 10.x, 192.168.x, 172.16–31.x, 100.64/10, `.local`), sonst `https://`. Keine Zugangsdaten in der URL.

## OmniRoute: Modell-Gateway
| | |
|---|---|
| Quelle | https://github.com/cheaper-inference/OmniRoute · npm `omniroute` |
| Lizenz | MIT |
| Geprüfte Version | **3.8.54** (24.11.2026), Node ≥ 22.22.2 |
| Doku-Quellen | `docs/reference/API_REFERENCE.md`, `docs/guides/HEADLESS.md` im offiziellen Repo |
| Genutzte Endpunkte | `GET /api/monitoring/health` (öffentlich) · `GET /v1/models` (Bearer, Katalog mit `pricing` in USD/Token) · `POST /v1/chat/completions` (Phase 2) · Antwort-Header `X-OmniRoute-Decision` |
| Auth | `Authorization: Bearer <OmniRoute-API-Key>`. Schlüssel per Verwaltungs-API `POST /api/keys` nach `POST /api/auth/login` (Passwort aus `INITIAL_PASSWORD`) |
| Start (Server) | `DATA_DIR=… OMNIROUTE_HEADLESS=1 OMNIROUTE_SERVER_HOST=127.0.0.1 REQUIRE_API_KEY=true INITIAL_PASSWORD=… JWT_SECRET=… API_KEY_SECRET=… omniroute serve --headless --port 20128` |
| Ressourcen (gemessen) | Installation ≈ **3 GB** (npm, 1329 Pakete); RAM im Leerlauf ≈ **510–660 MB** (2 Prozesse) |
| Kostenregel in NEMESIS | Gratis nur bei Preis 0 laut `/v1/models`. Kein `pricing` (z.B. `auto/*`-Kombis) = unbekannt = gesperrt. |
| Getestet | ✅ **echt**: Health 200, `/v1/models` ohne Schlüssel 401, mit Schlüssel 200 (247 Modelle; 7 mit Preis 0, 127 kostenpflichtig, 113 ohne Preis), Chat ohne Schlüssel 401, falscher Schlüssel → Warnung. ✅ Vertragstests. ❌ **Noch kein echter Chat-Aufruf** (Phase 2) |
| Wichtiger Befund | Die 7 Modelle mit Preis 0 im Werkszustand kommen von `ddgw/…` (nach Namen und OmniRoute-README ein Zugang über die DuckDuckGo-Weboberfläche, also **keine offizielle API**) und `unc/…` (Herkunft noch ungeprüft). Phase 2 lässt nur Anbieter aus einer Freigabeliste offizieller API-Zugänge zu; alles andere bleibt gesperrt. Echte Gratis-Modelle erfordern das Verbinden eigener Anbieter-Konten (z.B. Groq, Gemini, OpenRouter `:free`) im OmniRoute-Dashboard bzw. über die Verwaltungs-API. |

## OpenHands: Software-Ausführung
| | |
|---|---|
| Quelle | https://github.com/OpenHands/software-agent-sdk · PyPI `openhands-agent-server`, `openhands-sdk` |
| Lizenz | MIT |
| Geprüfte Version | **openhands-agent-server 1.64.0** (24.11.2026), Python ≥ 3.12 |
| Doku-Quellen | https://docs.openhands.dev/sdk · OpenAPI aus dem Paket: [`docs/integrationen/openhands-endpunkte.md`](integrationen/openhands-endpunkte.md) |
| Genutzte Endpunkte (Phase 1) | `GET /alive`, `/ready`, `/server_info` (ohne Schlüssel) · `GET /api/conversations/count` (Schutzprüfung) |
| Geplant (Phase 3, alle in der OpenAPI vorhanden) | `POST /api/conversations` (StartConversationRequest: `workspace`, `agent_settings.llm` mit `model`/`base_url`/`api_key` → OmniRoute), `POST …/{id}/run`, `/pause`, `/interrupt`, `GET …/{id}/events`, `GET /api/conversations/{id}/git/diff`, `…/file/download` |
| Auth | Header `X-Session-API-Key`; Server-Start mit `OH_SESSION_API_KEYS_0=<geheim>` |
| Start | `pip install openhands-agent-server==1.64.0` → `OH_SESSION_API_KEYS_0=… python -m openhands.agent_server --host 127.0.0.1 --port 8000` |
| Ressourcen (gemessen) | RAM im Leerlauf ≈ **360 MB**; bei Aufträgen zusätzlich Werkzeuge/Workspace. Empfehlung: **Worker-PC**, nicht der 4-GB-Server |
| Getestet | ✅ **echt**: Lebenszeichen, Version 1.64.0, 33 Werkzeuge, Bereitschaft, ohne Schlüssel 401, mit Schlüssel 200. ✅ Vertragstests (offener Server = Fehler, falscher Schlüssel = Warnung, Dienst aus = verständlicher Fehler). ❌ Noch kein Programmierauftrag (Phase 3) |
| Sicherheitshinweis | Die Standard-Laufzeit ist `local` (Code läuft auf dem Rechner des Agent Servers) → nur auf einem isolierten Worker oder in einem Container betreiben |

## OpenClaw: Agenten und Automationen
| | |
|---|---|
| Quelle | https://github.com/openclaw/openclaw · npm `openclaw` |
| Lizenz | MIT |
| Version | npm aktuell **2026.11.8**; Doku gelesen aus **2026.11.6**; **Node ≥ 24.16** nötig |
| Doku-Quellen | `docs/gateway/tools-invoke-http-api.md`, `docs/gateway/openai-http-api.md`, `docs/gateway/health.md`, `docs/tools/browser/agent-tools.md`, `docs/nodes/computer-use.md` (im npm-Paket enthalten) |
| Genutzte Endpunkte | `GET /healthz`, `/readyz` · `POST /tools/invoke` (Bearer; Schutzprüfung mit `sessions_list`, Werkzeug `browser`) · `POST /v1/chat/completions` (`model: openclaw/<agentId>`, muss im Gateway aktiviert sein) |
| Sicherheit laut Doku | Das Gateway-Token ist ein **Betreiber-Schlüssel mit vollen Rechten**. HTTP sperrt standardmäßig `exec`, `shell`, `fs_write` usw. Nur loopback/privat betreiben. **Pro Kunde eigene Instanz** (keine geteilte Instanz für unabhängige Kunden). |
| Getestet | ✅ Vertragstests (Gesundheit, Schutzprüfung, Browser-Profil erzwungen, interne URLs gesperrt, Freigaben). ❌ **BLOCKED: kein echtes Gateway**. Node 24 ist in der Entwicklungsumgebung nicht verfügbar (Download vom Sicherheitssystem blockiert). |

## Zusammenspiel (Ziel, ab Phase 2–5)
```
Smartphone ─► NEMESIS Command Center (Zentrale) ─► Orchestrator (engine.js)
                                               ├─► Modelle: router.js (Kosten-Gate) ─► Gratis-Anbieter direkt | OmniRoute /v1
                                               ├─► Code-Aufträge ─► OpenHands Agent Server (Worker) ─LLM─► OmniRoute
                                               └─► Automationen/Browser ─► OpenClaw-Gateway (Worker)  ─LLM─► OmniRoute
```
