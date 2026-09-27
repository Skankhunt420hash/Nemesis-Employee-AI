/* ===========================================================
   NEMESIS SERVE  ·  nemesis-serve.js
   Die Auslieferung an Kunden.

   Der Kunde gibt NIEMALS einen Schlüssel ein. Dein Schlüssel
   liegt hier auf dem Server. Der Browser des Kunden kennt nur
   die öffentliche Agent-ID.

   Liest die Agenten direkt aus sync-data/. Du schaltest einen
   Agenten in der App frei, drückst Sync — fertig. Keine Datei
   die du hochladen musst.

   Wird von nemesis-sync.js eingebunden.
   =========================================================== */

const fs = require("fs");
const path = require("path");

const SYNC_DIR = process.env.DATA_DIR || path.join(__dirname, "sync-data");
const USAGE_FILE = path.join(SYNC_DIR, "_verbrauch.json");

/* ---------- Bremse 2: harter Deckel auf die Antwortlänge ---------- */
const MAX_OUTPUT = 400;

/* ---------- Bremse 3: Rate-Limits ---------- */
const IP_PRO_MINUTE = 8;
const PRO_SITZUNG = 25;
const SITZUNG_TTL_MIN = 120;

/* ---------- Nur die letzten 6 Wortwechsel mitschicken ---------- */
const VERLAUF_TURNS = 6;

/* ---------- Preise USD pro 1 Mio Token (Stand August 2026) ---------- */
const PREISE = {
  "claude-haiku-4-5":  { in: 1.00, out: 5.00,  cw: 1.25, cr: 0.10 },
  "claude-sonnet-5":   { in: 2.00, out: 10.00, cw: 2.50, cr: 0.20 },
  "claude-opus-5":     { in: 5.00, out: 25.00, cw: 6.25, cr: 0.50 },
};
const STANDARD_MODELL = "claude-haiku-4-5";

/* ===========================================================
   Agenten aus dem Sync-Zustand lesen
   =========================================================== */

let agentIndex = null;
let indexZeit = 0;
const INDEX_TTL = 20000;

function ladeAgenten() {
  if (agentIndex && Date.now() - indexZeit < INDEX_TTL) return agentIndex;

  const index = {};
  try {
    for (const datei of fs.readdirSync(SYNC_DIR)) {
      if (!datei.endsWith(".json") || datei.startsWith("_")) continue;
      let state;
      try {
        state = JSON.parse(fs.readFileSync(path.join(SYNC_DIR, datei), "utf8"));
      } catch (e) { continue; }

      const liste = Array.isArray(state) ? state : (state.agents || []);
      for (const a of liste) {
        const p = a && a.publish;
        if (!p || !p.id || p.active === false) continue;
        index[p.id] = { ...p, _raum: datei.replace(/\.json$/, "") };
      }
    }
  } catch (e) {
    console.error("[serve] sync-data nicht lesbar:", e.message);
  }

  agentIndex = index;
  indexZeit = Date.now();
  return index;
}

function holeAgent(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) return null;
  return ladeAgenten()[id] || null;
}

/* ===========================================================
   Bremse 1: Verbrauchszähler pro Agent pro Monat
   =========================================================== */

let verbrauch = null;
let schmutzig = false;

function monat() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function ladeVerbrauch() {
  if (verbrauch) return verbrauch;
  try { verbrauch = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")); }
  catch (e) { verbrauch = {}; }
  return verbrauch;
}

function sichereVerbrauch() {
  if (!schmutzig || !verbrauch) return;
  try {
    fs.writeFileSync(USAGE_FILE + ".tmp", JSON.stringify(verbrauch, null, 1));
    fs.renameSync(USAGE_FILE + ".tmp", USAGE_FILE);
    schmutzig = false;
  } catch (e) { console.error("[serve] Verbrauch nicht speicherbar:", e.message); }
}
setInterval(sichereVerbrauch, 10000).unref();
// Wichtig: wer SIGTERM abfaengt, muss selbst beenden. Sonst laesst sich der
// Server nicht mehr stoppen und blockiert beim Neustart den Port.
process.on("SIGTERM", () => { sichereVerbrauch(); process.exit(0); });
process.on("SIGINT", () => { sichereVerbrauch(); process.exit(0); });

function konto(id) {
  const alle = ladeVerbrauch();
  const m = monat();
  if (!alle[id]) alle[id] = {};
  if (!alle[id][m]) alle[id][m] = { nachrichten: 0, tokenRein: 0, tokenRaus: 0, kostenUsd: 0 };
  return alle[id][m];
}

function bucheVerbrauch(id, modell, u) {
  const k = konto(id);
  const p = PREISE[modell] || PREISE[STANDARD_MODELL];
  const rein = u.input_tokens || 0, raus = u.output_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
  const kosten = (rein / 1e6) * p.in + (raus / 1e6) * p.out
               + (cw / 1e6) * p.cw + (cr / 1e6) * p.cr;
  k.nachrichten++;
  k.tokenRein += rein + cw + cr;
  k.tokenRaus += raus;
  k.kostenUsd = Math.round((k.kostenUsd + kosten) * 1e6) / 1e6;
  schmutzig = true;
  return kosten;
}

function quotaVoll(agent) {
  const limit = agent.quota && agent.quota.messagesPerMonth;
  if (!limit || limit <= 0) return false;
  return konto(agent.id).nachrichten >= limit;
}

/* ===========================================================
   Bremse 3: Rate-Limit
   =========================================================== */

const ipTreffer = new Map();
const sitzungen = new Map();

function rateLimit(agentId, ip, sid) {
  const jetzt = Date.now();

  const key = agentId + ":" + ip;
  const treffer = (ipTreffer.get(key) || []).filter((t) => jetzt - t < 60000);
  if (treffer.length >= IP_PRO_MINUTE) return { ok: false, grund: "ip" };
  treffer.push(jetzt);
  ipTreffer.set(key, treffer);

  if (sid) {
    const s = sitzungen.get(sid) || { n: 0, letzt: jetzt };
    if (jetzt - s.letzt > SITZUNG_TTL_MIN * 60000) s.n = 0;
    if (s.n >= PRO_SITZUNG) return { ok: false, grund: "sitzung" };
    s.n++; s.letzt = jetzt;
    sitzungen.set(sid, s);
  }
  return { ok: true };
}

setInterval(() => {
  const jetzt = Date.now();
  for (const [k, v] of ipTreffer) {
    const lebt = v.filter((t) => jetzt - t < 60000);
    if (lebt.length) ipTreffer.set(k, lebt); else ipTreffer.delete(k);
  }
  for (const [k, v] of sitzungen) {
    if (jetzt - v.letzt > SITZUNG_TTL_MIN * 60000) sitzungen.delete(k);
  }
}, 60000).unref();

/* ===========================================================
   Hilfsfunktionen
   =========================================================== */

function domainErlaubt(agent, origin) {
  const liste = agent.allowedOrigins;
  if (!liste || !liste.length || liste.includes("*")) return true;
  if (!origin) return true;                       // QR-Code, direkter Aufruf
  if (liste.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return liste.some((e) => e.startsWith("*.") && host.endsWith(e.slice(1)));
  } catch (e) { return false; }
}

function saeubere(roh) {
  if (!Array.isArray(roh)) return [];
  const sauber = roh
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000) }))
    .filter((m) => m.content.length);
  const kurz = sauber.slice(-(VERLAUF_TURNS * 2));
  while (kurz.length && kurz[0].role !== "user") kurz.shift();
  return kurz;
}

function oeffentlich(a) {
  return {
    id: a.id,
    name: a.name || a.id,
    greeting: a.greeting || "Guten Tag, wie kann ich helfen?",
    placeholder: a.placeholder || "Ihre Frage…",
    suggestions: (a.suggestions || []).slice(0, 4),
    brand: {
      color: (a.brand && a.brand.color) || "#1f2937",
      textOnColor: (a.brand && a.brand.textOnColor) || "#ffffff",
      position: (a.brand && a.brand.position) || "right",
    },
  };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ===========================================================
   Anthropic aufrufen
   =========================================================== */

async function frageClaude(agent, messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY fehlt");

  const modell = agent.model || STANDARD_MODELL;
  const promptText = agent.systemPrompt || "Du bist ein hilfreicher Assistent.";

  // Caching greift bei Haiku erst ab ~2048 Token, also grob 8000 Zeichen.
  const system = promptText.length >= 8000
    ? [{ type: "text", text: promptText, cache_control: { type: "ephemeral" } }]
    : promptText;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modell,
        max_tokens: Math.min(agent.maxTokens || MAX_OUTPUT, MAX_OUTPUT),
        system,
        messages,
      }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    if (!r.ok) throw new Error((d.error && d.error.message) || "HTTP " + r.status);
    const text = (d.content || []).filter((b) => b.type === "text")
      .map((b) => b.text).join("\n").trim();
    return { text, usage: d.usage || {}, modell };
  } finally { clearTimeout(t); }
}

/* ===========================================================
   Das Widget — als Text hier drin, damit du nur EINE Datei hast
   =========================================================== */

const WIDGET = String.raw`(function(){
"use strict";
var S=document.currentScript; if(!S) return;
var AGENT=S.getAttribute("data-agent"); if(!AGENT){console.error("[Nemesis] data-agent fehlt");return;}
var API=S.getAttribute("data-api")||new URL(S.src).origin;
var MODE=S.getAttribute("data-mode")==="inline"?"inline":"bubble";
var TARGET=S.getAttribute("data-target");
if(window.__nemesis__===AGENT)return; window.__nemesis__=AGENT;

var sid; try{ sid=sessionStorage.getItem("nx:"+AGENT);
  if(!sid){sid="s"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  sessionStorage.setItem("nx:"+AGENT,sid);} }catch(e){ sid="s"+Math.random().toString(36).slice(2,10); }

var hist=[],busy=false,offen=MODE==="inline",cfg=null,root,panel,log,feld,knopf,launcher;

function styles(c){return ":host{all:initial}*{box-sizing:border-box;margin:0;padding:0}"+
".w{font:400 15px/1.5 ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;color:#16161a;-webkit-font-smoothing:antialiased}"+
".lc{position:fixed;bottom:20px;"+c.s+":20px;z-index:2147483000;width:56px;height:56px;border-radius:28px;border:0;background:"+c.b+";color:"+c.t+";box-shadow:0 6px 22px rgba(0,0,0,.19);cursor:pointer;display:grid;place-items:center;transition:transform .18s cubic-bezier(.2,.9,.3,1)}"+
".lc:hover{transform:scale(1.06)}.lc:active{transform:scale(.97)}.lc:focus-visible{outline:3px solid "+c.b+";outline-offset:3px}.lc svg{width:25px;height:25px}"+
".p{position:fixed;bottom:88px;"+c.s+":20px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.2),0 0 0 1px rgba(0,0,0,.05);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(10px) scale(.985);pointer-events:none;transition:opacity .2s,transform .2s cubic-bezier(.2,.9,.3,1)}"+
".p.on{opacity:1;transform:none;pointer-events:auto}"+
".w.il{display:flex;flex:1;min-height:0;width:100%}.w.il .p{position:static;width:100%;height:auto;max-height:none;flex:1;min-height:0;border-radius:0;box-shadow:none;opacity:1;transform:none;pointer-events:auto}.w.il .h,.w.il .lc{display:none}"+
".h{padding:14px 16px;background:"+c.b+";color:"+c.t+";display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto}"+
".h .t{font-size:15px;font-weight:600;letter-spacing:-.01em}.h button{background:0;border:0;color:inherit;cursor:pointer;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;opacity:.82}.h button:hover{opacity:1;background:rgba(255,255,255,.15)}.h svg{width:17px;height:17px}"+
".lg{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 16px;display:flex;flex-direction:column;gap:11px;background:#fafafa}"+
".m{max-width:84%;padding:10px 13px;border-radius:14px;font-size:14.5px;word-break:break-word}"+
".m.a{align-self:flex-start;background:#fff;border:1px solid #e8e8ec;border-bottom-left-radius:5px;white-space:pre-wrap}"+
".m.u{align-self:flex-end;background:"+c.b+";color:"+c.t+";border-bottom-right-radius:5px}"+
".d{display:flex;gap:4px;align-items:center;padding:3px 1px}.d i{width:6px;height:6px;border-radius:50%;background:#b6b6c0;animation:bo 1.3s infinite ease-in-out}.d i:nth-child(2){animation-delay:.16s}.d i:nth-child(3){animation-delay:.32s}"+
"@keyframes bo{0%,70%,100%{opacity:.35;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}"+
".c{display:flex;flex-wrap:wrap;gap:7px}.c button{font:inherit;font-size:13px;padding:7px 12px;cursor:pointer;background:#fff;border:1px solid #dcdce2;border-radius:16px;color:#3a3a44}.c button:hover{border-color:"+c.b+"}"+
".b{flex:0 0 auto;padding:11px 12px calc(11px + env(safe-area-inset-bottom));border-top:1px solid #eaeaee;background:#fff;display:flex;gap:8px;align-items:flex-end}"+
".b textarea{flex:1;resize:none;font:inherit;font-size:15px;color:#16161a;padding:9px 12px;border:1px solid #dcdce2;border-radius:20px;max-height:110px;min-height:40px;line-height:1.4;background:#fff}"+
".b textarea:focus{outline:0;border-color:"+c.b+"}.b textarea::placeholder{color:#9a9aa4}"+
".sd{flex:0 0 auto;width:40px;height:40px;border-radius:20px;border:0;background:"+c.b+";color:"+c.t+";cursor:pointer;display:grid;place-items:center}.sd:disabled{opacity:.35;cursor:default}.sd svg{width:17px;height:17px}"+
".n{font-size:11px;color:#a0a0aa;text-align:center;padding:0 12px 9px}"+
"@media(max-width:480px){.p{bottom:0;"+c.s+":0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.lc{bottom:16px;"+c.s+":16px}}"+
"@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}";}

function bauen(){
  var c={b:cfg.brand.color,t:cfg.brand.textOnColor,s:cfg.brand.position==="left"?"left":"right"};
  var host=document.createElement("div"); host.setAttribute("data-nemesis",AGENT);
  root=host.attachShadow({mode:"open"});
  var st=document.createElement("style"); st.textContent=styles(c); root.appendChild(st);
  var w=document.createElement("div"); w.className="w"+(MODE==="inline"?" il":"");
  w.innerHTML='<button class="lc" aria-label="Chat öffnen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.8A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/></svg></button>'+
  '<div class="p" role="dialog" aria-label="Chat"><div class="h"><span class="t"></span><button class="x" aria-label="Schliessen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'+
  '<div class="lg" role="log" aria-live="polite"></div>'+
  '<div class="b"><textarea rows="1" aria-label="Nachricht"></textarea><button class="sd" aria-label="Senden"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button></div>'+
  '<div class="n">Automatischer Assistent</div></div>';
  root.appendChild(w);
  panel=root.querySelector(".p"); log=root.querySelector(".lg");
  feld=root.querySelector("textarea"); knopf=root.querySelector(".sd"); launcher=root.querySelector(".lc");
  root.querySelector(".t").textContent=cfg.name; feld.placeholder=cfg.placeholder;
  launcher.onclick=um; root.querySelector(".x").onclick=um; knopf.onclick=function(){senden();};
  feld.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();senden();}});
  feld.addEventListener("input",function(){feld.style.height="auto";feld.style.height=Math.min(feld.scrollHeight,110)+"px";});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&offen&&MODE==="bubble")um();});
  var ziel=(MODE==="inline"&&TARGET)?document.querySelector(TARGET):null;
  (ziel||document.body).appendChild(host);
  gruss(); if(MODE==="inline")panel.classList.add("on");
}
function blase(r,t){var e=document.createElement("div");e.className="m "+(r==="user"?"u":"a");e.textContent=t;log.appendChild(e);rollen();return e;}
function rollen(){requestAnimationFrame(function(){log.scrollTop=log.scrollHeight;});}
function gruss(){ blase("a",cfg.greeting);
  if(cfg.suggestions&&cfg.suggestions.length){var box=document.createElement("div");box.className="c";
    cfg.suggestions.forEach(function(s){var b=document.createElement("button");b.textContent=s;
      b.onclick=function(){box.remove();senden(s);};box.appendChild(b);});
    log.appendChild(box);rollen();}}
function um(){offen=!offen;panel.classList.toggle("on",offen);
  launcher.setAttribute("aria-label",offen?"Chat schliessen":"Chat öffnen");
  if(offen)setTimeout(function(){feld.focus();},220);}
function tippt(){var e=document.createElement("div");e.className="m a";
  e.innerHTML='<span class="d"><i></i><i></i><i></i></span>';log.appendChild(e);rollen();return e;}
function senden(vor){
  var t=(vor||feld.value).trim(); if(!t||busy)return;
  var ch=root.querySelector(".c"); if(ch)ch.remove();
  if(!vor){feld.value="";feld.style.height="auto";}
  blase("user",t); hist.push({role:"user",content:t});
  busy=true; knopf.disabled=true; var w=tippt();
  fetch(API+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({agentId:AGENT,sessionId:sid,messages:hist})})
  .then(function(r){return r.json();})
  .then(function(d){ w.remove();
    var a=d.reply||"Da ist etwas schiefgelaufen.";
    blase("a",a);
    if(!d.quotaExceeded&&!d.rateLimited&&!d.failed)hist.push({role:"assistant",content:a});
    if(d.quotaExceeded||d.rateLimited){feld.disabled=true;feld.placeholder="Chat beendet";}})
  .catch(function(){w.remove();blase("a","Keine Verbindung. Bitte versuchen Sie es erneut.");})
  .finally(function(){busy=false;knopf.disabled=false;if(!feld.disabled&&!vor)feld.focus();});
}
function start(){
  fetch(API+"/api/agent/"+encodeURIComponent(AGENT))
  .then(function(r){if(!r.ok)throw new Error("Agent "+AGENT+" nicht gefunden");return r.json();})
  .then(function(d){cfg=d;bauen();window.NemesisChat={open:function(){if(!offen)um();}};})
  .catch(function(e){console.error("[Nemesis]",e.message);});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();`;

/* ===========================================================
   Landingpage
   =========================================================== */

/* ===========================================================
   Restaurant-Website  ·  /a/<agent>
   Eine Seite: Kopf, heute geöffnet, Zeiten, Karte, Kontakt,
   Impressum — und der Assistent unten rechts.
   Alles aus den Daten, die beim Freischalten mitkommen.
   =========================================================== */

const TAGE = [["montag","Montag"],["dienstag","Dienstag"],["mittwoch","Mittwoch"],
              ["donnerstag","Donnerstag"],["freitag","Freitag"],["samstag","Samstag"],["sonntag","Sonntag"]];

function preisText(p) {
  const n = Number(p);
  return isFinite(n) && p !== null && p !== "" ? n.toFixed(2) : "";
}

function telLink(t) {
  const n = String(t || "").replace(/[^\d+]/g, "");
  return n.length >= 6 ? "tel:" + n : "";
}

function hellOderDunkel(hex) {
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#ffffff";
  const v = parseInt(m[1], 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#1a1714" : "#ffffff";
}

function landingpage(a, basis) {
  const p = oeffentlich(a);
  const s = a.site || {};
  const farbe = /^#[0-9a-f]{3,8}$/i.test(p.brand.color) ? p.brand.color : "#7a1f2b";
  const aufFarbe = hellOderDunkel(farbe);
  const tel = telLink(s.telefon);
  const route = s.adresse ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.name + ", " + s.adresse) : "";
  const zeiten = s.zeiten || {};
  const hatZeiten = TAGE.some(([t]) => zeiten[t]);
  const karte = Array.isArray(s.karte) ? s.karte.filter((g) => g && g.name) : [];
  const texte = s.texte || {};

  // Speisekarte nach Kategorie, Reihenfolge wie gefunden
  const kats = [];
  const proKat = {};
  for (const g of karte) {
    const k = String(g.kategorie || "Karte");
    if (!proKat[k]) { proKat[k] = []; kats.push(k); }
    proKat[k].push(g);
  }

  const zeitenHtml = hatZeiten ? `
  <section class="blk" id="zeiten">
    <h2>Öffnungszeiten</h2>
    <dl class="zeiten">
      ${TAGE.map(([t, lb], i) => `<div class="zt" data-tag="${i}"><dt>${lb}</dt><dd>${esc(zeiten[t] || "–")}</dd></div>`).join("")}
    </dl>
    ${zeiten.hinweis ? `<p class="hint">${esc(zeiten.hinweis)}</p>` : ""}
  </section>` : (texte.zeiten ? `
  <section class="blk" id="zeiten"><h2>Öffnungszeiten</h2><p class="pre">${esc(texte.zeiten)}</p></section>` : "");

  const karteHtml = kats.length ? `
  <section class="blk" id="karte">
    <h2>Speisekarte</h2>
    ${kats.map((k) => `
    <div class="kat">
      <h3>${esc(k)}</h3>
      <ul>${proKat[k].map((g) => `
        <li>
          <div class="z1"><span class="gn">${esc(g.name)}</span><span class="dots"></span><span class="pr">${esc(preisText(g.preis))}</span></div>
          ${g.beschreibung ? `<div class="gb">${esc(g.beschreibung)}</div>` : ""}
          ${(g.vegan || g.vegetarisch || g.glutenfrei) ? `<div class="tags">${g.vegan ? "<span>vegan</span>" : g.vegetarisch ? "<span>vegetarisch</span>" : ""}${g.glutenfrei ? "<span>glutenfrei</span>" : ""}</div>` : ""}
        </li>`).join("")}
      </ul>
    </div>`).join("")}
    <p class="hint">Preise in CHF. Fragen zu Allergenen? Der Assistent hilft — im Zweifel fragen Sie bitte unser Personal.</p>
  </section>` : (texte.angebot ? `
  <section class="blk" id="karte"><h2>Angebot</h2><p class="pre">${esc(texte.angebot)}</p></section>` : "");

  const kontaktHtml = (s.adresse || s.telefon || s.email) ? `
  <section class="blk" id="kontakt">
    <h2>Kontakt</h2>
    ${s.adresse ? `<p class="gross">${esc(s.adresse)}</p>` : ""}
    <div class="knoepfe">
      ${tel ? `<a class="kn" href="${tel}">Anrufen · ${esc(s.telefon)}</a>` : ""}
      ${route ? `<a class="kn" href="${esc(route)}" target="_blank" rel="noopener">Route planen</a>` : ""}
      ${s.email ? `<a class="kn" href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ""}
    </div>
    ${s.anfahrt ? `<p class="hint">${esc(s.anfahrt)}</p>` : ""}
  </section>` : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(p.name)}</title>
<meta name="description" content="${esc(s.beschreibung || p.greeting)}">
<meta property="og:title" content="${esc(p.name)}">
<meta property="og:description" content="${esc(s.beschreibung || p.greeting)}">
<meta name="theme-color" content="${esc(farbe)}">
<style>
:root{--b:${esc(farbe)};--t:${esc(aufFarbe)};--ink:#1f1b17;--soft:#6b635a;--line:#e7e0d6;--bg:#faf7f2;--card:#fff}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600;letter-spacing:-.01em;margin:0}
a{color:inherit}
.top{position:sticky;top:0;z-index:5;background:rgba(250,247,242,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .in{max-width:760px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:12px}
.mk{width:34px;height:34px;border-radius:9px;background:var(--b);color:var(--t);display:grid;place-items:center;font:600 16px Georgia,serif;flex:0 0 auto}
.top .nm{font:600 16px/1.2 "Iowan Old Style",Palatino,Georgia,serif;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top a.tel{font-size:14px;font-weight:600;text-decoration:none;background:var(--b);color:var(--t);padding:8px 14px;border-radius:20px;white-space:nowrap}
.hero{max-width:760px;margin:0 auto;padding:56px 20px 36px}
.hero h1{font-size:clamp(34px,8vw,54px);line-height:1.05}
.hero p{font-size:18px;color:var(--soft);margin:14px 0 0;max-width:34em}
.heute{display:inline-flex;align-items:center;gap:8px;margin-top:22px;font-size:15px;font-weight:600;padding:8px 14px;border-radius:20px;background:var(--card);border:1px solid var(--line)}
.heute i{width:8px;height:8px;border-radius:50%;background:var(--b)}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.cta a,.cta button{font-family:inherit;font-weight:600;font-size:15px;line-height:1;padding:14px 20px;border-radius:12px;border:0;cursor:pointer;text-decoration:none}
.cta .h{background:var(--b);color:var(--t)}
.cta .n{background:var(--card);color:var(--ink);border:1px solid var(--line)}
nav.sp{max-width:760px;margin:0 auto;padding:0 20px;display:flex;gap:18px;font-size:14px;color:var(--soft)}
nav.sp a{text-decoration:none;border-bottom:1px solid transparent}nav.sp a:hover{border-color:currentColor}
main{max-width:760px;margin:0 auto;padding:8px 20px 40px}
.blk{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 24px;margin-top:18px}
.blk h2{font-size:26px;margin-bottom:16px}
.zeiten{margin:0}.zt{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-top:1px solid var(--line)}.zt:first-child{border-top:0}
.zt dt{color:var(--soft)}.zt dd{margin:0;text-align:right}
.zt.heute-z dt,.zt.heute-z dd{color:var(--ink);font-weight:700}
.kat{margin-top:22px}.kat:first-of-type{margin-top:0}
.kat h3{font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--b);font-family:inherit;font-weight:700;margin-bottom:6px}
.kat ul{list-style:none;margin:0;padding:0}.kat li{padding:11px 0;border-top:1px solid var(--line)}.kat li:first-child{border-top:0}
.z1{display:flex;align-items:baseline;gap:8px}.gn{font-weight:600}.dots{flex:1;border-bottom:1px dotted #cfc6b8;transform:translateY(-4px)}.pr{font-variant-numeric:tabular-nums;font-weight:600}
.gb{color:var(--soft);font-size:14.5px;margin-top:2px}
.tags{margin-top:6px;display:flex;gap:6px}.tags span{font-size:12px;padding:2px 8px;border-radius:10px;background:var(--bg);border:1px solid var(--line);color:var(--soft)}
.hint{color:var(--soft);font-size:14px;margin:14px 0 0}
.pre{white-space:pre-wrap;margin:0}
.gross{font-size:18px;margin:0 0 14px}
.knoepfe{display:flex;flex-wrap:wrap;gap:10px}.kn{padding:11px 16px;border-radius:12px;border:1px solid var(--line);text-decoration:none;font-weight:600;font-size:15px;background:var(--bg)}
footer{max-width:760px;margin:0 auto;padding:10px 20px calc(90px + env(safe-area-inset-bottom));color:var(--soft);font-size:13px}
footer h4{font-family:inherit;font-weight:700;font-size:12px;line-height:1;letter-spacing:.12em;text-transform:uppercase;margin:22px 0 8px;color:var(--ink)}
footer p{margin:0 0 6px}
@media (max-width:520px){.hero{padding-top:36px}.blk{padding:22px 18px;border-radius:14px}}
</style>
</head>
<body>
<header class="top"><div class="in">
  <div class="mk">${esc((p.name || "?").trim().charAt(0).toUpperCase())}</div>
  <div class="nm">${esc(p.name)}</div>
  ${tel ? `<a class="tel" href="${tel}">Anrufen</a>` : ""}
</div></header>

<section class="hero">
  <h1>${esc(p.name)}</h1>
  ${s.beschreibung ? `<p>${esc(s.beschreibung)}</p>` : ""}
  ${hatZeiten ? `<div class="heute" id="heute" hidden><i></i><span></span></div>` : ""}
  <div class="cta">
    <button class="h" type="button" onclick="window.NemesisChat?NemesisChat.open():location.hash='kontakt'">Frage stellen</button>
    ${kats.length || texte.angebot ? `<a class="n" href="#karte">Speisekarte</a>` : ""}
    ${route ? `<a class="n" href="${esc(route)}" target="_blank" rel="noopener">Route</a>` : ""}
  </div>
</section>

<nav class="sp">
  ${hatZeiten || texte.zeiten ? `<a href="#zeiten">Zeiten</a>` : ""}
  ${kats.length || texte.angebot ? `<a href="#karte">Karte</a>` : ""}
  ${kontaktHtml ? `<a href="#kontakt">Kontakt</a>` : ""}
</nav>

<main>
  ${zeitenHtml}
  ${karteHtml}
  ${!kats.length && !texte.angebot && texte.betrieb ? `<section class="blk"><h2>Über uns</h2><p class="pre">${esc(texte.betrieb)}</p></section>` : ""}
  ${kontaktHtml}
</main>

<footer>
  <h4>Impressum</h4>
  <p>${esc(p.name)}${s.adresse ? "<br>" + esc(s.adresse) : ""}</p>
  ${s.telefon || s.email ? `<p>${[s.telefon, s.email].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
  <h4>Datenschutz</h4>
  <p>Der Chat-Assistent auf dieser Seite beantwortet Ihre Fragen automatisch mit Hilfe eines KI-Dienstes (Anthropic, USA). Ihre Eingaben werden dafür übermittelt. Bitte geben Sie keine sensiblen persönlichen Daten ein.</p>
  <p style="margin-top:18px">Website &amp; Assistent von Nemesis Studios</p>
</footer>

${hatZeiten ? `<script>
(function(){
  var z=${JSON.stringify(TAGE.map(([t]) => zeiten[t] || null)).replace(/</g, "\\u003c")};
  var d=(new Date().getDay()+6)%7;
  var el=document.querySelector('.zt[data-tag="'+d+'"]'); if(el) el.classList.add('heute-z');
  if(z[d]){var h=document.getElementById('heute');h.querySelector('span').textContent='Heute: '+z[d];h.hidden=false;}
})();
</script>` : ""}
<script src="${esc(basis)}/embed.js" data-agent="${esc(p.id)}" data-api="${esc(basis)}"></script>
</body>
</html>`;
}

/* Startseite der Domain — damit nicht eine Fehlermeldung kommt,
   wenn jemand nemesis-studio-ai.ch direkt aufruft. */
function startseite() {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nemesis Studios</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f2;color:#1f1b17;font:400 17px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
main{max-width:520px}h1{font:600 38px/1.1 "Iowan Old Style",Palatino,Georgia,serif;margin:0 0 14px}p{color:#6b635a;margin:0 0 10px}
</style></head><body><main>
<h1>Nemesis Studios</h1>
<p>Websites mit digitalem Assistenten für Restaurants und kleine Betriebe.</p>
<p>Ihre Gäste fragen, der Assistent antwortet — rund um die Uhr, zu Karte, Zeiten und Reservation.</p>
</main></body></html>`;
}

/* ===========================================================
   Schloss: private Teile nur mit Zugangs-Pfad /k/<geheim>/...
   Oeffentlich bleiben nur die Teile, die Gaeste brauchen.
   =========================================================== */

const OEFFENTLICH = [/^\/$/, /^\/health$/, /^\/embed\.js$/, /^\/api\/chat$/,
                     /^\/api\/agent\/[^/]+$/, /^\/a\/[^/]+\/?$/, /^\/favicon\.ico$/, /^\/robots\.txt$/];

function schutz(req, res, url, CORS) {
  const zugang = process.env.NEMESIS_ZUGANG;
  if (!zugang || zugang.length < 16) return "offen";          // nicht eingerichtet: altes Verhalten

  const vorsatz = "/k/" + zugang;
  if (url.pathname === vorsatz || url.pathname.startsWith(vorsatz + "/")) {
    url.pathname = url.pathname.slice(vorsatz.length) || "/";
    return "frei";
  }
  if (OEFFENTLICH.some((r) => r.test(url.pathname))) return "frei";

  // Programme auf dem Droplet selbst (nicht ueber Caddy) duerfen weiter direkt
  const ra = String((req.socket && req.socket.remoteAddress) || "");
  const lokal = (ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1")
             && !req.headers["x-forwarded-for"];
  if (lokal) return "frei";

  res.writeHead(401, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify({ error: "Kein Zugang" }));
  return "blockiert";
}

/* ===========================================================
   Der Router — wird von nemesis-sync.js gerufen.
   Gibt true zurück wenn die Anfrage hier behandelt wurde.
   =========================================================== */

async function behandle(req, res, url, CORS) {
  const pfad = url.pathname;

  /* --- Startseite der Domain ----------------------------------------- */
  if (pfad === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(startseite());
    return true;
  }
  if (pfad === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("User-agent: *\nDisallow: /k/\nDisallow: /api/\n");
    return true;
  }

  /* --- Widget --------------------------------------------------------- */
  if (pfad === "/embed.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(WIDGET);
    return true;
  }

  /* --- Öffentliche Agent-Info ----------------------------------------- */
  if (pfad.startsWith("/api/agent/")) {
    const a = holeAgent(decodeURIComponent(pfad.slice(11)));
    if (!a) {
      res.writeHead(404, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "Agent nicht gefunden" })), true;
    }
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(oeffentlich(a)));
    return true;
  }

  /* --- Landingpage ----------------------------------------------------- */
  if (pfad.startsWith("/a/")) {
    const a = holeAgent(decodeURIComponent(pfad.slice(3)));
    if (!a) { res.writeHead(404); return res.end("Agent nicht gefunden"), true; }
    const proto = req.headers["x-forwarded-proto"] || "http";
    const basis = proto + "://" + (req.headers.host || "localhost");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(landingpage(a, basis));
    return true;
  }

  /* --- Verbrauch (mit Token geschützt) --------------------------------- */
  if (pfad === "/api/verbrauch") {
    const token = process.env.NEMESIS_ADMIN_TOKEN;
    if (!token || url.searchParams.get("token") !== token) {
      res.writeHead(401, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "Nicht autorisiert" })), true;
    }
    const m = url.searchParams.get("monat") || monat();
    const alle = ladeVerbrauch();
    const zeilen = Object.values(ladeAgenten()).map((a) => ({
      id: a.id, name: a.name || a.id,
      quota: (a.quota && a.quota.messagesPerMonth) || null,
      ...((alle[a.id] && alle[a.id][m]) || { nachrichten: 0, tokenRein: 0, tokenRaus: 0, kostenUsd: 0 }),
    }));
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({
      monat: m,
      gesamtKostenUsd: Math.round(zeilen.reduce((s, z) => s + z.kostenUsd, 0) * 1e4) / 1e4,
      agenten: zeilen,
    }, null, 1));
    return true;
  }

  /* --- DER Chat-Endpoint ----------------------------------------------- */
  if (pfad === "/api/chat") {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(), true; }
    if (req.method !== "POST") { res.writeHead(405, CORS); return res.end("POST erwartet"), true; }

    let roh = "";
    for await (const c of req) {
      roh += c;
      if (roh.length > 256 * 1024) { res.writeHead(413, CORS); return res.end("zu gross"), true; }
    }
    let körper;
    try { körper = JSON.parse(roh); }
    catch (e) {
      res.writeHead(400, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: "Kein gueltiges JSON" })), true;
    }

    const agent = holeAgent(körper.agentId);
    const kopf = { "Content-Type": "application/json", ...CORS };

    if (!agent) {
      res.writeHead(404, kopf);
      return res.end(JSON.stringify({ error: "Agent nicht gefunden" })), true;
    }
    if (!domainErlaubt(agent, req.headers.origin)) {
      console.warn("[serve] Domain blockiert: " + req.headers.origin + " -> " + agent.id);
      res.writeHead(403, kopf);
      return res.end(JSON.stringify({ error: "Diese Domain ist nicht freigegeben." })), true;
    }

    // Bremse 1
    if (quotaVoll(agent)) {
      console.warn("[serve] QUOTA VOLL: " + agent.id);
      res.writeHead(200, kopf);
      return res.end(JSON.stringify({
        reply: agent.fallbackMessage || "Ich bin gerade nicht erreichbar. Bitte kontaktieren Sie uns direkt.",
        quotaExceeded: true,
      })), true;
    }

    // Bremse 3
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
             || req.socket.remoteAddress || "?";
    const rl = rateLimit(agent.id, ip, körper.sessionId);
    if (!rl.ok) {
      res.writeHead(200, kopf);
      return res.end(JSON.stringify({
        reply: rl.grund === "sitzung"
          ? (agent.sessionLimitMessage || "Wir haben schon einiges besprochen. Für alles Weitere melden Sie sich gern direkt bei uns.")
          : "Einen Moment bitte – gleich geht es weiter.",
        rateLimited: true,
      })), true;
    }

    const nachrichten = saeubere(körper.messages);
    if (!nachrichten.length) {
      res.writeHead(400, kopf);
      return res.end(JSON.stringify({ error: "Keine gueltige Nachricht" })), true;
    }

    try {
      const { text, usage, modell } = await frageClaude(agent, nachrichten);
      const kosten = bucheVerbrauch(agent.id, modell, usage);
      if (process.env.NEMESIS_LOG_KOSTEN === "1") {
        console.log("[serve] " + agent.id + " · " + modell + " · $" + kosten.toFixed(5)
                  + " · Monat $" + konto(agent.id).kostenUsd.toFixed(4));
      }
      res.writeHead(200, kopf);
      res.end(JSON.stringify({ reply: text }));
    } catch (e) {
      console.error("[serve] Fehler bei " + agent.id + ": " + e.message);
      res.writeHead(200, kopf);
      res.end(JSON.stringify({
        reply: agent.errorMessage || "Da ist etwas schiefgelaufen. Bitte versuchen Sie es gleich noch einmal.",
        failed: true,
      }));
    }
    return true;
  }

  return false;   // nicht unsere Anfrage
}

module.exports = { behandle, schutz, ladeAgenten, konto, holeAgent, landingpage };
