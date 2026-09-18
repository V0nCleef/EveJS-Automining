"use strict";
// Read-only integration with the installed EveJS mining source. Runtime data
// and native dependencies are substituted; no server, database or client boots.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { supportsMiningSource, prepareMiningSource } = require("../lib/miningCompatibility");
const sourceFile = path.join(process.argv[2], "server/src/services/mining/miningRuntime.js");
const source = fs.readFileSync(sourceFile, "utf8");
assert.ok(supportsMiningSource(source), "Unsupported mining runtime baseline");
const bridge = require("../lib/bridge");
const ore = { itemID: 51, typeID: 123, itemName: "Dense Veldspar", kind: "asteroid", radius: 5, position: { x: 50, y: 0, z: 0 } };
const ship = { itemID: 10, kind: "ship", characterID: 42, position: { x: 0, y: 0, z: 0 }, radius: 5 };
const fitted = [{ itemID: 1, typeID: 100, flagID: 27, locationID: 10, online: true }, { itemID: 2, typeID: 100, online: false }];
const miningEffect = { effectID: 67, name: "miningLaser" };
const surveyEffect = { effectID: 81, name: "surveyScan" };
fitted.push({ itemID: 3, typeID: 200, locationID: 10, online: true });
const resources = new Map([[51, { remainingQuantity: 100, yieldTypeID: 123, yieldKind: "ore", unitVolume: 0.1 }]]);
let free = 100;
let boostUntil = 0;
const boostTimes = [];
const dependencies = {
  config: { miningEnabled:true, miningSurveyScanDistanceMeters:250000 },
  runtime: { getSceneForSession: () => scene },
  interactionScope: { canEntitiesInteractLocally: () => true },
  characterState: { getActiveShipRecord: () => ship },
  skillState: { getCachedCharacterSkillMap: () => new Map() },
  itemStore: { ITEM_FLAGS: { CARGO_HOLD: 5 } },
  simulationInventoryProjection: { findShipItemById: () => ship, getProjectionVersion: () => free, listContainerItems: () => [] },
  liveFittingState: {
    getEffectTypeRecord: () => miningEffect,
    getTypeAttributeMap: () => ({128: 1, 604: 663}),
    getAttributeIDByNames: name => ({integratedMiningScanner:9001,miningScannerUpgrade:9002})[name],
    getFittedModuleItems: () => fitted, isModuleOnline: x => x.online,
    getTypeEffectRecords: typeID => [typeID === 200 ? surveyEffect : miningEffect], getLoadedChargeByFlag: () => null,
    buildShipResourceState: () => ({ cargoCapacity: free }),
  },
  itemTypeRegistry: { resolveItemByTypeID: () => ({ name: "Dense Veldspar" }) },
  miningInventory: { getPreferredMiningHoldFlagForType: () => null },
  miningDogma: {
    resolveMiningFamily: () => "ore",
    isMiningEffectRecord: e => e === miningEffect,
    buildMiningModuleSnapshot: ({additionalModifierEntries}) => ({ family: "ore", maxRangeMeters: additionalModifierEntries.length ? 90 : 45 }),
  },
  commandBurstRuntime: { collectModifierEntriesForItem: (_, item, now) => {
    boostTimes.push(now);
    return now < boostUntil ? [{attributeID:54, value:100}] : [];
  } },
  wormholeEnvironmentRuntime: { getLocationModifierSourcesForSystem: () => [] },
  miningRuntimeState: { ensureSceneMiningState() {}, getMineableState: (_, id) => resources.get(id), isMineableStaticEntity: x => x.kind === "asteroid" },
  npcEquipment: { isNativeNpcEntity: () => false },
};
const context = { module: { exports: {} }, Map, Set, Date, console, __dirname: path.dirname(sourceFile),
  require(id) { if (id === "path") return path; return dependencies[path.basename(id)] || {}; },
};
vm.runInNewContext(prepareMiningSource(source) + "\n" + bridge, context, { filename: sourceFile });
const api = context.module.exports.__autoMiningBridge;
assert.equal(context.module.exports.miningModuleCanShortCycle(ship, {moduleID: 1, typeID: 100, effectID: 67}), true, "Crystal-capable ore miners must short-cycle on both baselines");
assert.equal(api.hasSurveyor(ship), false);
ship.passiveDerivedState = {attributes:{9001:1,9002:0}};
assert.equal(api.hasSurveyor(ship), true);
ship.passiveDerivedState.attributes = {9001:0,9002:2};
assert.equal(api.hasSurveyor(ship), true);
ship.passiveDerivedState.attributes = {9001:0,9002:0};
assert.equal(api.hasSurveyor(ship), false);
const scene = { staticEntities: [ore], getEntityByID: id => id === 51 ? ore : null,
  getShipEntityForSession: () => ship, getVisibleEntitiesForSession: () => [ore],
  getPublicGridClusterKeyForEntity: entity => entity.grid || 'current-belt' };
const modules = api.modules(ship);
assert.equal(modules.length, 1);
const candidates = api.candidates(scene, ship);
assert.equal(api.surveyGrid(scene,ship),'current-belt');
assert.equal(api.surveyResource(scene,ship,null),51);
// A cached live resource must not enumerate the asteroid field again.
const entities=scene.staticEntities;
scene.staticEntities={ [Symbol.iterator]() { throw Error('unexpected survey field search'); } };
assert.equal(api.surveyResource(scene,ship,51),51);
scene.staticEntities=entities;
assert.equal(candidates[0].name, "Dense Veldspar");
assert.equal(candidates[0].distance, 40);
assert.equal(api.target(scene,ship,51).distance,40);
assert.equal(api.target(scene,ship,999),null);
assert.equal(api.hasRoom(scene,ship,51),true);
assert.equal(api.hasRoom(scene,ship,999),null);
// AutoMining does not replace survey results: native visibility + range remain.
assert.equal(context.module.exports.buildScanResultsForSession({_space:{}})[0][0],51);
ore.position.x = 300000;
assert.equal(context.module.exports.buildScanResultsForSession({_space:{}}).length,0);
ore.position.x = 50;
scene.getVisibleEntitiesForSession = () => [];
assert.equal(context.module.exports.buildScanResultsForSession({_space:{}}).length,0);
scene.getVisibleEntitiesForSession = () => [ore];
assert(api.compatible(scene, ship, modules[0], candidates[0]));
ore.grid = 'another-belt';
assert.equal(api.surveyResource(scene,ship,51),null);
assert.equal(api.candidates(scene, ship).length, 0);
assert.equal(api.target(scene, ship, 51), null);
delete ore.grid;
resources.get(51).yieldKind = "ice";
assert.equal(api.surveyResource(scene,ship,null),51);
resources.get(51).yieldKind = "gas";
assert.equal(api.surveyResource(scene,ship,null),51);
assert(!api.compatible(scene,ship,modules[0],candidates[0]));
const gasModule={...modules[0],snapshot:{...modules[0].snapshot,family:'gas'}};
assert(api.compatible(scene,ship,gasModule,candidates[0]));
resources.get(51).yieldKind = "ice";
assert(!api.compatible(scene,ship,gasModule,candidates[0]));
assert(!api.compatible(scene, ship, modules[0], candidates[0]));
resources.get(51).yieldKind = "ore";
free = 0;
assert.equal(api.hasRoom(scene,ship,51),false);
assert(!api.compatible(scene, ship, modules[0], candidates[0]));
free = 100; ore.position.x = 100;
assert(!api.compatible(scene, ship, modules[0], api.candidates(scene, ship)[0]));
assert(api.compatible(scene, ship, modules[0], api.candidates(scene, ship)[0], 0, true));
boostUntil = 2000;
const boosted = api.modules(ship, 1000);
assert.equal(boostTimes.at(-1), 1000);
assert.equal(boosted[0].snapshot.maxRangeMeters, 90);
assert(api.compatible(scene, ship, boosted[0], api.candidates(scene, ship)[0]));
assert.notEqual(api.boostSignature(ship, boosted, 1000), api.boostSignature(ship, boosted, 2001));
assert(!api.compatible(scene, ship, api.modules(ship, 2001)[0], api.candidates(scene, ship)[0]));
resources.get(51).remainingQuantity = 0;
assert.equal(api.surveyResource(scene,ship,51),null);
assert.equal(api.target(scene,ship,51),null);
assert.equal(api.candidates(scene, ship).length, 0);
console.log("PASS: actual EveJS mining source + injected bridge: modules, surface range, approach eligibility, ore names, family compatibility, full hold, depletion.");
