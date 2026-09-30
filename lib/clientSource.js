"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Preserve multiline and continued strings; omit only full comment lines.
function emittedPython(source) {
  return /'''|"""|\\\r?\n/.test(source) ? source : source.replace(/^[ \t]*#[^\r\n]*\r?\n/gm, "");
}

function emittedBootstrap(source) {
  // Only canonical four-space indentation can be shortened. Preserve strings
  // and unfamiliar source rather than interpreting Python tokens here.
  if (/'''|"""|\\\r?\n|\t/.test(source)) return source;
  const emitted = emittedPython(source);
  let depth = 0, valid = true;
  const compacted = emitted.split(/(\r?\n)/).map(line => {
    const indent = line.match(/^ */)[0].length;
    if (/^ +\S/.test(line) && indent % 4 && !depth) valid = false;
    // Alignment inside bracket continuations is not block indentation.
    const code = line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|#.*/g, "");
    for (const char of code) {
      if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) { depth--; if (depth < 0) valid = false; }
    }
    return indent % 4 ? line : line.replace(/^ +(?=\S)/, " ".repeat(indent / 4));
  }).join("");
  return valid && !depth ? compacted : emitted;
}

function buildClientSource(modRoot) {
  const client = path.join(modRoot, "client");
  const catalogue = JSON.parse(fs.readFileSync(path.join(client, "locales.json"), "utf8"));
  const patterns = JSON.parse(fs.readFileSync(path.join(client, "statusPatterns.json"), "utf8"));
  const languages = ["de", "fr", "es", "it", "ru", "zh", "ja", "ko"];
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
  // Keep the standalone Chinese fallback in its authored file, but emit the
  // same validated rows from the shared table instead of a second full copy.
  const i18n = read("i18n.py");
  const fallbackStart = i18n.indexOf("\n_AM_ZH = {");
  const fallbackEnd = i18n.indexOf("\n_AM_ZH_PATTERNS = [", fallbackStart);
  if (fallbackStart < 0 || fallbackEnd <= fallbackStart) throw Error("AutoMining Chinese fallback boundaries changed");
  const emittedI18n = i18n.slice(0, fallbackStart) + "\n_AM_ZH = {}\n" + i18n.slice(fallbackEnd);
  // Login delivery compresses the whole companion. Keep the catalogues as JSON
  // text so the outer compressor can share repeated labels and language data;
  // precompressed base64 here defeats that compression and exceeds its bound.
  // A JSON-quoted string is also a Python 2/3 string literal for this UTF-8 source.
  const literal = data => JSON.stringify(JSON.stringify(data));
  const load = `\n_am_locale_data = __import__('json').loads(${literal(catalogue)})\n` +
    `_AM_TRANSLATIONS = dict((language, dict(zip(_am_locale_data['keys'], rows))) for language, rows in _am_locale_data['translations'].items())\n` +
    `_AM_ZH = _AM_TRANSLATIONS.pop('zh')\n` +
    `_am_pattern_data = __import__('json').loads(${literal(patterns)})\n` +
    `_AM_PATTERN_TRANSLATIONS = dict((language, list(zip([pattern['regex'] for pattern in _am_pattern_data['patterns']], rows))) for language, rows in _am_pattern_data['translations'].items())\n`;
  // Full-line comments add wire size but no behavior. Preserve any source with
  // multiline strings rather than risk mistaking a string line for a comment.
  // Keep the authored files readable and retain a UTF-8 header on the bundle.
  return "# coding: utf-8\n" + [read("companion.py"), emittedI18n, load,
    read("artwork.py"), read("hud.py"), read("hauling.py"), read("transport.py"), read("pve.py"), read("drones.py"), read("fleet.py"), read("activity.py")].map(emittedPython).join("\n");
}

module.exports = { buildClientSource, emittedPython, emittedBootstrap };
