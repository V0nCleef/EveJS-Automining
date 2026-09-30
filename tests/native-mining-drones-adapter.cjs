"use strict";
// Passive imports and pure identity checks only: no launch, order, tick or world.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const root = fs.realpathSync(process.argv[2]);
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "reader";
const writes = [], deny = name => () => { writes.push(name); throw Error("Read-only drone adapter attempted " + name); };
for (const name of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "rmdir", "copyFile", "truncate", "chmod", "chown", "symlink", "link", "utimes", "write", "writev"]) {
  if (fs[name]) fs[name] = deny(name); if (fs[name + "Sync"]) fs[name + "Sync"] = deny(name + "Sync");
  if (fs.promises[name]) fs.promises[name] = deny("promises." + name);
}
fs.createWriteStream = deny("createWriteStream");
const readOnly = flags => typeof flags === "number" ? !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) : ["r", "rs", "sr"].includes(flags || "r");
for (const name of ["open", "openSync"]) { const original = fs[name]; fs[name] = function(file, flags, ...args) { if (!readOnly(flags)) return deny(name)(); return original.call(this, file, flags, ...args); }; }
const open = fs.promises.open; fs.promises.open = function(file, flags, ...args) { if (!readOnly(flags)) return deny("promises.open")(); return open.call(this, file, flags, ...args); };
const loggerPath = path.resolve(root, "server/src/utils/logger.js").toLowerCase(), originalLoad = Module._load;
const logger = new Proxy({}, { get: (_, key) => key === "isVerboseDebugEnabled" ? () => false : () => {} });
Module._load = function(request, parent, isMain) {
  if (!Module.isBuiltin(request) && path.resolve(Module._resolveFilename(request, parent, isMain)).toLowerCase() === loggerPath) return logger;
  return originalLoad.apply(this, arguments);
};
try {
  const file = path.join(root, "server/src/services/drone/droneRuntime.js"), drone = require(file);
  for (const name of ["launchDronesForSession", "commandMineRepeatedly", "commandReturnBay", "commandReturnHome", "commandEngage", "isDroneEntity"])
    assert.equal(typeof drone[name], "function", "Native drone export " + name);
  assert.equal(drone.isDroneEntity({ kind: "drone" }), true); assert.equal(drone.isDroneEntity({ kind: "ship" }), false);
  assert.equal(drone.DRONE_COMMAND_MINE, "MINE"); assert.equal(drone.DRONE_COMMAND_RETURN_BAY, "RETURN_BAY");
  const mine = drone.commandMineRepeatedly.toString(), launch = drone.launchDronesForSession.toString(), source = fs.readFileSync(file, "utf8");
  for (const contract of ["getShipStateForSession(session)", "droneEntity.controllerID", "shipRecord.itemID", "canPlayerCompanionActOnTarget", "resolveDroneMiningSnapshot", "isDroneMiningCompatibleWithTarget"])
    assert(mine.includes(contract), "Native mining authority " + contract);
  for (const contract of ["getShipFittingSnapshot", "ATTRIBUTE_MAX_ACTIVE_DRONES", "ATTRIBUTE_DRONE_BANDWIDTH", "ITEM_FLAGS.DRONE_BAY", "activeDroneCount >= maxActiveDrones", "usedBandwidth + launchBandwidth > droneBandwidth"])
    assert(launch.includes(contract), "Native launch authority " + contract);
  assert.match(source, /function commandReturnDrones[\s\S]*?securityScopesExactlyMatch/);
  const client = fs.readFileSync(path.resolve(__dirname, "../client/drones.py"), "utf8");
  assert(client.includes("from eve.client.script.ui.services.menuSvcExtras.droneFunctions import LaunchDrones"));
  assert(client.includes("LaunchDrones(ids)"));
  assert.deepEqual(writes, []);
  console.log("PASS: native mining/return/launch exports, controlled-drone and target-profile checks, fitting skill/bandwidth/bay limits, existing TQ LaunchDrones call; no writes, ticks, scenes, launches or native orders.");
} catch (error) { console.error(error.stack); console.error("Blocked writes:", writes); process.exitCode = 1; }
