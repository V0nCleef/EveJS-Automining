"use strict";
// Passive compatibility check: load the real server handlers without a world
// tick or filesystem writes, and verify the recall wrappers are attached.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = fs.realpathSync(process.argv[2]);
const loaderPath = path.resolve(process.argv[3] || path.join(__dirname, "../loader.js"));
const autopilotPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
const autopilotFirst = process.argv[5] === "autopilot-first";
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "reader";

const blockedWrites = [];
const deny = name => () => { blockedWrites.push(name); throw Error(`Read-only native load attempted ${name}`); };
for (const name of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "rmdir",
  "copyFile", "truncate", "chmod", "chown", "symlink", "link", "utimes", "write", "writev"]) {
  if (fs[name]) fs[name] = deny(name);
  if (fs[name + "Sync"]) fs[name + "Sync"] = deny(name + "Sync");
  if (fs.promises[name]) fs.promises[name] = deny("promises." + name);
}
fs.createWriteStream = deny("createWriteStream");
const readFlag = flags => typeof flags === "number"
  ? !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
  : ["r", "rs", "sr"].includes(flags || "r");
for (const name of ["open", "openSync"]) {
  const original = fs[name];
  fs[name] = function(file, flags, ...args) {
    if (!readFlag(flags)) return deny(name)(file);
    return original.call(this, file, flags, ...args);
  };
}
const openPromise = fs.promises.open;
fs.promises.open = function(file, flags, ...args) {
  if (!readFlag(flags)) return deny("promises.open")(file);
  return openPromise.call(this, file, flags, ...args);
};

// Keep the native service graph, but prevent its logger from opening files.
const target = path.join(root, "server/src/services/ship/beyonceService.js");
const loggerPath = path.resolve(require.resolve(path.join(root, "server/src/utils/logger"))).toLowerCase();
const logger = new Proxy({}, { get: (_, key) => key === "isVerboseDebugEnabled" ? () => false : () => {} });
const nativeLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (!Module.isBuiltin(request) &&
      path.resolve(Module._resolveFilename(request, parent, isMain)).toLowerCase() === loggerPath) return logger;
  return nativeLoad.apply(this, arguments);
};

try {
  let autopilot;
  function loadAutopilot() {
    assert.ok(autopilotPath, "autopilot-first requires an autopilot loader path");
    autopilot = require(autopilotPath);
    assert.equal(autopilot.installResult.active, true, "Autopilot loader must be active");
  }
  if (autopilotFirst) loadAutopilot();
  const automining = require(loaderPath).install(root);
  assert.equal(automining.active, true, "AutoMining loader must be active");
  if (autopilotPath && !autopilotFirst) loadAutopilot();

  const Service = require(target);
  const runtime = require(path.join(root,"server/src/space/runtime.js"));
  const planner = runtime._testing.SolarSystemScene.prototype.warpToPoint;
  assert.equal(planner[Symbol.for("evejs.automining.transportArrival.v1")],true,"Pickup planner must wrap the actual native scene method");
  assert.match(planner.toString(),/original\.apply\(this,args\)/);
  const movement = require(path.join(root,"server/src/space/runtime/destinyMovementEngine.js"));
  // The exported dispatcher delegates to the native command planner. Its
  // source validates private-space visibility before calling the point seam.
  const commandsSource=fs.readFileSync(path.join(root,"server/src/space/destiny/commands/warpCommands.js"),"utf8");
  const entityPlanner=commandsSource.slice(commandsSource.indexOf("warpToEntity(runtime,"),commandsSource.indexOf("warpToPoint(runtime,"));
  assert(entityPlanner.indexOf("canSessionSeeDungeonScopedEntity")<entityPlanner.indexOf("return runtime.warpToPoint("));
  assert.match(entityPlanner,/targetEntityID: target\.itemID/);
  const ship={itemID:900000001,radius:250,position:{x:0,y:0,z:0},direction:{x:1,y:0,z:0},warpSpeedAU:3,maxVelocity:100};
  const arrival={x:200000,y:345,z:678};
  const pending=movement.buildPendingWarpRequest(ship,arrival,{stopDistance:0,targetEntityID:900000002});
  assert.deepEqual(pending.targetPoint,arrival);assert.deepEqual(pending.rawDestination,arrival);
  const preparing=movement.buildPreparingWarpState(ship,pending,{nowMs:1000});
  assert.deepEqual(preparing.targetPoint,arrival);assert.equal(preparing.targetEntityID,900000002);
  // Proof against the real native completion implementation, without a world tick.
  const movementSource=fs.readFileSync(path.join(root,"server/src/space/destiny/simulation/movement.js"),"utf8");
  assert.match(movementSource,/subtractVectors\(entity\.warpState\.targetPoint, entity\.warpState\.origin\)/);
  assert.match(movementSource,/entity\.position = addVectors\([\s\S]*?entity\.warpState\.origin,[\s\S]*?scaleVector\(direction, traveledDistance\)/);
  const ledger = require(path.join(root, "server/src/services/mining/miningLedgerState.js"));
  assert.equal(ledger.recordMiningLedgerEvent._autoMiningStatistics, automining.statistics,
    "Statistics hook must attach before native consumers capture ledger exports");
  const ClientSession = require(path.join(root, "server/src/network/clientSession.js"));
  assert.match(ClientSession.prototype.sendSessionChange.toString(), /statistics\.observeDock/);
  const ScanService = require(path.join(root, "server/src/services/mining/miningScanMgrService.js"));
  for (const rpc of ["AutoMiningJettison", "AutoMiningStatistics", "AutoMiningResetStatistics", "AutoMiningStatisticsSessions",
    "AutoMiningTransportReady", "AutoMiningTransportRequest", "AutoMiningTransportAction", "AutoMiningJobArtwork"])
    assert.equal(typeof ScanService.prototype["Handle_" + rpc], "function", "Missing HUD RPC " + rpc);
  for (const name of ["Handle_CmdWarpToStuff", "Handle_CmdDock", "Handle_CmdWarpToStuffAutopilot"]) {
    assert.match(Service.prototype[name].toString(), /departure\.run\(session, proceed\)/,
      `Drone recall guard missing from ${name}`);
  }
  if (autopilot) {
    assert.equal(autopilot.installResult.hookState.transformed.size, 1,
      "The other loader must actually compile its movement transform");
  }
  // The real native reconnect repairs session fields for an existing member;
  // it must retain every fleetmate. These records exist only in this process.
  const fleets = require(path.join(root, 'server/src/services/fleets/fleetRuntime.js'));
  const fleetID = 900009913, characterID = 900009914, changes = [];
  const member = {charID:characterID,role:4,job:0,wingID:-1,squadID:-1};
  const isolated = {fleetID,members:new Map([[characterID,member],[900009915,{charID:900009915}]]),
    compositionCache:{expiresAtMs:10,entries:[]}};
  fleets.runtimeState.fleets.set(fleetID,isolated);
  fleets.runtimeState.characterToFleet.set(characterID,fleetID);
  try {
    const session = {characterID,fleetid:123,shipid:900009916,sendSessionChange:c=>changes.push(c)};
    assert.equal(fleets.reconnectCharacter(session,fleetID),true);
    assert.equal(session.fleetid,fleetID);
    assert.deepEqual([...isolated.members.keys()],[characterID,900009915]);
    assert.notEqual(isolated.members.get(characterID),member);
    assert.deepEqual(changes[0].fleetid,[123,fleetID]);
  } finally {
    fleets.runtimeState.fleets.delete(fleetID);fleets.runtimeState.characterToFleet.delete(characterID);
  }
  assert.deepEqual(blockedWrites, [], "Passive load must not write server files");
  console.log(`PASS: recall guards attached to all travel handlers (${autopilotPath ? (autopilotFirst ? "autopilot first" : "AutoMining first") : "AutoMining only"}); no writes.`);
} catch (error) {
  console.error(error.stack);
  console.error("Blocked writes:", blockedWrites);
  process.exitCode = 1;
}
