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
