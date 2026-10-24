"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createController } = require("../lib/controller");

function fixture() {
  let s, inRange = true;
  const started = [], moves = [], errors = [];
  const session = { characterID: 42, shipID: 10, sendNotification() {} };
  const ship = { itemID: 10, kind: "ship", mode: "STOP", position: { x: 100, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 }, activeModuleEffects: new Map(), lockedTargets: new Map(), pendingTargetLocks: new Map() };
  const module = { item: { itemID: 20 }, effect: { name: "miningLaser" }, snapshot: { maxRangeMeters: 15000 } };
  const rock = { id: 90, name: "Veldspar", quantity: 1000, distance: 10000 };
  const scene = { systemID: 30, sessions: new Map([[42, session]]), getShipEntityForSession: () => ship,
    getTargets: () => [...ship.lockedTargets.keys()],
    addTarget(_, id) { ship.lockedTargets.set(id, {}); return { success: true, data: {} }; },
    activateGenericModule(_, item, effect, options) {
      started.push(options.targetID); ship.activeModuleEffects.set(item.itemID, { targetID: options.targetID });
      return { success: true, data: {} };
    },
    deactivateGenericModule(_, id) { ship.activeModuleEffects.delete(id); },
    removeTarget(_, id) { ship.lockedTargets.delete(id); },
    followBall() { moves.push("follow"); return true; },
    stop() { moves.push("stop"); ship.mode = "STOP"; return true; } };
  const space = { getSceneForSession: () => scene };
  const api = { modules: () => [module], candidates: () => [rock], compatible: () => inRange,
    surveyGrid: () => "belt", surveyResource: () => rock.id };
  const destinations = { station() {}, storage() {}, storages: () => [], search: () => ({ stations: [] }) };
  const controller = createController(() => api, () => space, message => errors.push(message),
    { get: () => ({ job: "mining", approach: true }), save: (_, value) => { s = value; } }, null, destinations);
  controller.command(session, { action: "on" });
  const anchor = { ...s.miningAnchor };
  function returning() {
    const now = Date.now();
    s.haulInterrupted = true;
    s.haul = { id: "test-return", phase: "returning", shipID: 10, origin: anchor,
      moving: "approach", heartbeat: now, started: now, changed: now };
    ship.mode = "GOTO"; ship.targetPoint = anchor; ship.position.x = 5000; ship.velocity.x = -70;
  }
  return { controller, session, ship, scene, started, moves, errors, get s() { return s; }, anchor, returning,
    setInRange(value) { inRange = value; },
    tick(now) { controller.tick(scene, now); assert.deepEqual(errors, []); } };
}

test("a strip miner starts during return approach without another movement command or changing personal approach settings", () => {
  const f = fixture(); f.returning(); f.tick(1000);
  assert.deepEqual(f.started, [90]);
  assert.equal(f.s.haul.phase, "returning");
  assert.equal(f.ship.mode, "GOTO");
  assert.deepEqual(f.ship.targetPoint, f.anchor);
  assert.deepEqual(f.moves, []);
  assert.equal(f.s.approach, true);
  assert.deepEqual(f.s.miningAnchor, f.anchor);
  assert.match(f.s.status, /Mining with 1/);
});

test("early return mining honours weapon range and landing readiness", () => {
  for (const blocked of ["range", "landing", "warp"]) {
    const f = fixture(); f.returning();
    if (blocked === "range") f.setInRange(false);
    if (blocked === "landing") f.session._space = { pilotWarpVisibilityHandoff: { shipID: 10, landingPending: true } };
    if (blocked === "warp") f.ship.mode = "WARP";
    f.tick(1000);
    assert.deepEqual(f.started, []);
    assert.deepEqual(f.moves, []);
    assert.equal(f.s.enabled, true);
  }
});

test("controller captures a new manual location, but automatic ore approaches leave the original intact", () => {
  const f = fixture();
  f.ship.position.x = 7000; f.tick(1000);
  assert.deepEqual(f.s.miningAnchor, f.anchor);
  f.controller.manualMiningNavigation(f.session);
  f.ship.mode = "GOTO"; f.ship.position.x = 8000; f.tick(2000);
  assert.deepEqual(f.s.miningAnchor, f.anchor);
  f.ship.mode = "STOP"; f.ship.velocity.x = 0; f.ship.position.x = 9000; f.tick(3000);
  assert.deepEqual(f.s.miningAnchor, { systemID: 30, x: 9000, y: 0, z: 0 });
});

test("a new manual warp anchors the landing location before any automatic ore approach", () => {
  const f = fixture();
  f.ship.mode = "WARP"; f.tick(1000);
  assert.deepEqual(f.s.miningAnchor, f.anchor);
  f.ship.mode = "STOP"; f.ship.position.x = 50000; f.ship.velocity.x = 90;
  f.tick(2000);
  assert.deepEqual(f.s.miningAnchor, { systemID: 30, x: 50000, y: 0, z: 0 });
  f.ship.position.x += 9000; f.tick(3000);
  assert.deepEqual(f.s.miningAnchor, { systemID: 30, x: 50000, y: 0, z: 0 });
});
