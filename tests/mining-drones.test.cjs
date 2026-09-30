"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMiningDrones } = require("../lib/miningDrones");
const { createRatDefense } = require("../lib/ratDefense");
const { targetClaims } = require("../lib/targetClaims");

test("mining drones obey filter grade and spread, then keep orders without rescanning", () => {
  const session = { characterID: 7 }, ship = { itemID: 10, kind: "ship" };
  const droneA = { itemID: 21, controllerID: 10, ownerID: 7, droneCommand: "IDLE" };
  const droneB = { itemID: 22, controllerID: 10, ownerID: 7, droneCommand: "IDLE" };
  const entities = new Map([[21, droneA], [22, droneB]]);
  const rocks = [
    { id: 101, name: "Hedbergite", distance: 100, state: { yieldKind: "ore", remainingQuantity: 100, unitVolume: 1 } },
    { id: 102, name: "Hedbergite IV-Grade", distance: 200, state: { yieldKind: "ore", remainingQuantity: 100, unitVolume: 1 } },
    { id: 103, name: "Hedbergite III-Grade", distance: 300, state: { yieldKind: "ore", remainingQuantity: 100, unitVolume: 1 } },
    { id: 104, name: "Scordite", distance: 50, state: { yieldKind: "ore", remainingQuantity: 100, unitVolume: 1 } },
  ];
  let scans = 0;
  const api = { surveyGrid: () => "belt", target: (_, __, id) => rocks.find(rock => rock.id === id),
    candidates: () => { scans++; return rocks; } };
  const orders = [];
  const native = { isDroneEntity: d => !!d?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    DRONE_COMMAND_RETURN_HOME: "RETURN_HOME", DRONE_COMMAND_MINE: "MINE",
    commandMineRepeatedly(_, ids, target) {
      orders.push([ids[0], target]);
      const drone = entities.get(ids[0]); drone.droneCommand = "MINE"; drone.targetID = target;
      return { type: "dict", entries: [] };
    } };
  const manager = createMiningDrones("ignored", { getAPI: () => api, pendingDeparture: () => false, native });
  const state = { enabled: true, mineDrones: true, mineDroneOrder: "nearest", mineDroneMode: "spread",
    characterID: 7, ores: ["hedbergite"], miningDroneIDs: new Set([21, 22]), mineIncompatibleIDs: new Set() };
  const scene = { getEntityByID: id => entities.get(id) };
  manager.tick(session, state, scene, ship, 1000);
  assert.deepEqual(orders, [[21, 102], [22, 103]]);
  manager.tick(session, state, scene, ship, 2000);
  assert.equal(scans, 1);
  assert.equal(orders.length, 2);
  state.mineDroneMode = "focus"; state.mineReplan = true; state.nextMineScan = 0;
  manager.tick(session, state, scene, ship, 3000);
  assert.deepEqual(orders.slice(-2), [[21, 102], [22, 102]]);
  droneA.droneCommand = "RETURN_BAY";
  state.mineReplan = true; state.nextMineScan = 0;
  manager.tick(session, state, scene, ship, 4000);
  assert.equal(orders.at(-1)[0], 22);
  assert.deepEqual([...state.mineAssignments.values()], [102]);
});

test("pilots share only rock IDs; each drone uses its own distance and filter", () => {
  const pilots = [{ characterID: 7 }, { characterID: 8 }];
  const ships = new Map(pilots.map((pilot, i) => [pilot, { kind: "ship", itemID: 10 + i }]));
  const drones = new Map(pilots.map((pilot, i) => [20 + i, {
    itemID: 20 + i, controllerID: 10 + i, ownerID: pilot.characterID, droneCommand: "IDLE",
  }]));
  const rocks = [
    { id: 101, name: "Veldspar", state: { yieldKind: "ore" } },
    { id: 102, name: "Veldspar", state: { yieldKind: "ore" } },
    { id: 103, name: "Scordite", state: { yieldKind: "ore" } },
  ];
  let available = new Set(rocks.map(rock => rock.id));
  const scene = { sessions: new Map(pilots.map(pilot => [pilot.characterID, pilot])),
    getShipEntityForSession: pilot => ships.get(pilot), getEntityByID: id => drones.get(id) };
  const states = new WeakMap(pilots.map((pilot, i) => [pilot, {
    enabled: true, mineDrones: true, mineDroneOrder: "nearest", mineDroneMode: "spread",
    characterID: pilot.characterID, ores: ["veldspar"], miningDroneIDs: new Set([20 + i]),
    mineIncompatibleIDs: new Set(), mineAssignments: new Map(), assignments: new Map(),
    scene, shipID: ships.get(pilot).itemID,
  }]));
  let scans = 0;
  const api = { surveyGrid: () => "belt", target: (_, __, id) => rocks.find(rock => rock.id === id),
    candidates: (_, ship) => { scans++; return rocks.filter(rock => available.has(rock.id)).map(rock => ({ ...rock,
      distance: ship.itemID === 10 ? {101: 10, 102: 20, 103: 30}[rock.id]
        : {101: 5, 102: 50, 103: 3}[rock.id],
    })); } };
  const orders = [];
  const native = { isDroneEntity: d => !!d?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    DRONE_COMMAND_RETURN_HOME: "RETURN_HOME", DRONE_COMMAND_MINE: "MINE",
    commandMineRepeatedly(session, [id], target) {
      orders.push([session.characterID, target]);
      Object.assign(drones.get(id), { droneCommand: "MINE", targetID: target });
      return { type: "dict", entries: [] };
    } };
  const manager = createMiningDrones("ignored", { getAPI: () => api, pendingDeparture: () => false,
    claimedTargets: (grid, pilot, candidates) => targetClaims(grid, pilot, candidates, states, { ownLasers: true }), native });
  manager.tick(pilots[0], states.get(pilots[0]), scene, ships.get(pilots[0]), 1000);
  manager.tick(pilots[1], states.get(pilots[1]), scene, ships.get(pilots[1]), 1000);
  assert.deepEqual(orders, [[7, 101], [8, 102]], "Ship B avoids A's claim despite being closer to that rock");
  assert.equal(scans, 2, "one candidate pass per pilot, not per drone");

  available = new Set([101]);
  states.get(pilots[1]).mineReplan = true;
  states.get(pilots[1]).nextMineScan = 0;
  manager.tick(pilots[1], states.get(pilots[1]), scene, ships.get(pilots[1]), 2000);
  assert.deepEqual(orders.at(-1), [8, 101], "a claim does not ban the only matching rock");

  drones.get(20).droneCommand = "RETURN_BAY";
  manager.tick(pilots[0], states.get(pilots[0]), scene, ships.get(pilots[0]), 3000);
  assert.deepEqual([...states.get(pilots[0]).mineAssignments.values()], [], "recall releases the claim");
  available = new Set(rocks.map(rock => rock.id));
  states.get(pilots[1]).ores = ["scordite"];
  states.get(pilots[1]).mineReplan = true;
  states.get(pilots[1]).nextMineScan = 0;
  manager.tick(pilots[1], states.get(pilots[1]), scene, ships.get(pilots[1]), 4000);
  assert.deepEqual(orders.at(-1), [8, 103], "the second pilot's own filter still wins");
});

test("claims include laser and drone orders only on the current grid, and never ban sharing", () => {
  const a = { characterID: 7 }, b = { characterID: 8 };
  const ships = new Map([[a, { itemID: 10 }], [b, { itemID: 11 }]]);
  const scene = { sessions: new Map([[7, a], [8, b]]), getShipEntityForSession: pilot => ships.get(pilot) };
  const states = new WeakMap([[a, { enabled: true, scene, shipID: 10, assignments: new Map([[1, 101]]), mineAssignments: new Map([[20, 102]]) }],
    [b, { enabled: true, scene, shipID: 11, assignments: new Map(), mineAssignments: new Map() }]]);
  assert.deepEqual([...targetClaims(scene, b, [{ id: 101 }, { id: 102 }, { id: 999 }], states)], [101, 102]);
  assert.deepEqual([...targetClaims(scene, b, [{ id: 999 }], states)], [], "other-grid rocks cannot be claimed here");
  assert.deepEqual([...targetClaims(scene, a, [{ id: 101 }, { id: 102 }], states, { ownDrones: true })], [102]);
  states.get(a).enabled = false;
  assert.deepEqual([...targetClaims(scene, b, [{ id: 101 }, { id: 102 }], states)], []);
});

test("rat fighters receive one batched attack and retarget after the rat disappears", () => {
  const ship = { kind: "ship", itemID: 10, grid: "belt" };
  const session = { characterID: 7 };
  const fighter = { itemID: 21, ownerID: 7, controllerID: 10, droneCommand: "IDLE" };
  const ratA = { kind: "ship", itemID: 31, nativeNpc: true, bounty: 100, grid: "belt" };
  const ratB = { kind: "ship", itemID: 32, nativeNpc: true, bounty: 100, grid: "belt" };
  const entities = new Map([[21, fighter], [31, ratA], [32, ratB]]);
  const scene = { dynamicEntities: entities, getPublicGridClusterKeyForEntity: entity => entity.grid || "belt",
    getEntityByID: id => entities.get(id) };
  const orders = [];
  const native = { isDroneEntity: d => !!d?.droneCommand, DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
    DRONE_COMMAND_ENGAGE: "ENGAGE", commandEngage(_, ids, id) {
      orders.push([ids, id]); fighter.droneCommand = "ENGAGE"; fighter.targetID = id;
      return { type: "dict", entries: [] };
    } };
  const defense = createRatDefense("ignored", { drones: {}, native });
  const state = { enabled: true, droneClientReady: true, ratDefenseEnabled: true, characterID: 7,
    launchDrones: true, droneGroupKey: "fighters", ratFighterGroupKey: "fighters",
    ratMiningIDs: new Set(), ratFighterIDs: new Set([21]), ratActive: true };
  defense.tick(session, state, scene, ship, 1000);
  defense.tick(session, state, scene, ship, 2000);
  assert.deepEqual(orders, [[[21], 31]]);
  entities.delete(31);
  defense.tick(session, state, scene, ship, 7000);
  assert.deepEqual(orders.at(-1), [[21], 32]);
});

test("same-grid fleet mates reuse rat discovery while removals remain immediate", () => {
  const rats = new Map([[31, { kind: "ship", itemID: 31, nativeNpc: true, bounty: 100, grid: "belt" }]]);
  let enumerations = 0;
  const dynamicEntities = new Proxy(rats, { get(target, key) {
    if (key === "entries") return () => { enumerations++; return target.entries(); };
    if (key === "size") return target.size;
    if (key === "get") return id => target.get(id);
    return Reflect.get(target, key);
  } });
  const scene = { dynamicEntities, getPublicGridClusterKeyForEntity: entity => entity.grid };
  const defense = createRatDefense("ignored", { drones: {}, native: {} });
  assert.equal(defense.ratsPresent(scene, { grid: "belt" }), true);
  assert.equal(defense.ratsPresent(scene, { grid: "belt" }), true);
  assert.equal(enumerations, 1);
  rats.delete(31);
  assert.equal(defense.ratsPresent(scene, { grid: "belt" }), false);
  assert.equal(enumerations, 2);
});

test("compression pause sends only owned mining drones home and preserves manual return orders", () => {
 const orders = [], drone = {itemID:21,ownerID:42,controllerID:100,droneCommand:"MINE"};
 const manager=createMiningDrones("",{getAPI:()=>null,pendingDeparture:()=>false,
 native:{isDroneEntity:d=>!!d,DRONE_COMMAND_RETURN_HOME:"RETURN_HOME",DRONE_COMMAND_RETURN_BAY:"RETURN_BAY",commandReturnHome:(session,ids)=>{
   orders.push(ids);drone.droneCommand="RETURN_HOME";return {type:"dict",entries:[]};}},logError:()=>{}});
 const s={characterID:42,miningDroneIDs:new Set([21,22,23,24]),mineAssignments:new Map([[21,9]])};
 const entities=new Map([[21,drone],[22,{itemID:22,ownerID:43,controllerID:100}],
   [23,{itemID:23,ownerID:42,controllerID:100,droneCommand:"RETURN_BAY"}],[24,{itemID:24,ownerID:42,controllerID:100,droneCommand:"RETURN_HOME"}]]);
 const scene={getEntityByID:id=>entities.get(id)};
 manager.pause({characterID:42},s,scene,{itemID:100});
 assert.deepEqual(orders,[[21]]); assert.equal(s.miningDroneIDs.size,4);
 assert.deepEqual([...s.mineCompressionResumeIDs],[21]); assert.equal(s.mineAssignments.size,0);
});

test("compression pause resumes only native confirmed returns and rejects void or mixed failures",()=>{
 for(const result of [{type:"dict",entries:[[22,"Denied"]]},undefined,{type:"dict",entries:[[99,"Unknown ID"]]}]) {
  const entities=new Map([21,22].map(itemID=>[itemID,{itemID,ownerID:42,controllerID:100,droneCommand:"MINE"}]));
  const manager=createMiningDrones("",{getAPI:()=>null,pendingDeparture:()=>false,native:{isDroneEntity:d=>!!d,
    DRONE_COMMAND_RETURN_HOME:"RETURN_HOME",DRONE_COMMAND_RETURN_BAY:"RETURN_BAY",commandReturnHome(){
      entities.get(21).droneCommand="RETURN_HOME";return result;}}});
  const s={characterID:42,miningDroneIDs:new Set([21,22])};manager.pause({characterID:42},s,{getEntityByID:id=>entities.get(id)},{itemID:100});
  assert.deepEqual([...s.mineCompressionResumeIDs],result?.entries?.[0]?.[0]===22?[21]:[]);
 }
});
test("compression resume reorders only drones paused by AutoMining and leaves manual returns untouched",()=>{
 const entities=new Map([[21,{itemID:21,ownerID:42,controllerID:100,droneCommand:"RETURN_HOME"}],
   [22,{itemID:22,ownerID:42,controllerID:100,droneCommand:"RETURN_HOME"}]]),orders=[];
 const api={surveyGrid:()=>"belt",candidates:()=>[{id:9,name:"Veldspar",state:{yieldKind:"ore"}}]};
 const manager=createMiningDrones("",{getAPI:()=>api,pendingDeparture:()=>false,native:{
   isDroneEntity:d=>!!d,DRONE_COMMAND_RETURN_BAY:"RETURN_BAY",DRONE_COMMAND_RETURN_HOME:"RETURN_HOME",DRONE_COMMAND_MINE:"MINE",
   commandMineRepeatedly:(session,ids)=>{orders.push(ids);return {type:"dict",entries:[]};}}});
 const s={enabled:true,mineDrones:true,characterID:42,ores:[],mineReplan:true,mineDroneMode:"spread",mineDroneOrder:"nearest",
   miningDroneIDs:new Set([21,22]),mineCompressionResumeIDs:new Set([21])};
 manager.tick({characterID:42},s,{getEntityByID:id=>entities.get(id)},{itemID:100},1000);
 assert.deepEqual(orders,[[21]]);assert.equal(s.mineCompressionResumeIDs.size,0);
});
