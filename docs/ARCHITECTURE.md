# Architektur NEMESIS Employee (Stand 24.11.2026, Masterplan V1.0)

## 1. Laufzeit-Überblick
```
Smartphone / Browser
  ├─ Nemesis Lab           /k/<Zugang>/app        (app/nemesis-app.html, React ohne Build)
  └─ Command Center        /k/<Zugang>/zentrale   (app/agenten/zentrale.html)
          │ HTTPS (Caddy)
          ▼
nemesis-sync.js (:3400, ein Node-Prozess, Installer: build/*)
  ├─ nemesis-serve.js      schutz(), oeffentlicher Kunden-Chat /api/chat (Claude nur mit Freigabe)
  ├─ nemesis-import.js     Website-Import
  └─ nemesis-app.js        behandle(): /app /llm /bg /telegram /apps /x /b /betrieb /welt /schluessel /pay /zentrale
       ├─ rotiere()                Modell-Transport (HTTP zu den Anbietern)  ──► Kosten-Gate modelle/router.js
       ├─ Betriebe, Telegram, Code-Schmiede (bg), Welt, Stripe   (bestehend, unveraendert)
       ├─ systemStatus()/systemReparatur()   echte Messwerte, Reparaturen
       └─ AGENTEN_SRC (eingebettet, agRequire):
            engine.js            Runtime/Orchestrator-Kern: Mitarbeiter, Laeufe, Werkzeuge, Rechte, Freigaben,
                                 Delegation, Notaus, Audit, Office, Sandbox, Selbstheilung
            http.js              API /zentrale/api (Rollen: Betreiber/Kunde)
            modelle/router.js    Anbieter-Registry, Kostenklassen, FREE MODE, Freigaben, Kontingente
            integrationen/       index (Verwaltung) · basis · omniroute · openhands · openclaw
            tresor.js            AES-256-GCM
Daten: sync-data/ (JSON-Dateien; _agenten/, _modelle.json, _integrationen.json, Betriebe, Welt, Telegram, Apps)

Externe Engines (einzeln aktivierbar, lokal oder auf einem Worker-PC):
  OmniRoute  :20128  /v1 (OpenAI-kompatibel)      ── Modelle fuer NEMESIS, OpenHands, OpenClaw (ab Phase 2)
  OpenHands  :8000   Agent Server REST            ── Code-Auftraege (ab Phase 3)
  OpenClaw   :18789  Gateway (tools/invoke, v1)   ── Automationen/Browser (ab Phase 4)
```

## 2. Schichten und Verantwortung
| Schicht | Modul | Verantwortung | Austauschbar über |
|---|---|---|---|
| Oberfläche | `zentrale.html`, `nemesis-app.html` | Command Center (mobil zuerst), Lab | – |
| API | `http.js` | Rollenprüfung, Mandantengrenze, Routen | – |
| Orchestrator/Runtime | `engine.js` | Aufträge (Zustände), Plan → Werkzeug → Ergebnis → Prüfung, Freigaben, Delegation, Limits, Notaus, Selbstheilung | – |
| Modelle | `modelle/router.js` + `rotiere()` | FREE MODE, Kosten-Gate, Rotation, Kontingente | Anbieter-Registry; OmniRoute als zusätzlicher Anbieter (Phase 2) |
| Ausführung | Werkzeug-Registry in `engine.js`, Docker-Sandbox | Dateien, Terminal, Build, Tests, Git, Web, Office | Werkzeug-Pakete; OpenHands (Phase 3), OpenClaw (Phase 4) |
| Integrationen | `integrationen/*` | Verbindung, Status, Konfiguration, Tests der externen Engines | ein Modul pro Engine (`META` + `adapter(cfg)`) |
| Sicherheit | `entscheide()`, `tresor.js`, Audit, SSRF-Schutz, Sandbox | siehe [SECURITY.md](SECURITY.md) | – |

## 3. Verbindliche Architekturregeln
| # | Regel |
|---|---|
| A1 | Jede KI-Anfrage läuft durch das Kosten-Gate (`router.pruefe`). FREE MODE ist Standard. Kein automatischer Bezahl-Fallback. Unbekannter Preis = gesperrt. |
| A2 | Jede Aktion eines Mitarbeiters ist ein registriertes Werkzeug; Rechte prüft nur `entscheide()` bei jeder Ausführung. Nicht verfügbare Werkzeuge sind deaktiviert, nicht simuliert. |
| A3 | Agenten- oder Kundencode läuft nie im Server-Prozess (Docker-Sandbox, isolierte Kindprozesse, externe Engine auf einem Worker). |
| A4 | Mandant = oberste Datengrenze (heute ein Betreiber + optionale Pilotkunden). |
| A5 | Externe Engines nur über `integrationen/<name>.js` und nur über dokumentierte Endpunkte; Version, Lizenz und Quelle in `META` und in INTEGRATIONS.md. Kein Zugriff auf Engine-Interna an anderer Stelle. |
| A6 | Datenspeicher: JSON-Dateien hinter Modul-Funktionen; ein Wechsel auf SQLite (Phase 5, „zentrale Datenbank“) ändert nur die Speicherfunktionen. |
| A7 | Keine Laufzeit-Abhängigkeiten im Server (Node ≥ 18). Schwere Systeme (OmniRoute, OpenHands, OpenClaw) laufen als eigene Prozesse/Dienste. |
| A8 | Deploy nur bewusst: Merge auf `main` = Deploy (Selbst-Update). |
| A9 | Jede Fähigkeit zeigt ihren echten Status (aus/ok/warnung/fehler/blockiert) in der UI. |
| A10 | Mobil zuerst (375 px ohne horizontales Scrollen, alle Bereiche erreichbar). |

## 4. Build und Auslieferung
`build/einbetten.py` bettet `app/agenten/**/*.js` + `zentrale.html` als `AGENTEN_SRC` und `app/laufzeit/runtime.js` in `app/nemesis-app.js` ein. `agRequire()` löst relative `require`-Aufrufe zwischen den Modulen auf. `build/build.sh` erzeugt daraus `install-app.sh`. Tests laden die Module direkt aus `app/`.

## 5. Phasen-Abhängigkeiten (V1.0)
```
P1 Foundation ─► P2 OmniRoute ─► P3 OpenHands ─► P4 OpenClaw (+Bruecke zu OpenHands) ─► P5 Orchestrator/Command Center
                                                                                         ─► P6 Evolution Engine ─► P7 Employee Genesis ─► P8 Digital Company ─► End-to-End-Test
```
