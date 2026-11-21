# NEMESIS Zentrale: Plattform für handlungsfähige digitale Mitarbeiter

## Aufbau

| Datei | Zweck |
|---|---|
| `app/agenten/engine.js` | Agent-Engine: Mandanten, Agenten, Werkzeuge, Rechteprüfung, Arbeitsschleife, Sandbox, Freigaben, Notaus, Delegation, Audit, Tresor, Office, OpenClaw-Adapter |
| `app/agenten/http.js` | HTTP-API `/zentrale/api/...` mit Rollen (Betreiber/Kunde) |
| `app/agenten/zentrale.html` | Dashboard (eine Datei, ohne Build, für Handy und Desktop) |
| `build/einbetten.py` | bettet alle drei Dateien in `app/nemesis-app.js` ein, damit Selbst-Update und Installer unverändert funktionieren |
| `tests/` | `npm test`: Engine, Sandbox, HTTP/Mandanten, OpenClaw, logic.js-Sandbox |

## Zugänge
- **Betreiber:** `https://<domain>/k/<NEMESIS_ZUGANG>/zentrale` (oder in der Lab-App: Werkbank → „NEMESIS Zentrale“)
- **Kunde:** `https://<domain>/zentrale` mit Token `nxm_…` (wird beim Anlegen einmal angezeigt; neues Token über die API `/m/<id>/token`)
- **Kontaktformular des Kunden:** `POST https://<domain>/zentrale/oeffentlich/<kunde>/anfrage` (`{email, name, nachricht}`); das Snippet steht in der Zentrale unter Office

## Wie ein Agent arbeitet
1. **Analyse und Plan:** Die KI zerlegt das Ziel (sichtbar im Protokoll).
2. **Handeln:** Pro Schritt wählt die KI **ein** Werkzeug. Die Engine prüft die Rechte (`entscheide()`), führt das Werkzeug **wirklich** aus und gibt das echte Ergebnis zurück.
3. **Fehler korrigieren:** Fehlerausgaben (z.B. aus Tests) gehen an die KI zurück. Nach 8 Fehlern in Folge bricht der Lauf ab.
4. **Abschlussprüfung, die nicht von der KI kommt:** Gibt es `build`/`test` in `package.json`, führt die Engine beide selbst aus. Schlagen sie fehl, ist der Lauf **nicht fertig** (bis zu 3 Korrekturrunden).
5. **Freigaben/Rückfragen:** Der Lauf pausiert und wartet im Freigabe-Center. Danach läuft er weiter, auch nach einem Server-Neustart.

## Rechte (pro Agent und Werkzeug)
`aus` · `lesen` · `bestaetigung` · `begrenzt` · `autonom`, dazu das Autonomie-Level 0–3 des Agenten.
Harte Regeln im Code:
- Aktionen nach aussen (`extern`) brauchen **immer** eine Freigabe, ausser der Betreiber erlaubt es pro Kunde. `antwort_senden` und `openclaw_auftrag` brauchen sie **in jedem Fall**.
- Wurde Fremdinhalt gelesen (Web, E-Mail), brauchen Aktionen nach aussen und Löschaktionen eine Freigabe (Schutz vor Prompt-Injection).
- Rechte werden beim Start eines Laufs eingefroren. Delegation ergibt die Schnittmenge, also nie mehr Rechte als beim Auftraggeber.
- Es gibt kein Werkzeug, das Rechte, Limits oder die Konfiguration ändert.

## Sandbox (Terminal, Build, Tests, Git)
- `NEMESIS_SANDBOX=auto` (Standard): Docker, wenn verfügbar, sonst sind die Terminal-Werkzeuge **gesperrt**.
- Docker-Lauf: `--network none` (nur `pakete_installieren` hat Netz, dann mit `--ignore-scripts`), `--cap-drop ALL`, `no-new-privileges`, Benutzer 1000, Limits für Speicher, CPU und Prozesse, nur der Projektordner ist eingehängt.
- Image: `NEMESIS_SANDBOX_BILD` (Standard `node:22`, enthält git). Empfehlung: mit Digest pinnen.
- Auf dem Droplet einmalig: `apt-get install -y docker.io && docker pull node:22`

## Kosten und Limits
Pro Kunde: KI-Aufrufe/Tag, Aktionen/Tag, CHF/Tag, parallele Aufträge, maximale Stunden pro Auftrag. Pro Agent: Schritte, KI-Aufrufe und Werkzeuge pro Lauf. Die Kosten werden geschätzt (Gratis-Anbieter 0, bezahlte ≈ CHF 2 pro 1 Mio. Tokens).

## OpenClaw (optional)
1. OpenClaw-Gateway (Node ≥ 24.16) auf demselben Server, **nur loopback**: `openclaw gateway --port 18789`
2. Für Agentenaufträge in der Gateway-Config `gateway.http.endpoints.chatCompletions.enabled: true` setzen und dort einen Agenten (z.B. `desktop`) mit dem `computer`-Werkzeug auf einem verwalteten Desktop einrichten (OpenClaw-Doku `nodes/computer-use.md`).
3. In der Zentrale unter Kunden → OpenClaw-Gateway: URL, Token, Agent und freigeschaltete Kunden eintragen.

Werkzeuge: `browser_lesen` (lesen, Fremdinhalt), `browser_handeln` (extern, braucht Freigabe), `openclaw_auftrag` (braucht immer Freigabe). Die Engine erzwingt das Profil `openclaw` (oder `nemesis-<kunde>`); der persönliche Browser und die Wahl von Host oder Node sind gesperrt. Direkte Hoststeuerung ist **aus**.

## Datenschutz, Sicherung, Löschung
- Daten pro Kunde: `sync-data/_agenten/mandanten/<id>/` (Agenten, Office, Läufe, Projekte, Dokumente, `audit.jsonl`, `tresor.json`)
- Export: Zentrale → Einstellungen → „Alle Daten exportieren“ (JSON), oder Ordner-Backup
- Löschen: nur der Betreiber, mit Bestätigung über die Kunden-ID; Eintrag in `_agenten/loeschprotokoll.jsonl`
- Tresor-Schlüssel: `NEMESIS_TRESOR_SCHLUESSEL` (64 Hex-Zeichen) oder `_agenten/.tresor-schluessel` (chmod 600). **Getrennt sichern**, sonst sind gespeicherte Zugangsdaten nach einer Wiederherstellung unbrauchbar.
- Notaus: Kunden → NOTAUS (alle Kunden), „Alle stoppen“ (ein Kunde), „Stoppen“ (ein Lauf)
