# NEMESIS Employee: Verbindlicher Masterplan

**Ziel:** Eine mobile Plattform, auf der echte autonome KI-Mitarbeiter erstellt, spezialisiert, mit Fähigkeiten ausgestattet, trainiert, vernetzt (Company OS) und kommerziell angeboten werden können.
**Grundlage:** [ARCHITECTURE.md](ARCHITECTURE.md) (Zielarchitektur und Regeln A1–A10), [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md), [PHASE_STATUS.md](PHASE_STATUS.md).
**Branch:** `ccr-45791acd-iy1q1j` ist der Entwicklungsbranch (diese Umgebung erlaubt nur ihn). `main` = Produktion, **ein Merge ist ein Deploy** (Selbst-Update).

---

## 1. Audit-Zusammenfassung

Das Repo ist eine funktionsreiche, aber **zersplitterte** Plattform:
- Vier Agenten- und Werkzeugwelten (Lab, Telegram, Betrieb, Zentrale).
- Ein Modell-Rotator **ohne Kosten-Gate**.
- JSON-Dateien als Datenbank, ein einziger Node-Prozess für alles, Deploy per `main`.

Die Zentrale-Engine aus dem letzten Auftrag ist der einzige Teil mit durchgängigem Rechte-Modell, Sandbox, Mandantentrennung und Tests. Sie wird zur Universal Runtime ausgebaut, nicht ersetzt.

Die früher gemeldeten Probleme sind nachgeprüft:
| Thema | Ergebnis der Nachprüfung |
|---|---|
| Sandbox `logic.js` | Behoben, 7 Tests grün. Rest-Risiko S6 (lokales Vertrauen). |
| Werkzeugausführung | In der Engine echt und getestet. Telegram- und Betrieb-Werkzeuge echt, aber ungetestet und mit eigenem Rechte-Modell. Lab-Werkbank überwiegend Prompt-Skills. |
| Agentenrechte | In der Engine serverseitig pro Ausführung (getestet). In Telegram und Betrieb grob. In der Lab-Werkbank keine Rechte (keine Aktionen). |
| Kosten | **Neu als kritisch eingestuft** (S1–S3): verstößt gegen die neuen Kostenregeln. |

## 2. Sicherheits- und Kostenbefunde (priorisiert)

| ID | Schwere | Befund | Beleg | Behebung in |
|---|---|---|---|---|
| **S1** | 🔴 kritisch (Kosten) | Jede Modellkette endet automatisch bei OpenAI (`WAHL` + `RETTUNG`); ein vorhandener `OPENAI_API_KEY` gilt als Erlaubnis. Betroffen sind alle Aufrufer: Zentrale-Engine, Telegram, Betrieb-Gast-Chat (**öffentlich**), `/bg`, Welt, `/llm`. | `app/nemesis-app.js` `WAHL`, `RETTUNG`, `rotiere()` | **P1** (erste Aufgabe) |
| **S2** | 🔴 kritisch (Kosten) | Der öffentliche Kunden-Chat `/api/chat` fragt zuerst Claude (kostenpflichtig), sobald `ANTHROPIC_API_KEY` gesetzt ist. | `build/nemesis-serve.js`, `build/patch-serve.js` | **P1** |
| **S3** | 🟠 hoch (Kosten) | Die Gratis-Kennzeichnung ist eine statische Annahme, nicht verifiziert. Bei NVIDIA, Mistral, Cohere und Together hängt „gratis“ vom Konto und Tarif ab. Bei Gemini kann derselbe Schlüssel kostenpflichtig werden, wenn im Google-Projekt Billing aktiv ist. Nur OpenRouter filtert technisch auf `:free`-Modelle. Die Bedingungen müssen pro Konto in P1 bestätigt werden. | `ANBIETER[x].frei` | **P1** (Verifikation und Admin-Bestätigung pro Anbieter) |
| **S4** | 🔴 kritisch (Deploy) | Selbst-Update alle 30 Minuten von `main` ohne Signatur oder Freigabe | `update()` | Sofort-Empfehlung `NEMESIS_AUTO_UPDATE=0`; Absicherung (gepinnter Commit oder signiertes Release) in **P9**, früher auf Wunsch |
| **S5** | 🟠 hoch | Ohne `NEMESIS_ZUGANG` ist alles offen („altes Verhalten“). | `schutz()` in `nemesis-serve.js` | P9 (Fail-closed) |
| **S6** | 🟠 hoch | Anfragen von `127.0.0.1` ohne `X-Forwarded-For` gelten als Betreiber. Jeder lokale Prozess (OpenClaw-Gateway, OpenCode, ein Sandbox-Ausbruch in einem Host-Prozess) bekommt damit Admin-Zugriff. Das Node-Permission-Model in Node 22 sperrt kein Netzwerk. | `schutz()`, `vonAussen()` | **P2** (lokales Vertrauen abschaffen: Admin nur mit Schlüssel), Voraussetzung für P3 |
| **S7** | 🟡 mittel | `/fetch` im Sync-Server ohne SSRF-Schutz (nur mit Admin-Zugang erreichbar) | `build/nemesis-sync.js` | P4 (Web-Werkzeug vereinheitlichen) |
| **S8** | 🟡 mittel | Das Admin-Geheimnis steht im URL-Pfad (Verlauf, Logs) | `/k/<Zugang>/` | P8/P9 (Benutzerkonten mit Sitzung) |
| **S9** | 🟡 mittel | Das Lab speichert Anbieter-Schlüssel im Browser (`localStorage nx:cfg`) und ruft kostenpflichtige Anbieter direkt auf, ohne serverseitiges Gate | `nemesis-app.html` `ask()` | P1 (Server-Route als Standard, Direktaufruf nur ausdrücklich) |
| **S10** | 🟡 mittel | Docker-Sandbox: Image nicht gepinnt. Während `pakete_installieren` hat der Container Netz (Host-Bridge, Metadata-IP erreichbar; durch `--ignore-scripts` gemildert). Der Server-Prozess steuert Docker (Root-äquivalent). | `engine.js` `erstelleSandbox` | P3 (Digest-Pin, Egress nur zur Registry, eigener Sandbox-Dienst) |
| **S11** | 🟡 mittel | Eine OpenClaw-Gateway-Instanz für alle Kunden | `engine.js` `openclaw()` | P5 (eine Instanz pro Kunde oder gesperrt) |
| **S12** | ⚪ niedrig | Zentrale-CSP mit `'unsafe-inline'`; Kunden-Token im `localStorage` | `http.js`, `zentrale.html` | P8/P9 |
| **S13** | ⚪ niedrig | Delegation nach Neustart kann doppelt laufen; der Eltern-Lauf belegt einen Slot, während er wartet | `engine.js` `_delegieren` | P5 |
| **S14** | ⚪ niedrig | Keine Benutzer/Rollen innerhalb eines Kunden | Zentrale | P8 |

**Keine Produktionsdaten verändert.** Alle Tests laufen mit Temp-Ordnern.

## 3. Konsolidierungsentscheidungen (gegen widersprüchliche Architektur)

| Entscheidung | Begründung |
|---|---|
| **Runtime = Zentrale-Engine.** Lab-Agenten werden über einen Import zu Runtime-Agenten (Persona, Wissen, Skills). Die Lab-Werkbank-Effekte bleiben als **Prompt-Skills**. | Keine zweite Plattform (Regel 3/4) |
| Telegram-Werkzeuge und Betrieb-Werkzeuge werden **Werkzeug-Pakete** der Registry; Telegram und Gast-Chat werden **Kanäle**. Die bestehenden Endpunkte bleiben, intern rufen sie die Runtime. | Ein Rechte-Modell (A2) |
| Die alten Missionen (`bgMission`) werden auf Runtime-Läufe umgeleitet; die Code-Schmiede bleibt als Werkzeug `app_bauen` erhalten. | Funktion erhalten, keine Doppelung |
| Der Router (P1) wird **neben** `rotiere()` gebaut, `rotiere()` ruft danach den Router. Die API von `/llm` bleibt gleich. | Bestehende Aufrufer bleiben kompatibel |
| JSON-Speicher bleibt bis P9, aber hinter einer Schnittstelle | Keine Big-Bang-Migration |
| Schwere Fremdsysteme (OpenCode, ComfyUI, OpenClaw, Training) laufen als **eigene Dienste/Container pro Kunde**, angebunden über Adapter | Schutz des Produktionsservers (Regel 8), A5/A7 |

## 4. Implementierungsreihenfolge (konkret)

### P1: Free Model Router (Start als Nächstes, behebt S1–S3 und S9)
1. `app/agenten/modelle/registry.js`: Anbieter und Modelle als Daten (Fähigkeiten: chat, json, tools, vision, kontext; Kostenklasse `gratis-verifiziert | gratis-annahme | kostenpflichtig`; Limits RPM/RPD/TPM).
2. Server-Konfiguration `modelle.json`: Free-only = **an** (Standard). Kostenpflichtige Modelle nur mit Eintrag `freigegeben: {von, am, budgetChfTag}`.
3. `router.js`: Auswahl nach Fähigkeit und Agenten-Wunsch, nur gratis Kandidaten, Fallback **nur innerhalb gratis**. Bei Erschöpfung → `KONTINGENT_ERSCHOEPFT` (Runtime pausiert). Quotenzähler pro Anbieter (Tag/Minute) und 429-Pausen.
4. Verifikation der Gratisnutzung pro Anbieter: OpenRouter `:free` + Endpunkt `/api/v1/key` (is_free_tier, limit); bei anderen Anbietern ist eine Admin-Bestätigung Pflicht (Status „gratis-annahme“ bis bestätigt).
5. `rotiere()` → Router-Fassade; `RETTUNG`/OpenAI aus den Standardketten entfernen (bleibt als freischaltbares Premium-Modell). Kunden-Chat (`patch-serve`) → Claude nur mit Freigabe.
6. Admin-UI in der Zentrale: Anbieter, Status, Kontingente, Freigaben.
7. Tests: Gratis-Aufruf (gegen lokalen OpenAI-kompatiblen Testserver), **Verweigerung eines nicht freigegebenen Bezahlmodells, obwohl ein Schlüssel vorhanden ist**, kein Fallback auf bezahlt, Pause bei Erschöpfung, Agentenwahl wird respektiert. Dazu ein echter Gratis-Aufruf, wenn ein Gratis-Schlüssel bereitgestellt wird (sonst BLOCKED markiert).

### P2: Universal Super Agent Core
Engine modularisieren (`kern/`, `werkzeuge/`, `mandanten/`, `arbeitsbereiche/`); Pause/Resume durch den Benutzer; Ergebnisvalidierung als eigener Schritt; Speicher-Schnittstelle; **S6 beheben**; Ereignisse (für P5). Ende-zu-Ende mit **echtem Gratis-Modell**.

### P3: Universal Development Engine
OpenCode-Prüfung (`@opencode-ai/sdk`, Server-Modus) als Coding-Harness **im Container pro Workspace**; Datei-Explorer, Editor und Terminal-Ansicht in der UI (mobil); Artefakt-Export (ZIP); Sandbox-Härtung (S10); Coding als Werkzeug-Paket; zweiter Avatar mit denselben Fähigkeiten.

### P4: Skill & Creative System
Eine Registry mit Manifesten; Trennung Werkzeug/Skill; Telegram- und Betrieb-Werkzeuge migrieren; Medien-Adapter (z.B. ComfyUI-API) nur mit tatsächlich vorhandenem Worker, sonst `blockiert`; Branchenprofile und Personalisierungs-Assistent (Website, freigegebene Dokumente); Avatar Studio stellt Pakete zusammen.

### P5: Multi-Agent Network & Company OS
Agent-Directory, Nachrichten, Übergaben mit Nachweis, Teams und Abteilungen, Wissen mit Rechten, Mission Control, Ereignis-Automationen; OpenClaw nur pro Kunde isoliert (S11); S13.

### P6: Skill Forge
Skill-Architect-Agent schreibt Werkzeug-Code als Paket (Manifest, Tests) → Sandbox-Tests → statische Prüfung → Freigabe durch den Admin → Version, Installation, Rollback. Neue Werkzeuge laufen **ausschließlich in der Sandbox**, nie im Server-Prozess.

### P7: Real AI Training Lab
Persona / RAG / Fine-Tuning klar getrennt; Datensätze mit Rechten und Split; Jobs an einen **externen Training-Worker** (Transformers + PEFT/TRL, LoRA/QLoRA) über eine Worker-API; Evaluation vorher/nachher; Versionierung und Rollback. **Ohne GPU-Worker: BLOCKED.** Ein winziger CPU-LoRA-Lauf auf einem sehr kleinen Open-Weight-Modell ist als ehrlicher Machbarkeitsnachweis möglich, wenn Modell-Download und Lizenz es erlauben.

### P8: Marketplace
Katalog, Vorlagen, Tool-Shop, Organisationen, Lizenzen und Freischaltungen serverseitig; Test-Lizenzen, simulierte Zahlung (Stripe-Testmodus oder Fake-Provider, klar gekennzeichnet); zwei Demo-Kunden mit unterschiedlichen Lizenzen und Negativtests.

### P9: Produktionsreife
S4, S5, S8 beheben; Backup/Restore-Test; Monitoring; Lasttest; Abrechnung; mobile Prüfung aller Seiten; Pilot-Checkliste. **Keine automatische Liveschaltung.**

## 5. Kostenrahmen (getrennt nach Art)
| Art | Heute | Regel |
|---|---|---|
| LLM-API | Gratis-Anbieter, sofern Kontingent vorhanden | Nur bestätigt gratis; bezahlt nur nach ausdrücklicher Admin-Freigabe |
| Hosting | bestehender Droplet | Docker-Images brauchen ≈2 GB Speicher; OpenCode, OpenClaw und ComfyUI pro Kunde brauchen zusätzlich RAM/CPU → ab P3/P5 eventuell grösserer Droplet (**Hardwarekosten**, keine API-Kosten) |
| Training | – | Braucht eine GPU. Ohne kostenlose GPU: BLOCKED. Keine Cloud-GPU ohne Freigabe |
| Medien | – | ComfyUI braucht eine GPU; ohne: BLOCKED |
