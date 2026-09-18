"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");
const { isMainThread } = require("node:worker_threads");
const { createController } = require("./lib/controller");
const commands = require("./lib/commands");
const { createPreferences } = require("./lib/preferences");
const bridge = require("./lib/bridge");
const { createCompression } = require("./lib/compression");
const { createCatalog } = require("./lib/catalog");
const { installHUD } = require("./lib/hud");
const SUPPORTED_HASH = "425b56f81bf398d79f67437f08f05b7746eca2f982e9a7c0ebc5b98a1307a8c0";
const key = Symbol.for("evejs.automining.loader.v1");
function canonical(file) { return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file); }
function install(root = path.resolve(__dirname, "../..")) {
  if (!isMainThread || globalThis[key]) return globalThis[key];
  const miningPath = path.join(root, "server/src/services/mining/miningRuntime.js");
  const hash = text => crypto.createHash("sha256").update(text).digest("hex");
  if (!fs.existsSync(miningPath) || hash(fs.readFileSync(miningPath)) !== SUPPORTED_HASH) {
    console.error("[AutoMining] Unsupported miningRuntime.js. Mod left inactive; server files unchanged.");
    return { active: false };
  }
  let mining = null;
  const preferences = createPreferences(path.join(root, "config/autoMining.players.json"));
  const controller = createController(() => mining?.__autoMiningBridge, () => require(path.join(root, "server/src/space/runtime.js")), console.error, preferences, createCompression(root));
  const targets = new Map([
    [canonical(miningPath), "mining"],
    [canonical(path.join(root, "server/src/services/chat/chatCommands.js")), "commands"],
    [canonical(path.join(root, "server/src/_secondary/chat/chatRuntime.js")), "plain"],
    [canonical(path.join(root, "server/src/services/mining/miningScanMgrService.js")), "scanService"],
  ]);
  const seen = new WeakSet();
  const previousCompile = Module.prototype._compile;
  Module.prototype._compile = function(content, filename) {
    if (canonical(filename) === canonical(miningPath)) {
      if (hash(content) === SUPPORTED_HASH) content += "\n" + bridge;
      else console.error("[AutoMining] Another mod changed the mining runtime; AutoMining bridge disabled.");
    }
    return previousCompile.call(this, content, filename);
  };
  const previousLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const exports = previousLoad.apply(this, arguments);
    if (!exports || !["object", "function"].includes(typeof exports) || Module.isBuiltin(request)) return exports;
    let target;
    try { target = targets.get(canonical(Module._resolveFilename(request, parent, isMain))); } catch { return exports; }
    if (!target || seen.has(exports)) return exports;
    if (target === "scanService" && exports.prototype?.Handle_perform_scan) {
      exports.prototype.Handle_AutoMiningClientReady = function(args, session) { return controller.clientReady(session, args?.[1]); };
      exports.prototype.Handle_AutoMiningSurveyAck = function(args, session) { return controller.surveyAck(session, args?.[0] === true || args?.[0] === 1, args?.[1]); };
      exports.prototype.Handle_AutoMiningProfile = function(args, session) { return controller.applyProfile(session, args?.[0]); };
      installHUD(exports, controller, createCatalog(root));
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
  globalThis[key] = { active: true, controller };
  console.log("[AutoMining] v1.0.5 loaded. /AutoMining on | off | ore,ore | clear | nearest | furthest");
  return globalThis[key];
}
module.exports = { install, SUPPORTED_HASH };
install();
