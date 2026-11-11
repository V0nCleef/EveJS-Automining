"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const loaderSource = fs.readFileSync(path.join(root, "loader.js"), "utf8");

function load({ registration = "success", compatible = true, mainThread = true } = {}) {
  const logs = [], calls = [], module = { exports: {} };
  function Module() {}
  Module.prototype._compile = function(source) { return source; };
  Module._load = () => ({}); Module.isBuiltin = () => false;
  const prepared = { ready() {} }, controller = { setDepartureGuard() {}, setReinforcementAttackAvailable() {} };
  const noop = () => ({});
  const dependencies = {
    "node:fs": { existsSync: () => true, readFileSync: () => "fixture-mining" },
    "node:path": path, "node:module": Module, "node:worker_threads": { isMainThread: mainThread },
    "./lib/controller": { createController: () => controller }, "./lib/commands": {},
    "./lib/preferences": { createPreferences: noop }, "./lib/bridge": "fixture bridge",
    "./lib/compression": { createCompression: noop },
    "./lib/crystals": { createCrystalManager: noop, nativeCrystalOperations: noop },
    "./lib/catalog": { createCatalog: noop }, "./lib/hud": { installHUD() {} },
    "./lib/jobArtwork": { installJobArtwork() {} }, "./lib/haulDestinations": { createHaulDestinations: noop },
    "./lib/departure": { createNativeDeparture: noop, createTransportArrival: noop, installNavigation() {} },
    "./lib/miningCompatibility": { supportsMiningSource: () => compatible },
    "./lib/loginDelivery": {
      supportsRoot: () => true, createDelivery: () => { calls.push("prepare"); return prepared; },
      install: (_, delivery) => { assert.equal(delivery, prepared); calls.push("register");
        if (registration === "throw") throw Error("fixture registration failure");
        return registration === "success" ? { id: "automining", abi: 1 } : null; },
    },
    "./lib/statistics": { createStatistics: noop }, "./lib/activity": { createActivity: noop },
    "./lib/manualModules": { installManualModuleStops() {} },
    "./lib/statePaths": { migrateState: () => { calls.push("state"); return { paths: {} }; } },
    "./evejs-launcher.mod.json": { version: "fixture" },
  };
  function fakeRequire(id) {
    if (!(id in dependencies)) throw Error("Unexpected fixture dependency " + id);
    return dependencies[id];
  }
  fakeRequire.main = module; fakeRequire.cache = {};
  const context = { module, require: fakeRequire, __dirname: root, process: { platform: process.platform },
    console: { log: text => logs.push(text), error: text => logs.push(text), warn: text => logs.push(text) } };
  vm.runInNewContext(loaderSource, context);
  return { result: module.exports.install("fixture-root"), calls, logs, prepared, Module };
}

test("only successful registration exposes a prepared AutoMining delivery", () => {
  const f = load();
  assert.equal(f.result.delivery, f.prepared);
  assert.deepEqual(f.calls, ["state", "prepare", "register"]);
});
for (const registration of ["throw", "unavailable"]) test("registration " + registration + " leaves AutoMining HUD unready", () => {
  const f = load({ registration });
  assert.equal(f.result.active, true, "existing backend stays available");
  assert.equal(f.result.delivery, null);
  assert.equal(f.logs.filter(text => /companion/.test(text)).length, 1);
});
test("unsupported native mining source is refused before state or delivery registration", () => {
  const f = load({ compatible: false });
  assert.equal(f.result.active, false); assert.deepEqual(f.calls, []);
});
test("worker context performs no state migration or delivery registration", () => {
  const f = load({ mainThread: false });
  assert.equal(f.result, undefined); assert.deepEqual(f.calls, []);
});
