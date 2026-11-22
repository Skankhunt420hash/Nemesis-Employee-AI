# Architektur NEMESIS Employee: Ist-Zustand und verbindliche Zielarchitektur

## 1. Ist-Zustand

```
Internet ──HTTPS──> Caddy ──> nemesis-sync.js (:3400, ein Node-Prozess)
                               ├─ nemesis-serve.js  schutz() + oeffentlicher Kunden-Chat /api/chat, /a/<id>  (Claude → Rotator)
                               ├─ nemesis-import.js Website-Import
                               ├─ nemesis-app.js    behandle(): /app /llm /bg /telegram /apps /x /b /betrieb /welt /schluessel /pay /zentrale
                               │    ├─ rotiere()        Modell-Rotator (gratis zuerst, OpenAI zuletzt)
                               │    ├─ bg*              Hintergrund-Auftraege (Code-Schmiede, alte Missionen)
                               │    ├─ tg*              Telegram (eigene Werkzeuge)
                               │    ├─ b*               Betriebe (eigene Werkzeuge, Gast-Chat)
                               │    ├─ runtime.js       generierte Apps (/x), logic.js im isolierten Kindprozess
                               │    └─ AGENTEN_SRC      Zentrale: engine.js + http.js + zentrale.html (eingebettet)
                               └─ /state?raum=      Lab-Zustand (Agenten als JSON)
Browser: nemesis-app.html (Lab, React ohne Build) · zentrale.html (Zentrale) · betrieb-seiten/*
Daten:   sync-data/*.json, sync-data/_agenten/mandanten/<id>/...
Deploy:  install-app.sh (eingebettete Dateien) + Selbst-Update alle 30 Minuten von GitHub main
```

Kernprobleme der Architektur:
1. **Vier Agenten- und Werkzeug-Welten** (Lab, Telegram, Betrieb, Zentrale) mit eigenen Rechte-Modellen.
2. **Der Modellzugang hat kein Kosten-Gate**: Ein vorhandener Schlüssel wird automatisch genutzt; OpenAI und Claude stehen als Fallback in den Ketten.
3. **Ein Prozess für alles**: Server, Agenten, Sandbox-Steuerung und öffentliche Endpunkte teilen sich einen Node-Prozess mit Docker-Zugriff.
4. **Deploy = Push auf `main`**, ohne Signatur.

## 2. Zielarchitektur (verbindlich für alle Phasen)

Grundsatz: **Es gibt keine zweite Plattform.** Die vorhandene Zentrale-Engine (`app/agenten/`) wird schrittweise zur **Universal Agent Runtime** ausgebaut. Lab, Telegram und Betriebe werden zu **Kanälen** und **Werkzeug-Paketen** dieser Runtime, statt eigene Agenten zu führen.

```
app/agenten/
  kern/          Universal Agent Runtime: Laeufe, Schleife, Plan, Validierung, Pause/Resume/Stop,
                 Limits, Freigaben, Delegation, Ereignisse
  modelle/       Provider-Registry + Router + Kosten-Gate (ersetzt die Logik von rotiere(); der alte
                 Endpunkt /llm bleibt als Fassade bestehen)
  werkzeuge/     Tool-Registry: ausfuehrbare Werkzeuge mit Manifest (art, rechte, timeout, umgebung,
                 version), gruppiert in Pakete (dateien, coding, office, web, browser, medien,
                 betrieb, telegram ...)
  skills/        Prompt-Skills (reine Anleitungen/Personas), klar getrennt von Werkzeugen
  arbeitsbereiche/  Workspaces, Sandbox-Treiber (docker | aus), Vorschau, Artefakte
  mandanten/     Organisationen, Benutzer, Rollen, Tokens, Lizenzen, Limits, Tresor, Audit
  training/      Datensaetze, Jobs, Adapter, Evaluation, Worker-Schnittstelle (separat)
  kanaele/       zentrale (UI/API), telegram, betrieb-gast, kunden-chat, webhook/ereignisse
  http.js        API-Fassade
  zentrale.html  UI (mobil zuerst)
```

### Verbindliche Regeln
| # | Regel |
|---|---|
| A1 | Jede KI-Anfrage aus jedem Kanal läuft über `modelle/router`. Das **Kosten-Gate liegt auf dem Server**: kostenpflichtige Modelle nur, wenn der Admin sie **ausdrücklich** freigegeben hat (pro Modell, mit Budget). Ein vorhandener Schlüssel ist keine Freigabe. Free-only ist Standard. **Kein automatischer Fallback auf bezahlte Modelle.** Sind die Gratis-Kontingente erschöpft, pausiert der Lauf (`wartet_kontingent`). |
| A2 | Jede Aktion eines Agenten ist ein Werkzeug aus der Registry. Rechte prüft ausschließlich `entscheide()` bei jeder Ausführung. Werkzeuge haben ein Manifest; Werkzeuge ohne verfügbare Ausführungsumgebung sind **deaktiviert**, nicht simuliert. |
| A3 | Code von Agenten oder Kunden läuft **nie** im Server-Prozess, sondern nur in der Sandbox (Docker: ohne Netz, cap-drop, Limits) oder in isolierten Kindprozessen. Ohne Sandbox: gesperrt. |
| A4 | Mandant ist die oberste Grenze: eigene Ordner, Secrets, Workspaces, Agenten, Lizenzen. Jede API-Anfrage und jedes Werkzeug ist an genau einen Mandanten gebunden. Delegation und Agenten-Nachrichten nur innerhalb des Mandanten und der freigegebenen Teams. |
| A5 | Externe Harnesses (OpenClaw, OpenCode, ComfyUI, Training-Worker) werden **nur über Adapter** und nur über offiziell dokumentierte Schnittstellen angebunden. Pro Kunde gibt es eine eigene isolierte Instanz oder eine dokumentierte Trennung; eine OpenClaw-Gateway-Instanz für mehrere Kunden ist **nicht** erlaubt. |
| A6 | Speicherung hinter einer Speicher-Schnittstelle (`speicher.lesen/schreiben/liste`). Zuerst JSON-Dateien wie heute; ein Wechsel auf SQLite ist in Phase 9 möglich, ohne die Fachlogik zu ändern. |
| A7 | Keine neuen Laufzeit-Abhängigkeiten im Server ohne Begründung (heute: null Abhängigkeiten). Schwere Komponenten (OpenCode, ComfyUI, Training) laufen als **eigene Dienste/Container** und nicht im Server-Prozess. |
| A8 | Deploy nur bewusst: Auto-Update wird abgesichert (Phase 0 → Phase 9), bis dahin gilt: **Merge auf `main` = Deploy**. |
| A9 | Jede Fähigkeit ist mit Status gekennzeichnet (Manifest-Feld `status`: verfügbar/blockiert/ungetestet), und die UI zeigt ihn an. |
| A10 | Mobil zuerst: Jede neue UI-Funktion muss bei 375 px Breite ohne horizontales Scrollen bedienbar sein (Playwright-Prüfung in den Tests). |

### Build und Auslieferung
Die Module in `app/agenten/**` werden von `build/einbetten.py` zu `AGENTEN_SRC` gebündelt (Erweiterung: mehrere Module mit einem kleinen `require`-Shim). Damit bleiben Installer und Selbst-Update kompatibel. Tests laden die Module direkt.

### Abhängigkeiten der Phasen
```
P0 Audit ─> P1 Modell-Router ─> P2 Runtime-Kern ─┬─> P3 Development Engine ─┐
                                                 ├─> P4 Skill/Tool-Registry ─┼─> P5 Company OS ─┐
                                                 │                          └─> P6 Skill Forge ─┤
                                                 └─> (P1+P4) P7 Training Lab (separat, Hardware-blockiert)
                                                                            P8 Marketplace <─┘ (braucht P4, P5, Mandanten aus P2)
                                                                            P9 Produktionsreife (zuletzt)
```
