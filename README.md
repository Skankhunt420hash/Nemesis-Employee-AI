# Nemesis Employee AI

Nemesis Lab (Agent-Generator-App) + Backend auf dem Droplet.

## Installieren / Aktualisieren (DigitalOcean-Konsole, eine Zeile)

```
curl -fsSL https://raw.githubusercontent.com/Skankhunt420hash/Nemesis-Employee-AI/main/install-app.sh | bash
```

Am Ende steht dein App-Link `https://nemesis-studio-ai.ch/k/<Zugang>/app` — am Handy öffnen, „Zum Startbildschirm".

## Aufbau

| Datei | Zweck |
|---|---|
| `app/nemesis-app.html` | Die App (React, eine Datei) |
| `app/nemesis-app.js` | Server-Modul: liefert die App aus, Gratis-Rotator `/llm`, Status `/llm/status` |
| `install-app.sh` | Installer (gebaut aus `build/`, Dateien eingebettet) |
| `install.sh` | Haupt-Installer (Kunden-Auslieferung, Import, Schloss, Domain) |
| `build/` | Server-Quellen, Patch, Vorlage; `bash build/build.sh` baut `install-app.sh` |

## Gratis-Rotator

Schlüssel liegen nur in `/opt/nemesis/.env` (`GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `COHERE_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `OPENAI_API_KEY`).
Reihenfolge: Gratis-Modelle zuerst, OpenAI nur als Rettung. Fällt ein Anbieter aus (Limit, Fehler), springt er automatisch zum nächsten.
Manuell: `!model <key>` am Anfang einer Nachricht — `gemini`, `nemotron`, `qwen`, `gptoss`, `llama`, `cohere`, `mistral`, `gpt54mini`, `gpt55`.

## Die Welt (Spielplatz → Die Welt)

Läuft auf dem Server, auch wenn die App zu ist. Du wählst, welche Agenten hineindürfen; die Welt speichert sie selbst (`sync-data/_welt-<raum>.json`).
Tage laufen automatisch (Autopilot, 1–24 Std), Bewohner bauen Häuser, Kirchen, Läden … und gründen Firmen. Jede Firma bekommt eine echte App
(eine HTML-Datei), an der täglich weitergebaut wird. In der **Ablage** kannst du die App ausprobieren, kopieren oder Wünsche ans Team geben.
Kosten-Bremsen: max. Tage und KI-Aufrufe pro 24 Std, optional nur Gratis-Modelle.

### Neu in der Welt
- **Wirtschaft:** Taler-Währung, Handel zwischen Bewohnern/Firmen, Firmenwert und Rangliste, Zufallsereignisse (Boom, Flaute, Sturm, Markttag, Fest), Stadtkasse mit Steuern.
- **Politik:** Wahlen (alle 7 Tage), Bürgermeister, Gesetze (Steuer, Grundeinkommen, Bauzuschuss), Abstimmungen.
- **Beziehungen & Charakter:** Freunde, Rivalen, Partner; fünf Charakterwerte, Lebensziel und Erinnerungen pro Bewohner.
- **Karte:** Stadtplan mit Zeitraffer (Tab «Karte»).
- **Firma → Produkt:** «Als Produkt anbieten» erzeugt eine öffentliche Verkaufsseite `/p/<raum>/<firma>` mit Live-Demo, Preis, Kontakt, Einbett-Code und Datei-Download.
- **3D-Welt (Tab «3D»):** begehbare Stadt im Browser (Three.js). Kreis links = gehen, Wischen = umschauen, Figuren/Häuser/Firmen antippen. Mit Bewohnern reden: Antworten kommen im Charakter der Figur, mit ihren Erinnerungen (`/welt/sprechen`).

## Betrieb: Agenten, die für den Kunden arbeiten
In der App bei Agent → Kunde ⭐ → «Betrieb für diesen Kunden anlegen» (Restaurant, Shop, Dienstleister). Danach gibt es pro Kunde:
- **Besitzer-Bereich** `/b/<id>/#t=<geheimer Token>` (Handy): Agent-Chat, Daten (Lager, Reservierungen, Bestellungen, Kontakte, Aufgaben …), Posteingang, Einstellungen, optional Telegram-Meldungen.
- **Gast-Chat** `/b/<id>/chat` und `/b/<id>/embed.js` (eine Zeile für die Website): Gäste fragen, reservieren, bestellen. Gäste sehen nie Lager, Einkaufspreise oder fremde Daten.
- **Werkzeuge des Agenten** (serverseitig, mit Rechteprüfung): lesen, rechnen (exakt), schreiben, ändern, löschen, Tabellen anlegen, Reservierung prüfen (Kapazität), benachrichtigen.
Daten liegen in `sync-data/_betrieb-<id>.json`. Seiten-Quellen: `app/betrieb-seiten/`, eingebettet mit `python3 build/einbetten.py` (läuft in `build.sh`).

## Betrieb: 1 Link, Mini-Webseite, eigene App
- Kunde ohne Website: `/b/<id>/chat` ist eine Mini-Webseite (Anrufen, Route, Zeiten, Speisekarte, Chat) + QR + druckbare Tischkarte `/b/<id>/karte`.
- Kunde mit Website: eine Zeile `<script src=".../b/<id>/embed.js">`.
- Besitzer bekommt einen einzigen Link (`/b/<id>/#t=...`), Tab "Teilen". Jeder Betrieb ist als PWA installierbar (eigener Name, Farbe, Icon).

## Code-Schmiede 2.0 (Voll-Apps)
- Beschreibung -> Plan (Tabellen/Felder/Login) -> Oberflaeche (index.html, style.css, app.js) -> optional `logic.js` -> Selbstpruefung (Syntax, IDs, Tabellennamen; Modell repariert selbst) -> Deploy auf den eigenen Server.
- Laufzeit `app/laufzeit/runtime.js` (keine Abhaengigkeiten): REST-API pro Tabelle, Login (scrypt, Sitzungen), Besitzer-Filter, Validierung, JSON-Datenbank, Static-Hosting. Wird per `build/einbetten.py` in `nemesis-app.js` und `nemesis-app.html` eingebettet; dieselbe Datei ist im ZIP als `server.js`.
- Hosting: `/x/<name>/` (oeffentlich, CSP-Sandbox), privat `/apps/deploy|liste|loeschen|export`. Vor dem Livegang laeuft ein echter Probelauf (CRUD je Tabelle, Login, Frontend); schlaegt er fehl, bleibt die alte Version live. Daten bleiben bei Updates erhalten. `logic.js` laeuft in einer vm-Sandbox (nur `ctx.db`).
- Rausgeben: Link/QR, ZIP (`node server.js`, Dockerfile, README), Android-APK ueber GitHub Actions (Capacitor, ein Commit per Git-Data-API, Release mit `app-debug.apk`).

## Telegram-Zentrale (OpenClaw-Prinzip)
- Lab: Werkstatt -> Telegram-Zentrale. Bot-Schluessel von @BotFather einfuegen, Link antippen, Start druecken: gekoppelt (Einmal-Code, 30 Min, 5 Fehlversuche -> Sperre). Fremde Chats werden ignoert.
- Server pollt Telegram selbst (nur ausgehend, kein Webhook/Port noetig), Daten in `sync-data/_telegram.json` (chmod 600).
- Agenten (aus dem Lab uebertragen) antworten mit Werkzeugen: Notizen, Web lesen/suchen (SSRF-Schutz: keine internen Adressen, nur Port 80/443), rechnen, Erinnerungen, Jobs (Zeitplan, Zuerich-Zeit), Betriebe verwalten, Apps lesen, andere Agenten fragen.
- Nach Web-Zugriff sind schreibende Werkzeuge im selben Auftrag gesperrt (Schutz vor Prompt-Injection). Tageslimit fuer KI-Aufrufe einstellbar.
- Chat-Befehle: /agenten /agent /jobs /job /notizen /neu /stopp /status /code /entkoppeln, `@Name Frage`.

## Hintergrund-Aufträge (Server arbeitet weiter, auch wenn die App zu ist)

Code-Schmiede (Voll-Apps bauen, ändern, reparieren) und Dauer-Missionen laufen als Aufträge **auf dem Server** (`/bg/neu|status|abbrechen|nochmal|loeschen|projekt`, Zustand in `sync-data/_bg.json`).
- Max. 2 gleichzeitig, weitere warten; nach Server-Neustart laufen offene Aufträge automatisch weiter.
- Die App fragt nur den Stand ab (alle paar Sekunden) – App schließen oder Handy sperren stoppt nichts.
- Bei Fertig/Fehler kommt eine Telegram-Nachricht (wenn Telegram-Zentrale verbunden ist).
- Per Telegram startbar: `app_bauen`, `mission_starten`, `auftraege_liste`.

## KI-Schlüssel in der App eintragen (ohne Konsole)
Lab → Werkstatt → «KI-Schlüssel» (Gemini, Groq, OpenRouter, Mistral, Cohere, Together, NVIDIA, OpenAI): alle Schlüssel in EINEM Text einfügen (einer pro Zeile, mit oder ohne Namen). Der Server erkennt den Anbieter (Präfix oder Live-Test), prüft jeden Schlüssel beim Anbieter, speichert nur gültige in `.env` (chmod 600) und nutzt sie sofort, ohne Neustart. Schlüssel werden nie zurückgegeben, nur die letzten 4 Zeichen. Routen: `/schluessel/status[?pruefen=1]`, `/schluessel/speichern` (privat).

## Restaurant: Tagesangebot (Gericht des Abends)
Restaurants haben die öffentliche Tabelle `tagesangebot` (Datum, Art, Gericht, Preis, Beschreibung, Allergene); ältere Restaurants bekommen sie beim Laden automatisch. Der Inhaber sagt dem Agenten «Gericht des Abends ist …», er trägt es ein. Gäste-Agent liest «heute»; fehlt der Eintrag, sagt er das ehrlich und empfiehlt aus der Karte. Reservierungen: Kapazität wird geprüft, nie überbucht.
