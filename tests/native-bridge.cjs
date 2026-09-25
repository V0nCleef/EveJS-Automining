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
let crystalLoaded = null, crystalCargo = [];
let oreHoldEnabled = false;
let boostUntil = 0;
const boostTimes = [];
const dependencies = {
  config: { miningEnabled:true, miningSurveyScanDistanceMeters:250000 },
  runtime: { getSceneForSession: () => scene },
  interactionScope: { canEntitiesInteractLocally: () => true },
  characterState: { getActiveShipRecord: () => ship },
  skillState: { getCachedCharacterSkillMap: () => new Map() },
  itemStore: { ITEM_FLAGS: { CARGO_HOLD: 5 } },
  simulationInventoryProjection: { findShipItemById: () => ship, getProjectionVersion: () => `${free}:${oreHoldEnabled}`, listContainerItems: () => [...crystalCargo, ...(oreHoldEnabled ? [{ flagID: 134, quantity: 1, volume: 100 - free }] : [])] },
  liveFittingState: {
    getEffectTypeRecord: () => miningEffect,
    getTypeAttributeMap: type => ({128: 1, 604: 663, 3148: type === 701 ? 7 : 8}),
    isChargeCompatibleWithModule: (module, charge) => module === 100 && [700,701].includes(charge),
    getAttributeIDByNames: name => ({integratedMiningScanner:9001,miningScannerUpgrade:9002})[name],
    getFittedModuleItems: () => fitted, isModuleOnline: x => x.online,
    getTypeEffectRecords: typeID => [typeID === 200 ? surveyEffect : miningEffect], getLoadedChargeByFlag: () => crystalLoaded,
    buildShipResourceState: () => ({ cargoCapacity: free, generalMiningHoldCapacity: oreHoldEnabled ? 100 : 0 }),
  },
  itemTypeRegistry: { resolveItemByTypeID: () => ({ name: "Dense Veldspar" }) },
  miningInventory: { getPreferredMiningHoldFlagForType: () => oreHoldEnabled ? 134 : null,
    getShipHoldCapacityByFlag: (state, flag) => flag === 134 ? state.generalMiningHoldCapacity : 0 },
  typeListAuthority: { matchesTypeList: (item, list) => item.typeID === 123 && list === 7 || item.typeID === 124 && list === 8 },
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
  require(id) {
    if (id === "path") return path;
    // Pure shared numeric functions moved out of miningRuntime in 0.12.9.
    if (id === "../../common/numbers") return require(path.resolve(path.dirname(sourceFile), id));
    return dependencies[path.basename(id)] || {};
  },
};
vm.runInNewContext(prepareMiningSource(source) + "\n" + bridge, context, { filename: sourceFile });
const api = context.module.exports.__autoMiningBridge;
const profileCounts = new Map(), profileTimes = [];
api.setProfiler({ start: () => 0n, end: name => profileTimes.push(name),
  count: (name, amount = 1) => profileCounts.set(name, (profileCounts.get(name) || 0) + amount) });
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
let fieldEnumerations = 0;
scene.staticEntities = new Proxy(scene.staticEntities, { get(target, key, receiver) {
  if (key === Symbol.iterator) return function* () { fieldEnumerations++; yield* target; };
  return Reflect.get(target, key, receiver);
} });
const modules = api.modules(ship);
assert.equal(modules.length, 1);
const candidates = api.candidates(scene, ship);
const fleetMate = { ...ship, itemID: 11, position: { x: 20, y: 0, z: 0 } };
const fleetCandidates = api.candidates(scene, fleetMate);
assert.equal(fieldEnumerations, 1, 'Same-belt pilots share one field enumeration');
assert.equal(profileCounts.get('field.cacheMisses'), 1);
assert.equal(profileCounts.get('field.cacheHits'), 1);
assert.deepEqual(profileTimes, ['field.enumeration']);
assert.equal(fleetCandidates.length, 1);
assert.notEqual(fleetCandidates[0].distance, candidates[0].distance, 'Each ship keeps its own range');
assert.equal(api.surveyGrid(scene,ship),'current-belt');
assert.equal(api.surveyResource(scene,ship,null),51);
scene.getLivePublicGridClusterKeyForEntity = entity => entity === ship ? ship.liveGrid || 'current-belt' : entity.grid || 'current-belt';
assert.equal(api.miningSite(scene,ship),true);
ship.liveGrid = 'station-undock';
assert.equal(api.surveyGrid(scene,ship),'station-undock');
assert.equal(api.miningSite(scene,ship),false);
assert.equal(api.surveyResource(scene,ship,null),null);
assert.equal(api.candidates(scene,ship).length,0);
assert.equal(api.target(scene,ship,51),null);
delete ship.liveGrid;
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
assert.equal(api.oreHold(scene, ship, () => true, 0), null, "Cargo-only ships must not trigger ore-hold hauling");
oreHoldEnabled = true; free = 0.05; resources.get(51).remainingQuantity = 100;
assert.equal(api.oreHold(scene, ship, name => require('../lib/commands').matchesOre(name, ['veldspar']), 0).full, true, "A sub-unit remainder is full");
assert.equal(api.oreHold(scene, ship, name => require('../lib/commands').matchesOre(name, ['scordite']), 0).full, true, "95% departure does not depend on the current filter");
free = 5.01; assert.equal(api.oreHold(scene, ship, () => true, 0).full, false, "Below 95% keeps mining when ore still fits");
free = 5; assert.equal(api.oreHold(scene, ship, () => true, 0).full, true, "Exactly 95% starts hauling");
free = 20.01; assert.equal(api.oreHold(scene, ship, () => true, 0, 80).full, false, "Configurable 80% trigger waits below its boundary");
free = 20; assert.equal(api.oreHold(scene, ship, () => true, 0, 80).full, true, "Configurable 80% trigger starts at its boundary");
free = 0; assert.equal(api.oreHold(scene, ship, () => true, 0).full, true);
const wasOnline = fitted[0].online; fitted[0].online = false;
assert.equal(api.oreHold(scene, ship, () => true, 0).full, false, "No mining modules cannot trigger departure");
assert.equal(api.oreHold(scene, ship, () => true, 0, 95, true).full, true, "Booster-only ships with mining drones can haul at the threshold");
fitted[0].online = wasOnline;
console.log("PASS: actual EveJS mining source + injected bridge: ore-hold hauling at 95%, cargo-only ships and missing modules.");

// Actual native family/crystal compatibility with controlled inventory data.
free = 100; ore.position.x = 50;
const crystalModule = {...modules[0], snapshot: {...modules[0].snapshot, chargeTypeID:700, crystalTargetTypeListID:8}};
const crystalRocks = api.candidates(scene, ship);
crystalLoaded = {itemID:800, typeID:700, stacksize:1};
let plan = api.crystalPlan(scene,ship,crystalModule,crystalRocks,0,false);
assert.equal(plan.chargeID,0); assert.equal(plan.loadedID,800);
crystalCargo = [{itemID:900,typeID:701,ownerID:42,locationID:10,flagID:5,quantity:-1,stacksize:1}];
plan = api.crystalPlan(scene,ship,crystalModule,crystalRocks,0,false);
assert.equal(plan.chargeID,900); assert.equal(plan.chargeTypeID,701);
crystalCargo[0].flagID=134;
assert.equal(api.crystalPlan(scene,ship,crystalModule,crystalRocks,0,false).chargeID,0,'No loading from an unrelated hold');
crystalCargo[0].flagID=5;crystalCargo[0].ownerID=99;
assert.equal(api.crystalPlan(scene,ship,crystalModule,crystalRocks,0,false).chargeID,0,"No loading someone else's crystal");
const compatibleModule={...crystalModule,snapshot:{...crystalModule.snapshot,chargeTypeID:701,crystalTargetTypeListID:7}};
assert.equal(api.crystalPlan(scene,ship,compatibleModule,crystalRocks,0,false),null,'Preserve an already useful crystal');
const laterRock={...crystalRocks[0],id:52,state:{...crystalRocks[0].state,yieldTypeID:124}};
assert.equal(api.crystalPlan(scene,ship,crystalModule,[crystalRocks[0],laterRock],0,false).loadedID,800,
  'A crystal for a later filter entry must not skip the first eligible ore');
assert.equal(api.crystalPlan(scene,ship,crystalModule,[],0,false),null,'Do not unload when no selected ore exists');
const distant=crystalRocks.map(r=>({...r,distance:99999}));
assert.equal(api.crystalPlan(scene,ship,crystalModule,distant,0,false),null,'Respect range when approach is disabled');
assert.ok(api.crystalPlan(scene,ship,crystalModule,distant,0,true),'Approach can prepare for a distant eligible rock');
console.log('PASS: native crystal compatibility, matching cargo selection, no-crystal fallback, ownership/hold/range and existing-crystal preservation.');
