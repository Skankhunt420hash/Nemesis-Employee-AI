#!/usr/bin/env bash
# Baut install-app.sh aus der Vorlage + app/ Dateien. Aufruf: bash build/build.sh
set -e
cd "$(dirname "$0")/.."
python3 build/einbetten.py
node --check app/nemesis-app.js
python3 - <<'PY'
import base64
t=open("build/install-app.template.sh").read()
def b(p): return base64.encodebytes(open(p,"rb").read()).decode().rstrip("\n")
t=t.replace("@@APPJS@@",b("app/nemesis-app.js")).replace("@@APPHTML@@",b("app/nemesis-app.html")).replace("@@PATCH@@",b("build/patch-app.js")).replace("@@PATCHSERVE@@",b("build/patch-serve.js"))
open("install-app.sh","w").write(t)
PY
chmod +x install-app.sh
bash -n install-app.sh
echo "install-app.sh gebaut ($(wc -c < install-app.sh) Bytes)"
