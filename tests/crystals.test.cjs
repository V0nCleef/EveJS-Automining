"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCrystalManager } = require("../lib/crystals");

function fixture() {
  const loaded = new Map([[1, { itemID: 71, typeID: 7 }], [2, { itemID: 72, typeID: 7 }]]);
  const pending = new Set(), calls = [], ship = { itemID: 10, activeModuleEffects: new Map() };
  const s = { ores: ["hedbergite"], approach: false }, modules = [1, 2].map(itemID => ({ item: { itemID } }));
  let charge = 0, refused = false;
  const api = { loadedCrystal: (_, m) => loaded.get(m.item.itemID),
    crystalPlan(_, __, m) { const old = loaded.get(m.item.itemID); return old?.typeID === 7 ? { loadedID: old.itemID, chargeID: charge, chargeTypeID: 8 } : null; } };
  const ops = { pending: id => pending.has(id),
    load(_, shipID, id, crystalID) { calls.push(["load", shipID, id, crystalID]); pending.add(id); },
    unload(_, shipID, id) { calls.push(["unload", shipID, id]); if (!refused) loaded.delete(id); } };
  const update = createCrystalManager(() => ops);
  return { s, ship, calls, modules, loaded, pending,
    matchingCargo() { charge = 99; }, refuse() { refused = true; },
    tick(now = 1000) { return update({ api, ship, state: s, modules, now, rocks: [], session: {}, scene: {} }); } };
}

test("missing matching cargo unloads each incompatible crystal then releases miners", () => {
  const f = fixture(); assert.equal(f.tick(), true);
  assert.deepEqual(f.calls, [["unload",10,1],["unload",10,2]]);
  assert.equal(f.tick(2000), false); assert.equal(f.calls.length, 2);
  assert.equal(f.s.replan, true); assert.equal(f.s.nextModuleCheck, 0);
});

test("matching cargo requests native load once, waits and accepts confirmed loaded charge", () => {
  const f = fixture(); f.matchingCargo(); f.tick();
  assert.deepEqual(f.calls, [["load",10,1,99],["load",10,2,99]]);
  f.tick(50000); assert.equal(f.calls.length, 2);
  f.pending.clear(); f.loaded.set(1,{typeID:8}); f.loaded.set(2,{typeID:8});
  assert.equal(f.tick(51000), false);
});

test("refused unload reports the problem, backs off, and does not assume bare mining", () => {
  const f = fixture(); f.refuse(); f.tick();
  assert.match(f.s.crystalStatus,/free cargo space/); assert.equal(f.loaded.size,2);
  f.tick(2000); assert.equal(f.calls.length,2);
  f.tick(7000); assert.equal(f.calls.length,4);
});

test("active miners and empty filter remain untouched", () => {
  const f = fixture(); f.ship.activeModuleEffects.set(1,{}); f.tick();
  assert.deepEqual(f.calls, [["unload",10,2]]);
  f.s.ores=[]; f.ship.activeModuleEffects.clear(); assert.equal(f.tick(2000),false);
  assert.equal(f.calls.length,1);
});
