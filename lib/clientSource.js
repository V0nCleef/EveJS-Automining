"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function buildClientSource(modRoot) {
  const client = path.join(modRoot, "client");
  const catalogue = JSON.parse(fs.readFileSync(path.join(client, "locales.json"), "utf8"));
  const patterns = JSON.parse(fs.readFileSync(path.join(client, "statusPatterns.json"), "utf8"));
  const languages = ["de", "fr", "es", "it", "ru", "ja", "ko"];
  const tokens = value => (value.match(/%(?:\.\d+)?[sdf%]/g) || []).sort().join("|");
  const complete = (sources, translations) => languages.every(lang =>
    Array.isArray(translations?.[lang]) && translations[lang].length === sources.length &&
    translations[lang].every((value, index) => typeof value === "string" && value.trim() &&
      tokens(value) === tokens(sources[index]) &&
      value.split("\n").length === sources[index].split("\n").length &&
      /^\s/.test(value) === /^\s/.test(sources[index]) &&
      /\s$/.test(value) === /\s$/.test(sources[index])));
  if (!Array.isArray(catalogue.keys) || new Set(catalogue.keys).size !== catalogue.keys.length ||
      !complete(catalogue.keys, catalogue.translations) ||
      !Array.isArray(patterns.patterns) || patterns.patterns.length !== 11 ||
      !patterns.patterns.every(pattern => typeof pattern.regex === "string" && typeof pattern.source === "string") ||
      !complete(patterns.patterns.map(pattern => pattern.source), patterns.translations)) {
    throw Error("AutoMining language catalogue is incomplete");
  }
  const read = name => fs.readFileSync(path.join(client, name), "utf8");
  const packed = data => zlib.deflateSync(Buffer.from(JSON.stringify(data), "utf8"), { level: 9 }).toString("base64");
  const load = `\n_am_locale_data = __import__('json').loads(__import__('zlib').decompress(__import__('base64').b64decode('${packed(catalogue)}')))\n` +
    `_AM_TRANSLATIONS = dict((language, dict(zip(_am_locale_data['keys'], rows))) for language, rows in _am_locale_data['translations'].items())\n` +
    `_am_pattern_data = __import__('json').loads(__import__('zlib').decompress(__import__('base64').b64decode('${packed(patterns)}')))\n` +
    `_AM_PATTERN_TRANSLATIONS = dict((language, list(zip([pattern['regex'] for pattern in _am_pattern_data['patterns']], rows))) for language, rows in _am_pattern_data['translations'].items())\n`;
  return "# coding: utf-8\n" + [read("companion.py"), read("i18n.py"), load,
    read("hud.py"), read("hauling.py"), read("drones.py"), read("fleet.py")].join("\n");
}

module.exports = { buildClientSource };
