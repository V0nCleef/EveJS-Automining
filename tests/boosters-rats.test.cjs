"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoosters } = require("../lib/boosters");
const { createRatDefense } = require("../lib/ratDefense");

test("booster-only ship activates mining burst, invites enabled pilots on its grid, and stops only its burst", () => {
  const leader = { characterID: 1, sendNotification() {} }, near = { characterID: 2 }, far = { characterID: 3 };
  const ships = new Map([[leader, { kind: "ship", itemID: 101, grid: "belt", activeModuleEffects: new Map() }],
    [near, { kind: "ship", itemID: 102, grid: "belt" }], [far, { kind: "ship", itemID: 103, grid: "gate" }]]);
  const events = [];
  const scene = { sessions: new Map([[1, leader], [2, near], [3, far]]),
    getShipEntityForSession: s => ships.get(s), getPublicGridClusterKeyForEntity: ship => ship.grid,
    activateGenericModule(s, item, effect) { events.push(["activate", item.itemID, effect]); const state = { effect }; ships.get(s).activeModuleEffects.set(item.itemID, state); return { success: true }; },
    deactivateGenericModule(s, id) { events.push(["deactivate", id]); } };
  const fleet = { fleetID: 77 }, membership = new Map();
  const native = {
    fitting: { getFittedModuleItems: () => [{ itemID: 500, typeID: 10 }, { itemID: 501, typeID: 11 }],
      isModuleOnline: () => true,
      getTypeEffectRecords: id => [{ name: id === 10 ? "moduleBonusWarfareLinkMining" : "moduleBonusWarfareLinkShield" }] },
    bursts: { resolveCommandBurstDefinition: record => ({ family: record.name.endsWith("Mining") ? "mining" : "shield" }) },
    fleets: { getFleetForCharacter: id => membership.get(id), createFleetRecord: () => fleet,
      initFleet: s => membership.set(s.characterID, fleet),
      inviteCharacter: (s, id, peer) => { events.push(["invite", peer]); return true; },
      acceptInvite: (s, id) => { events.push(["accept", s.characterID]); membership.set(s.characterID, fleet); },
      runtimeState: { invitesByCharacter: new Map() } },
  };
  const states = new Map([[leader, { enabled: true, autoBoost: true, inviteFleet: true, hudReady: true, boostOwned: new Map() }],
    [near, { enabled: true, hudReady: true }], [far, { enabled: true, hudReady: true }]]);
  const boosters = createBoosters("ignored", { state: s => states.get(s), native });
  assert.equal(boosters.miningModules(leader, ships.get(leader)).length, 1);
  boosters.tickFleet(leader, states.get(leader), scene, ships.get(leader), 1000);
  boosters.tick(leader, states.get(leader), scene, ships.get(leader), 1000);
  assert.deepEqual(events, [["invite", 2]]);
  assert.match(states.get(leader).boostStatus, /Waiting 5s after arrival/);
  assert.equal(membership.has(3), false);
  boosters.tick(leader, states.get(leader), scene, ships.get(leader), 5999);
  assert.equal(events.some(row => row[0] === "activate"), false);
  boosters.tick(leader, states.get(leader), scene, ships.get(leader), 6000);
  assert.deepEqual(events.at(-1), ["activate", 500, "moduleBonusWarfareLinkMining"]);
  boosters.tick(leader, states.get(leader), scene, ships.get(leader), 7000);
  assert.equal(events.filter(row => row[0] === "activate").length, 1);
  boosters.stop(states.get(leader), scene, leader, ships.get(leader));
  assert.deepEqual(events.at(-1), ["deactivate", 500]);
});

test("booster invites a miner after station undock, before any asteroid is present", () => {
  const leader = { characterID: 1, sendNotification() {} }, miner = { characterID: 2, stationID: 6001 };
  const ships = new Map([[leader, { kind: "ship", itemID: 101, grid: "station-undock" }]]);
  const events = [], membership = new Map(), fleet = { fleetID: 77 };
  const scene = { sessions: new Map([[1, leader], [2, miner]]),
    getShipEntityForSession: s => ships.get(s),
    getLivePublicGridClusterKeyForEntity: ship => ship.grid,
    getPublicGridClusterKeyForEntity: () => "stale-belt",
    activateGenericModule: () => { throw Error("Station undock must not activate bursts"); } };
  const native = {
    fitting: { getFittedModuleItems: () => [{ itemID: 500, typeID: 10 }], isModuleOnline: () => true,
      getTypeEffectRecords: () => [{ name: "miningBurst" }] },
    bursts: { resolveCommandBurstDefinition: () => ({ family: "mining" }) },
    fleets: { getFleetForCharacter: id => membership.get(id), createFleetRecord: () => fleet,
      initFleet: s => membership.set(s.characterID, fleet),
      inviteCharacter: (s, id, peer) => { events.push(["invite", peer]); return true; },
      acceptInvite: s => { events.push(["accept", s.characterID]); membership.set(s.characterID, fleet); },
      runtimeState: { invitesByCharacter: new Map() } } };
  const states = new Map([[leader, { enabled: true, autoBoost: true, inviteFleet: true, hudReady: true, boostOwned: new Map() }],
    [miner, { enabled: true, hudReady: true }]]);
  const boosters = createBoosters("ignored", { getAPI: () => ({ surveyResource: () => null }), state: s => states.get(s), native });
  boosters.tickFleet(leader, states.get(leader), scene, ships.get(leader), 1000);
  assert.deepEqual(events, []);
  miner.stationID = null;
  ships.set(miner, { kind: "ship", itemID: 102, grid: "station-undock" });
  boosters.tickFleet(leader, states.get(leader), scene, ships.get(leader), 1999);
  assert.deepEqual(events, []);
  boosters.tickFleet(leader, states.get(leader), scene, ships.get(leader), 2000);
  assert.deepEqual(events, [["invite", 2]]);
  boosters.tick(leader, states.get(leader), scene, ships.get(leader), 2000);
  assert.match(states.get(leader).boostStatus, /Waiting for a mining site/);
});

test("boost arrival delay restarts after warp, including a return to the same grid", () => {
  const session = { characterID: 1 }, ship = { kind: "ship", itemID: 101, grid: "belt", activeModuleEffects: new Map() };
  const calls = [], state = { autoBoost: true, boostOwned: new Map() };
  const scene = { getPublicGridClusterKeyForEntity: s => s.grid,
    activateGenericModule(s, item) { calls.push(item.itemID); return { success: true }; } };
  const native = { fitting: { getFittedModuleItems: () => [{ itemID: 500, typeID: 10 }],
    isModuleOnline: () => true, getTypeEffectRecords: () => [{ name: "miningBurst" }] },
  bursts: { resolveCommandBurstDefinition: () => ({ family: "mining" }) } };
  const boosters = createBoosters("ignored", { state: () => state, native });
  boosters.tick(session, state, scene, ship, 1000);
  boosters.pause(state);
  boosters.tick(session, state, scene, ship, 3000);
  boosters.tick(session, state, scene, ship, 7999);
  assert.deepEqual(calls, []);
  boosters.tick(session, state, scene, ship, 8000);
  assert.deepEqual(calls, [500]);
});

test("rat response recalls miners, launches fighters, then recalls only its own fighters and restores miners", () => {
  const ship = { kind: "ship", itemID: 10, grid: "belt" }, session = { characterID: 1, notifications: [],
    sendNotification(...args) { this.notifications.push(args); } };
  const miner = { itemID: 100, ownerID: 1, controllerID: 10, droneCommand: "MINING" };
  const fighter = { itemID: 200, ownerID: 1, controllerID: 10, droneCommand: "FIGHT" };
  const rat = { kind: "ship", itemID: 300, nativeNpc: true, operatorKind: "asteroidBeltRat", grid: "belt" };
  const entities = new Map([[100, miner], [300, rat]]), calls = [];
  const scene = { dynamicEntities: entities, getPublicGridClusterKeyForEntity: e => e.grid || "belt",
    getEntityByID: id => entities.get(id) };
  const drones = { requestGroup: (s, state, sc, sh, group, kind) => { calls.push(["launch", group, kind]); return true; } };
  const native = { isDroneEntity: d => !!d?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    commandReturnBay: (s, ids) => { calls.push(["recall", ids]); return { type: "dict", entries: [] }; } };
  const defense = createRatDefense("ignored", { drones, native });
  const state = { enabled: true, droneClientReady: true, ratDefenseEnabled: true, characterID: 1, shipID: 10,
    ratMiningGroupKey: "miners", ratFighterGroupKey: "fighters", launchDrones: true, droneGroupKey: "miners" };
  assert.equal(defense.tick(session, state, scene, ship, 1000), true);
  const request = JSON.parse(session.notifications[0][2][0]);
  defense.setGroups(session, state, { ...request, miningIDs: [100], fighterIDs: [200] });
  defense.tick(session, state, scene, ship, 2000);
  assert.deepEqual(calls.at(-1), ["recall", [100]]);
  entities.delete(100);
  defense.tick(session, state, scene, ship, 3000);
  assert.deepEqual(calls.at(-1), ["launch", "fighters", "ratFighters"]);
  state.ratManagedFighterIDs.add(200); entities.set(200, fighter); entities.delete(300);
  defense.tick(session, state, scene, ship, 4000);
  defense.tick(session, state, scene, ship, 9000);
  assert.deepEqual(calls.at(-1), ["recall", [200]]);
  entities.delete(200);
  defense.tick(session, state, scene, ship, 10000);
  assert.deepEqual(calls.at(-1), ["launch", "miners", "ratMiners"]);
});

test("standard fighter group remains out after rats leave", () => {
  const fighter = { itemID: 200, ownerID: 1, controllerID: 10, droneCommand: "FIGHT" };
  const rat = { kind: "ship", nativeNpc: true, operatorKind: "asteroidBeltRat", grid: "belt" };
  const scene = { dynamicEntities: new Map([[200, fighter], [300, rat]]),
    getPublicGridClusterKeyForEntity: () => "belt" };
  const calls = [], native = { isDroneEntity: d => !!d?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    commandReturnBay: (s, ids) => { calls.push(ids); return { type: "dict", entries: [] }; } };
  const defense = createRatDefense("ignored", { drones: { requestGroup: () => { throw Error("Should not launch"); } }, native });
  const state = { enabled: true, droneClientReady: true, ratDefenseEnabled: true, characterID: 1, shipID: 10,
    ratMiningGroupKey: "miners", ratFighterGroupKey: "fighters", launchDrones: true, droneGroupKey: "fighters" };
  const session = { characterID: 1, sendNotification() {} }, ship = { kind: "ship", itemID: 10 };
  defense.tick(session, state, scene, ship, 1000);
  state.ratMiningIDs = new Set([100]); state.ratFighterIDs = new Set([200]);
  defense.tick(session, state, scene, ship, 2000);
  scene.dynamicEntities.delete(300);
  defense.tick(session, state, scene, ship, 3000);
  defense.tick(session, state, scene, ship, 8000);
  assert.deepEqual(calls, []);
  assert.match(state.ratStatus, /stays out/);
});

test("selected fighters already outside return after rats when miners are the standard group", () => {
  const fighter = { itemID: 200, ownerID: 1, controllerID: 10, droneCommand: "FIGHT" };
  const rat = { kind: "ship", nativeNpc: true, operatorKind: "asteroidBeltRat", grid: "belt" };
  const scene = { dynamicEntities: new Map([[200, fighter], [300, rat]]),
    getPublicGridClusterKeyForEntity: () => "belt" };
  const calls = [], native = { isDroneEntity: d => !!d?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    commandReturnBay: (s, ids) => { calls.push(ids); return { type: "dict", entries: [] }; } };
  const defense = createRatDefense("ignored", { drones: { requestGroup: () => true }, native });
  const state = { enabled: true, droneClientReady: true, ratDefenseEnabled: true, characterID: 1, shipID: 10,
    ratMiningGroupKey: "miners", ratFighterGroupKey: "fighters", launchDrones: true, droneGroupKey: "miners" };
  const session = { characterID: 1, sendNotification() {} }, ship = { kind: "ship", itemID: 10 };
  defense.tick(session, state, scene, ship, 1000);
  state.ratMiningIDs = new Set([100]); state.ratFighterIDs = new Set([200]);
  defense.tick(session, state, scene, ship, 2000);
  scene.dynamicEntities.delete(300);
  defense.tick(session, state, scene, ship, 3000);
  defense.tick(session, state, scene, ship, 8000);
  assert.deepEqual(calls, [[200]]);
});

test("boosters wait until a mining site before spending command burst charges", () => {
  const ship = { kind: "ship", itemID: 10, mode: "STOP" }, session = { characterID: 1 };
  const state = { autoBoost: true, inviteFleet: false, boostOwned: new Map() };
  const scene = { getPublicGridClusterKeyForEntity: () => "station-undock",
    activateGenericModule: () => { throw Error("Should not activate away from a site"); } };
  const native = { fitting: { getFittedModuleItems: () => [{ itemID: 500, typeID: 10 }], isModuleOnline: () => true,
    getTypeEffectRecords: () => [{ name: "miningBurst" }] },
  bursts: { resolveCommandBurstDefinition: () => ({ family: "mining" }) } };
  const boosters = createBoosters("ignored", { getAPI: () => ({ surveyResource: () => null }), state: () => state, native });
  boosters.tick(session, state, scene, ship, 1000);
  assert.match(state.boostStatus, /Waiting for a mining site/);
});

test("travel deactivates only an AutoMining-owned mining boost", () => {
  const owned = { name: "miningBurst" }, other = { name: "shieldBurst" };
  const ship = { kind: "ship", itemID: 10, activeModuleEffects: new Map([[500, owned], [501, other]]) };
  const session = { characterID: 1 }, calls = [];
  const scene = { deactivateGenericModule: (_, id, options) => { calls.push([id, options]); ship.activeModuleEffects.delete(id); } };
  const state = { boostOwned: new Map([[500, owned], [501, { name: "old-effect" }]]), boostGrid: "belt", boostReadyAt: 123 };
  const boosters = createBoosters("ignored", { state: () => state });
  boosters.pause(state, scene, session, ship);
  assert.deepEqual(calls, [[500, { reason: "autominingTravel", deferUntilCycle: false }]]);
  assert.equal(ship.activeModuleEffects.get(501), other);
  assert.equal(state.boostGrid, null);
});

test("automatic fleet join lets native clients accept and initialize their Fleet UI", () => {
  const events = [], leader = { characterID: 1, sendNotification: (...args) => events.push([1, ...args]) };
  const miner = { characterID: 2, sendNotification: (...args) => events.push([2, ...args]) };
  const ships = new Map([[leader, { kind: "ship", itemID: 11, grid: "belt" }],
    [miner, { kind: "ship", itemID: 12, grid: "belt" }]]);
  const squad = { squadID: 90 }, wing = { wingID: 80, squads: new Map([[90, squad]]) };
  const fleet = { fleetID: 77, wings: new Map([[80, wing]]), members: new Map() };
  const membership = new Map(), states = new Map([[leader, { enabled: true, autoBoost: true, inviteFleet: true, hudReady: true }],
    [miner, { enabled: true, hudReady: true }]]);
  const native = { fitting: { getFittedModuleItems: () => [{ itemID: 500, typeID: 10 }], isModuleOnline: () => true,
    getTypeEffectRecords: () => [{ name: "miningBurst" }] },
    bursts: { resolveCommandBurstDefinition: () => ({ family: "mining" }) },
    fleets: { runtimeState: { invitesByCharacter: new Map() }, getFleetForCharacter: id => membership.get(id),
      createFleetRecord: () => fleet, initFleet: session => { membership.set(session.characterID, fleet); fleet.members.set(1, { charID: 1 }); },
      inviteCharacter: (...args) => { events.push(['invite', ...args]); return true; },
      acceptInvite: () => { throw Error('Server must not accept for the client'); } } };
  const scene = { sessions: new Map([[1, leader], [2, miner]]), getShipEntityForSession: session => ships.get(session),
    getPublicGridClusterKeyForEntity: ship => ship.grid };
  createBoosters("ignored", { state: session => states.get(session), native }).tickFleet(leader, states.get(leader), scene, ships.get(leader), 1000);
  assert.deepEqual(events.filter(row => row[0] === 1).map(row => row[1]), ["OnAutoMiningFleetReady"]);
  assert.deepEqual(events.filter(row => row[0] === 2), []);
  assert.equal(events.find(row => row[0] === 'invite').at(-1).autoAccept, true);
});

test("manual fighter recall does not cause repeated rat launches in one encounter", () => {
  const ship = { kind: "ship", itemID: 10, grid: "belt" }, rat = { kind: "ship", nativeNpc: true, bounty: 100, grid: "belt" };
  const entities = new Map([[300, rat]]), calls = [];
  const scene = { dynamicEntities: entities, getPublicGridClusterKeyForEntity: entity => entity.grid,
    getEntityByID: id => entities.get(id) };
  const state = { enabled: true, droneClientReady: true, ratDefenseEnabled: true, characterID: 1, shipID: 10,
    ratMiningGroupKey: "miners", ratFighterGroupKey: "fighters", ratMiningIDs: new Set(), ratFighterIDs: new Set([200]) };
  const defense = createRatDefense("ignored", { drones: { requestGroup: () => { calls.push("launch"); return true; } },
    native: { isDroneEntity: () => false } });
  const session = { characterID: 1, sendNotification() {} };
  defense.tick(session, state, scene, ship, 1000);
  state.ratMiningIDs = new Set(); state.ratFighterIDs = new Set([200]);
  defense.tick(session, state, scene, ship, 2000);
  defense.tick(session, state, scene, ship, 20_000);
  assert.deepEqual(calls, ["launch"]);
});
