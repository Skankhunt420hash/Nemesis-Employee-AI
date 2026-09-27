// Kunden-Chat: Claude zuerst, bei Ausfall automatisch Ausweichmodell (Rotator).
// Aendert nur den Funktionsnamen und haengt eine Huelle an. Ausgabe: SCHON | OK | ANKER
const fs = require("fs");
const datei = process.argv[2];
let s = fs.readFileSync(datei, "utf8");

if (s.includes("frageClaudeDirekt")) { console.log("SCHON"); process.exit(0); }
const alt = "async function frageClaude(agent, messages) {";
if (s.split(alt).length !== 2 || !s.includes("module.exports")) { console.log("ANKER"); process.exit(3); }

s = s.replace(alt, "async function frageClaudeDirekt(agent, messages) {");
const HUELLE = `
/* ===========================================================
   Ausweichmodell (Nemesis-App-Installer): Faellt Claude aus,
   antwortet automatisch der Rotator. Der Kunde merkt nichts.
   NEMESIS_KUNDEN_KI=rotator in .env -> Claude gar nicht fragen.
   =========================================================== */
let claudePause = 0;
async function frageClaude(agent, messages) {
  const modus = String(process.env.NEMESIS_KUNDEN_KI || "").toLowerCase();
  if (process.env.ANTHROPIC_API_KEY && modus !== "rotator" && Date.now() > claudePause) {
    try { return await frageClaudeDirekt(agent, messages); }
    catch (e) {
      const m = String(e.message || "");
      if (/credit|balance|authentication|api[-_ ]?key|permission|401|403/i.test(m)) claudePause = Date.now() + 10 * 60 * 1000;
      console.warn("[serve] Claude aus (" + m.slice(0, 120) + "), Ausweichmodell uebernimmt");
    }
  }
  const APP = require("./nemesis-app.js");
  const r = await APP.rotiere({
    system: agent.systemPrompt || "Du bist ein hilfreicher Assistent.",
    messages, max_tokens: Math.min(agent.maxTokens || 600, 1000),
  });
  if (r.status !== 200) throw new Error((r.body && r.body.error) || "kein Modell erreichbar");
  return { text: r.body.text, usage: {}, modell: r.body.anbieter + ":" + r.body.modell };
}
`;
const i = s.lastIndexOf("module.exports");
s = s.slice(0, i) + HUELLE + "\n" + s.slice(i);
fs.writeFileSync(datei + ".neu", s);
console.log("OK");
