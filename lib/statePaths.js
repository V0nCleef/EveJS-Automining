"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FILENAMES = Object.freeze({
  players: "autoMining.players.json",
  statistics: "autoMining.statistics.json",
  fleetGroups: "autoMining.fleetGroups.json",
});
function exists(filename) {
  try { fs.statSync(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
function statePaths(root) {
  root = path.resolve(root);
  const resolver = path.join(root, "server/src/config/dataRoot.js");
  // Both 0.12.9 and 261018.1 expose this dependency-free resolver. Older
  // installs use the same environment/default convention without loading config.
  let dataRoot;
  if (exists(resolver)) {
    const native = require(resolver);
    if (typeof native.resolveDataRoot !== "function") throw Error("Unsupported EveJS data-root resolver; AutoMining state preserved.");
    dataRoot = native.resolveDataRoot();
  } else {
    const configured = String(process.env.EVEJS_DATA_ROOT || "").trim();
    dataRoot = configured ? path.resolve(configured) : path.join(root, "_local");
  }
  if (typeof dataRoot !== "string" || !path.isAbsolute(dataRoot)) throw Error("Invalid EveJS data root; AutoMining state preserved.");
  return Object.fromEntries(Object.entries(FILENAMES).map(([kind, name]) => [kind, path.join(dataRoot, "automining", name)]));
}
function validate(bytes, kind, filename) {
  let data;
  try { data = JSON.parse(bytes.toString("utf8")); }
  catch { throw Error(`Invalid AutoMining ${kind} state: ${filename}. Existing files preserved.`); }
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (data?.schemaVersion !== 1 ||
      (kind === "players" && !object(data.characters)) ||
      (kind === "statistics" && (!object(data.characters) || !Number.isFinite(data.trackedSince))) ||
      (kind === "fleetGroups" && (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.presets) || !Array.isArray(data.roster)))) {
    throw Error(`Invalid AutoMining ${kind} state: ${filename}. Existing files preserved.`);
  }
}
function publish(source, destination, kind) {
  const bytes = fs.readFileSync(source);
  validate(bytes, kind, source);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    // An atomic, no-clobber publish. rename() can replace an existing file;
    // linking the completed sibling instead preserves a racing destination.
    try { fs.linkSync(temporary, destination); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const persisted = fs.readFileSync(destination);
    validate(persisted, kind, destination);
    return persisted.equals(bytes) ? "copied" : "canonical-kept";
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (exists(temporary)) fs.unlinkSync(temporary);
  }
}
function migrateState(root) {
  const paths = statePaths(root), files = [];
  for (const [kind, destination] of Object.entries(paths)) {
    const source = path.join(root, "config", FILENAMES[kind]);
    if (exists(destination)) {
      const bytes = fs.readFileSync(destination);
      validate(bytes, kind, destination);
      const conflict = exists(source) && !bytes.equals(fs.readFileSync(source));
      files.push({ kind, source, destination, status: conflict ? "canonical-kept" : "unchanged" });
    } else if (exists(source)) {
      files.push({ kind, source, destination, status: publish(source, destination, kind) });
    }
  }
  return { paths, files };
}
module.exports = { statePaths, migrateState };
