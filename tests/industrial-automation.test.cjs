"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createIndustrialAutomation, validateIntervalSeconds } = require("../lib/industrialAutomation");
function fixture({ gap = false, quantity = 2000, compressorType = 62622 } = {}) {
  const fitted = [{ itemID: 1, typeID: 62590, itemName: "Medium core" }];
  if (compressorType) fitted.push({ itemID: 2, typeID: compressorType, itemName: "Compressor" });
  const ship = { kind: "ship", itemID: 100, activeModuleEffects: new Map() };
  const session = { characterID: 42 };
  const s = { enabled: true, coreEnabled: true, compressorEnabled: true, coreIntervals: gap ? { 62590: 150 } : {}, compressorIntervals: {}, fuelReserveCycles: 2, fuelTargetCycles: 20 };
  let time = 0; const calls = [];
  const scene = {
    activateGenericModule(session, item, name, options) {
      calls.push(["start", item.itemID, options.repeat]);
      ship.activeModuleEffects.set(item.itemID, { moduleID: item.itemID, typeID: item.typeID, effectID: item.itemID === 1 ? 8119 : 8364,
        nextCycleAtMs: time + (item.itemID === 1 ? 75000 : 60000), remainingCycles: options.repeat === 0 ? 1 : null });
      return { success: true };
    },
    deactivateGenericModule(session, id, options) { calls.push(["stop", id, options.deferUntilCycle]); ship.activeModuleEffects.get(id).deactivateAtMs = ship.activeModuleEffects.get(id).nextCycleAtMs; }
  };
  const native = {
    fitting: { getFittedModuleItems: () => fitted, isModuleOnline: () => true,
      getTypeEffectRecords: typeID => [{ effectID: typeID === 62590 ? 8119 : 8364, name: "opaqueNativeEffect" }] },
    dogma: { getEntityRuntimeShipItem: () => ship, getEntityRuntimeSkillMap: () => new Map() },
    attributes: { getGenericModuleRuntimeAttributes: (char, ship, item) => ({ durationMs: item.itemID === 1 ? 75000 : 60000, fuelTypeID: 16272, fuelPerActivation: item.itemID === 1 ? 99.99999999999997 : 0 }) },
    fuels: { getFuelStacksForShipStorage: () => [{ quantity }], getFuelQuantityFromStacks: stacks => stacks[0].quantity }
  };
  const api = createIndustrialAutomation("unused", { native, getAPI: () => ({ miningSite: () => true }) });
  return { api, ship, s, scene, session, calls, tick(at) { time = at; api.tick(session, s, scene, ship, at); } };
}
test("native defaults repeat continuously; snapshot uses effective duration and rounded fuel", () => {
  const f = fixture(); f.tick(0);
  assert.deepEqual(f.calls, [["start", 1, undefined], ["start", 2, undefined]]);
  const view = f.api.snapshot(f.session, f.s, f.scene, f.ship, 0);
  assert.equal(view.modules[0].defaultSeconds, 75);
  assert.equal(view.modules[1].intervalSeconds, 60);
  assert.equal(view.fuel.perCycle, 100); assert.equal(view.fuel.cycles, 20); assert.equal(view.fuel.targetUnits, 2000);
});
test("custom core gap uses one cycle and prevents compressor overlap outside core window", () => {
  const f = fixture({ gap: true }); f.tick(0);
  assert.deepEqual(f.calls, [["start", 1, 0], ["start", 2, 0]]);
  f.ship.activeModuleEffects.delete(2); f.tick(60000);
  assert.equal(f.calls.length, 2);
  assert.match(f.api.snapshot(f.session, f.s, f.scene, f.ship, 60000).status, /full core cycle/);
  f.ship.activeModuleEffects.clear(); f.tick(75000); assert.equal(f.calls.length, 2);
  f.tick(150000); assert.deepEqual(f.calls.slice(2), [["start", 1, 0], ["start", 2, 0]]);
});
test("departure requests deferred owned shutdown and remains latched until resumed", () => {
  const f = fixture(); f.tick(0);
  assert.equal(f.api.requestDeparture(f.session, f.s, f.scene, f.ship, 1000), false);
  assert.deepEqual(f.calls.slice(2), [["stop", 1, true], ["stop", 2, true]]);
  f.ship.activeModuleEffects.clear(); f.tick(80000); assert.equal(f.calls.length, 4);
  assert.equal(f.api.requestDeparture(f.session, f.s, f.scene, f.ship, 80000), true);
  f.api.resume(f.s, f.ship); f.tick(81000); assert.equal(f.calls.length, 6);
});
test("manual or replaced effects are never taken over or stopped", () => {
  const f = fixture(); f.tick(0); const manual = { effectID: 8119, typeID: 62590, moduleID: 1, nextCycleAtMs: 75000 };
  f.ship.activeModuleEffects.set(1, manual);
  assert.equal(f.api.requestDeparture(f.session, f.s, f.scene, f.ship, 1000), false);
  assert.deepEqual(f.calls.slice(2), [["stop", 2, true]]); assert.equal(manual.deactivateAtMs, undefined);
});

test("manual core pause survives settings and travel resumes until explicit Start clears it",()=>{
 const f=fixture();f.tick(0);
 f.s.manualModuleStops=new Map([[1,100]]);f.ship.activeModuleEffects.clear();
 f.api.resume(f.s,f.ship);f.tick(80000);assert.equal(f.calls.filter(c=>c[0]==="start"&&c[1]===1).length,1);
 assert.equal(f.api.snapshot(f.session,f.s,f.scene,f.ship,80000).modules[0].manualPaused,true);
 f.s.manualModuleStops.clear();f.tick(81000);
 assert.equal(f.calls.filter(c=>c[0]==="start"&&c[1]===1).length,2);
});

test("pausing a compressor leaves the core automated and applies only to the matching ship",()=>{
 const f=fixture();f.tick(0);f.s.manualModuleStops=new Map([[2,100]]);f.ship.activeModuleEffects.delete(2);f.tick(80000);
 assert.equal(f.calls.filter(c=>c[0]==="start"&&c[1]===2).length,1);
 assert.equal(f.ship.activeModuleEffects.has(1),true);
 f.s.manualModuleStops.set(2,101);f.tick(81000);
 assert.equal(f.calls.filter(c=>c[0]==="start"&&c[1]===2).length,2);
});
test("low fuel stops future owned cycles without cutting the current cycle", () => {
  const f = fixture({ quantity: 200 }); f.tick(0); f.s.fuelEnabled = true; f.tick(1000);
  const fuel = f.api.snapshot(f.session, f.s, f.scene, f.ship, 1000).fuel;
  assert.equal(fuel.reserveUnits, 200); assert.equal(fuel.needsRestock, true);
  assert.deepEqual(f.calls.slice(2), [["stop", 1, true], ["stop", 2, true]]);
});
test("invalid or overlapping intervals are rejected", () => {
  for (const value of [0, 74, NaN, Infinity, 86401]) assert.throws(() => validateIntervalSeconds(value, 75000));
  assert.equal(validateIntervalSeconds(75, 75000), 75);
});
test("editing continuous interval defers active cycle and enforces new start spacing", () => {
  const f = fixture(); f.tick(0); f.s.coreIntervals[62590] = 150; f.api.resume(f.s, f.ship); f.tick(1000);
  assert.deepEqual(f.calls.slice(2), [["stop", 1, true]]);
  f.ship.activeModuleEffects.clear(); f.tick(75000); assert.equal(f.calls.length, 3);
  f.tick(150000); assert.deepEqual(f.calls.slice(3), [["start", 1, 0], ["start", 2, 0]]);
});
test("compressor automation can use an active manual core without owning it", () => {
  const f = fixture(); f.s.coreEnabled = false;
  f.ship.activeModuleEffects.set(1, { effectID: 8119, typeID: 62590, moduleID: 1, nextCycleAtMs: 75000, remainingCycles: null });
  f.tick(0); assert.deepEqual(f.calls, [["start", 2, undefined]]);
  f.api.stop(f.session, f.s, f.scene, f.ship, 1000); assert.deepEqual(f.calls.slice(1), [["stop", 2, true]]);
  assert.match(f.api.snapshot(f.session, f.s, f.scene, f.ship, 1000).status, /Manual industrial core/);
});

test("every fitted compressor type is recognised without a whitelist", () => {
  for (const typeID of [62622, 62624, 62625, 62626, 62628, 62630, 62631, 62632, 62633, 62634, 62635, 62636]) {
    const f = fixture({ compressorType: typeID }); f.tick(0);
    const view = f.api.snapshot(f.session, f.s, f.scene, f.ship, 0);
    assert.deepEqual(view.modules.map(m => m.kind), ["core", "compressor"]);
    assert.equal(view.modules[1].typeID, typeID);
  }
});
test("no fitted compressor keeps compressor automation idle", () => {
  const f = fixture({ compressorType: null }); f.tick(0);
  assert.deepEqual(f.calls, [["start", 1, undefined]]);
  assert.deepEqual(f.api.snapshot(f.session, f.s, f.scene, f.ship, 0).modules.map(m => m.kind), ["core"]);
});
