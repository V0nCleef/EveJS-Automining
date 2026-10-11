"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
let cached;
function source() {
  if (!cached) {
    const dir = path.resolve(__dirname, "../client");
    const locales = JSON.parse(fs.readFileSync(path.join(dir, "fleetCommand.locales.json"), "utf8"));
    for (const language of ["de", "fr", "es", "it", "ru", "zh", "ja", "ko"]) {
      if (!locales[language] || Object.keys(locales.en).some(key => !locales[language][key]?.trim()))
        throw Error("Fleet Command translations are incomplete.");
    }
    const code = "# coding: utf-8\n_AM_FLEET_LOCALES = __import__('json').loads(" + JSON.stringify(JSON.stringify(locales)) + ")\n" +
      fs.readFileSync(path.join(dir, "fleetCommand.py"), "utf8");
    cached = { source: zlib.deflateSync(Buffer.from(code), { level: 9 }).toString("base64") };
  }
  return cached;
}
module.exports = { source };
