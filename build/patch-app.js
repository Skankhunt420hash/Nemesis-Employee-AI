// Haengt das App-Modul in die LAUFENDE nemesis-sync.js ein (2 Zeilen), ersetzt nichts.
// Ausgabe: SCHON | OK | ANKER
const fs = require("fs");
const datei = process.argv[2];
let s = fs.readFileSync(datei, "utf8");

if (s.includes('require("./nemesis-app.js")') && s.includes("APP.behandle")) { console.log("SCHON"); process.exit(0); }

const r1 = 'const SERVE = require("./nemesis-serve.js");';
const r2 = /^([ \t]*)if \(await SERVE\.behandle\(req, res, url, CORS\)\) return;/m;
if (s.split(r1).length !== 2 || !r2.test(s)) { console.log("ANKER"); process.exit(3); }

s = s.replace(r1, r1 + '\nconst APP = require("./nemesis-app.js");');
s = s.replace(r2, (m, einzug) => einzug + "if (await APP.behandle(req, res, url, CORS)) return;\n" + m);
fs.writeFileSync(datei + ".neu", s);
console.log("OK");
