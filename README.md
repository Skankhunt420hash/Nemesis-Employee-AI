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
