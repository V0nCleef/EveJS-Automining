"use strict";
// Passive compatibility check: load the real server handlers without a world
// tick, mutation handlers or filesystem writes; verify inventory adapter seams.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = fs.realpathSync(process.argv[2]);
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
const loggerPath = path.resolve(require.resolve(path.join(root, "server/src/utils/logger"))).toLowerCase();
const logger = new Proxy({}, { get: (_, key) => key === "isVerboseDebugEnabled" ? () => false : () => {} });
const nativeLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (!Module.isBuiltin(request) &&
      path.resolve(Module._resolveFilename(request, parent, isMain)).toLowerCase() === loggerPath) return logger;
  return nativeLoad.apply(this, arguments);
};

try {
  const Broker = require(path.join(root, "server/src/services/inventory/invBrokerService.js"));
  const types = require(path.join(root, "server/src/services/inventory/itemTypeRegistry.js"));
  const mining = require(path.join(root, "server/src/services/mining/miningInventory.js"));
  const flags = require(path.join(root, "server/src/services/inventory/itemStore.js")).ITEM_FLAGS;
  const broker = Object.create(Broker.prototype); broker._boundContexts = new Map();
  let context = null; broker._getBoundContext = () => context;
  broker._makeBoundSubstruct = value => { context = value; return value; };
  const target = {inventoryID: 50, flagID: null, kind: "container", locationID: 30};
  broker._makeBoundSubstruct(target);
  assert.equal(broker._getBoundContext(), target);
  assert.equal(broker._extractKwarg({flag: 0,qty: 50}, "flag"), 0);
  assert.equal(broker._extractKwarg({flag: 0,qty: 50}, "qty"), 50);
  assert.equal(broker._resolveAppliedMoveQuantity({singleton: 0,stacksize: 100}, {locationID: 50,flagID: 0}, 50), 50);
  assert.deepEqual(Object.fromEntries(broker._buildCapacityInfo(100, 25).args.entries), {capacity: 100,used: 25});
  assert.equal(broker._getGenericContainerContentsOwnerID({characterID:42}, {categoryID:12,ownerID:99,typeID:23}), null, "Native generic container listing must include mixed custody owners");
  assert.equal(flags.FLEET_HANGAR, 155); assert.equal(flags.FUEL_BAY, 133);
  const can = types.resolveItemByTypeID(23);
  assert.ok(can && can.capacity > 0, "Native jetcan static capacity must exist");
  console.log(`Native type23 jetcan capacity: ${can.capacity} m3`);
  assert.equal(mining.classifyMiningMaterialType({typeID: 123456789,categoryID: 25,groupID: 465}).kind, "ice");
  assert.equal(mining.classifyMiningMaterialType({typeID: 123456790,categoryID: 25,groupID: 711}).kind, "gas");
  assert.equal(mining.classifyMiningMaterialType({typeID: 123456791,categoryID: 25,groupID: 450}).kind, "ore");
  const entitlement = require(path.join(root, "server/src/services/_shared/spaceLootEntitlement.js"));
  assert.equal(entitlement.sessionHasSpaceLootRight({characterID: 42}, {ownerID: 99,lootInfo: {abandoned: true}}), true);
  assert.deepEqual(blockedWrites, []);
  console.log("PASS: real native inventory adapter kwargs, quantity, capacity records, hold flags and ore classifier; no writes or mutation handlers invoked.");
} catch (error) {
  console.error(error.stack); console.error("Blocked writes:", blockedWrites); process.exitCode = 1;
}
