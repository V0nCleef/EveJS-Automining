"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRatDefense } = require("../lib/ratDefense");
const { createMiningDrones } = require("../lib/miningDrones");

function fixture(mineDrones = true) {
  const calls = [], notifications = [];
  const session = { characterID: 42, sendNotification: (_, __, args) => notifications.push(JSON.parse(args[0])) };
  const ship = { itemID: 10, kind: "ship", grid: "belt", activeModuleEffects: new Map([[91, { effectID: 8119 }]]) };
  const miner = { itemID: 21, ownerID: 42, controllerID: 10, droneCommand: "MINE" };
  const fighter = { itemID: 22, ownerID: 42, controllerID: 10, droneCommand: "IDLE" };
  const rat = { itemID: 90, kind: "ship", nativeNpc: true, operatorKind: "asteroidBeltRat", grid: "belt" };
  const entities = new Map([[21, miner], [90, rat]]);
  const scene = { dynamicEntities: entities, getEntityByID: id => entities.get(id), getPublicGridClusterKeyForEntity: e => e.grid || "belt" };
  const state = { enabled: true, job: "boosting", mineDrones, droneClientReady: true, ratDefenseEnabled: true,
    characterID: 42, shipID: 10, ratMiningGroupKey: "miners", ratFighterGroupKey: "fighters", launchDrones: false };
  const native = { isDroneEntity: e => !!e?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY", DRONE_COMMAND_ENGAGE: "ENGAGE",
    commandReturnBay(_, ids) { calls.push(["recall", ids]); for (const id of ids) entities.get(id).droneCommand = "RETURN_BAY"; return { type: "dict", entries: [] }; },
    commandEngage(_, ids, target) { calls.push(["engage", ids, target]); for (const id of ids) Object.assign(entities.get(id), { droneCommand: "ENGAGE", targetID: target }); return { type: "dict", entries: [] }; } };
  const defense = createRatDefense("unused", { native, drones: { requestGroup(_, __, ___, ____, group, kind) { calls.push(["launch", group, kind]); return true; } } });
  return { calls, notifications, session, ship, miner, fighter, rat, entities, scene, state, defense,
    tick: now => defense.tick(session, state, scene, ship, now),
    groups() { defense.setGroups(session, state, { ...notifications.at(-1), miningIDs: mineDrones ? [21, 23, 24] : [], fighterIDs: [22] }); } };
}

test("opted-in booster recalls only its controlled mining group and restores it after rats", () => {
  const f = fixture();
  f.entities.set(23, { itemID: 23, ownerID: 43, controllerID: 10, droneCommand: "MINE" });
  f.entities.set(24, { itemID: 24, ownerID: 42, controllerID: 11, droneCommand: "MINE" });
  f.tick(1000); assert.equal(f.notifications[0].miningKey, "miners"); f.groups();
  f.tick(2000); f.tick(3000); assert.deepEqual(f.calls, [["recall", [21]]]);
  f.entities.delete(21); f.tick(4000); assert.deepEqual(f.calls.at(-1), ["launch", "fighters", "ratFighters"]);
  f.entities.set(22, f.fighter); f.tick(5000); assert(f.state.ratManagedFighterIDs.has(22));
  f.entities.delete(90); f.tick(6000); f.tick(11000); assert.deepEqual(f.calls.at(-1), ["recall", [22]]);
  f.entities.delete(22); f.tick(12000); assert.deepEqual(f.calls.at(-1), ["launch", "miners", "ratMiners"]);
  f.state.ratRestoreSuccess = true; f.tick(13000); assert.equal(f.state.ratActive, false);
  assert.equal(f.ship.activeModuleEffects.get(91).effectID, 8119);
});

test("fighter-only booster does not require or restore a mining group and stale opt-in replies are rejected", () => {
  const f = fixture(false); f.state.ratMiningGroupKey = ""; f.tick(1000);
  assert.equal(f.notifications[0].miningKey, ""); f.groups();
  f.entities.delete(21); f.tick(2000); assert.deepEqual(f.calls.at(-1), ["launch", "fighters", "ratFighters"]);
  f.entities.delete(90); assert.equal(f.tick(3000), false);
  assert.equal(f.calls.filter(call => call[0] === "launch" && call[2] === "ratMiners").length, 0);
  const g = fixture(); g.tick(1000); g.state.mineDrones = false;
  assert.throws(() => g.groups(), /expired/);
});

test("boosting drone orders remain optional, pause for Defense and departure, and ignore another pilot's drones", () => {
  const f = fixture(), orders = []; let pending = false;
  f.entities.set(23, { itemID: 23, ownerID: 43, controllerID: 10, droneCommand: "IDLE" });
  const api = { surveyGrid: () => "belt", target: () => null,
    candidates: () => [{ id: 100, name: "Veldspar", state: { yieldKind: "ore" } }, { id: 101, name: "Scordite", state: { yieldKind: "ore" } }] };
  const manager = createMiningDrones("unused", { getAPI: () => api, pendingDeparture: () => pending, native: {
    isDroneEntity: e => !!e?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY", DRONE_COMMAND_RETURN_HOME: "RETURN_HOME", DRONE_COMMAND_MINE: "MINE",
    commandMineRepeatedly(_, ids, target) { orders.push([ids, target]); return { type: "dict", entries: [] }; } } });
  Object.assign(f.state, { mineDrones: false, miningDroneIDs: new Set([21, 23]), ores: ["veldspar"], mineDroneMode: "focus", mineDroneOrder: "nearest" });
  manager.tick(f.session, f.state, f.scene, f.ship, 1000); assert.equal(orders.length, 0);
  f.state.mineDrones = true; manager.tick(f.session, f.state, f.scene, f.ship, 2000, true); assert.equal(orders.length, 0);
  pending = true; manager.tick(f.session, f.state, f.scene, f.ship, 3000); assert.equal(orders.length, 0);
  pending = false; manager.tick(f.session, f.state, f.scene, f.ship, 4000); assert.deepEqual(orders, [[[21], 100]]);
  assert.equal(f.ship.activeModuleEffects.get(91).effectID, 8119);
});
