"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createController } = require("../lib/controller");
function fixture() {
  let state, time = 0, visible = true, serial = 0;
  const calls = [], errors = [];
  const session = { characterID: 42, shipid: 100, sendNotification() {} };
  const ship = { kind: "ship", itemID: 100, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: "STOP",
    activeModuleEffects: new Map(), lockedTargets: new Map(), pendingTargetLocks: new Map() };
  const scene = { systemID: 300, sessions: new Map([[42, session]]), getShipEntityForSession: () => visible ? ship : null,
    getCurrentSimTimeMs: () => 100000 + time, removeTarget() {}, cancelAddTarget() {}, stop: () => true };
  let blocked = false;
  const industrial = { snapshot(session, s, scene, entity, now) { state = s; calls.push(["snapshot", entity, now]); return { modules: [], fuel: {}, status: blocked ? "Waiting for industrial core cycle before departure." : "", travelBlocked: blocked }; },
    tick(session, s, scene, ship, now) { calls.push(["tick", now]); }, resume(s, ship) { calls.push(["resume", ship]); }, stop() {},
    requestDeparture() { return !blocked; } };
  const activity = { emit(session, s, event) { calls.push(["event", event]); }, observe() {} };
  const ore = { tick(session, s) { if (s.oreMode === "jettison") { s.jettisonEvent = { id: `jet:${++serial}`, quantity: 100 }; s.stackEvent = { id: `stack:${serial}`, merged: 2 }; } },
    jettison(session, s) { s.jettisonEvent = { id: `manual:${++serial}`, quantity: 100 }; return {}; }, view: () => ({}) };
  const destinations = { storage: () => ({ key: "personal" }), cargo: () => [], totals: () => ({ 1: 10 }), fuelQuantity: () => 200,
    station: () => ({ stationID: 600 }) };
  const api = { modules: () => [], candidates: () => [], surveyGrid: () => "belt", surveyResource: () => 11, oreHold: () => ({ flagID: 134, full: false }), miningSite: () => true };
  const controller = createController(() => api, () => ({ getSceneForSession: () => visible ? scene : null }), e => errors.push(e), null, null,
    destinations, null, null, { industrial, activity, oreHandling: ore });
  controller.snapshot(session); state.hudReady = true;
  controller.command(session, { action: "on" });
  return { controller, session, ship, scene, calls, errors, get s() { return state; }, block: value => { blocked = value; },
    visible: value => { visible = value; }, tick(at) { time = at; controller.tick(scene, at); assert.deepEqual(errors, []); },
    events: () => calls.filter(c => c[0] === "event").map(c => c[1]) };
}
test("same-scene warp arrival resumes industrial latch using simulation time", () => {
  const f = fixture(); f.s.job = "boosting"; f.s.coreEnabled = true; f.ship.mode = "WARP"; f.tick(1000);
  const before = f.calls.filter(c => c[0] === "resume").length;
  f.ship.mode = "STOP"; f.tick(2000);
  assert.equal(f.calls.filter(c => c[0] === "resume").length, before + 1);
  assert.equal(f.events().at(-1).key, "resumed");
  assert(f.calls.some(c => c[0] === "tick" && c[1] === 102000));
});
test("Defense core waiting preserves danger and refreshes snapshot", () => {
  const f = fixture(); f.block(true); f.s.defenseEnabled = true; f.s.defenseShieldEnabled = true; f.s.defenseShieldThreshold = 30;
  f.ship.shieldCapacity = 100; f.ship.conditionState = { shieldCharge: 0.1 }; f.tick(1000);
  assert.equal(f.s.defenseStatus, "Defense retreat: low shield.");
  assert.equal(f.s.industrialSnapshot.travelBlocked, true); assert.equal(f.s.haul, null);
});
test("confirmed automatic and manual ore events use distinct operation ids", () => {
  const f = fixture(); f.s.oreMode = "jettison"; f.tick(1000); f.tick(2000); f.controller.jettison(f.session);
  const events = f.events();
  assert.deepEqual(events.map(e => e.key), ["jettisonComplete", "stackComplete", "jettisonComplete", "stackComplete", "jettisonComplete"]);
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
});
test("verified unloading and restocking phases emit completion and returned position emits resumed", () => {
  const f = fixture(); const id = "trip-1";
  const op = { id, phase: "unloading", shipID: 100, station: { stationID: 600 }, storage: { key: "personal" }, storageKey: "personal",
    items: [{ typeID: 1, quantity: 10 }], before: {}, flagID: 134, origin: { systemID: 300, x: 0, y: 0, z: 0 }, changed: Date.now(), heartbeat: Date.now() };
  f.s.haul = op; f.s.storageKey = "personal"; f.session.stationID = 600;
  f.controller.haulAction(f.session, id, "unloaded"); assert.equal(f.events().at(-1).key, "oreComplete");
  op.phase = "resupplying"; op.fuel = { typeID: 16272, storageKey: "personal" }; op.fuelPlan = { requiredUnits: 100 };
  f.controller.haulAction(f.session, id, "resupplied"); assert.equal(f.events().at(-1).key, "fuelComplete");
  delete f.session.stationID; op.phase = "returning"; op.settledAt = Date.now() - 3000;
  f.controller.haulAction(f.session, id, "complete"); assert.equal(f.events().at(-1).key, "resumed"); assert.equal(f.s.haul, null);
});
test("docked snapshot presents stable read-only ship identity without activation", () => {
  const f = fixture(); f.visible(false); f.session.stationID = 600;
  f.controller.snapshot(f.session); const first = f.calls.at(-1)[1];
  f.controller.snapshot(f.session); const second = f.calls.at(-1)[1];
  assert.equal(first.kind, "ship"); assert.equal(first.itemID, 100); assert.equal(first.pilotCharacterID, 42);
  assert.equal(first, second); assert.equal(f.calls.filter(c => c[0] === "tick").length, 0);
});
test("fleet stop requires boss and rechecks online character and current membership", () => {
  const fleet = { members: new Map([1, 2, 3, 4, 5].map(id => [id, {}])) }, other = {};
  const sessions = new Map([1, 2, 3, 4, 5].map(characterID => [characterID, { characterID, socket: { destroyed: characterID === 5 } }]));
  const preferences = { get: id => ({ enabled: id !== 3 }), save() {} };
  const controller = createController(() => ({ modules: () => [] }), () => ({ getSceneForSession: () => null }), () => {}, preferences,
    null, null, null, null, { getFleet: id => id === 4 ? other : fleet, getSession: id => sessions.get(id), isFleetBoss: (current, id) => current === fleet && id === 1 });
  assert.equal(controller.snapshot(sessions.get(1)).canStopFleet, true);
  assert.equal(controller.snapshot(sessions.get(2)).canStopFleet, false);
  assert.throws(() => controller.stopFleet(sessions.get(2)), /current fleet boss/);
  assert.deepEqual(controller.stopFleet(sessions.get(1)), { stopped: 2, recallOrdered: 0, recallFailed: 0 });
  assert.equal(controller.snapshot(sessions.get(1)).enabled, false);
  assert.equal(controller.snapshot(sessions.get(2)).enabled, false);
  assert.equal(controller.snapshot(sessions.get(4)).enabled, true);
  assert.equal(controller.snapshot(sessions.get(5)).enabled, true);
});
test("fuel trip is cancelled when target cycles change", () => {
  const f = fixture();
  f.s.fuelEnabled = true; f.s.fuelStationID = 600; f.s.stationID = 600;
  f.s.haul = { id: "fuel-1", purpose: "fuel", phase: "outbound", shipID: 100, flagID: 134,
    station: { stationID: 600 }, storage: { key: "personal" }, items: [] };
  const snapshot = f.controller.snapshot(f.session), settings = snapshot.settings;
  settings.fuelTargetCycles++;
  f.controller.applySettings(f.session, JSON.stringify({ settings, revision: snapshot.revision }));
  assert.equal(f.s.haul, null); assert.equal(f.s.enabled, false);
});



function fleetRecallFixture({ throws = false } = {}) {
  const order = [], fleet = { members: new Map([[1, {}], [2, {}], [3, {}]]) };
  const sessions = new Map([1, 2, 3].map(characterID => [characterID, { characterID, shipid: characterID * 100 }]));
  const entities = [
    { kind: "drone", itemID: 11, ownerID: 1, controllerID: 100, family: "mining" },
    { kind: "drone", itemID: 12, ownerID: 1, controllerID: 100, family: "fighter" },
    { kind: "drone", itemID: 13, ownerID: 2, controllerID: 100 },
    { kind: "drone", itemID: 14, ownerID: 1, controllerID: 999 },
    { kind: "ship", itemID: 15, ownerID: 1, controllerID: 100 },
    { kind: "drone", itemID: 21, ownerID: 2, controllerID: 200 },
    { kind: "drone", itemID: 31, ownerID: 3, controllerID: 300 },
  ];
  const scenes = new Map([1, 2, 3].map(id => [sessions.get(id), {
    droneEntityIDs: new Set(entities.map(e => e.itemID)), getEntityByID: id => entities.find(e => e.itemID === id),
    getShipEntityForSession: () => ({ kind: "ship", itemID: id * 100 }),
  }]));
  // Native ship identity is stable between enumeration and command.
  for (const [s, scene] of scenes) { const ship = scene.getShipEntityForSession(); scene.getShipEntityForSession = () => ship; }
  const droneRuntime = { isDroneEntity: entity => entity?.kind === "drone", commandReturnBay(session, ids) {
    order.push(["recall", session.characterID, ids]);
    if (throws && session.characterID === 2) throw Error("native recall failure");
    return { type: "dict", entries: session.characterID === 1 ? [[12, "denied"]] : [] };
  } };
  const prefs = { get: id => ({ enabled: id !== 3 }), save(id) { order.push(["stop", id]); } };
  const controller = createController(() => ({ modules: () => [] }), () => ({ getSceneForSession: s => scenes.get(s) }), () => {}, prefs,
    null, null, null, null, { getFleet: () => fleet, getSession: id => sessions.get(id), isFleetBoss: (f, id) => id === 1, droneRuntime });
  return { controller, sessions, order };
}
test("fleet Stop recalls owned controlled miners and fighters, including already-OFF pilots", () => {
  const f = fleetRecallFixture();
  assert.deepEqual(f.controller.stopFleet(f.sessions.get(1)), { stopped: 2, recallOrdered: 3, recallFailed: 1 });
  assert.deepEqual(f.order, [["stop", 1], ["stop", 2], ["recall", 1, [11, 12]], ["recall", 2, [21]], ["recall", 3, [31]]]);
});
test("recall failure cannot undo stops or prevent other fleet recalls", () => {
  const f = fleetRecallFixture({ throws: true });
  assert.deepEqual(f.controller.stopFleet(f.sessions.get(1)), { stopped: 2, recallOrdered: 2, recallFailed: 2 });
  assert.equal(f.controller.snapshot(f.sessions.get(1)).enabled, false);
  assert.equal(f.controller.snapshot(f.sessions.get(2)).enabled, false);
  assert.deepEqual(f.order.at(-1), ["recall", 3, [31]]);
});
test("unauthorized fleet pilot cannot issue Stop or any drone recalls", () => {
  const f = fleetRecallFixture();
  assert.throws(() => f.controller.stopFleet(f.sessions.get(2)), /current fleet boss/);
  assert.deepEqual(f.order, []);
});
test("departure refusal resumes only after safe native result, never while travel is pending", () => {
  const f = fixture(); f.block(true); f.controller.prepareDeparture(f.session);
  let resumes = f.calls.filter(c => c[0] === "resume").length;
  f.ship.pendingWarp = true; f.controller.departureRefused(f.session);
  assert.equal(f.calls.filter(c => c[0] === "resume").length, resumes);
  f.ship.pendingWarp = false; f.controller.departureRefused(f.session);
  assert.equal(f.calls.filter(c => c[0] === "resume").length, resumes + 1);
  assert.equal(f.s.departureStatus, "");
});
