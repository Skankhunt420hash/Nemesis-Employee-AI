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
