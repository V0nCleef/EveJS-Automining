"use strict";
// Read-only integration with the installed EveJS mining source. Runtime data
// and native dependencies are substituted; no server, database or client boots.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const sourceFile = path.join(process.argv[2], "server/src/services/mining/miningRuntime.js");
const source = fs.readFileSync(sourceFile, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"), "425b56f81bf398d79f67437f08f05b7746eca2f982e9a7c0ebc5b98a1307a8c0");
const bridge = require("../lib/bridge");
const ore = { itemID: 51, typeID: 123, itemName: "Dense Veldspar", kind: "asteroid", radius: 5, position: { x: 50, y: 0, z: 0 } };
const ship = { itemID: 10, kind: "ship", characterID: 42, position: { x: 0, y: 0, z: 0 }, radius: 5 };
const fitted = [{ itemID: 1, typeID: 100, flagID: 27, locationID: 10, online: true }, { itemID: 2, typeID: 100, online: false }];
const miningEffect = { effectID: 67, name: "miningLaser" };
const surveyEffect = { effectID: 81, name: "surveyScan" };
fitted.push({ itemID: 3, typeID: 200, locationID: 10, online: true });
const resources = new Map([[51, { remainingQuantity: 100, yieldTypeID: 123, yieldKind: "ore", unitVolume: 0.1 }]]);
let free = 100;
const dependencies = {
  interactionScope: { canEntitiesInteractLocally: () => true },
  characterState: { getActiveShipRecord: () => ship },
  skillState: { getCachedCharacterSkillMap: () => new Map() },
  itemStore: { ITEM_FLAGS: { CARGO_HOLD: 5 } },
  simulationInventoryProjection: { findShipItemById: () => ship, getProjectionVersion: () => free, listContainerItems: () => [] },
  liveFittingState: {
    getFittedModuleItems: () => fitted, isModuleOnline: x => x.online,
    getTypeEffectRecords: typeID => [typeID === 200 ? surveyEffect : miningEffect], getLoadedChargeByFlag: () => null,
    buildShipResourceState: () => ({ cargoCapacity: free }),
  },
  itemTypeRegistry: { resolveItemByTypeID: () => ({ name: "Dense Veldspar" }) },
  miningInventory: { getPreferredMiningHoldFlagForType: () => null },
  miningDogma: {
    isMiningEffectRecord: e => e === miningEffect,
    buildMiningModuleSnapshot: () => ({ family: "ore", maxRangeMeters: 45 }),
  },
  commandBurstRuntime: { collectModifierEntriesForItem: () => [] },
  wormholeEnvironmentRuntime: { getLocationModifierSourcesForSystem: () => [] },
  miningRuntimeState: { ensureSceneMiningState() {}, getMineableState: (_, id) => resources.get(id), isMineableStaticEntity: x => x.kind === "asteroid" },
  npcEquipment: { isNativeNpcEntity: () => false },
};
const context = { module: { exports: {} }, Map, Set, Date, console, __dirname: path.dirname(sourceFile),
  require(id) { if (id === "path") return path; return dependencies[path.basename(id)] || {}; },
};
vm.runInNewContext(source + "\n" + bridge, context, { filename: sourceFile });
const api = context.module.exports.__autoMiningBridge;
const scene = { staticEntities: [ore], getEntityByID: id => id === 51 ? ore : null };
const modules = api.modules(ship);
assert.equal(modules.length, 1);
const candidates = api.candidates(scene, ship);
assert.equal(candidates[0].name, "Dense Veldspar");
assert.equal(candidates[0].distance, 40);
assert.equal(api.target(scene,ship,51).distance,40);
assert.equal(api.target(scene,ship,999),null);
assert.equal(api.hasRoom(scene,ship,51),true);
assert.equal(api.hasRoom(scene,ship,999),null);
assert(api.compatible(scene, ship, modules[0], candidates[0]));
resources.get(51).yieldKind = "ice";
assert(!api.compatible(scene, ship, modules[0], candidates[0]));
resources.get(51).yieldKind = "ore";
free = 0;
assert.equal(api.hasRoom(scene,ship,51),false);
assert(!api.compatible(scene, ship, modules[0], candidates[0]));
free = 100; ore.position.x = 100;
assert(!api.compatible(scene, ship, modules[0], api.candidates(scene, ship)[0]));
assert(api.compatible(scene, ship, modules[0], api.candidates(scene, ship)[0], 0, true));
resources.get(51).remainingQuantity = 0;
assert.equal(api.target(scene,ship,51),null);
assert.equal(api.candidates(scene, ship).length, 0);
console.log("PASS: actual EveJS mining source + injected bridge: modules, surface range, approach eligibility, ore names, family compatibility, full hold, depletion.");
