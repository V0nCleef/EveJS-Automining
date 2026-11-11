"use strict";
// Released hook code, fake native dependencies and sockets. No gameplay/storage services.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createHarness } = require("./nativeLoginHarness.cjs");
const runtimeApi = require("./runtimeUnderTest.cjs").api;
const modRoot = path.resolve(__dirname, "../.."), taskRoot = path.dirname(modRoot);
const vendor = process.env.EVEJS_LOGIN_VENDOR_ROOT || path.join(taskRoot, "integration/vendor");
const menuFile = process.env.EVEJS_LOGIN_CAPTURED_MENU || path.join(taskRoot, "evidence/shared-menu-abi-final/typical/captured-loader.cjs");

function evaluate(source, context, dependencies, directory) {
  const module = { exports: {} };
  const req = id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id.startsWith("node:") || ["fs", "path", "crypto", "zlib"].includes(id)) return require(id);
    throw Error("Unexpected isolated loader dependency " + id);
  };
  req.cache = {}; req.main = module; req.resolve = id => id;
  vm.runInContext("(function(require,module,__dirname){\n" + source + "\n})", context)(req, module, directory);
  return module.exports;
}

function createReportedHarness(order, { releasedAuto = false, markerFitting = false } = {}) {
  const state = { layers: [], auto: null, family: null, moon: null, erosionCompositions: 0 };
  const h = createHarness({ order, unknownSource: source => "const futureAddonMetadata = 61;\n" +
    source.replace("class EVEHandshake {", "class EVEHandshake {\n  futureAddonInfo() { return futureAddonMetadata; }"), setupLayer(layer, env) {
    const { FakeModule: M, context, host, codec, nativeRoot, logs } = env;
    if (!M._cache) {
      delete host[Symbol.for("evejs.ourMods.privateFittingRuntime")];
      context.console = { log: x => logs.push(x), error: x => logs.push(x), warn: x => logs.push(x) };
      M._cache = {};
      class ScanService { Handle_perform_scan() {} }
      M._load = () => ScanService;
      M._resolveFilename = id => id;
      M.isBuiltin = () => false;
      state.ScanService = ScanService;
    }
    if (!["auto", "solo", "family-dcb", "erosion", "moon", "menu"].includes(layer)) return false;
    state.layers.push(layer);
    if (layer === "auto") {
      const autoRoot = releasedAuto ? path.join(vendor, "old-automining") : modRoot;
      const login = releasedAuto ? require(path.join(autoRoot, "lib/loginDelivery.js")) : evaluate(
        fs.readFileSync(path.join(modRoot, "lib/loginDelivery.js"), "utf8"), context, {
          "./hud": require(path.join(modRoot, "lib/hud")), "./clientSource": require(path.join(modRoot, "lib/clientSource")),
          "./loginDeliveryRuntime": { ...runtimeApi, getRuntime: root => runtimeApi.getRuntime(root, { host, moduleHost: M, codec, logger: { error: text => logs.push(text) } }) },
        }, modRoot);
      const controller = require(path.join(modRoot, "lib/controller")).createController(() => null, () => null);
      const noop = () => ({}), safeConsole = { log: x => logs.push(x), error: x => logs.push(x), warn: x => logs.push(x) };
      const previousConsole = context.console;
      context.console = safeConsole;
      const deps = {
        "node:module": M, "node:worker_threads": { isMainThread: true },
        "node:fs": { existsSync: () => true, readFileSync: () => "fixture-mining" },
        "./lib/controller": { createController: () => controller }, "./lib/commands": {},
        "./lib/preferences": { createPreferences: noop }, "./lib/bridge": "fixture bridge",
        "./lib/compression": { createCompression: noop },
        "./lib/crystals": { createCrystalManager: noop, nativeCrystalOperations: noop },
        "./lib/catalog": { createCatalog: noop }, "./lib/hud": { installHUD() {} },
        "./lib/jobArtwork": { installJobArtwork() {} }, "./lib/haulDestinations": { createHaulDestinations: noop },
        "./lib/departure": { createNativeDeparture: noop, createTransportArrival: noop, installNavigation() {} },
        "./lib/miningCompatibility": { supportsMiningSource: () => true },
        "./lib/loginDelivery": { ...login, createDelivery: () => login.createDelivery(autoRoot, { token: "server-A" }) },
        "./lib/statistics": { createStatistics: noop }, "./lib/activity": { createActivity: noop },
        "./lib/manualModules": { installManualModuleStops() {} },
        "./lib/statePaths": { migrateState: () => ({ paths: {} }) },
        "./evejs-launcher.mod.json": { version: "1.2.26-review-fixture" },
      };
      evaluate(fs.readFileSync(path.join(autoRoot, "loader.js"), "utf8"), context, deps, path.join(nativeRoot, "mods/automining"));
      // The actual loader closures retain safeConsole after this evaluation.
      context.console = previousConsole;
      state.auto = host[Symbol.for("evejs.automining.loader.v1")];
      state.controller = controller;
      state.scan = M._load(path.join(nativeRoot, "server/src/services/mining/miningScanMgrService.js"));
      assert.equal(typeof state.scan.prototype.Handle_AutoMiningLoginReady, "function");
    } else if (layer === "solo" || layer === "family-dcb") {
      const dir = layer === "solo" ? path.join(vendor, "solo/simulation") : path.join(vendor, "dcb/droneClassBalance/simulation");
      const delivery = require(path.join(dir, "delivery.js"));
      let bundle = delivery.readBundle(dir);
      if (markerFitting) {
        bundle = { ...bundle, adapter: "# authored additive fixture", bootstrap: "print('FITTING_ONCE')\n", fingerprints: {} };
        bundle.digest = delivery.bundleDigest(bundle);
      }
      const id = layer === "solo" ? "soloprogressionbalance" : "droneclassbalance";
      state.family = require(path.join(dir, "familyRuntime.js")).attachMember(nativeRoot, {
        id, bundle, eligible: () => true, policy: () => null,
      }, host, M);
      assert.equal(state.family.active, true, "released fitting hook should support the exact native fixture");
    } else if (layer === "erosion") {
      const dir = path.join(vendor, "erosion"), delivery = require(path.join(dir, "lib/delivery"));
      const config = require(path.join(dir, "lib/radius")).normalizeConfig(require(path.join(dir, "config.json")));
      assert.equal(delivery.supportsHandshake(env.baseline), true);
      const prepared = delivery.createDelivery(dir, config), previous = M.prototype._compile;
      M.prototype._compile = function(source, filename) {
        const result = previous.call(this, source, filename);
        delivery.installHandshake(this.exports, { codec, delivery: { compose(packet) {
          state.erosionCompositions++; return prepared.compose(packet);
        } } });
        return result;
      };
    } else if (layer === "moon") {
      const dir = path.join(vendor, "moon"), previousProcess = context.process;
      context.process = { platform: process.platform, env: { EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL: "1" } };
      const deps = { "node:module": M, "node:worker_threads": { isMainThread: true } };
      for (const name of ["config", "lib/contentOverlay", "lib/lifecycleRetirement", "lib/moonRules", "lib/presentationOverlay",
        "lib/runtimeApi", "lib/scanStrengthOverlay", "lib/sourceTransforms", "data/moonOreTemplates.v1.json"]) {
        deps["./" + name] = require(path.join(dir, name));
      }
      // Synthetic empty native target inventory: only retirement loader transparency is qualified.
      deps["./lib/viability"] = { run: () => ({ targets: {}, siteIDReport: {} }), canonicalize: file => path.resolve(file) };
      const entry = evaluate(fs.readFileSync(path.join(dir, "loader.js.disabled"), "utf8"), context, deps, dir);
      state.moon = entry.install({ runtimeRoot: nativeRoot, config: { enabled: false }, transientNames: false });
      context.process = previousProcess;
      assert.equal(state.moon.active, true); assert.equal(state.moon.enabled, false);
    } else if (layer === "menu") {
      const source = fs.readFileSync(menuFile, "utf8");
      const prev = context.console;
      context.console = { log: x => logs.push(x), error: x => logs.push(x) };
      const marshalPath = path.join(nativeRoot, "server/src/network/tcp/utils/marshal.js");
      evaluate(source, context, { module: M, "node:module": M, "node:worker_threads": { isMainThread: true },
        [marshalPath]: codec, [marshalPath.toLowerCase()]: codec },
        path.join(nativeRoot, ".evejs-launcher/shared-menu/fixture"));
      context.console = prev;
      assert.ok(logs.includes("EVEJS_MOD_MENU:REGISTERED:v1"));
    }
    state.runtime = host[Symbol.for("evejs.loginDelivery.v1")];
    return true;
  } });
  return Object.assign(h, { reported: state });
}
module.exports = { createReportedHarness, menuFile };
