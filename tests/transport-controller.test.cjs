"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createController } = require("../lib/controller");
function fixture(role = "transport", fleetOre = null, fleetGroups = null, jobProfiles = {}) {
  let state, blocked = false, docked = false, cleanupFails = false;
  const calls = [], errors = [], transportTicks = [];
  const session = { characterID: 42, shipid: 100, shipTypeID: 42244, sendNotification() {} };
  const ship = { kind: "ship", itemID: 100, typeID: 42244, position: { x: 0, y: 0, z: 0 },
    mode: "STOP", activeModuleEffects: new Map(), pendingTargetLocks: new Map(), lockedTargets: new Map() };
  const scene = { systemID: 300, sessions: new Map([[42, session]]), getShipEntityForSession: () => ship,
    getCurrentSimTimeMs: () => 1000, removeTarget() {}, stop() {} };
  const transport = {
    eligibility: () => ({ eligible: true, dualRole: true }),
    view: (session, s) => { state = s; return { eligible: true, dualRole: true }; },
    tick: (...args) => { calls.push("transport"); transportTicks.push(args); }, cancel: () => calls.push("cancel"), request: () => calls.push("request"),
    cleanup: (session, s) => { calls.push("cleanup"); if (cleanupFails) throw Error("native cleanup refused"); if (docked) s.transportFleetLease = null; },
    allowNavigation: () => false,
  };
  const industrial = { tick: () => calls.push("industrial"), resume() {}, stop() {},
    requestDeparture: () => !blocked, snapshot: () => ({ modules: [], fuel: {}, status: "", travelBlocked: blocked }) };
  const preferences = { get: () => ({ enabled: true, shipRole: role, job: role === "transport" ? "hauling" : "mining", autoBoost: true, coreEnabled: true,
    transportEnabled: true, transportStationID: 600, transportStorageKey: "personal", jobProfiles }), save() {} };
  const api = { modules: () => [], candidates: () => [], surveyGrid: () => "belt", surveyResource: () => 11,
    oreHold: () => ({ flagID: 134, full: true }), miningSite: () => true };
  const destinations = { station: () => ({ stationID: 600 }), storage: () => ({ key: "personal" }) };
  const controller = createController(() => api, () => ({ getSceneForSession: () => docked ? null : scene }), error => errors.push(error),
    preferences, null, destinations, null, null, { transport, industrial, fleetOre, fleetGroups });
  controller.snapshot(session);
  return { controller, session, scene, ship, calls, errors, transport, transportTicks, get s() { return state; }, block: value => { blocked = value; },
    dock() { docked = true; session.stationid = 600; }, cleanupFails() { cleanupFails = true; },
    tick(time) { controller.tick(scene, time); assert.deepEqual(errors, []); } };
}
test("Transport suppresses industrial activation and waits for the core without clearing booster settings", () => {
  const f = fixture(); f.block(true); f.tick(1000);
  assert.equal(f.calls.includes("transport"), false); assert.equal(f.calls.includes("industrial"), false);
  assert.equal(f.s.autoBoost, true); assert.equal(f.s.coreEnabled, true);
  f.block(false); f.tick(2000);
  assert.equal(f.calls.includes("transport"), true); assert.equal(f.calls.includes("industrial"), false);
});
test("switching the same Porpoise back to Boosting releases Transport and preserves its destination", () => {
  const f = fixture("transport", null, null, { boosting: { autoBoost: true, coreEnabled: true } });
  const before = f.controller.snapshot(f.session);
  f.controller.applySettings(f.session, JSON.stringify({ revision: before.revision,
    settings: { ...before.settings, job: "boosting" } }));
  assert(f.calls.includes("cancel")); assert.equal(f.s.autoBoost, true); assert.equal(f.s.coreEnabled, true);
  assert.equal(f.s.transportStationID, 600); assert.equal(f.s.enabled, false);
  f.controller.command(f.session, { action: "on" }); f.tick(1000); assert(f.calls.includes("industrial"));
});
test("full miner hold queues pickup while retaining the normal mining role", () => {
  const f = fixture("boosting"); f.s.oreMode = "pickup";
  f.tick(1000); f.tick(2000);
  assert.equal(f.calls.filter(call => call === "request").length, 1);
});
test("manual navigation pauses Transport rather than re-registering it next tick", () => {
  const f = fixture(); f.controller.cancelHaul(f.session, "Manual navigation");
  assert.equal(f.s.enabled, false); const before = f.calls.length; f.tick(1000);
  assert.equal(f.calls.length, before);
});

test("a full fleet-hangar miner waits for scheduled compression and resumes when it is ready", () => {
  let waiting = true, ticks = 0;
  const receiver = { tick() { ticks++; }, view() { return null; }, waitingForCompression: () => waiting };
  const f = fixture("boosting", receiver); f.s.job = "mining"; f.s.oreMode = "fleetHangar";
  f.tick(1000); assert.equal(f.s.status, "Waiting for fleet compression.");
  assert.equal(f.s.enabled, true); assert.equal(f.s.fleetCompressionPaused, true);
  assert.equal(f.calls.includes("request"), false); assert.equal(f.calls.includes("transport"), false);
  f.tick(2000); assert.equal(ticks, 2);
  waiting = false; f.tick(3000);
  assert.equal(f.s.fleetCompressionPaused, false); assert.equal(f.calls.includes("transport"), true);
  assert.equal(f.calls.includes("request"), false);
  f.s.oreMode = "pickup"; f.tick(4000);
  assert.equal(f.calls.includes("request"), true);
});
test("a docked configured hauler without a fleet reaches pool registration without creating a scene", () => {
  const f = fixture(); f.dock(); f.controller.transportReady(f.session);
  assert.equal(f.s.transportClientReady, true); assert.equal(f.calls.includes("transport"), true);
  const [session, state, scene, ship] = f.transportTicks[0];
  assert.equal(scene, null); assert.equal(ship.itemID, f.session.shipid); assert.equal(ship.typeID, 42244);
  assert.equal(state.enabled, true); assert.equal(session, f.session);
});
test("cancelled temporary fleet cleanup progresses while OFF and docked without restarting Transport", () => {
  const f = fixture(); f.s.enabled = false; f.s.transportFleetLease = { fleetID: 7, cleanupPending: true };
  f.controller.transportReady(f.session); assert.equal(f.calls.includes("cleanup"), true); assert.ok(f.s.transportFleetLease);
  f.dock(); f.controller.transportReady(f.session); assert.equal(f.s.transportFleetLease, null);
  assert.equal(f.s.enabled, false); assert.equal(f.calls.includes("transport"), false);
});
test("temporary cleanup runs before automatic fleet coordination even while OFF", () => {
  const order = [], groups = { view: () => null, tick: () => order.push("fleet"), release() {} };
  const f = fixture("transport", null, groups); f.s.enabled = false; f.s.transportFleetLease = { fleetID: 7 };
  f.transport.cleanup = () => order.push("cleanup"); f.tick(1000); assert.deepEqual(order, ["cleanup", "fleet"]);
  order.length = 0; f.dock(); f.controller.fleetReady(f.session); assert.deepEqual(order, ["cleanup", "fleet"]);
});
test("Stop cleans a docked temporary fleet lease and retains an in-space lease for docking", () => {
  for (const docked of [false, true]) {
    const order = [], groups = { view: () => null, release: () => order.push("release") };
    const f = fixture("transport", null, groups); f.s.transportFleetLease = { fleetID: 7 };
    const cleanup = f.transport.cleanup;
    f.transport.cleanup = (...args) => { order.push("cleanup"); cleanup(...args); };
    if (docked) f.dock();
    f.controller.command(f.session, { action: "off" });
    assert.equal(f.s.enabled, false); assert.equal(f.calls.includes("cancel"), true);
    assert.equal(Boolean(f.s.transportFleetLease), !docked);
    assert.deepEqual(order, ["cleanup", "release"]); assert.equal(f.calls.includes("transport"), false);
  }
});
test("ordinary mining, boosting and PVE pilots do not initialize temporary fleet cleanup", () => {
  const f = fixture("boosting"); f.s.enabled = false;
  for (const job of ["mining", "boosting", "pve"]) { f.s.job = job; f.controller.transportReady(f.session); }
  assert.equal(f.calls.includes("cleanup"), false); assert.equal(f.calls.includes("transport"), false);
});
test("native cleanup refusal is contained and retains the lease for a safe retry", () => {
  const f = fixture(); f.s.enabled = false; f.s.transportFleetLease = { fleetID: 7 }; f.cleanupFails();
  assert.doesNotThrow(() => f.controller.transportReady(f.session)); assert.ok(f.s.transportFleetLease);
  assert.match(f.errors[0], /Transport fleet cleanup failed: native cleanup refused/); assert.equal(f.s.enabled, false);
});
test("manual pickup request never enables a miner or changes its applied unload mode", () => {
  const f = fixture("boosting"); f.s.enabled = false; f.s.oreMode = "unload";
  f.transport.request = (session, s) => { assert.equal(s.enabled, false); assert.equal(s.oreMode, "unload"); throw Error("Start Mining before requesting fleet pickup."); };
  assert.throws(() => f.controller.transportRequest(f.session), /Start Mining/);
  assert.equal(f.s.enabled, false); assert.equal(f.s.oreMode, "unload"); assert.equal(f.calls.includes("transport"), false);
});
