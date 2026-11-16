"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createController } = require("../lib/controller");
const { installHUD } = require("../lib/hud");
const { createDroneLaunch } = require("../lib/droneLaunch");
const { createRatDefense } = require("../lib/ratDefense");

function fixture({ enabled = false, ready = true, rats = false } = {}) {
  const messages = [], errors = [], groupRequests = [], recalls = [];
  const ship = { itemID: 10, kind: "ship", mode: "STOP" };
  const session = { characterID: 42, shipID: 10,
    sendNotification(name, type, args) {
      if (name === "OnAutoMiningLaunchDrones") messages.push(JSON.parse(args[0]));
      if (name === "OnAutoMiningRatGroups") groupRequests.push(JSON.parse(args[0]));
    } };
  const entities = new Map(rats ? [[90, { itemID: 90, kind: "ship", nativeNpc: true,
    operatorKind: "asteroidBeltRat" }]] : []);
  const scene = { getShipEntityForSession: () => ship, sessions: new Map([[42, session]]),
    dynamicEntities: entities, getEntityByID: id => entities.get(id), getGridBubbleIDForEntity: () => 23 };
  const api = { surveyGrid: () => "belt", surveyResource: () => 99, miningSite: () => true,
    modules: () => [], candidates: () => [] };
  const preferences = { get: () => ({ enabled, launchDrones: false }), save() {} };
  const getSpace = () => ({ getSceneForSession: () => scene });
  const ratDefense = rats ? createRatDefense("unused", { getAPI: () => api,
    drones: createDroneLaunch({ getAPI: () => api, getSpace, pendingDeparture: () => false }),
    native: { isDroneEntity: entity => entity?.kind === "drone", DRONE_COMMAND_RETURN_BAY: "RETURN_BAY",
      DRONE_COMMAND_ENGAGE: "ENGAGE", commandEngage: () => ({ type: "dict", entries: [] }),
      commandReturnBay(_, ids) { recalls.push(ids); return { type: "dict", entries: [] }; } } }) : null;
  const controller = createController(() => api, () => ({ getSceneForSession: () => scene }),
    error => errors.push(error), preferences, null, null, null, null, { ratDefense });
  class MiningScanService {}
  installHUD(MiningScanService, controller, () => []);
  const service = new MiningScanService();
  const rpc = (method, ...args) => {
    const response = JSON.parse(service["Handle_" + method](args, session));
    assert.equal(response.success, true, JSON.stringify(response));
    return response;
  };
  if (ready) rpc("AutoMiningDronesReady");
  const save = key => {
    const snap = rpc("AutoMiningGetState", false);
    return rpc("AutoMiningSetSettings", Buffer.from(JSON.stringify({ revision: snap.revision,
      settings: { ...snap.settings, launchDrones: true, droneGroupKey: key,
        ...(rats ? { ratDefenseEnabled: true, ratMiningGroupKey: key,
          ratFighterGroupKey: '["Fighters","native-id"]' } : {}) } })));
  };
  return { rpc, save, messages, controller, scene, ship, session, errors, groupRequests, entities, recalls };
}

for (const enabled of [false, true]) {
  test(`HUD save then Start / Resume arms launch at the current belt (previous enabled=${enabled})`, () => {
    const f = fixture({ enabled });
    f.save('["Miners","native-id"]');
    const response = f.rpc("AutoMiningControl", Buffer.from("on"));
    assert.equal(response.enabled, true);
    f.controller.tick(f.scene, 1000);
    assert.equal(f.messages.length, 1);
    assert.equal(f.rpc("AutoMiningDroneClaim", f.messages[0].id).groupKey, '["Miners","native-id"]');
    assert.deepEqual(f.errors, []);
  });
}

test("Start / Resume retries a failed earlier launch here without requiring travel", () => {
  const f = fixture();
  f.save('["Miners","previous-id"]');
  f.rpc("AutoMiningControl", "on");
  f.controller.tick(f.scene, 1000);
  f.rpc("AutoMiningDroneResult", f.messages[0].id, "Selected drone group is unavailable.", []);
  f.save('["Miners","recreated-native-id"]');
  f.rpc("AutoMiningControl", "on");
  f.controller.tick(f.scene, 2000);
  assert.equal(f.messages.length, 2);
  assert.notEqual(f.messages[0].id, f.messages[1].id);
  assert.equal(f.messages[1].groupKey, '["Miners","recreated-native-id"]');
  assert.equal(f.rpc("AutoMiningDroneClaim", f.messages[1].id).groupKey, f.messages[1].groupKey);
  assert.deepEqual(f.errors, []);
});

test("Start / Resume remains armed until client readiness and landing, then sends once", () => {
  const f = fixture({ ready: false });
  f.save('["Miners","native-id"]');
  f.rpc("AutoMiningControl", "on");
  f.controller.tick(f.scene, 1000);
  assert.equal(f.messages.length, 0);
  f.ship.pendingWarp = true;
  f.rpc("AutoMiningDronesReady");
  f.controller.tick(f.scene, 2000);
  assert.equal(f.messages.length, 0);
  f.ship.pendingWarp = false;
  f.controller.tick(f.scene, 3000);
  f.controller.tick(f.scene, 4000);
  assert.equal(f.messages.length, 1);
  assert.deepEqual(f.errors, []);
});

test("Start / Resume at a live rat prioritizes fighters, then restores miners after the encounter", () => {
  const f = fixture({ enabled: true, rats: true });
  const minerKey = '["Miners","native-id"]';
  f.save(minerKey);
  f.rpc("AutoMiningControl", "on");
  f.controller.tick(f.scene, 1000);
  assert.equal(f.messages.length, 0, "arrival miners must not bypass enabled rat response");
  assert.equal(f.groupRequests.length, 1);
  f.rpc("AutoMiningRatGroups", JSON.stringify({ ...f.groupRequests[0], miningIDs: [11], fighterIDs: [21] }));
  f.controller.tick(f.scene, 2000);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].kind, "ratFighters");
  f.rpc("AutoMiningDroneClaim", f.messages[0].id);
  f.entities.set(21, { itemID: 21, kind: "drone", ownerID: 42, controllerID: 10, droneCommand: "ENGAGE", targetID: 90 });
  f.rpc("AutoMiningDroneResult", f.messages[0].id, "1 drone visible", [21]);
  f.entities.delete(90);
  f.controller.tick(f.scene, 3000);
  f.controller.tick(f.scene, 8000);
  assert.deepEqual(f.recalls, [[21]]);
  f.entities.delete(21);
  f.controller.tick(f.scene, 9000);
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[1].kind, "ratMiners");
  assert.equal(f.messages[1].groupKey, minerKey);
  assert.deepEqual(f.errors, []);
});
