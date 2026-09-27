#!/usr/bin/env bash
# =====================================================================
#  NEMESIS SCHLUESSEL-CHECK
#  curl -fsSL https://raw.githubusercontent.com/Skankhunt420hash/Nemesis-Employee-AI/main/keys.sh | bash
#
#  Prueft jeden KI-Schluessel live beim Anbieter. Kaputte kannst du
#  direkt ersetzen (unsichtbar einfuegen). Nur was der Anbieter
#  akzeptiert, wird gespeichert. Danach Neustart + Test.
# =====================================================================
set -u
G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; B='\033[1m'; N='\033[0m'
TTY=/dev/tty; [ -r "$TTY" ] || TTY=/dev/null

main() {
echo; echo -e "${B}========== NEMESIS SCHLUESSEL-CHECK ==========${N}"

# Server finden
DIENST=""; DATEI=""
for U in $(systemctl list-units --type=service --all --no-legend 2>/dev/null | sed 's/^● *//' | awk '{print $1}'); do
  D=$(systemctl show "$U" -p ExecStart --value 2>/dev/null | grep -o '/[^ ;]*nemesis-sync[^ ;]*\.js' | head -1)
  [ -n "$D" ] && { DIENST="$U"; DATEI="$D"; break; }
done
ORDNER=$(dirname "${DATEI:-/opt/nemesis/x}")
ENVF="$ORDNER/.env"
[ -f "$ENVF" ] || { echo -e "  ${R}PROBLEM${N} $ENVF fehlt"; exit 1; }
PORT=$(systemctl show "$DIENST" -p Environment --value 2>/dev/null | tr ' ' '\n' | grep '^PORT=' | cut -d= -f2); PORT=${PORT:-3400}
cp "$ENVF" "$ENVF.bak-$(date +%Y%m%d-%H%M%S)"; chmod 600 "$ENVF".bak-* 2>/dev/null
echo "  Datei: $ENVF (Backup angelegt)"

sauber() { printf '%s' "$1" | tr -d '\r\n\t' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']*//" -e "s/[\"']*\$//" -e 's/^[Bb]earer[[:space:]]*//'; }
lesen()  { grep -E "^(export[[:space:]]+)?$1=" "$ENVF" | tail -1 | sed -E "s/^(export[[:space:]]+)?$1=//"; }
setzen() { local V="$1" W="$2"; sed -i -E "/^(export[[:space:]]+)?$V=/d" "$ENVF"; printf '%s=%s\n' "$V" "$W" >> "$ENVF"; chmod 600 "$ENVF"; }

# Test: gibt HTTP-Status zurueck
teste() {
  local P="$1" K="$2" URL H
  case "$P" in
    groq)       URL="https://api.groq.com/openai/v1/models" ;;
    gemini)     URL="https://generativelanguage.googleapis.com/v1beta/openai/models" ;;
    openrouter) URL="https://openrouter.ai/api/v1/key" ;;
    mistral)    URL="https://api.mistral.ai/v1/models" ;;
    cohere)     URL="https://api.cohere.com/v1/models" ;;
    openai)     URL="https://api.openai.com/v1/models" ;;
  esac
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $K" "$URL"
}

GEAENDERT=""
while IFS='|' read -r P VAR NAME WO; do
  echo; echo -e "${B}$NAME${N}"
  ROH=$(lesen "$VAR"); K=$(sauber "$ROH"); S="fehlt"
  if [ -n "$K" ]; then
    S=$(teste "$P" "$K")
    if [ "$S" = "200" ] && [ "$ROH" != "$K" ]; then setzen "$VAR" "$K"; GEAENDERT=1
      echo -e "  ${Y}REPARIERT${N} Schluessel hatte Leerzeichen/Anfuehrungszeichen, bereinigt"; fi
  fi
  if [ "$S" = "200" ]; then echo -e "  ${G}OK${N}      gueltig (...${K: -4})"; continue; fi
  case "$S" in
    fehlt) echo -e "  ${Y}FEHLT${N}   noch kein Schluessel" ;;
    401|403) echo -e "  ${R}UNGUELTIG${N} Anbieter lehnt ab ($S) — widerrufen oder falsch kopiert" ;;
    000) echo -e "  ${Y}KEIN NETZ${N} Anbieter nicht erreichbar, lasse ihn wie er ist"; continue ;;
    *) echo -e "  ${Y}FEHLER${N}  Anbieter antwortet $S" ;;
  esac
  [ "$P" = "openai" ] && { echo "          (OpenAI lasse ich wie es ist)"; continue; }
  echo "          Neuen Key holen (gratis): $WO"
  for V in 1 2; do
    echo -n "          Key einfuegen (unsichtbar), oder nur Enter = ueberspringen: "
    NEU=""; read -r -s NEU < "$TTY"; echo
    NEU=$(sauber "$NEU")
    [ -z "$NEU" ] && { echo "          uebersprungen"; break; }
    S2=$(teste "$P" "$NEU")
    if [ "$S2" = "200" ]; then setzen "$VAR" "$NEU"; GEAENDERT=1
      echo -e "  ${G}GESPEICHERT${N} Key funktioniert (...${NEU: -4})"; break
    else echo -e "  ${R}ABGELEHNT${N} Anbieter sagt $S2 — nicht gespeichert. Nochmal:"; fi
  done
done <<'LISTE'
gemini|GEMINI_API_KEY|Google Gemini (bestes Gratis-Modell, 1M Kontext)|aistudio.google.com/apikey
groq|GROQ_API_KEY|Groq (sehr schnell, gratis)|console.groq.com/keys
openrouter|OPENROUTER_API_KEY|OpenRouter (Nemotron, Qwen Coder, GPT-OSS gratis)|openrouter.ai/settings/keys
mistral|MISTRAL_API_KEY|Mistral (gratis Experiment-Tarif)|console.mistral.ai/api-keys
cohere|COHERE_API_KEY|Cohere (gratis Trial-Key)|dashboard.cohere.com/api-keys
openai|OPENAI_API_KEY|OpenAI (dein Abo, nur Rettung)|platform.openai.com/api-keys
LISTE

echo
if [ -n "$GEAENDERT" ] && [ -n "$DIENST" ]; then
  echo "  ...    Neustart $DIENST"
  systemctl restart "$DIENST"
  for i in $(seq 1 15); do sleep 1; curl -s "localhost:$PORT/health" | grep -q '"ok":true' && break; done
fi

Z=$(lesen NEMESIS_ZUGANG | tr -d "\"' \r")
if [ ${#Z} -ge 16 ]; then
  echo -e "${B}Test ueber deinen Server:${N}"
  for M in gemini llama openrouter mistral cohere; do
    T=$(curl -s --max-time 60 "localhost:$PORT/k/$Z/llm" -H 'Content-Type: application/json' \
        -d "{\"modell\":\"$M\",\"messages\":[{\"role\":\"user\",\"content\":\"Sag OK\"}],\"max_tokens\":20}")
    echo "$T" | M=$M node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d),m=process.env.M;
      const want={gemini:"gemini",llama:"groq",openrouter:"openrouter",mistral:"mistral",cohere:"cohere"}[m];
      if(j.ok&&j.anbieter===want) console.log("  \x1b[1;32mGRATIS\x1b[0m  "+want+": "+j.modell);
      else { const f=(j.versuche||[]).find(v=>v.anbieter===want); console.log("  \x1b[1;33m--\x1b[0m      "+want+": "+(f?(f.status||"netz")+" "+String(f.fehler).slice(0,90):"kein Schluessel")); } }catch(e){console.log("  -- "+process.env.M+": keine Antwort")}})'
  done
  T=$(curl -s --max-time 60 "localhost:$PORT/k/$Z/llm" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"Sag OK"}],"max_tokens":20}')
  echo "$T" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.ok?("\n  Automatik nimmt jetzt: \x1b[1m"+j.anbieter+" / "+j.modell+"\x1b[0m"+(j.frei?"  \x1b[1;32m(GRATIS)\x1b[0m":"  \x1b[1;33m(Abo)\x1b[0m")):"\n  Automatik: "+j.error)}catch(e){}})'
fi
echo
echo -e "${B}==============================================${N}"
}
main "$@"
