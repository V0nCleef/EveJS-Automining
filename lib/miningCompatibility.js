"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
// Keep the legacy export for consumers that identify the original baseline.
const SUPPORTED_HASH = "425b56f81bf398d79f67437f08f05b7746eca2f982e9a7c0ebc5b98a1307a8c0";
const PATCHED_HASH = "9b8381b117b10126ec13f48b724e25d91f86c9cff2ddca9f80c1bb8aa1c713a3";
const STOCK_HASHES = Object.freeze([SUPPORTED_HASH, "4f32fb95e02227fac4fe24926858837b7366d6c9b193043865c6580f1cf97e64", "4459f8bf26e1c9852ece7d0789acbc2d6cc229feace739acce9305f661297da5"]);
const PATCHED_HASHES = Object.freeze([PATCHED_HASH, "4f06f4e62398174a4da19310fd3188940f479a70381af3e26300b326775bcd95", "9b8381b117b10126ec13f48b724e25d91f86c9cff2ddca9f80c1bb8aa1c713a3"]);
// Reviewed 0.12.9 beta: native ore/gas short-cycling is already fixed. Its
// removed crystal helper is supplied by the mod bridge, not a core patch.
const NATIVE_FIXED_HASHES = Object.freeze([
  "90d5d2d44508c580ab49b65f1eed41b40035439181c2551f9e7caddba4952fd6",
  "5144a44918d889e6be77f1aa61d14d2a25fdb1875d24050b650556c25ab637f5",
]);
const SUPPORTED_HASHES = Object.freeze([...new Set([...STOCK_HASHES, ...PATCHED_HASHES, ...NATIVE_FIXED_HASHES])]);
function hash(source) { return createHash("sha256").update(source).digest("hex"); }
function supportsMiningSource(source) { return SUPPORTED_HASHES.includes(hash(source)); }

// Apply only miningRuntime.js hunks from the bundled core patch. The other
// core file contains explanatory comment changes, not executable changes.
// Validate every old/context line and the final source hash; never write back
// to EveJS, silently accept an unknown baseline, or apply the fix twice.
function prepareMiningSource(source) {
  const sourceHash = hash(source);
  if (PATCHED_HASHES.includes(sourceHash) || NATIVE_FIXED_HASHES.includes(sourceHash)) return source;
  if (!STOCK_HASHES.includes(sourceHash)) throw new Error("Unsupported mining runtime baseline");
  const original = Buffer.isBuffer(source) ? source.toString("utf8") : source;
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.replace(/\r\n/g, "\n").split("\n");
  const patch = fs.readFileSync(path.join(__dirname, "../patches/mining-short-cycle.patch"), "utf8").replace(/\r\n/g, "\n");
  const section = patch.split("--- a/server/src/services/mining/miningRuntime.js\n")[1];
  if (!section) throw new Error("Missing bundled mining patch section");
  const patchLines = section.split("\n--- a/")[0].split("\n");
  const result = [];
  let cursor = 0;
  let hunks = 0;
  for (let index = 0; index < patchLines.length; index++) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patchLines[index]);
    if (!match) continue;
    const start = Number(match[1]) - 1;
    if (start < cursor) throw new Error("Overlapping bundled patch hunks");
    result.push(...lines.slice(cursor, start));
    cursor = start;
    let removed = 0;
    let added = 0;
    for (++index; index < patchLines.length && !patchLines[index].startsWith("@@ "); index++) {
      const line = patchLines[index];
      if (line === "") continue;
      const prefix = line[0];
      const body = line.slice(1);
      if (prefix === " " || prefix === "-") {
        if (lines[cursor] !== body) throw new Error("Bundled mining patch context mismatch");
        cursor++;
        removed++;
      }
      if (prefix === " " || prefix === "+") { result.push(body); added++; }
      if (![" ", "-", "+"].includes(prefix)) throw new Error("Unsupported bundled patch line");
    }
    index--;
    if (removed !== Number(match[2] ?? 1) || added !== Number(match[4] ?? 1)) {
      throw new Error("Bundled mining patch hunk length mismatch");
    }
    hunks++;
  }
  result.push(...lines.slice(cursor));
  const prepared = result.join(newline);
  if (hunks === 0 || !PATCHED_HASHES.includes(hash(prepared))) throw new Error("Bundled mining patch output hash mismatch");
  return prepared;
}
module.exports = { SUPPORTED_HASH, SUPPORTED_HASHES, supportsMiningSource, prepareMiningSource };
