/* Tresor: AES-256-GCM fuer Zugangsdaten (Engine, Integrationen).
   Schluessel: NEMESIS_TRESOR_SCHLUESSEL (64 Hex) oder <dir>/.tresor-schluessel (chmod 600). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function tresor(dir) {
  let key;
  const env = process.env.NEMESIS_TRESOR_SCHLUESSEL || "";
  if (/^[0-9a-f]{64}$/i.test(env)) key = Buffer.from(env, "hex");
  else {
    const f = path.join(dir, ".tresor-schluessel");
    try { key = Buffer.from(fs.readFileSync(f, "utf8").trim(), "hex"); } catch (e) {}
    if (!key || key.length !== 32) { key = crypto.randomBytes(32); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, key.toString("hex"), { mode: 0o600 }); }
  }
  return {
    zu(text, kontext) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(String(kontext)));
      const d = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
      return { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), d: d.toString("base64") };
    },
    auf(o, kontext) {
      const c = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(o.iv, "base64"));
      c.setAAD(Buffer.from(String(kontext))); c.setAuthTag(Buffer.from(o.tag, "base64"));
      return Buffer.concat([c.update(Buffer.from(o.d, "base64")), c.final()]).toString("utf8");
    },
  };
}

module.exports = { tresor };
