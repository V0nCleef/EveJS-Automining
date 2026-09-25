"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHauling } = require("../lib/hauling");
const { createController } = require("../lib/controller");
const { createHaulDestinations } = require("../lib/haulDestinations");

function fixture() {
  let now = 0, remaining = [{ itemID: 9, typeID: 100, quantity: 500 }], deposited = 20, available = true;
  const notifications = [], moves = [], saved = [];
  const session = { characterID: 42, shipID: 10, sendNotification: (...args) => notifications.push(args) };
  const ship = { itemID: 10, kind: "ship", mode: "STOP", position: { x: 100, y: 200, z: 300 }, velocity: { x: 0, y: 0, z: 0 } };
  const scene = { systemID: 30, getShipEntityForSession: () => session.stationID ? null : ship, stop: () => { ship.mode = "STOP"; moves.push("stop"); return true; } };
  const space = { getSceneForSession: () => session.stationID ? null : scene,
    warpToPoint: (_, point) => { moves.push(["warp", point]); ship.mode = "WARP"; return { success: true }; },
    gotoPoint: (_, point) => { moves.push(["approach", point]); ship.mode = "GOTO"; ship.targetPoint = point; return true; } };
  const destination = { key: "personal", ownerID: 42, locationID: 600, flagID: 4 };
  const destinations = { station: id => { assert.equal(id, 600); return { stationID: 600, systemID: 31 }; },
    storage: (_, id, key) => { assert.equal(id, 600); if (!available || key !== "personal") throw Error("Storage unavailable"); return destination; },
    cargo: () => remaining, totals: () => ({ 100: deposited }) };
  const s = { enabled: true, haulEnabled: true, haulClientReady: true, stationID: 600, storageKey: "personal" };
  const hauling = createHauling({ destinations, getSpace: () => space, clock: () => now,
    save: (_, value) => { saved.push({ enabled: value.enabled, interrupted: value.haulInterrupted }); return ""; },
    resetMining: () => moves.push("reset") });
  return { s, hauling, session, ship, scene, space, destinations, saved, moves, notifications,
    begin: () => hauling.begin(session, s, scene, ship, { full: true, flagID: 134 }),
    action: action => hauling.action(session, s, s.haul.id, action),
    dock() { session.stationID = 600; }, empty() { remaining = []; }, deposit() { remaining = []; deposited = 520; },
    missing() { available = false; }, advance(ms) { now += ms; } };
}

test("full cycle requires confirmed dock and deposit before undock, then exact origin before resume", () => {
  const f = fixture(); f.begin();
  assert.equal(f.s.haul.phase, "outbound");
  assert.deepEqual(f.saved[0], { enabled: true, interrupted: true });
  assert.deepEqual(f.moves, ["reset"]);
  assert.throws(() => f.action("unloaded"), /Not ready/);
  f.dock(); f.action("poll"); assert.equal(f.s.haul.phase, "unloading");
  assert.throws(() => f.action("unloaded"), /Ore remains/);
  f.deposit(); f.action("unloaded"); assert.equal(f.s.haul.phase, "undocking");
  // Ship finishes undock animation and waits the mandatory post-undock pause before inbound.
  f.session.stationID = 0; f.scene.systemID = 31;
  f.advance(100); f.action("poll"); // First poll records when undock completed (op.undockedAt)
  assert.equal(f.s.haul.phase, "undocking"); // Still waiting for the mandatory pause
  f.advance(3500); f.action("poll"); // Now enough time has elapsed to transition
  assert.equal(f.s.haul.phase, "inbound");
  f.scene.systemID = 30; f.ship.position = { x: 1e9, y: 0, z: 0 }; f.action("poll");
  assert.equal(f.s.haul.phase, "returning");
  f.action("position"); f.action("position"); assert.equal(f.moves.filter(x => x[0] === "warp").length, 1);
  f.ship.mode = "STOP"; f.ship.position = { x: 1000, y: 200, z: 300 }; f.action("position");
  assert.equal(f.moves.at(-1)[0], "approach");
  assert.throws(() => f.action("complete"), /not been reached/);
  f.ship.position = { x: 100, y: 200, z: 300 };
  f.ship.velocity = { x: 3, y: 0, z: 0 };
  assert.equal(f.action("position").atOrigin, undefined);
  f.ship.velocity = { x: 0, y: 0, z: 0 };
  assert.equal(f.action("position").atOrigin, undefined);
  f.advance(2100);
  assert.equal(f.action("position").atOrigin, true);
  f.action("complete"); assert.equal(f.s.haul, null); assert.equal(f.s.enabled, true); assert.equal(f.s.haulInterrupted, false);
});

test("Defense retreats without a full hold, unloads, and remains docked with AutoMining off", () => {
  const f = fixture(); f.s.haulEnabled = false;
  assert.equal(f.hauling.begin(f.session, f.s, f.scene, f.ship,
    { full: false, flagID: 134, used: 500 }, { retreat: true, layer: "shield" }), true);
  assert.equal(f.s.haul.retreatLayer, "shield");
  f.dock(); f.action("poll"); assert.equal(f.s.haul.phase, "unloading");
  f.deposit(); f.action("unloaded");
  assert.equal(f.s.haul, null); assert.equal(f.s.enabled, false);
  assert.match(f.s.defenseStatus, /Ore unloaded/);
  assert.equal(f.moves.includes("undock"), false);
});

test("Upwell docking is recognized through structureID before unloading", () => {
  const f = fixture();
  f.begin();
  f.session.structureID = 600;
  f.action("poll");
  assert.equal(f.s.haul.phase, "unloading");
  f.deposit(); f.action("unloaded");
  assert.equal(f.s.haul.phase, "undocking");
});

test("Defense with no ore docks and stops; unconfirmed ore never authorizes undock", () => {
  const empty = fixture(); empty.s.haulEnabled = false; empty.empty();
  empty.hauling.begin(empty.session, empty.s, empty.scene, empty.ship,
    { full: false, flagID: 134, used: 0 }, { retreat: true, layer: "armor" });
  empty.dock(); empty.action("poll");
  assert.equal(empty.s.haul, null); assert.equal(empty.s.enabled, false);
  assert.match(empty.s.defenseStatus, /Docked/);

  const cargo = fixture(); cargo.s.haulEnabled = false;
  cargo.hauling.begin(cargo.session, cargo.s, cargo.scene, cargo.ship,
    { full: false, flagID: 134, used: 500 }, { retreat: true, layer: "armor" });
  cargo.dock(); cargo.action("poll"); cargo.empty();
  assert.throws(() => cargo.action("unloaded"), /selected storage/);
  assert.equal(cargo.s.haul.phase, "unloading");
});

test("emptying ore elsewhere cannot authorize undock; changed storage is not replaced", () => {
  const f = fixture(); f.begin(); f.dock(); f.action("poll"); f.empty();
  assert.throws(() => f.action("unloaded"), /selected storage/);
  assert.equal(f.s.haul.phase, "unloading");
  f.missing(); assert.throws(() => f.action("unloaded"), /Storage unavailable/);
});

test("return warp is requested under gate cloak; only native landing readiness is retried", () => {
  const f = fixture(); f.begin(); f.dock(); f.action("poll"); f.deposit(); f.action("unloaded");
  // Advance past the mandatory post-undock pause before the ship can begin returning.
  f.session.stationID = 0;
  f.advance(100); f.action("poll"); // Record when undock completed
  assert.equal(f.s.haul.phase, "undocking"); // Still waiting for the mandatory pause
  f.advance(3500); f.action("poll"); // Now enough time has elapsed to transition to inbound
  assert.equal(f.s.haul.phase, "inbound");
  f.ship.position = { x: 1e9, y: 0, z: 0 }; f.action("poll");
  f.ship.isCloaked = 1; f.ship.cloaked = true;
  const original = f.space.warpToPoint; let attempts = 0;
  f.space.warpToPoint = (...args) => {
    attempts++;
    if (attempts === 1) return { success: false, errorMsg: "WARP_LANDING_PENDING" };
    return original(...args);
  };
  f.action("position"); assert.equal(attempts, 1); assert.equal(f.s.haul.moving, null);
  f.action("position"); assert.equal(attempts, 2); assert.equal(f.ship.mode, "WARP");
  f.action("position"); assert.equal(attempts, 2);
  f.ship.mode = "STOP"; f.s.haul.moving = null;
  f.space.warpToPoint = () => ({ success: false, errorMsg: "WARP_BLOCKED_BY_CLOAK" });
  assert.throws(() => f.action("position"), /WARP_BLOCKED_BY_CLOAK/);
});

test("return keeps one belt anchor across trips and refuses to resume while drifting", () => {
  const f = fixture(); f.begin();
  const anchor = { ...f.s.haul.origin };
  f.dock(); f.action("poll"); f.deposit(); f.action("unloaded");
  f.session.stationID = 0; f.advance(100); f.action("poll"); f.advance(3500); f.action("poll");
  f.action("poll");
  f.ship.position = { x: anchor.x + 8, y: anchor.y, z: anchor.z };
  f.ship.velocity = { x: 2, y: 0, z: 0 };
  assert.equal(f.action("position").atOrigin, undefined);
  assert.throws(() => f.action("complete"), /not been reached/);
  f.ship.velocity = { x: 0, y: 0, z: 0 };
  f.action("position"); f.action("position"); f.advance(2100);
  assert.equal(f.action("position").atOrigin, true);
  f.action("complete");
  f.ship.position = { x: anchor.x + 8, y: anchor.y, z: anchor.z };
  f.begin();
  assert.deepEqual(f.s.haul.origin, anchor);
});

test("stale tokens, different ships, timeouts and cancellation never resume mining", () => {
  for (const kind of ["token", "ship", "timeout", "cancel"]) {
    const f = fixture(); f.begin();
    if (kind === "token") {
      assert.throws(() => f.hauling.action(f.session, f.s, "other", "complete"), /no longer active/);
      assert.equal(f.s.haul.phase, "outbound"); continue;
    }
    if (kind === "ship") f.session.shipID = 11;
    if (kind === "timeout") f.advance(46000);
    if (kind === "cancel") f.hauling.cancel(f.session, f.s);
    else f.hauling.observe(f.session, f.s);
    assert.equal(f.s.haul, null); assert.equal(f.s.enabled, false);
  }
});

test("missing capability and default-off cannot depart; two character operations remain independent", () => {
  const f = fixture(); f.s.haulEnabled = false; assert.equal(f.begin(), false);
  f.s.haulEnabled = true; f.s.haulClientReady = false; f.begin(); assert.equal(f.s.enabled, false);
  assert.equal(f.notifications.length, 0);
  const a = fixture(), b = fixture(); a.begin(); b.begin();
  assert.notEqual(a.s.haul.id, b.s.haul.id);
  a.hauling.cancel(a.session, a.s); assert.equal(b.s.haul.phase, "outbound");
});

test("instanced mining locations pause before departure and unrelated movement is preserved", () => {
  const f = fixture(); f.ship.dungeonCurrentInstanceID = 123;
  f.begin(); assert.equal(f.s.haul, null); assert.equal(f.s.enabled, false);
  assert.match(f.s.haulStatus, /instanced or gated/); assert.deepEqual(f.moves, []);
  const a = fixture(); a.begin(); a.s.haul.moving = "approach"; a.ship.mode = "GOTO";
  a.ship.targetPoint = { x: 9999, y: 0, z: 0 };
  a.hauling.cancel(a.session, a.s); assert.equal(a.ship.mode, "GOTO");
});

test("controller preserves interruption marker on login and disables replay until explicit Start", () => {
  const prefs = { get: () => ({ enabled: true, haulEnabled: true, haulInterrupted: true }), save() {} };
  const controller = createController(() => ({}), () => ({ getSceneForSession: () => null }), () => {}, prefs);
  const session = { characterID: 42 };
  assert.equal(controller.snapshot(session).enabled, false);
  assert.match(controller.snapshot(session).status, /Interrupted/);
  controller.command(session, { action: "on" });
  assert.equal(controller.snapshot(session).enabled, true);
});

test("destination discovery scopes personal containers and corporation divisions and revalidates removals", () => {
  const stations = [{ stationID: 600, stationName: "Jita IV - Moon 4", solarSystemID: 30, regionID: 1 },
    { stationID: 601, stationName: "Amarr station", solarSystemID: 40, regionID: 2 }];
  let office = { officeID: 777, stationID: 600 }, container = { itemID: 8, typeID: 12, ownerID: 42, locationID: 600, flagID: 4, singleton: 1 };
  class Broker { constructor() { assert.fail("Discovery must not register an inventory observer"); } _canQueryCorporationHangarFlag(_, flag) { return flag === 116; } }
  const modules = {
    "worldData.js": { ensureLoaded: () => ({ stations, stationsById: new Map(stations.map(s => [s.stationID, s])), solarSystemsById: new Map() }) },
    "itemStore.js": { listContainerItems: (owner, location) => owner === 42 && location === 600 && container ? [container] : [] },
    "corporationRuntimeState.js": { getCorporationOffices: () => office ? [office] : [], getCorporationDivisionNames: () => ({ 2: "Ore" }) },
    "invBrokerService.js": Broker, "itemTypeRegistry.js": { resolveItemByTypeID: () => ({ name: "Ore box" }) },
    "cargoContainerRuntime.js": { isCargoContainerType: () => true },
    "structureState.js": {
      getStructureByID: id => id === 9001 ? { structureID: 9001, itemName: "Home Upwell", solarSystemID: 30 } : null,
      listDockableStructuresForCharacter: session => session.characterID === 42 ? [{ structureID: 9001 }] : [],
      canCharacterDockAtStructure: session => ({ success: session.characterID === 42 }),
    },
  };
  const d = createHaulDestinations("fixture", file => modules[require("node:path").basename(file)]);
  const session = { characterID: 42, corporationID: 99 };
  assert.equal(d.search("Amarr").stations[0].stationID, 601);
  assert.deepEqual(d.resolveStationIDs([601, 600, 601]).stations.map(x => x.stationID), [601, 600]);
  assert.throws(() => d.resolveStationIDs([999]), /existing station/);
  assert.throws(() => d.resolveStationIDs([600, "601"]), /valid station IDs/);
  assert.throws(() => d.resolveStationIDs(Array(31).fill(600)), /up to 30/);
  assert.deepEqual(d.storages(session, 600).map(x => x.key), ["personal", "container:8", "corp:777:116"]);
  assert.throws(() => d.storage({ characterID: 43 }, 600, "container:8"), /no longer available/);
  office = null; container = null;
  assert.throws(() => d.storage(session, 600, "corp:777:116"), /no longer available/);
  assert.throws(() => d.storage(session, 600, "container:8"), /no longer available/);
  assert.throws(() => d.station(999), /existing station/);
  assert.equal(d.search("Home Upwell", session).stations[0].kind, "structure");
  assert.equal(d.resolveStationIDs([9001], session).stations[0].stationID, 9001);
  assert.deepEqual(d.storages(session, 9001).map(x => x.key), ["personal"]);
  office = { officeID: 888, stationID: 9001 };
  assert.deepEqual(d.storages(session, 9001).map(x => x.key), ["personal", "corp:888:116"]);
  assert.equal(d.search("Home Upwell", { characterID: 43 }).stations.length, 0);
  assert.throws(() => d.resolveStationIDs([9001], { characterID: 43 }), /existing station/);
});
