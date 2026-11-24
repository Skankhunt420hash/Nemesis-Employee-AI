# Sicherheitskonzept NEMESIS Employee

Stand 24.11.2026. Grundsatz: **Sicherheit sitzt im Code auf dem Server, nicht im Prompt.** Kein Mitarbeiter (Agent) kann sich Rechte geben, Limits ändern oder Freigaben umgehen.

## Umgesetzte Schutzmechanismen
| Bereich | Mechanismus | Ort | Test |
|---|---|---|---|
| Rollen | Betreiber (geheimer Zugangspfad) / Kunde (Token `nxm_…`, nur eigener Mandant). Jede API-Anfrage wird serverseitig geprüft. | `app/agenten/http.js` | `zentrale-http.test.js` |
| Werkzeugrechte | 5 Modi pro Werkzeug (aus/lesen/Bestätigung/begrenzt/autonom) + Autonomie 0–3; `entscheide()` bei **jeder** Ausführung; beim Start eines Laufs eingefroren; kein Werkzeug ändert Rechte | `engine.js` | `engine.test.js` |
| Delegation | Unterauftrag bekommt nur die Schnittmenge der Rechte; Tiefe ≤ 2; verwaiste Unteraufträge werden gestoppt | `engine.js` | `engine.test.js`, `integrationen.test.js` |
| Freigaben | Alles nach aussen (E-Mail senden, Browser-Aktionen, OpenClaw-Aufträge) braucht eine Freigabe; nach dem Lesen von Fremdinhalt (Web/E-Mail) brauchen Aktionen nach aussen und Löschungen eine Freigabe (Prompt-Injection-Schutz) | `engine.js` | ✓ |
| Sandbox | Agenten-Code nur in Docker: ohne Netz (Ausnahme `npm install --ignore-scripts`), `--cap-drop ALL`, `no-new-privileges`, Benutzer 1000, Limits für Speicher/CPU/Prozesse, nur der Projektordner eingehängt; ohne Docker sind Terminal-Werkzeuge gesperrt | `engine.js` | ✓ |
| Generierte Apps | `logic.js` in einem isolierten Kindprozess (Permission-Model, keine Host-Objekte, `eval` aus) | `app/laufzeit/runtime.js` | `laufzeit-logik.test.js` |
| Zugangsdaten | AES-256-GCM-Tresor (Mandanten-Secrets, Integrations-Schlüssel, OpenClaw-Token); nie im Klartext zurückgegeben | `app/agenten/tresor.js` | ✓ |
| Netz | SSRF-Schutz (interne Adressen, Metadata-IP, fremde Ports gesperrt); Integrationen: http nur privat, sonst https | `engine.js`, `integrationen/basis.js` | ✓ |
| Kosten | FREE MODE als Standard; Bezahlmodelle nur mit Freigabe **und** ausdrücklicher Wahl **und** Budget; nie als Fallback; Kunden-Chat ohne Claude-Freigabe auf Gratis-Rotation; Tageslimits pro Mandant | `modelle/router.js`, `nemesis-app.js` | `modelle.test.js` |
| Ressourcen | Limits für Schritte, KI-Aufrufe und Werkzeugaufrufe pro Lauf; Zeitbudget; Zeitlimits pro Werkzeug und KI-Aufruf; parallele Läufe pro Mandant/global | `engine.js` | ✓ |
| Schleifen | Abbruch nach 8 Fehlern in Folge, Schrittlimit, Delegationstiefe, kein Selbst-Delegieren | `engine.js` | ✓ |
| Not-Aus | Lauf / Mandant / global (sperrt auch neue Läufe); beendet Kindprozesse und Container | `engine.js` | ✓ |
| Audit | Hash-Kette pro Mandant, Manipulation erkennbar | `engine.js` | ✓ |
| Integrationen | Verbindungstest prüft, ob OpenHands/OpenClaw **ohne** Schlüssel erreichbar sind → dann Status „Fehler“ | `integrationen/*` | `integrationen.test.js` |
| Git-Checkpoints | Commits pro Teilschritt; `main` nur mit Absicht (Merge = Deploy) | – | – |
| Backup | Export pro Mandant (JSON), Datenordner `sync-data/` als Ganzes sichern; Tresor-Schlüssel getrennt sichern | DEPLOYMENT.md | ⏳ Wiederherstellung nicht getestet |

## Offene Befunde (priorisiert)
| ID | Schwere | Befund | Plan |
|---|---|---|---|
| S4 | 🔴 | Selbst-Update alle 30 Minuten von `main` ohne Signatur | `NEMESIS_AUTO_UPDATE=0` setzen; signierte/gepinnte Updates (Phase 8/Pilot) |
| S5 | 🟠 | Ohne `NEMESIS_ZUGANG` ist der Sync-Server offen (Altverhalten) | Fail-closed |
| S6 | 🟠 | `nemesis-serve.js`: Anfragen von 127.0.0.1 ohne `X-Forwarded-For` gelten als frei → lokale Prozesse (z.B. OmniRoute/OpenHands auf demselben Server) erreichen Sync-Routen | Vor dem Betrieb weiterer Dienste auf **demselben** Server beheben (Phase 2/3); Empfehlung bis dahin: Worker-PC |
| S7 | 🟡 | `/fetch` im Sync-Server ohne SSRF-Schutz (nur Betreiber) | Web-Werkzeug vereinheitlichen |
| S8 | 🟡 | Admin-Geheimnis im URL-Pfad | Login mit Sitzung |
| S10 | 🟡 | Sandbox-Image nicht gepinnt; Server steuert Docker (root-äquivalent) | Digest-Pin, eigener Sandbox-Dienst |
| S11 | 🟡 | Eine OpenClaw-Instanz für alle Mandanten | Ein Benutzer (Betreiber) aktuell unkritisch; bei Kunden: Instanz pro Kunde |
| S12 | ⚪ | CSP mit `'unsafe-inline'`; Kunden-Token im `localStorage` | später |
| I1 | 🟠 | **OpenHands-Laufzeit `local`** führt Code auf dem Rechner des Agent Servers aus | Agent Server nur auf isoliertem Worker/Container; Phase 3 prüft Docker-Workspaces |
| I2 ✅ | 🟡 | **OmniRoute** listet Web-Zugänge (z.B. `ddgw`) mit Preis 0 | Behoben (Phase 2): nur vom Admin mit Begründung freigegebene Präfixe; getestet auch gegen echtes OmniRoute |
| I3 | 🟡 | OmniRoute-Verwaltungs-API bleibt im Headless-Modus erreichbar (laut Doku keine Sicherheitsgrenze) | Nur an 127.0.0.1 binden, `REQUIRE_API_KEY=true`, starke Secrets |

Behoben (früher): S1/S2/S3 (Kosten-Fallbacks), S9 (Lab-Direktaufruf), S13 (verwaiste Delegationen), Sandbox-Ausbruch `logic.js`.

## Datenschutz
- Daten liegen auf dem eigenen Server (`sync-data/`).
- Modellanfragen gehen an die gewählten Anbieter. Gratis-Anbieter können Eingaben laut ihren Bedingungen verwenden, daher **keine vertraulichen Daten an Gratis-Modelle**, ohne das bewusst zu entscheiden. Phase 2 ergänzt eine Kennzeichnung „vertraulich“ pro Mitarbeiter/Projekt, die nur freigegebene Anbieter zulässt.
- Löschen pro Mandant mit Protokoll.
