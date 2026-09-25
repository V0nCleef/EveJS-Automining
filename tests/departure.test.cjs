"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDeparture, installNavigation } = require("../lib/departure");
const { createController } = require("../lib/controller");

function fixture() {
  let now = 0;
  const session = { characterID: 42, shipID: 10, socket: { destroyed: false } };
  const ship = { itemID: 10, mode: "STOP" }, drones = new Map(), items = new Map(), sleepers = [], events = [];
  const scene = { dynamicEntities: drones, droneEntityIDs: new Set(), getEntityByID: id => drones.get(id),
    getShipEntityForSession: () => ship, stop: () => events.push("stop") };
  const options = { enabled: true, hauling: false, stationID: 600 };
  const controller = { departureOptions: () => options, departureStarted: () => events.push("started"),
    departureProgress: (_, text) => events.push(text), departureEnded: (_, text, paused) => events.push({ text, paused }),
    cancelHaul: () => events.push("cancelHaul") };
  const runtime = { isDroneEntity: d => d?.kind === "drone", DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    commandReturnBay(_, ids) { events.push(["recall", ...ids]); for (const id of ids) drones.get(id).droneCommand = "RETURN_BAY"; return { type: "dict", entries: [] }; } };
  const guard = createDeparture({ getSpace: () => ({ getSceneForSession: () => scene }), getDrones: () => runtime,
    getItem: id => items.get(id), bayFlag: () => 87, controller, userError: text => { throw Error(text); },
    clock: () => now, timeout: 3000, sleep: () => new Promise(resolve => sleepers.push(resolve)) });
  const f = { guard, session, scene, ship, drones, items, events, controller, options, runtime,
    add(id, extra = {}) { drones.set(id, { itemID: id, kind: "drone", controllerID: 10, ownerID: 42, droneCommand: "MINE", ...extra }); scene.droneEntityIDs.add(id); },
    bay(id) { drones.delete(id); scene.droneEntityIDs.delete(id); items.set(id, { itemID: id, ownerID: 42, locationID: 10, flagID: 87, quantity: 1 }); },
    async step(ms = 500) { now += ms; sleepers.splice(0).forEach(fn => fn()); await Promise.resolve(); await Promise.resolve(); },
    run(proceed = () => { events.push("travel"); return 123; }) { return guard.run(session, proceed); } };
  f.add(1); return f;
}

test("armor retreat orders recall but issues warp immediately", () => {
  const f = fixture(); f.options.retreatLayer = "armor"; f.options.haulID = "emergency";
  f.ship.shieldCapacity = 100; f.ship.armorHP = 100;
  f.ship.conditionState = { shieldCharge: 0.4, armorDamage: 0.75 };
  assert.equal(f.run(), 123);
  assert.equal(f.events.some(event => Array.isArray(event) && event[0] === "recall" && event[1] === 1), true);
  assert.equal(f.events.includes("travel"), true);
  assert.equal(f.events.includes("stop"), false);
});

test("shield retreat waits for drones, then leaves at shield loss even with drones outside", async () => {
  const f = fixture(); f.options.retreatLayer = "shield"; f.options.haulID = "emergency";
  f.ship.shieldCapacity = 100; f.ship.armorHP = 100;
  f.ship.conditionState = { shieldCharge: 0.25, armorDamage: 0 };
  const pending = f.run();
  assert.equal(f.events.includes("travel"), false);
  assert.equal(f.events.includes("stop"), false);
  f.ship.conditionState.shieldCharge = 0;
  await f.step(250); await pending;
  assert.equal(f.events.includes("travel"), true);
  assert.equal(f.drones.has(1), true);
});

test("shield retreat leaves on first armor damage or recall timeout", async () => {
  for (const cause of ["armor", "timeout"]) {
    const f = fixture(); f.options.retreatLayer = "shield"; f.options.haulID = "emergency";
    f.ship.shieldCapacity = 100; f.ship.armorHP = 100;
    f.ship.conditionState = { shieldCharge: 0.25, armorDamage: 0 };
    const pending = f.run();
    if (cause === "armor") f.ship.conditionState.armorDamage = 0.01;
    await f.step(cause === "timeout" ? 3000 : 250); await pending;
    assert.equal(f.events.includes("travel"), true, cause);
  }
});

test("recall waits for inventory-confirmed bay arrival; existing returns and other pilots stay untouched", async () => {
  const f = fixture(); f.add(2, { droneCommand: "RETURN_BAY" }); f.add(3, { ownerID: 99 });
  const pending = f.run(); assert.deepEqual(f.events.find(Array.isArray), ["recall", 1]);
  assert.ok(!f.events.includes("travel")); f.bay(1); await f.step(); assert.ok(!f.events.includes("travel"));
  f.bay(2); await f.step(); assert.equal(await pending, 123); assert.equal(f.guard.pending(f.session), false);
  assert.equal(f.events.filter(Array.isArray).length, 1); assert.equal(f.drones.get(3).droneCommand, "MINE");
});

test("disappearance or wrong inventory flag never counts as return to bay", async () => {
  for (const kind of ["missing", "cargo"]) {
    const f = fixture(), result = f.run(); const rejected = assert.rejects(result, /cannot be confirmed/);
    f.bay(1); if (kind === "missing") f.items.delete(1); else f.items.get(1).flagID = 5;
    await f.step(); await rejected; assert.ok(!f.events.includes("travel"));
  }
});

test("native recovered singleton rows resume the saved warp exactly once", async () => {
  const f = fixture(); f.add(2);
  const pending = f.run();
  f.bay(1); Object.assign(f.items.get(1), { quantity: -1, stacksize: 1, singleton: 1 });
  await f.step(); assert.ok(!f.events.includes("travel"));
  f.bay(2); Object.assign(f.items.get(2), { quantity: -1, stacksize: 1, singleton: 1 });
  await f.step(); assert.equal(await pending, 123);
  await f.step(); assert.equal(f.events.filter(e => e === "travel").length, 1);
});

test("Stop, disconnect, ship change, timeout, and new drone orders cancel delayed travel", async () => {
  for (const kind of ["stop", "disconnect", "ship", "timeout", "order", "haul"]) {
    const f = fixture(); if (kind === "haul") f.options.haulID = "A";
    const result = f.run(), rejected = assert.rejects(result, /cancelled|timed out|another order/i);
    if (kind === "stop") f.guard.cancel(f.session);
    if (kind === "disconnect") f.session.socket.destroyed = true;
    if (kind === "ship") f.session.shipID = 11;
    if (kind === "order") f.drones.get(1).droneCommand = "MINE";
    if (kind === "haul") f.options.haulID = undefined;
    await f.step(kind === "timeout" ? 4000 : 500); await rejected;
    assert.ok(!f.events.includes("travel")); assert.equal(f.guard.pending(f.session), false);
  }
});

test("replacement retains only latest command, and character change cannot pause the new character", async () => {
  const f = fixture(), old = f.run(() => assert.fail("Stale travel"));
  const rejected = assert.rejects(old, /replaced/);
  const current = f.run(() => "new destination"); f.bay(1); await f.step();
  await rejected; assert.equal(await current, "new destination");
  const g = fixture(), changed = g.run(), rejectedChange = assert.rejects(changed, /change/);
  g.session.characterID = 43; await g.step(); await rejectedChange;
  assert.equal(g.events.filter(e => e?.paused === true).length, 0);
});

test("newly launched drones join the same wait; recall refusal fails closed", async () => {
  const f = fixture(), result = f.run(); f.add(2); f.bay(1); await f.step();
  assert.ok(!f.events.includes("travel")); assert.deepEqual(f.events.filter(Array.isArray).at(-1), ["recall", 2]);
  f.bay(2); await f.step(); assert.equal(await result, 123);
  const g = fixture(); g.runtime.commandReturnBay = () => ({ type: "dict", entries: [[1, "denied"]] });
  await assert.rejects(g.run(), /refused/); assert.ok(!g.events.includes("travel"));
});

test("no-drone and disabled paths preserve synchronous native return/error behavior", () => {
  const f = fixture(); f.options.enabled = false;
  assert.equal(f.run(() => 456), 456); assert.ok(!f.events.includes("started"));
  f.options.enabled = true; f.bay(1);
  const error = Error("Native docking refusal"); assert.throws(() => f.run(() => { throw error; }), e => e === error);
});

test("navigation wrappers preserve arguments, receiver, native docking result and native errors", async () => {
  const f = fixture(); const kwargs = { minRange: 5000 }, context = { callID: 1 };
  class Service {
    Handle_CmdDock(...args) { assert.equal(this, service); assert.deepEqual(args, [[600, 10], f.session, kwargs, context]); return 123456789n; }
    Handle_CmdWarpToStuff() { throw nativeError; }
    Handle_CmdStop() { return "stopped"; }
  }
  const service = new Service(), nativeError = Error("native warp refusal");
  installNavigation(Service, f.controller, f.guard);
  const dock = service.Handle_CmdDock([600, 10], f.session, kwargs, context);
  f.bay(1); await f.step(); assert.equal(await dock, 123456789n);
  assert.throws(() => service.Handle_CmdWarpToStuff([], f.session), e => e === nativeError);
  f.add(2); const warp = service.Handle_CmdWarpToStuff([], f.session), rejected = assert.rejects(warp, /manual navigation/);
  assert.equal(service.Handle_CmdStop([], f.session), "stopped"); await f.step(); await rejected;
  const failed = service.Handle_CmdWarpToStuff([], f.session);
  const nativeRejected = assert.rejects(failed, e => e === nativeError);
  f.bay(2); await f.step(); await nativeRejected;
});

test("autopilot warp also waits for server-confirmed drone return", async () => {
  const f = fixture();
  class Service { Handle_CmdWarpToStuffAutopilot() { f.events.push("autopilot"); return "warping"; } }
  installNavigation(Service, f.controller, f.guard);
  const pending = new Service().Handle_CmdWarpToStuffAutopilot(["bookmark", 900], f.session);
  assert.ok(!f.events.includes("autopilot"));
  f.bay(1); await f.step();
  assert.equal(await pending, "warping");
  assert.equal(f.events.filter(x => x === "autopilot").length, 1);
});

test("fleet warp waits for follower recall before issuing the commander command", async () => {
  const leader = { characterID: 1 }, member = { characterID: 2 };
  const calls = [];
  let release;
  const guard = { fleetFollowers: () => [member], run(session, proceed) {
    calls.push(session.characterID);
    return session === member ? new Promise(resolve => { release = () => resolve(proceed()); }) : proceed();
  }, cancel() {} };
  const controller = { departureOptions: () => ({ hauling: false }), cancelHaul() {} };
  class Service { Handle_CmdWarpToStuff() { calls.push("warp"); return "warped"; } }
  installNavigation(Service, controller, guard);
  const pending = new Service().Handle_CmdWarpToStuff(["station", 600], leader,
    { type: "dict", entries: [["fleet", true], ["minRange", 0]] });
  assert.deepEqual(calls, [2]);
  release();
  assert.equal(await pending, "warped");
  assert.deepEqual(calls, [2, 1, "warp"]);
});

test("fleet commander cannot pull a member away with drones still outside", async () => {
  const f = fixture(), leader = { characterID: 7, shipID: 10, socket: { destroyed: false } };
  f.guard.fleetFollowers = () => [f.session];
  class Service { Handle_CmdWarpToStuff() { f.events.push("fleet warp"); return "warped"; } }
  installNavigation(Service, f.controller, f.guard);
  const pending = new Service().Handle_CmdWarpToStuff(["station", 600], leader, { fleet: true, minRange: 0 });
  assert.deepEqual(f.events.find(Array.isArray), ["recall", 1]);
  assert.ok(!f.events.includes("fleet warp"));
  f.bay(1); await f.step();
  assert.equal(await pending, "warped");
  assert.equal(f.events.filter(event => event === "fleet warp").length, 1);
});

test("controller exposes independent recall setting and suspends planning until departure finishes", () => {
  const ship = { itemID: 10, kind: "ship" }, session = { characterID: 42, shipID: 10 };
  const scene = { sessions: new Map([[42, session]]), getShipEntityForSession: () => ship };
  let pending = false, cancelled = 0;
  const controller = createController(() => ({ modules: () => [] }), () => ({ getSceneForSession: () => scene }));
  controller.setDepartureGuard({ pending: () => pending, cancel: () => { cancelled++; pending = false; } });
  controller.command(session, { action: "on" }); pending = true;
  controller.departureProgress(session, "Returning drones"); controller.tick(scene, 1000);
  assert.equal(controller.snapshot(session).status, "Returning drones");
  controller.command(session, { action: "off" }); assert.equal(cancelled, 1);
  assert.equal(controller.snapshot(session).settings.recallDrones, true);
  const snapshot = controller.snapshot(session);
  controller.applySettings(session, JSON.stringify({ revision: snapshot.revision, settings: { ...snapshot.settings, recallDrones: false } }));
  assert.equal(controller.departureOptions(session).enabled, false);
  controller.command(session, { action: "on" }); ship.dockingTargetID = 600;
  controller.tick(scene, 2000);
  assert.match(controller.snapshot(session).status, /Paused during travel/);
});
