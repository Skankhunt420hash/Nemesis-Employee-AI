# Changelog

Alle Änderungen liegen auf dem Entwicklungsbranch `ccr-45791acd-iy1q1j`; `main` (Produktion) ist unverändert.

## 24.11.2026: Master Development Plan V1.0, Phase 2 (OmniRoute Intelligence Network)
- OmniRoute als Anbieter im Kosten-Gate (Preis 0 + freigegebener offizieller Präfix oder bestätigte eigene Modelle; `auto/*`, unbekannte Preise, Web-Zugänge gesperrt); lokale Modelle; Modi FREE/LOCAL/PREMIUM/AUS; Pausen pro OmniRoute-Modell; Anfrage-Protokoll; Leistungstest; Modell-Bibliothek; transparenter Ersatz bei gesperrter Modellwahl.
- Fixes: Absturz bei Anbietern ohne `.env`-Schlüssel (Start-Stack-Test), Handy-Layout (Modelle und Office breiter als der Bildschirm; die untere Leiste ragte aus dem Bild).
- Tests: 71/71 inkl. echter Anfrage über OmniRoute 3.8.54 und Handy-Test aller 14 Seiten.

## 24.11.2026: Master Development Plan V1.0, Phase 1 (Foundation & Self-Healing)
- **Neu:** Integrationsverwaltung `app/agenten/integrationen/` für OmniRoute, OpenHands und OpenClaw: einzeln aktivierbar, Adresse frei wählbar (Worker-PC), Schlüssel im Tresor, Verbindungstests nur über dokumentierte Endpunkte, verständliche Fehlermeldungen. Prüft auch, ob ein Dienst **ungeschützt** erreichbar ist.
- **Neu:** Systemstatus (echte Messwerte: Node, RAM, Speicher, Schreibrechte, Sandbox, Aufträge, Gratis-Modelle, Integrationen) und Reparaturfunktionen (Aufträge, Anbieter-Pausen, Modell-Listen).
- **Neu:** Selbstheilung: hängende Aufträge werden neu eingereiht, verwaiste Unteraufträge gestoppt (alle 2 Minuten und nach einem Neustart).
- **Neu:** Command-Center-Seiten „Integrationen“ und „Systemstatus“; „Mehr“-Menü am Handy.
- **Umbau:** OpenClaw-Adapter aus der Engine in `integrationen/openclaw.js` verschoben (eine Konfigurationsquelle, automatische Übernahme der alten Einstellung); Tresor als eigenes Modul `tresor.js`; `build/einbetten.py` bündelt alle Module unter `app/agenten/`.
- **Fixes:** Handy-Navigation (Admin-Seiten waren unerreichbar), Namenskollision im verschobenen OpenClaw-Adapter, Fehlercode-Erkennung bei Verbindungsfehlern, verwaiste Delegationen nach einem Neustart.
- **Tests:** 61/61, inkl. Start des echten Server-Stacks, echter OpenHands Agent Server 1.64.0 und echtes OmniRoute 3.8.54.
- **Doku:** CLAUDE.md, MASTERPLAN (V1.0), ARCHITECTURE, INTEGRATIONS, PROGRESS, SECURITY, TEST_REPORT, DEPLOYMENT, CHANGELOG, `deploy/env.example`. Ersetzt: NEMESIS_MASTERPLAN.md, PHASE_STATUS.md, TESTBERICHT.md, AUDIT.md (Inhalt übernommen; die alten Dateien liegen in der Git-Historie).

## 22.11.2026: Free Model Router + Korrektur
- Kosten-Gate `app/agenten/modelle/router.js`; OpenAI aus allen automatischen Ketten entfernt; Bezahlmodelle nur mit Freigabe und ausdrücklicher Wahl; Läufe pausieren bei erschöpftem Gratis-Kontingent; Admin-Seite „Modelle & Kosten“; Lab-Direktaufrufe nur mit Häkchen.
- Korrektur nach Rückmeldung: Gratis-Anbieter standardmäßig aktiv (die App läuft nach einem Update weiter), abschaltbar.

## 21./22.11.2026: Audit und Agenten-Plattform
- **Sicherheitsfix:** Sandbox-Ausbruch in `logic.js` behoben (isolierter Kindprozess).
- Agent-Engine mit echten Werkzeugen, Rechten pro Werkzeug, Docker-Sandbox, Freigaben, Notaus, Delegation, Audit-Kette, Tresor; Zentrale (Command Center), NEMESIS Office, OpenClaw-Adapter (Vertragstests).
