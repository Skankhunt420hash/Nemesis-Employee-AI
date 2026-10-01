#!/usr/bin/env python3
# Schreibt die Seiten aus app/betrieb-seiten/ als Konstante in app/nemesis-app.js (zwischen den Markern).
import json, re, sys, os
r = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
js = os.path.join(r, "app", "nemesis-app.js"); d = os.path.join(r, "app", "betrieb-seiten")
rd = lambda n: open(os.path.join(d, n), encoding="utf8").read()
block = "/*SEITEN-START*/\nconst BETRIEB_SEITEN = " + json.dumps({"besitzer": rd("besitzer.html"), "gast": rd("gast.html"), "embed": rd("embed.js")}, ensure_ascii=False) + ";\n/*SEITEN-ENDE*/"
s = open(js, encoding="utf8").read()
if "/*SEITEN-START*/" in s:
    s = re.sub(r"/\*SEITEN-START\*/.*?/\*SEITEN-ENDE\*/", lambda m: block, s, flags=re.S)
else:
    sys.exit("Marker fehlt")
open(js, "w", encoding="utf8").write(s)
print("Seiten eingebettet:", len(block), "Bytes")

# Laufzeit (app/laufzeit/runtime.js) in nemesis-app.js und nemesis-app.html einbetten
lz = re.sub(r"^#!.*\n", "", open(os.path.join(r, "app", "laufzeit", "runtime.js"), encoding="utf8").read())
def einsetzen(datei, vorlage):
    t = open(datei, encoding="utf8").read()
    if "/*LZ-START*/" not in t:
        sys.exit("LZ-Marker fehlt in " + datei)
    blk = "/*LZ-START*/\n" + vorlage + "\n/*LZ-ENDE*/"
    t = re.sub(r"/\*LZ-START\*/.*?/\*LZ-ENDE\*/", lambda m: blk, t, flags=re.S)
    open(datei, "w", encoding="utf8").write(t)
einsetzen(js, "const APP_LAUFZEIT = " + json.dumps(lz, ensure_ascii=False) + ";")
einsetzen(os.path.join(r, "app", "nemesis-app.html"), "const LAUFZEIT_SRC = " + json.dumps(lz.replace("</", "<\\/"), ensure_ascii=False) + ";")
print("Laufzeit eingebettet:", len(lz), "Bytes")
