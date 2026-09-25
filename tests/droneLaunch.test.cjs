"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDroneLaunch, validGroupKey } = require("../lib/droneLaunch");
const { createController } = require("../lib/controller");

function fixture() {
  let now = 0, pending = false, resource = 99, grid = "belt";
  const messages = [], ship = { itemID: 10, kind: "ship", mode: "STOP" };
  const session = { characterID: 42, shipID: 10, sendNotification: (_, __, args) => messages.push(JSON.parse(args[0])) };
  const scene = { getShipEntityForSession: () => ship, sessions: new Map([[42, session]]) };
  const space = { getSceneForSession: () => scene };
  const api = { surveyGrid: () => grid, surveyResource: () => resource, modules: () => [], candidates: () => [] };
  const s = { characterID: 42, enabled: true, launchDrones: true, droneClientReady: true, droneGroupKey: '["Miners","123"]' };
  const drones = createDroneLaunch({ getAPI: () => api, getSpace: () => space, pendingDeparture: () => pending, clock: () => now });
  return { s, ship, session, scene, space, api, drones, messages,
    arrive() { drones.arrival(session, s, scene, ship, now); },
    advance() { now += 31000; }, pending() { pending = true; }, noOre() { resource = null; }, gate() { grid = "gate"; },
    claim() { return drones.claim(session, s, messages.at(-1).id); } };
}

test("arrival sends once, consumes one grant and accepts only stable native group IDs", () => {
  const f = fixture(); f.drones.arm(f.s); f.arrive(); f.arrive();
  assert.equal(f.messages.length, 1); assert.equal(f.claim().groupKey, f.s.droneGroupKey);
  assert.throws(() => f.claim(), /no longer/);
  f.drones.result(f.s, f.messages[0].id, "Launch requested"); assert.equal(f.s.droneStatus, "Launch requested");
  assert.ok(validGroupKey('["Fighters","456"]')); assert.ok(!validGroupKey('Miners')); assert.ok(!validGroupKey('["Miners"]'));
});

test("expired, changed-group, departure, stopped, wrong-ship, changed-grid and warp requests cannot launch", () => {
  for (const change of [f => f.advance(), f => f.s.droneGroupKey = '["Fighters","456"]', f => f.pending(),
    f => f.s.enabled = false, f => f.ship.itemID = 11, f => f.gate(), f => f.ship.pendingWarp = true,
    f => f.s.haul = {}, f => f.session.stationID = 600]) {
    const f = fixture(); f.drones.arm(f.s); f.arrive(); change(f);
    assert.throws(() => f.claim(), /no longer/);
  }
});

test("gates, travel, hauling, disabled opt-in and clients without the feature do not launch", () => {
  for (const change of [f => f.noOre(), f => f.ship.pendingWarp = true, f => f.pending(),
    f => f.s.haul = {}, f => f.s.launchDrones = false, f => f.s.droneClientReady = false]) {
    const f = fixture(); f.drones.arm(f.s); change(f); f.arrive(); assert.equal(f.messages.length, 0);
  }
});

test("stale belt grid at a station cannot authorize a drone launch", () => {
  const f = fixture();
  f.api.miningSite = () => false;
  f.drones.arm(f.s);
  f.arrive();
  assert.equal(f.messages.length, 0);
  f.api.miningSite = () => true;
  f.arrive();
  assert.equal(f.messages.length, 0); // bounded retry interval
  f.advance();
  f.arrive();
  assert.equal(f.messages.length, 1);
  f.api.miningSite = () => false;
  assert.throws(() => f.claim(), /no longer/);
});

test("rat fighter launch works without arrival launch or remaining ore, but still needs rat opt-in", () => {
  const f = fixture(); f.s.launchDrones = false; f.s.ratDefenseEnabled = true;
  f.s.ratFighterGroupKey = '["Fighters","456"]'; f.noOre();
  assert.equal(f.drones.requestGroup(f.session, f.s, f.scene, f.ship, f.s.ratFighterGroupKey, "ratFighters"), true);
  assert.equal(f.claim().groupKey, f.s.ratFighterGroupKey);
  f.s.ratDefenseEnabled = false;
  assert.equal(f.drones.requestGroup(f.session, f.s, f.scene, f.ship, f.s.ratFighterGroupKey, "ratFighters"), false);
});

test("controller launches on Start at a belt and again after a later warp, without HUD polling", () => {
  const f = fixture();
  const c = createController(() => f.api, () => f.space);
  let snap = c.snapshot(f.session);
  c.applySettings(f.session, JSON.stringify({ revision: snap.revision,
    settings: { ...snap.settings, launchDrones: true, droneGroupKey: f.s.droneGroupKey } }));
  c.dronesReady(f.session); c.command(f.session, { action: "on" }); c.tick(f.scene, 1000);
  assert.equal(f.messages.length, 1);
  c.droneClaim(f.session, f.messages[0].id); c.tick(f.scene, 2000); assert.equal(f.messages.length, 1);
  f.ship.pendingWarp = true; c.tick(f.scene, 2100);
  f.ship.pendingWarp = false; c.tick(f.scene, 4000); assert.equal(f.messages.length, 2);
  c.command(f.session, { action: "off" }); assert.throws(() => c.droneClaim(f.session, f.messages[1].id), /no longer/);
});
