#!/usr/bin/env bash
# =====================================================================
#  NEMESIS APP-INSTALLER  (App + Gratis-Rotator + Failed-to-fetch-Fix)
#  Eine Zeile in der DigitalOcean-Konsole:
#  curl -fsSL https://raw.githubusercontent.com/Skankhunt420hash/Nemesis-Employee-AI/main/install-app.sh | bash
#
#  Baut nur DAZU (2 Zeilen in nemesis-sync.js), ersetzt nichts.
#  Backup vorher, bei Problem automatisch zurueck.
# =====================================================================
set -u
G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; B='\033[1m'; N='\033[0m'
ok()   { echo -e "  ${G}OK${N}      $*"; }
nein() { echo -e "  ${R}PROBLEM${N} $*"; PROBLEME=$((PROBLEME+1)); }
info() { echo -e "  ${Y}HINWEIS${N} $*"; }
stufe(){ echo; echo -e "${B}$*${N}"; }
PROBLEME=0

main() {
DOMAIN="${1:-${NEMESIS_DOMAIN:-nemesis-studio-ai.ch}}"
DOMAIN=$(echo "$DOMAIN" | tr "A-Z" "a-z" | sed -e "s#^https\?://##" -e "s#/.*##" -e "s#^www\.##")

echo
echo -e "${B}============ NEMESIS APP-INSTALLER ============${N}"

# ---------------------------------------------------------------------
stufe "1/7  Werkzeuge"
command -v node >/dev/null 2>&1 || { nein "Node.js fehlt"; exit 1; }
NV=$(node -p 'process.versions.node.split(".")[0]')
[ "$NV" -ge 18 ] && ok "Node.js $NV" || { nein "Node.js $NV zu alt (brauche 18+)"; exit 1; }
command -v curl >/dev/null 2>&1 || { nein "curl fehlt"; exit 1; }

# ---------------------------------------------------------------------
stufe "2/7  Server finden"
MODUS=""; NAME=""; DATEI=""; PORT=""; DIENSTUSER=""
if command -v systemctl >/dev/null 2>&1; then
  ALLE=$(systemctl list-units --type=service --all --no-legend 2>/dev/null | sed 's/^● *//' | awk '{print $1}')
  for U in $(echo "$ALLE" | grep -i nemesis) $(echo "$ALLE" | grep -vi nemesis); do
    EX=$(systemctl show "$U" -p ExecStart --value 2>/dev/null)
    D=$(echo "$EX" | grep -o '/[^ ;]*nemesis-sync[^ ;]*\.js' | head -1)
    if [ -n "$D" ]; then
      MODUS="systemd"; NAME="$U"; DATEI="$D"
      PORT=$(systemctl show "$U" -p Environment --value 2>/dev/null | tr ' ' '\n' | grep '^PORT=' | cut -d= -f2)
      DIENSTUSER=$(systemctl show "$U" -p User --value 2>/dev/null)
      break
    fi
  done
fi
if [ -z "$MODUS" ] && command -v pm2 >/dev/null 2>&1; then
  INFO=$(pm2 jlist 2>/dev/null | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{ try {
    const l=JSON.parse(d.slice(d.indexOf("[")));
    const p=l.find(x=>/nemesis-sync/i.test((x.pm2_env||{}).pm_exec_path||"")||/nemesis-sync/i.test(x.name||""));
    if(!p) return; const e=p.pm2_env||{}, env=e.env||{};
    console.log([p.name,e.pm_exec_path,env.PORT||e.PORT||""].join("\t")); } catch(err){} });')
  if [ -n "$INFO" ]; then MODUS="pm2"; IFS=$'\t' read -r NAME DATEI PORT <<< "$INFO"; fi
fi
[ -z "$MODUS" ] && { nein "Kein laufender nemesis-sync gefunden. Schick mir: systemctl list-units --type=service | grep -i nemesis"; exit 1; }
[ -f "$DATEI" ] || { nein "Datei $DATEI fehlt"; exit 1; }
PORT=${PORT:-3400}; ORDNER=$(dirname "$DATEI")
ok "$MODUS-Dienst \"$NAME\" · $DATEI · Port $PORT"
FREI=$(df -Pm "$ORDNER" | awk 'NR==2{print $4}')
[ "${FREI:-0}" -lt 100 ] && { nein "Nur ${FREI} MB frei. Erst Platz schaffen."; exit 1; }
[ "$FREI" -lt 1000 ] && info "Nur ${FREI} MB frei, bald aufraeumen." || ok "Speicher: ${FREI} MB frei"

# ---------------------------------------------------------------------
stufe "3/7  Backup"
BK="$ORDNER/backup-app-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" && cp "$DATEI" "$BK/" || { nein "Backup fehlgeschlagen"; exit 1; }
for f in nemesis-app.js nemesis-app.html; do [ -f "$ORDNER/$f" ] && cp "$ORDNER/$f" "$BK/"; done
ok "Gesichert in $BK"

neustart() {
  if [ "$MODUS" = "systemd" ]; then systemctl daemon-reload >/dev/null 2>&1; systemctl restart "$NAME" >/dev/null 2>&1
  else pm2 restart "$NAME" --update-env >/dev/null 2>&1; pm2 save >/dev/null 2>&1; fi
}
logs() {
  if [ "$MODUS" = "systemd" ]; then journalctl -u "$NAME" -n 15 --no-pager 2>/dev/null
  else pm2 logs "$NAME" --lines 15 --nostream 2>/dev/null; fi
}
zurueck() {
  echo; echo -e "${R}Rolle zurueck ...${N}"
  cp "$BK/$(basename "$DATEI")" "$DATEI"
  for f in nemesis-app.js nemesis-app.html; do
    if [ -f "$BK/$f" ]; then cp "$BK/$f" "$ORDNER/$f"; else rm -f "$ORDNER/$f"; fi
  done
  neustart; sleep 2
  curl -s "localhost:$PORT/health" | grep -q '"ok":true' && echo -e "  ${G}Alter Stand laeuft wieder.${N}" || echo -e "  ${R}Auch alter Stand startet nicht. Logs schicken.${N}"
}

# ---------------------------------------------------------------------
stufe "4/7  App + Gratis-Rotator einbauen"
TMP=$(mktemp -d)
base64 -d > "$TMP/nemesis-app.js" <<'__APPJS__'
@@APPJS@@
__APPJS__
base64 -d > "$TMP/nemesis-app.html" <<'__APPHTML__'
@@APPHTML@@
__APPHTML__
base64 -d > "$TMP/patch-app.js" <<'__PATCH__'
@@PATCH@@
__PATCH__
node --check "$TMP/nemesis-app.js" 2>/dev/null || { nein "Installer beschaedigt. Nochmal herunterladen."; exit 1; }
grep -q "Nemesis Lab" "$TMP/nemesis-app.html" || { nein "App-Datei beschaedigt. Nochmal herunterladen."; exit 1; }
[ -f "$ORDNER/nemesis-serve.js" ] || { nein "nemesis-serve.js fehlt. Erst den Haupt-Installer (install.sh) laufen lassen."; exit 1; }

cp "$TMP/nemesis-app.js" "$TMP/nemesis-app.html" "$ORDNER/"
[ -n "$DIENSTUSER" ] && [ "$DIENSTUSER" != "root" ] && chown "$DIENSTUSER" "$ORDNER/nemesis-app.js" "$ORDNER/nemesis-app.html" 2>/dev/null
ERG=$(node "$TMP/patch-app.js" "$DATEI" 2>/dev/null)
case "$ERG" in
  SCHON) ok "War schon eingebaut, App + Rotator aktualisiert" ;;
  OK)    mv "$DATEI.neu" "$DATEI"; ok "Eingebaut (2 Zeilen), dein Router und alles andere bleibt" ;;
  *)     nein "nemesis-sync.js sieht anders aus als erwartet, fasse nichts an."
         echo "          Schick mir: grep -n 'SERVE' $DATEI"; zurueck; exit 1 ;;
esac
node --check "$DATEI" 2>/dev/null || { nein "Syntaxfehler nach Einbau"; zurueck; exit 1; }
ok "Syntax sauber"

# Zugang (Schloss) holen oder anlegen
ZUFALL() { head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" | head -c 32; }
ZUGANG=""
if [ "$MODUS" = "systemd" ]; then
  ENVF="$ORDNER/.env"; touch "$ENVF"; chmod 600 "$ENVF"
  ZUGANG=$(grep '^NEMESIS_ZUGANG=' "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")
  if [ ${#ZUGANG} -lt 16 ]; then
    ZUGANG=$(ZUFALL); sed -i '/^NEMESIS_ZUGANG=/d' "$ENVF"; echo "NEMESIS_ZUGANG=$ZUGANG" >> "$ENVF"
    info "Neuen Zugang angelegt (alter Link gilt nicht mehr)"
  fi
  DROP="/etc/systemd/system/$NAME.d"; mkdir -p "$DROP"
  grep -rqs "EnvironmentFile=.*$ENVF" "$DROP" /etc/systemd/system/"$NAME" 2>/dev/null || \
    printf '[Service]\nEnvironmentFile=%s\n' "$ENVF" > "$DROP/nemesis-schluessel.conf"
  [ -n "$DIENSTUSER" ] && [ "$DIENSTUSER" != "root" ] && chown "$DIENSTUSER" "$ENVF"
else
  ZUGANG=$(grep -o "NEMESIS_ZUGANG='[^']*'" ~/.bashrc 2>/dev/null | tail -1 | cut -d"'" -f2)
  if [ ${#ZUGANG} -lt 16 ]; then ZUGANG=$(ZUFALL); echo "export NEMESIS_ZUGANG='$ZUGANG'" >> ~/.bashrc; fi
  export NEMESIS_ZUGANG="$ZUGANG"
fi
ok "Schloss aktiv"

# ---------------------------------------------------------------------
stufe "5/7  Neustart"
cd "$ORDNER"; neustart
LEBT=""
for i in $(seq 1 20); do
  sleep 1
  curl -s "localhost:$PORT/health" 2>/dev/null | grep -q '"ok":true' && \
  curl -s "localhost:$PORT/k/$ZUGANG/app" 2>/dev/null | grep -q "Nemesis Lab" && { LEBT=1; break; }
done
if [ -n "$LEBT" ]; then ok "Server laeuft mit App + Rotator"
else nein "Server startet nicht richtig. Log:"; logs | tail -15 | sed 's/^/          /'; zurueck; exit 1; fi

# ---------------------------------------------------------------------
stufe "6/7  Webserver (nginx) gegen 'Failed to fetch' haerten"
if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
  # a) Grosse Anfragen + lange KI-Antworten erlauben (sonst 413/504 -> Failed to fetch)
  LIM=/etc/nginx/conf.d/nemesis-limits.conf
  if [ ! -f "$LIM" ]; then
    printf 'client_max_body_size 25m;\nproxy_read_timeout 180s;\nproxy_send_timeout 180s;\n' > "$LIM"
    if nginx -t >/dev/null 2>&1; then systemctl reload nginx; ok "Limits: 25 MB, 180 s Wartezeit"
    else rm -f "$LIM"; info "nginx hat eigene Limits gesetzt, lasse sie"; fi
  else ok "Limits schon gesetzt"; fi

  # b) Schloss muss auch hinter nginx wirken (braucht X-Forwarded-For)
  sleep 1
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$DOMAIN/state?raum=nemesis")
  if [ "$C" = "200" ]; then
    SITE=$(grep -lsE "proxy_pass[^;]*:$PORT" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | head -1)
    if [ -n "$SITE" ]; then
      SITE=$(readlink -f "$SITE"); cp "$SITE" "$BK/nginx-site.vorher"
      sed -i -E "s#^([[:space:]]*)(proxy_pass[^;]*:$PORT[^;]*;)#\1\2\n\1proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;#" "$SITE"
      if nginx -t >/dev/null 2>&1; then systemctl reload nginx; sleep 1
        C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$DOMAIN/state?raum=nemesis")
        [ "$C" = "401" ] && ok "Schloss war hinter nginx offen, jetzt dicht" || nein "Schloss hinter nginx noch offen ($C)"
      else cp "$BK/nginx-site.vorher" "$SITE"; nein "nginx-Anpassung abgelehnt, zurueckgesetzt"; fi
    else nein "Deine Agenten sind ueber https ohne Zugang lesbar. nginx-Datei nicht gefunden."; fi
  elif [ "$C" = "401" ]; then ok "Schloss wirkt auch ueber https"
  else info "https://$DOMAIN antwortet mit $C (Domain nicht erreichbar?)"; fi
else
  info "Kein nginx aktiv, uebersprungen"
fi

# ---------------------------------------------------------------------
stufe "7/7  Alles pruefen"
HTTPS=""
curl -s --max-time 8 "https://$DOMAIN/health" | grep -q '"ok":true' && HTTPS=1
[ -n "$HTTPS" ] && ok "https://$DOMAIN erreichbar" || nein "https://$DOMAIN nicht erreichbar"
if [ -n "$HTTPS" ]; then
  A=$(curl -s --max-time 10 "https://$DOMAIN/k/$ZUGANG/app" | grep -c "Nemesis Lab")
  [ "$A" -gt 0 ] && ok "App wird ueber https ausgeliefert" || nein "App ueber https nicht erreichbar"
fi

ST=$(curl -s "localhost:$PORT/k/$ZUGANG/llm/status")
HAT=$(echo "$ST" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d).anbieter;console.log(Object.keys(a).filter(k=>a[k].schluessel).join(", "))}catch(e){}})')
if [ -n "$HAT" ]; then ok "KI-Schluessel gefunden: $HAT"
else
  nein "Keine KI-Schluessel gefunden."
  [ -f "$ORDNER/.env" ] && echo "          Namen in .env: $(grep -oE '^[A-Z0-9_]+' "$ORDNER/.env" | tr '\n' ' ')"
  echo "          Erwartet z.B. GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY"
fi
if [ -n "$HAT" ]; then
  echo "  ...    Teste KI (bis 60 s)"
  T=$(curl -s --max-time 100 "localhost:$PORT/k/$ZUGANG/llm" -H 'Content-Type: application/json' \
      -d '{"system":"Antworte nur mit OK.","messages":[{"role":"user","content":"Test"}],"max_tokens":20}')
  ANB=$(echo "$T" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.ok?j.anbieter+" / "+j.modell+(j.frei?" (gratis)":" (Abo)"):"FEHLER "+(j.error||"")+" "+JSON.stringify(j.versuche||[]).slice(0,300))}catch(e){console.log("FEHLER keine Antwort")}})')
  case "$ANB" in FEHLER*) nein "KI: $ANB" ;; *) ok "KI antwortet: $ANB" ;; esac
fi

# ---------------------------------------------------------------------
echo
echo -e "${B}===============================================${N}"
[ "$PROBLEME" -eq 0 ] && echo -e "${G}  ALLES GRUEN.${N}" || echo -e "${R}  $PROBLEME PROBLEM(E).${N} Rote Zeilen in den Chat kopieren."
echo -e "${B}===============================================${N}"
echo
if [ -n "$HTTPS" ]; then LINK="https://$DOMAIN/k/$ZUGANG/app"; else LINK="http://<deine-ip>:$PORT/k/$ZUGANG/app"; fi
echo -e "${B}  DEINE APP (am Handy oeffnen):${N}"
echo
echo -e "  ${G}$LINK${N}"
echo
echo "  Dann im Browser-Menue: 'Zum Startbildschirm hinzufuegen'."
echo "  Deine 12 Agenten vom Handy: in der ALTEN App Zahnrad -> 'Daten sichern',"
echo "  in der neuen App Zahnrad -> 'Daten einspielen'."
echo -e "  ${Y}Der Link ist dein Passwort. Nicht teilen.${N}"
echo "  Backup: $BK"
}
main "$@"
