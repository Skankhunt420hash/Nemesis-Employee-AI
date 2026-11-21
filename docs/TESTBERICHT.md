# Testbericht (21.11.2026)

`npm test`, Node 22.23, Docker 29 mit Image `node:22`. **37 von 37 bestanden, 0 fehlgeschlagen, 0 übersprungen.**

**Ehrlicher Hinweis:** In den Tests sind die *Entscheidungen* des Modells vorgeskriptet, weil im Testcontainer kein API-Schlüssel vorhanden ist. Alles andere ist echt: Werkzeuge, Dateien, Docker-Sandbox, npm-Build und Tests, Git, Rechteprüfung, Freigaben, HTTP-Server, SMTP-Protokoll. Ein Lauf mit einem echten Modell ist **noch nicht** getestet. Er ist der erste Schritt auf dem Server (siehe unten).

## Die 9 geforderten Prüfungen

| # | Prüfung | Ergebnis | Test |
|---|---|---|---|
| 1 | Werkzeuge werden wirklich ausgeführt | ✅ | `1+3: Agent erzeugt wirklich Dateien …` (Datei liegt danach auf der Platte) |
| 2 | Gesperrte Werkzeuge lassen sich nicht ausführen | ✅ | `1+3 …` (`datei_loeschen` = aus, erfundenes `rechte_setzen` wird abgelehnt), `Nur-Lesen …`, `Pfade …` |
| 3 | Agenten erzeugen Dateien | ✅ | `1+3 …`, `Coiffeur …` |
| 4 | Der Developer baut ein Testprojekt | ✅ | `Coiffeur …`: package.json, Build-Skript, `npm install`/`build`/`test` in Docker ohne Netz |
| 5 | Fehler werden erkannt und korrigiert | ✅ | `Coiffeur …`: der erste `npm test` schlägt wirklich fehl („Termin-Button fehlt“), Korrektur mit `datei_ersetzen`, neuer Build, Tests grün, Abschlussprüfung durch die Engine bestanden, Git-Commit, Vorschau mit Token |
| 6 | OpenClaw-Verbindung | ⚠️ teilweise | Vertragstests gegen die **dokumentierte** API (`tools/invoke`, `chat/completions`, `healthz/readyz`) bestanden. **Kein Test gegen ein echtes Gateway**: OpenClaw 2026.11.6 braucht Node ≥ 24.16; das Herunterladen von Node 24 wurde in dieser Umgebung aus Sicherheitsgründen blockiert. |
| 7 | Hintergrundaufgaben lassen sich stoppen | ✅ | `7: … sofort stoppen (auch während Modell-Aufruf)` (< 3 s), `NOTAUS …`, Sandbox-Zeitlimit beendet den Container |
| 8 | Kunden können nicht aufeinander zugreifen | ✅ | `8: Kunden können nicht aufeinander zugreifen` (7 Routen → 403, kein Token/falsches Token → 401, Kunde sieht keine anderen Kunden), Kontaktformular landet nur beim richtigen Kunden, Entwurf eines fremden Kunden nicht sendbar |
| 9 | Bestehende Funktionen bleiben erhalten | ✅ | `9: Bestehende Funktionen …` (App, Schloss, LLM-Status, Betriebe, Hintergrund-Aufträge, Apps), dazu die bestehende `logic.js`-Funktion |

## Weitere Sicherheitstests
- Sandbox-Ausbruch aus `logic.js` (5 Varianten) blockiert, Endlosschleife legt den Server nicht lahm
- Docker-Sandbox: kein Netz, Host-Dateisystem nicht sichtbar, nicht erlaubte Befehle (`sh`, `curl`) abgelehnt
- SSRF: 127.0.0.1, localhost, 169.254.169.254, 10.x, `file://` und fremde Ports gesperrt
- Audit-Log: eine Manipulation wird erkannt; Zugangsdaten liegen nicht im Klartext auf der Platte
- Prompt-Injection: Nach dem Lesen fremder Inhalte braucht Löschen eine Freigabe, auch bei voller Autonomie
- Delegation: Der Unteragent erhält nur die Schnittmenge der Rechte
- Kunde kann eigene Limits und Politik nicht erhöhen; nur der Betreiber kann Kunden löschen

## Im Browser geprüft (Playwright, Chromium)
Alle Seiten der Zentrale auf Desktop (1440 px) und iPhone 13: keine JavaScript-Fehler, kein horizontales Scrollen. Der Kunden-Login zeigt keine Betreiber-Menüs.

## Nicht getestet / offen
- Echtes Modell (Qualität von Plan und Werkzeugwahl mit den Gratis-Modellen)
- Echtes OpenClaw-Gateway, Computer Use
- Echter SMTP-Versand über einen Provider (Protokoll gegen einen lokalen Server getestet)
- Last und viele gleichzeitige Kunden
- Lab-Oberfläche (`nemesis-app.html`) nur per Routen-Regression geprüft, nicht Klick für Klick
