# NEMESIS Employee: Master Development Plan V1.0
**Autonomous AI Workforce & Evolution Platform**: Stand 24.11.2026 (löst den früheren Plan in `NEMESIS_MASTERPLAN.md` ab; der alte Plan liegt in der Git-Historie)

## Vision
Eine persönliche digitale KI-Firma (ein Benutzer: der Betreiber), steuerbar vom Smartphone. Spezialisierte KI-Mitarbeiter arbeiten eigenständig, arbeiten zusammen, entwickeln Software, führen Automationen aus und erwerben **kontrolliert** neue Fähigkeiten.
NEMESIS ist das Hauptsystem. Ausführung über **OmniRoute** (Modelle), **OpenHands** (Software) und **OpenClaw** (Agenten/Automationen). Alle drei sind MIT-lizenziert und geprüft, siehe [INTEGRATIONS.md](INTEGRATIONS.md).

## Leitplanken
Siehe [`/CLAUDE.md`](../CLAUDE.md) (verbindlich) und [SECURITY.md](SECURITY.md). Kurz:
- Bestehendes erhalten.
- Nur echte, dokumentierte Integrationen.
- FREE MODE als Standard.
- Kein Bezahl-Fallback.
- Freigabe für alles nach aussen.
- Sandbox für Agenten-Code.
- Mobil zuerst.
- Ehrliche Statusangaben.

## Phasen (Abhängigkeitsreihenfolge)
| # | Phase | Kern | Erfolgskriterium | Status |
|---|---|---|---|---|
| 1 | Foundation & Self-Healing | Analyse, Bugfixes, modulare Integrationsschicht, Integrationsverwaltung, Systemstatus, Selbstheilung, Basistests | App startet fehlerfrei, Kernfunktionen laufen, Architektur dokumentiert, Basistests, für die 3 Integrationen vorbereitet | **COMPLETED**, siehe PROGRESS |
| 2 | OmniRoute Intelligence Network | Gemeinsamer Model Provider Service (NEMESIS, OpenHands, OpenClaw), Erkennung, Fallback, Rate-Limits, Leistungstests, Kosten, Modell pro Mitarbeiter, Fähigkeitsprüfung; Modi FREE (Standard) / LOCAL / PREMIUM | Ein Gratis-Cloud-Modell mit echter Anfrage getestet; Ausfälle kontrolliert; Bezahlanfragen im FREE MODE technisch blockiert; alle Anfragen nachvollziehbar | **TESTED**; echte Gratis-Cloud-Anfrage ⛔ (kein Schlüssel) |
| 3 | OpenHands Engine | Adapter: Start, Übergabe, Status, Live-Protokoll, Abbruch, Fehler, Ergebnis, Limits, isolierter Workspace, Git, Diffs/Tests speichern; LLM über OmniRoute | Ein Mitarbeiter nimmt einen echten Programmierauftrag an, ändert Code, testet, zeigt das Ergebnis in der App | Vorarbeit: Docker-Builder in der Engine (getestet) |
| 4 | OpenClaw Automation Engine | Eigenständige Aufgaben, Werkzeuge, Zeitpläne, Ereignisse, Recherche, Arbeitsbereiche, Sitzungen, Benachrichtigungen, Übergaben; Brücke OpenClaw → OpenHands | Ein OpenClaw-Mitarbeiter führt einen Auftrag aus, fordert ein Werkzeug an und übergibt einen Entwicklungsauftrag an OpenHands | Vorarbeit: Adapter (Vertragstests); **echtes Gateway BLOCKED (Node 24)** |
| 5 | NEMESIS Central Orchestrator | Zentrale Warteschlange, Analyse, Zerlegung, Mitarbeiterwahl, Prioritäten, Abhängigkeiten, parallel/sequenziell, Bewertung, Wiederaufnahme, Freigaben, Limits; Zustände Erstellt…Abgebrochen; Command Center | Komplexer Auftrag wird verteilt, ausgeführt, geprüft und als gemeinsames Ergebnis präsentiert | Vorarbeit: Läufe, Delegation, Freigaben, Notaus |
| 6 | Evolution Engine | Skill Factory (10-Schritt-Zyklus), Skill Registry (Version, Tests, Sicherheit, Rechte, Rollback, Import/Export); Skills: Python, JS, API, Workflows, MCP | Fehlende Fähigkeit erkannt → echtes Werkzeug gebaut, getestet, nach Freigabe registriert, erfolgreich genutzt | NOT STARTED |
| 7 | Employee Genesis | Identität, Technik, Gedächtnis (Kurz-/Langzeit, Projekt, Erfahrung, Präferenzen, Firmenwissen; privat geschützt), Entwicklungshistorie aus echten Resultaten, Autonomiestufen 1–5, Pause/Deaktivieren | (Teil des Abschlusstests) | Vorarbeit: Avatar Studio, Rechte, Gedächtnis-Werkzeug, Statistik |
| 8 | Autonomous Digital Company | Abteilungen, Teams, Projekte, Ziele; 12 Mitarbeiter-Vorlagen; Company Command Center (16 Bereiche); Berichte, Vorschläge | Finaler End-to-End-Test (10 Schritte, ohne Bezahl-API) | NOT STARTED |

### Zusatzwünsche des Betreibers (verbindlich, aus früheren Aufträgen)
- **Lernendes NEMESIS-Gehirn:** Erfahrungsgedächtnis nach jedem Auftrag (Lektionen aus Erfolgen und Fehlern), Fehleranalyse → Verbesserungsvorschläge, Wissen, neue Fähigkeiten über die Evolution Engine. Keine Selbständerung von Rechten, Kosten oder Code ohne Freigabe; keine Behauptung, dass Modelle sich selbst trainieren. → Phasen 6/7.
- **Free-Modell-Bibliothek und viele Gratis-Anbieter** mit Rotation über alle (eines leer → nächstes). OpenAI/Claude nicht in der Rotation. → Phase 2 (OmniRoute) und Abschluss.
- Echtes Fine-Tuning nur mit vorhandener GPU (heute keine) → nach Phase 8, als blockiert markiert, bis Hardware da ist.

## Infrastruktur
DigitalOcean-Server mit 4 GB RAM (geteilt mit anderen Apps). **Auf dem Server:** NEMESIS (≈70 MB) und optional OmniRoute headless (≈0,5–0,7 GB). **Auf einem Worker-PC:** OpenHands Agent Server (≈0,4 GB Leerlauf, mehr unter Last) und OpenClaw (Node 24), angebunden über die Integrationsverwaltung (https oder privates Netz/VPN). Details: [DEPLOYMENT.md](DEPLOYMENT.md).

## Finaler End-to-End-Test (nach Phase 8)
Test-Repository analysieren → Fehler finden → beheben → neue Fähigkeit entwickeln, durch alle 10 Stationen (Orchestrator, OmniRoute gratis, OpenClaw, OpenHands, Quality, Security, Evolution, Registrierung nach Freigabe, Nutzung, Command Center). Ohne Bezahl-API. Fehlt eine Voraussetzung, wird das tatsächliche Ergebnis mit Blocker dokumentiert.
