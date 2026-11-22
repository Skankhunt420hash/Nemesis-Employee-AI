# Phasen-Status

Statuswerte: NOT STARTED · IN PROGRESS · BLOCKED · TESTED · COMPLETED
Eine Phase ist erst COMPLETED, wenn ihre Abschlusstests tatsächlich bestanden sind.

| Phase | Titel | Status | Abschlusskriterium | Stand / Nachweis |
|---|---|---|---|---|
| 0 | Repository-Audit | **COMPLETED** | Audit, Architektur, priorisierte Aufgaben und Sicherheitsbefunde dokumentiert | `docs/NEMESIS_MASTERPLAN.md`, `docs/ARCHITECTURE.md`, `docs/FEATURE_INVENTORY.md`, Basis-Tests 37/37 grün (22.11.2026) |
| 1 | Free Model Router | **TESTED** (Live-Gratisaufruf BLOCKED) | Gratis-Aufruf erfolgreich; nicht freigegebener Bezahlaufruf wird trotz Schlüssel verweigert; kein Bezahl-Fallback | `tests/modelle.test.js` 10/10 + Engine-Pausentest; Gesamt 48/48 (22.11.2026). Gratis-Aufruf nur gegen lokalen OpenAI-kompatiblen Testserver: kein Gratis-Schlüssel in der Entwicklungsumgebung → COMPLETED nach einem Live-Test auf dem Server |
| 2 | Universal Super Agent Core | IN PROGRESS (Vorarbeit) | Agent erstellt und ändert echte Dateien, mehrstufig, dokumentiert; gesperrte Werkzeuge technisch unbenutzbar | Vorarbeit aus dem letzten Auftrag erfüllt das Kriterium mit **vorgeskriptetem** Modell (T). Offen: echtes Modell, Pause/Resume, Modularisierung, S6 |
| 3 | Universal Development Engine | IN PROGRESS (Vorarbeit) | Kleine App aus Beschreibung: Tests, Build, Vorschau; zweiter Avatar mit denselben Fähigkeiten | Coiffeur-Ende-zu-Ende mit Skript-Modell in der Docker-Sandbox (T). Offen: OpenCode, Editor/Terminal-UI, Export, echtes Modell, zweiter Avatar |
| 4 | Universal Skill & Creative System | NOT STARTED | Coding-, Business- und Creative-Agent auf derselben Runtime mit verschiedenen Werkzeugen | – |
| 5 | Multi-Agent Network & Company OS | IN PROGRESS (Vorarbeit) | Manager → Developer → Reviewer, nachweisbare Übergaben | Delegation mit Rechte-Schnittmenge (T). Kein Reviewer-Ablauf, kein Directory |
| 6 | Skill Forge | NOT STARTED | Neues Werkzeug entwickelt, getestet, vom Admin freigegeben, einem anderen Agenten zugewiesen | – |
| 7 | Real AI Training Lab | NOT STARTED (voraussichtlich BLOCKED) | Echter Adapter trainiert und unabhängig bewertet | Keine GPU, kein torch in der Entwicklungsumgebung |
| 8 | Agent & Tool Marketplace | NOT STARTED | Zwei Demo-Kunden mit getrennten Agenten und Lizenzen; unberechtigte Zugriffe scheitern | Mandantentrennung der Zentrale ist getestet (Vorarbeit) |
| 9 | Kommerzielle Produktionsreife | NOT STARTED | Pilot vorbereitet, keine automatische Liveschaltung | – |
| 10 | Free-Modell-Bibliothek & Erweiterung | NOT STARTED | Bibliothek aller Gratis-Modelle (auswählbar pro Agent), viele zusätzliche Gratis-Anbieter, Rotation über alle | Wunsch 22.11.2026 |

## Phase 1: Abschlussbericht (22.11.2026)

**Umgesetzt**
- `app/agenten/modelle/router.js`: Anbieter-Registry (9 Anbieter inkl. OpenAI/Anthropic), Kostenklassen (`gratis-verifiziert`, `gratis-bestaetigt`, `gratis-annahme` = gesperrt, `kostenpflichtig`), Fähigkeiten je Modellfamilie, Kontingente (pro Minute/Tag, einstellbar), 429-Pausen, Kostenzählung, Admin-Protokoll. Konfiguration in `sync-data/_modelle.json` (chmod 600, ohne Schlüssel).
- Kosten-Gate im bestehenden Rotator `rotiere()`: jeder Kandidat wird geprüft. Der automatische OpenAI-Rettungsanker (`RETTUNG`) ist entfernt. Bezahlte Modelle nur mit Freigabe (Muster, Tagesbudget, Ablaufdatum, Bestätigungssatz) **und** ausdrücklicher Wahl. Fallbacks nur auf erlaubte Gratis-Modelle. Erschöpft: HTTP 429 `KONTINGENT_ERSCHOEPFT` mit `wiederAb`.
- Gratis-Verifikation: OpenRouter `:free` und Preis-Prüfung über die Modell-Liste (OpenRouter, Together). Alle anderen Anbieter brauchen eine Admin-Bestätigung mit Prüfnotiz. Ein bezahlter Anbieter kann nicht als gratis bestätigt werden.
- Agenten-Läufe pausieren bei erschöpftem Kontingent (`wartet_kontingent`, ohne Slot), laufen automatisch weiter und überstehen einen Neustart. Delegierte Läufe warten mit.
- Modellwahl pro Agent wird respektiert und ebenfalls geprüft; die Engine verlangt JSON-Fähigkeit.
- Kunden-Chat (`/api/chat`): Claude nur mit Anthropic-Freigabe, sonst über den Rotator (Gate).
- Lab: Direktaufrufe mit Browser-Schlüssel nur mit ausdrücklichem Häkchen „Ich erlaube Direktaufrufe“, sonst über den Server (Gate).
- Admin-Oberfläche „Modelle & Kosten“ in der Zentrale (nur Betreiber; Kunden 403).

**Tests** (`npm test` 48/48, davon neu 11): Kostenklassen; Bestätigung nur mit Notiz; bezahlter Anbieter nicht als gratis bestätigbar; Freigabe nur mit Bestätigungssatz; Budget-Grenze; Rate-Limits Minute/Tag; 429-Pause; Preis-Verifikation; E2E über den echten Rotator mit gezählten HTTP-Aufrufen: Gratis-Aufruf ok, **OpenAI 0 Aufrufe bei erschöpftem Gratis-Kontingent trotz Schlüssel**, ausdrücklich gewähltes Bezahlmodell ohne Freigabe → 403, Bezahlmodell mit Freigabe nie automatisch, nur ausdrücklich; Kunden-Chat auf Rotator; Admin-API nur für den Betreiber; Engine-Pause und automatische Fortsetzung. Browser: Modelle-Seite Desktop und iPhone ohne JS-Fehler und ohne horizontales Scrollen. Lab-Skripte mit Babel fehlerfrei kompiliert.

**Einschränkungen / offen**
- **BLOCKED:** Live-Gratisaufruf bei einem echten Anbieter (kein Schlüssel in dieser Umgebung). Das Lab ließ sich hier nicht im Browser starten (cdnjs durch den Umgebungs-Proxy gesperrt). Geprüft ist nur der Syntax-Build.
- Die Standardlimits (Anfragen/Minute und /Tag) sind vorsichtige Annahmen, keine Herstellerwerte. Echte Restkontingente werden nicht beim Anbieter abgefragt (außer über 429-Antworten).
- Die Kosten bezahlter Modelle werden aus Tokens geschätzt (Zeichen/4 × Preis aus der Freigabe), nicht vom Anbieter abgerechnet.
- Die Claude-Kosten im Kunden-Chat zählen nicht gegen das Freigabe-Budget (die Freigabe wirkt dort nur als Ein/Aus).
- Die Fähigkeiten pro Modell sind Familien-Annahmen.
- **Korrektur 22.11. (nach Rückmeldung):** Gratis-Anbieter (Groq, Gemini, Mistral, Cohere, NVIDIA, OpenRouter `:free`, Together-Gratismodelle) sind **standardmäßig aktiv** und rotieren automatisch; der Admin kann einzelne abschalten. Die App läuft nach einem Deploy ohne Zusatzschritt weiter. OpenAI ist aus allen automatischen Ketten entfernt; OpenAI und Claude laufen nur noch bei ausdrücklicher Wahl **und** Freigabe. Gemini-Hinweis bleibt: Ist im Google-Projekt Billing aktiv, kann derselbe Schlüssel Kosten erzeugen.
- Verhaltensänderung: Der Kunden-Chat `/api/chat` nutzt ohne Anthropic-Freigabe die Gratis-Rotation statt Claude.

## Bekannte Fehler und Einschränkungen (Stand Phase 0)
Siehe Masterplan §2 (S1–S14). Die wichtigsten offenen Punkte:
- ~~S1/S2: Kostenpflichtige automatische Fallbacks~~: **im Branch behoben (Phase 1)**. Bis zum Deploy gilt auf dem Server weiter die Empfehlung, `OPENAI_API_KEY` und `ANTHROPIC_API_KEY` zu entfernen oder `NEMESIS_KUNDEN_KI=rotator` zu setzen.
- S4: Selbst-Update von `main`. Empfehlung `NEMESIS_AUTO_UPDATE=0`.
- Kein Test mit einem echten Modell, kein echtes OpenClaw-Gateway, keine GPU.
