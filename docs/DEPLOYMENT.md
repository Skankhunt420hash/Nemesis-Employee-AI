# Installation und Betrieb

## 1. Hauptsystem (bestehender DigitalOcean-Server, 4 GB RAM)
Installation/Update wie bisher (eine Zeile, Ubuntu-Konsole):
```
curl -fsSL https://raw.githubusercontent.com/Skankhunt420hash/Nemesis-Employee-AI/main/install-app.sh | bash
```
- **Achtung:** Das Skript kommt von `main`. Der Server aktualisiert sich zusätzlich alle 30 Minuten selbst von `main` (`NEMESIS_AUTO_UPDATE=0` in `.env` schaltet das ab, **empfohlen**).
- Neue Funktionen (Integrationen, Systemstatus) sind nach dem Update **aus**, bis du sie in der Zentrale einschaltest.
- Zentrale: `https://<domain>/k/<NEMESIS_ZUGANG>/zentrale`.

### Wichtige Einstellungen (`/opt/nemesis/.env`, keine echten Werte ins Repo)
Siehe [`deploy/env.example`](../deploy/env.example).
| Variable | Zweck |
|---|---|
| `NEMESIS_ZUGANG` | Geheimer Betreiber-Pfad (≥ 16 Zeichen) |
| `NEMESIS_AUTO_UPDATE=0` | Selbst-Update aus (empfohlen) |
| `NEMESIS_SANDBOX` | `auto` (Docker, wenn vorhanden), `docker`, `aus` |
| `NEMESIS_SANDBOX_BILD` | Sandbox-Image, Standard `node:22` (enthält git) |
| `NEMESIS_TRESOR_SCHLUESSEL` | Optional, 64 Hex-Zeichen. Sonst wird `sync-data/_agenten/.tresor-schluessel` erzeugt (**getrennt sichern!**) |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, … | Gratis-Anbieter (auch über Lab → KI-Schlüssel setzbar) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Optional; werden **nur** nach Freigabe unter „Modelle & Kosten“ genutzt |

### Sandbox für Agenten (empfohlen)
`apt-get install -y docker.io && docker pull node:22` (≈1,6 GB Speicher). Ohne Docker sind Terminal-, Build- und Test-Werkzeuge gesperrt.

### RAM-Budget (gemessen im Leerlauf)
| Dienst | RAM | Empfehlung |
|---|---|---|
| NEMESIS (Server + Zentrale) | ≈ 70 MB | Server |
| OmniRoute headless | ≈ 510–660 MB (+3 GB Installation) | Server **nur** wenn genug frei ist (Systemstatus prüfen), sonst Worker |
| OpenHands Agent Server | ≈ 360 MB im Leerlauf, mehr bei Aufträgen | **Worker-PC** |
| OpenClaw-Gateway | nicht gemessen (Node ≥ 24.16 nötig) | **Worker-PC** |

## 2. Worker-PC (eigener Computer, empfohlen für OpenHands/OpenClaw)
Ein vorhandener PC/Mac/Linux-Rechner, kein zusätzlicher bezahlter Server. Verbindung zum Hauptsystem über ein privates Netz (z.B. VPN/Tailscale) oder über https.

### OpenHands Agent Server
```bash
python3.12 -m venv ~/openhands && ~/openhands/bin/pip install openhands-agent-server==1.64.0
OH_SESSION_API_KEYS_0="$(openssl rand -hex 24)" ~/openhands/bin/python -m openhands.agent_server --host 127.0.0.1 --port 8000
```
Nur an `127.0.0.1` oder die VPN-Adresse binden. Den Schlüssel in der Zentrale unter Integrationen → OpenHands eintragen und „Verbindung testen“ drücken. Der Test prüft auch, dass der Server ohne Schlüssel gesperrt ist.
**Hinweis:** Die Standard-Laufzeit `local` führt Code auf diesem Rechner aus. Nur einen dafür vorgesehenen Rechner oder Benutzer verwenden.

### OmniRoute (falls nicht auf dem Server)
```bash
npm install omniroute@3.8.54
DATA_DIR=~/omniroute-data OMNIROUTE_HEADLESS=1 OMNIROUTE_SERVER_HOST=127.0.0.1 REQUIRE_API_KEY=true \
INITIAL_PASSWORD="$(openssl rand -hex 16)" JWT_SECRET="$(openssl rand -base64 48)" API_KEY_SECRET="$(openssl rand -hex 32)" \
npx omniroute serve --headless --port 20128
```
Danach im OmniRoute-Dashboard (Headless: per Verwaltungs-API/CLI) einen **offiziellen** Gratis-Anbieter verbinden und einen API-Schlüssel erzeugen (`POST /api/auth/login`, dann `POST /api/keys`). Diesen Schlüssel in der Zentrale unter Integrationen → OmniRoute eintragen.

### OpenClaw
Node ≥ 24.16, dann `npm install -g openclaw && openclaw onboard` und `openclaw gateway --port 18789` mit `gateway.auth.mode=token` (Doku `docs/gateway/authentication.md` im Paket). Token in der Zentrale eintragen.

## 3. Sicherung und Wiederherstellung
- Sichern: Ordner `/opt/nemesis/sync-data/` (alle Daten) **und** getrennt `NEMESIS_TRESOR_SCHLUESSEL` bzw. `sync-data/_agenten/.tresor-schluessel`.
- Pro Kunde: Zentrale → Einstellungen → „Alle Daten exportieren“.
- Wiederherstellen: Dienst stoppen, Ordner zurückkopieren, Tresor-Schlüssel zurücklegen, Dienst starten, Systemstatus prüfen. (⏳ Ablauf noch nicht auf dem echten Server getestet.)

## 4. Prüfen nach jeder Änderung
- Zentrale → **Systemstatus**: alle Prüfungen grün oder bewusst gelb.
- Zentrale → **Integrationen**: „Verbindung testen“.
- Entwicklung: `npm test` (siehe [TEST_REPORT.md](TEST_REPORT.md)).
