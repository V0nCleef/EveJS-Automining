"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const { createController } = require("./lib/controller");
const commands = require("./lib/commands");
const { createPreferences } = require("./lib/preferences");
const bridge = require("./lib/bridge");
const { createCompression } = require("./lib/compression");
const { createCrystalManager, nativeCrystalOperations } = require("./lib/crystals");
const { createCatalog } = require("./lib/catalog");
const { installHUD } = require("./lib/hud");
const { createHaulDestinations } = require("./lib/haulDestinations");
const { createNativeDeparture, installNavigation } = require("./lib/departure");
const { SUPPORTED_HASH, supportsMiningSource, prepareMiningSource } = require("./lib/miningCompatibility");
const loginDelivery = require("./lib/loginDelivery");
const key = Symbol.for("evejs.automining.loader.v1");
function canonical(file) { return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file); }
function install(root = path.resolve(__dirname, "../..")) {
  if (!isMainThread || globalThis[key]) return globalThis[key];
  const miningPath = path.join(root, "server/src/services/mining/miningRuntime.js");
  if (!fs.existsSync(miningPath) || !supportsMiningSource(fs.readFileSync(miningPath))) {
    console.error("[AutoMining] Unsupported miningRuntime.js. Mod left inactive; server files unchanged.");
    return { active: false };
  }
  const handshakePath = path.join(root, "server/src/network/tcp/handshake.js");
  let delivery = null;
  try {
    if (loginDelivery.supportsRoot(root)) delivery = loginDelivery.createDelivery(__dirname);
  } catch (error) {
    console.error("[AutoMining] Login companion could not be prepared; server startup preserved.");
  }
  let mining = null;
  const preferences = createPreferences(path.join(root, "config/autoMining.players.json"));
  const destinations = createHaulDestinations(root);
  const controller = createController(() => mining?.__autoMiningBridge, () => require(path.join(root, "server/src/space/runtime.js")), console.error, preferences, createCompression(root), destinations,
    createCrystalManager(nativeCrystalOperations(root)), root);
  const departure = createNativeDeparture(root, controller);
  controller.setDepartureGuard(departure);
  const targets = new Map([
    [canonical(miningPath), "mining"],
    [canonical(path.join(root, "server/src/services/chat/chatCommands.js")), "commands"],
    [canonical(path.join(root, "server/src/_secondary/chat/chatRuntime.js")), "plain"],
    [canonical(path.join(root, "server/src/services/mining/miningScanMgrService.js")), "scanService"],
    [canonical(path.join(root, "server/src/services/ship/beyonceService.js")), "movement"],
  ]);
  const seen = new WeakSet();
  function installMovement(exports) {
    if (seen.has(exports)) return;
    const required = ["Handle_CmdGotoDirection", "Handle_CmdWarpToStuff", "Handle_CmdDock", "Handle_CmdWarpToStuffAutopilot"];
    const missing = required.filter(name => typeof exports?.prototype?.[name] !== "function");
    if (missing.length) throw Error(`[AutoMining] Drone recall guard cannot attach: missing ${missing.join(", ")}`);
    installNavigation(exports, controller, departure);
    seen.add(exports);
    console.log("[AutoMining] Drone recall guard attached to warp and dock handlers.");
  }
  const previousCompile = Module.prototype._compile;
  Module.prototype._compile = function(content, filename) {
    if (canonical(filename) === canonical(miningPath)) {
      if (supportsMiningSource(content)) content = prepareMiningSource(content) + "\n" + bridge;
      else console.error("[AutoMining] Another mod changed the mining runtime; AutoMining bridge disabled.");
    }
    if (delivery && canonical(filename) === canonical(handshakePath)) {
      if (loginDelivery.supportsSource(content)) content = loginDelivery.extendSource(content);
      else console.error("[AutoMining] Login source changed by another mod; original handshake preserved.");
    }
    const result = previousCompile.call(this, content, filename);
    // Another loader may compile this service directly and bypass Module._load.
    // Compilation still passes through this hook, so attach recall here too.
    if (canonical(filename) === canonical(path.join(root, "server/src/services/ship/beyonceService.js"))) {
      installMovement(this.exports);
    }
    return result;
  };
  const previousLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const exports = previousLoad.apply(this, arguments);
    if (!exports || !["object", "function"].includes(typeof exports) || Module.isBuiltin(request)) return exports;
    let target;
    try {
      const loadedPath = canonical(Module._resolveFilename(request, parent, isMain));
      target = targets.get(loadedPath);
    } catch { return exports; }
    if (!target || seen.has(exports)) return exports;
    if (target === "scanService" && exports.prototype?.Handle_perform_scan) {
      if (delivery) exports.prototype.Handle_AutoMiningLoginReady = function(args, session) { return delivery.ready(args, session, controller); };
      exports.prototype.Handle_AutoMiningClientReady = function(args, session) { return controller.clientReady(session, args?.[1]); };
      exports.prototype.Handle_AutoMiningSurveyAck = function(args, session) { return controller.surveyAck(session, args?.[0] === true || args?.[0] === 1, args?.[1]); };
      exports.prototype.Handle_AutoMiningProfile = function(args, session) { return controller.applyProfile(session, args?.[0]); };
      installHUD(exports, controller, createCatalog(root), destinations);
    } else if (target === "movement" && typeof exports === "function") {
      installMovement(exports);
    } else if (target === "mining" && exports.__autoMiningBridge) {
      mining = exports;
      const original = exports.tickScene;
      exports.tickScene = function(scene, now) {
        const result = original.apply(this, arguments);
        controller.tick(scene, now);
        return result;
      };
    } else if (target === "commands" && typeof exports.executeChatCommand === "function") {
      commands.installChat(exports, controller);
    } else if (target === "plain" && typeof exports.broadcastLocalMessage === "function") {
      commands.installPlainChat(exports, controller);
    } else return exports; // Defer partial exports from circular requires.
    seen.add(exports);
    return exports;
  };
  globalThis[key] = { active: true, controller, delivery };
  console.log(`[AutoMining] v${require("./evejs-launcher.mod.json").version} loaded. !AutoMining on | off | ore,ore | clear | nearest | furthest | largest | smallest (GM clients can also use /AutoMining)`);
  return globalThis[key];
}
module.exports = { install, SUPPORTED_HASH };
install();
