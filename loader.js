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
const { installJobArtwork } = require("./lib/jobArtwork");
const { createHaulDestinations } = require("./lib/haulDestinations");
const { createNativeDeparture, createTransportArrival, installNavigation } = require("./lib/departure");
const { SUPPORTED_HASH, supportsMiningSource, prepareMiningSource } = require("./lib/miningCompatibility");
const loginDelivery = require("./lib/loginDelivery");
const { createStatistics } = require("./lib/statistics");
const { createActivity } = require("./lib/activity");
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
  const combatPath = path.join(root, "server/src/space/runtime/targetDamageApplication.js");
  // A late export replacement cannot change functions already destructured by
  // native consumers. Preserve every job and fail closed only for these metrics.
  const combatAlreadyLoaded = Object.values(require.cache).some(module => canonical(module.filename) === canonical(combatPath));
  let combatWarningShown = false;
  function combatUnavailable(reason) {
    if (combatWarningShown) return;
    combatWarningShown = true;
    console.warn(`[AutoMining] Live combat statistics unavailable: ${reason}`);
  }
  if (combatAlreadyLoaded) combatUnavailable("native damage loaded before this mod. Restart normally to enable tracking.");
  else if (!fs.existsSync(combatPath)) combatUnavailable("this native build has no supported damage commit hook.");
  let delivery = null;
  try {
    if (loginDelivery.supportsRoot(root)) delivery = loginDelivery.createDelivery(__dirname);
  } catch (error) {
    console.error("[AutoMining] Login companion could not be prepared; server startup preserved.");
  }
  let mining = null;
  const preferences = createPreferences(path.join(root, "config/autoMining.players.json"));
  const destinations = createHaulDestinations(root);
  const loadNative = name => require(path.join(root, "server/src", name));
  const typeCache = new Map();
  const typeInfo = id => {
    if (!typeCache.has(id)) typeCache.set(id, loadNative("services/inventory/itemTypeRegistry.js").resolveItemByTypeID(id));
    return typeCache.get(id);
  };
  const statistics = createStatistics(path.join(root, "config/autoMining.statistics.json"), {
    typeVolume: id => Number(typeInfo(id)?.volume) || 0,
    isDroneType: id => Number(typeInfo(id)?.categoryID) === 18,
    getFleet: id => loadNative("services/fleets/fleetRuntime.js").getFleetForCharacter(id),
    getSession: id => loadNative("services/chat/sessionRegistry.js").findSessionByCharacterID(id),
    characterName: id => loadNative("services/chat/sessionRegistry.js").findSessionByCharacterID(id)?.characterName || String(id),
  });
  const activity = createActivity();
  const controller = createController(() => mining?.__autoMiningBridge, () => require(path.join(root, "server/src/space/runtime.js")), console.error, preferences, createCompression(root), destinations,
    createCrystalManager(nativeCrystalOperations(root)), root, { statistics, activity,
      getFleet: id => loadNative("services/fleets/fleetRuntime.js").getFleetForCharacter(id),
      getSession: id => loadNative("services/chat/sessionRegistry.js").findSessionByCharacterID(id),
      isFleetBoss: (fleet, id) => {
        const member = loadNative("services/fleets/fleetRuntime.js").getMemberRecord(fleet, id);
        const constants = loadNative("services/fleets/fleetConstants.js");
        return !!(member && (member.job & constants.FLEET_JOB_CREATOR));
      },
    });
  const departure = createNativeDeparture(root, controller);
  controller.setReinforcementAttackAvailable?.(false);
  if(combatAlreadyLoaded)console.warn("[AutoMining] Automatic reinforcement calls unavailable: native damage loaded before this mod. Manual calls and jobs remain available.");
  departure.transportArrival = createTransportArrival(controller);
  controller.setDepartureGuard(departure);
  const targets = new Map([
    [canonical(miningPath), "mining"],
    [canonical(path.join(root, "server/src/services/chat/chatCommands.js")), "commands"],
    [canonical(path.join(root, "server/src/_secondary/chat/chatRuntime.js")), "plain"],
    [canonical(path.join(root, "server/src/services/mining/miningScanMgrService.js")), "scanService"],
    [canonical(path.join(root, "server/src/services/ship/beyonceService.js")), "movement"],
    [canonical(path.join(root, "server/src/services/mining/miningLedgerState.js")), "miningLedger"],
    ...(!combatAlreadyLoaded ? [[canonical(combatPath), "combatDamage"]] : []),
    [canonical(path.join(root, "server/src/network/clientSession.js")), "clientSession"],
  ]);
  const seen = new WeakSet();
  const statsSeen = new WeakSet();
  function installStatistics(exports, target) {
    if (!exports || !["function", "object"].includes(typeof exports) || statsSeen.has(exports)) return;
    if (target === "miningLedger") {
      if (!statistics.attachLedger(exports)) throw Error("[AutoMining] Mining statistics could not attach to the native ledger.");
    } else if (target === "combatDamage") {
      if (!statistics.attachCombat(exports, {
        isActive: session => controller.combatStatisticsEnabled(session), typeInfo,
        scope: entity => loadNative("space/destiny/identity/interactionScope.js").resolveEntityInteractionScope(entity),
      })) {
        // This optional metric must never disable jobs or native damage. Empty
        // circular exports can be tried again after their compilation completes.
        combatUnavailable("could not attach to native damage commits.");
        return;
      }
      // Attach before native consumers destructure this export, immediately
      // after the existing statistics hook. Native results and errors stay exact.
      const committed=exports.applyWeaponDamageToTarget;
      if(typeof committed==="function"&&!committed._autoMiningReinforcementAttack) {
        const wrapped=function(scene,attacker,target){
          const result=committed.apply(this,arguments);
          try{controller.reinforcementAttack(scene,attacker,target,result);}catch{}
          return result;
        };
        wrapped._autoMiningCombatStatistics=committed._autoMiningCombatStatistics;
        wrapped._autoMiningReinforcementAttack=controller;
        exports.applyWeaponDamageToTarget=wrapped;
        controller.setReinforcementAttackAvailable?.(true);
      }
    } else if (target === "clientSession" && typeof exports.prototype?.sendSessionChange === "function") {
      const original = exports.prototype.sendSessionChange;
      exports.prototype.sendSessionChange = function(changes, options) {
        const result = original.apply(this, arguments);
        // Initial selection/reconnect establishes a baseline, not a new dock.
        const characterChange = changes?.charid;
        if (!characterChange || Number(characterChange[0]) === Number(characterChange[1])) {
          const beforeStation = changes?.stationid ? changes.stationid[0] : this.stationid ?? this.stationID;
          const beforeStructure = changes?.structureid ? changes.structureid[0] : this.structureid ?? this.structureID;
          const afterStation = changes?.stationid ? changes.stationid[1] : this.stationid ?? this.stationID;
          const afterStructure = changes?.structureid ? changes.structureid[1] : this.structureid ?? this.structureID;
          if (changes?.stationid || changes?.structureid) {
            try { statistics.observeDock(this, Number(beforeStructure || beforeStation || 0), Number(afterStructure || afterStation || 0)); }
            catch (error) { console.error(`[AutoMining] Dock statistics recording failed: ${error.message}`); }
          }
        }
        return result;
      };
    } else return;
    statsSeen.add(exports);
  }
  function installMovement(exports) {
    if (seen.has(exports)) return;
    const required = ["Handle_CmdGotoDirection", "Handle_CmdWarpToStuff", "Handle_CmdDock", "Handle_CmdWarpToStuffAutopilot"];
    const missing = required.filter(name => typeof exports?.prototype?.[name] !== "function");
    if (missing.length) throw Error(`[AutoMining] Drone recall guard cannot attach: missing ${missing.join(", ")}`);
    // Native entity warp reaches this point planner after fleet/item and scope
    // authority checks. Only the consumed transport invocation receives a point.
    departure.transportArrival.attach(loadNative("space/runtime.js")._testing.SolarSystemScene.prototype);
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
    installStatistics(this.exports, targets.get(canonical(filename)));
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
    if (target === "miningLedger" || target === "clientSession" || target === "combatDamage") {
      installStatistics(exports, target);
      seen.add(exports);
      return exports;
    }
    if (target === "scanService" && exports.prototype?.Handle_perform_scan) {
      if (delivery) exports.prototype.Handle_AutoMiningLoginReady = function(args, session) { return delivery.ready(args, session, controller); };
      exports.prototype.Handle_AutoMiningClientReady = function(args, session) { return controller.clientReady(session, args?.[1]); };
      exports.prototype.Handle_AutoMiningSurveyAck = function(args, session) { return controller.surveyAck(session, args?.[0] === true || args?.[0] === 1, args?.[1]); };
      exports.prototype.Handle_AutoMiningProfile = function(args, session) { return controller.applyProfile(session, args?.[0]); };
      installHUD(exports, controller, createCatalog(root), destinations);
      installJobArtwork(exports, __dirname);
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
  globalThis[key] = { active: true, controller, delivery, statistics };
  console.log(`[AutoMining] v${require("./evejs-launcher.mod.json").version} loaded. !AutoMining on | off | ore,ore | clear | nearest | furthest | largest | smallest (GM clients can also use /AutoMining)`);
  return globalThis[key];
}
module.exports = { install, SUPPORTED_HASH };
install();
