"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createFleetOre } = require("../lib/fleetOre");

function fixture(compressed, uncompressed) {
  let now = 0, compressionReady = false, guestAccess = true, committed = true, serial = 1000;
  const calls = [], rows = [], sessions = new Map(), states = new Map(), ships = new Map();
  const fleet = { fleetID: 10, members: new Map([[1, {}], [2, {}]]) };
  const scene = { getShipEntityForSession: s => ships.get(s.characterID), getLivePublicGridClusterKeyForEntity: () => "public-belt" };
  const booster = { characterID: 1, shipID: 101 }, miner = { characterID: 2, shipID: 102 };
  sessions.set(1, booster); sessions.set(2, miner);
  const state = { job: "boosting", enabled: true, receiveFleetOre: true, compressorEnabled: true,
    receiveFleetAcceptCompressed: compressed, receiveFleetAcceptUncompressed: uncompressed };
  states.set(1, state); states.set(2, { job: "mining", enabled: true, oreMode: "fleetHangar" });
  for (const s of [booster, miner]) ships.set(s.characterID, { itemID: s.shipID, mode: "STOP", radius: 100,
    position: { x: (s.characterID - 1) * 1000, y: 0, z: 0 } });
  const types = { 10: { volume: 1, ore: true }, 11: { volume: 0.1, ore: true, compressed: true }, 12: { volume: 1 } };
  const capacities = new Map([["101:134", 100], ["101:155", 100], ["102:134", 100]]);
  const native = {
    fleet: id => fleet.members.has(id) ? fleet : null, local: () => true,
    type: id => types[id], ore: row => types[row.typeID]?.ore === true, compressed: row => types[row.typeID]?.compressed === true,
    list: (s, id, flag, all) => rows.filter(r => r.locationID === id && r.flagID === flag && (all || r.ownerID === s.characterID)),
    access: (s, id, flag) => !(s.characterID === 2 && id === 101 && flag === 155 && !guestAccess),
    capacity: (s, id, flag) => ({ capacity: capacities.get(`${id}:${flag}`) || 0,
      used: rows.filter(r => r.locationID === id && r.flagID === flag).reduce((n, r) => n + r.quantity * types[r.typeID].volume, 0) }),
    move(s, target, source, row, quantity, flag) {
      calls.push({ kind: "move", source, target, typeID: row.typeID, quantity, flag, actor: s.characterID });
      assert.equal(source, row.locationID); assert(quantity > 0 && quantity <= row.quantity);
      if (!committed) return;
      row.quantity -= quantity;
      rows.push({ itemID: serial++, typeID: row.typeID, quantity, flagID: flag, locationID: target, ownerID: target === 103 ? 3 : 1 });
    },
  };
  const service = createFleetOre({ native, getSpace: () => ({ getSceneForSession: () => scene }),
    getSession: id => sessions.get(id), getState: s => states.get(s.characterID), clock: () => now, logError: () => {},
    compress(sc, s, ship, facilityID) {
      assert.equal(sc, scene); assert.equal(s, miner); assert.equal(ship, ships.get(2)); assert.equal(facilityID, 101);
      calls.push({ kind: "compress" });
      if (compressionReady) for (const r of rows) if (r.locationID === 102 && r.typeID === 10) r.typeID = 11;
    },
  });
  const add = (typeID, quantity = 20, locationID = 102, flagID = 134) => {
    const row = { itemID: serial++, typeID, quantity, locationID, flagID, ownerID: locationID === 102 ? 2 : 1 };
    rows.push(row); return row;
  };
  return { service, state, states, calls, rows, capacities, add, sessions, ships, scene, fleet,
    tick(time = now) { now = time; return service.tick(booster, state, scene, ships.get(1), null, now); },
    minerTick(time = now) { now = time; return service.tick(miner, states.get(2), scene, ships.get(2), null, now); },
    waiting: () => service.waitingForCompression(miner, states.get(2), scene, ships.get(2)),
    compression(value) { compressionReady = value; }, access(value) { guestAccess = value; }, commit(value) { committed = value; },
    remaining: typeID => rows.filter(r => r.locationID === 102 && r.typeID === typeID).reduce((n, r) => n + r.quantity, 0),
  };
}

test("receiver admission toggles select raw/compressed independently of compressor automation", () => {
  for (const [compressed, raw, expected] of [[true, true, [10, 11]], [true, false, [11]], [false, true, [10]], [false, false, []]]) {
    const f = fixture(compressed, raw); f.add(10); f.add(11); f.add(12); f.tick();
    const deposits = f.calls.filter(c => c.kind === "move" && c.source === 102);
    assert.deepEqual(deposits.map(c => c.typeID).sort(), expected, `compressed=${compressed}, raw=${raw}`);
    assert.equal(f.remaining(10), raw ? 0 : 20); assert.equal(f.remaining(11), compressed ? 0 : 20);
    assert.equal(f.remaining(12), 20, "non-ore remains excluded");
    assert.equal(f.calls.filter(c => c.kind === "compress").length, compressed && !raw ? 1 : 0);
  }
});

test("compressed-only admission waits across native facility intervals and transfers only confirmed compressed rows", () => {
  const f = fixture(true, false); f.add(10); assert.equal(f.waiting(), true);
  f.tick(); assert.equal(f.remaining(10), 20); assert.equal(f.calls.filter(c => c.kind === "move").length, 0);
  f.tick(1000); assert.equal(f.calls.length, 1, "existing five-second scheduling bound is retained");
  f.tick(5000); assert.equal(f.remaining(10), 20); assert.equal(f.calls.filter(c => c.kind === "compress").length, 2);
  f.compression(true); const result = f.tick(10000);
  assert.equal(f.remaining(10), 0); assert.equal(f.remaining(11), 0); assert.equal(f.waiting(), false);
  assert.equal(result.event.quantity, 20); assert(f.calls.filter(c => c.kind === "move").every(c => c.typeID === 11));
});

test("compressed-only without enabled facility retains raw but takes already compressed ore", () => {
  const f = fixture(true, false); f.state.compressorEnabled = false; f.add(10); f.add(11);
  assert.equal(f.waiting(), false, "a disabled facility cannot create a compression pause");
  f.tick(); assert.equal(f.remaining(10), 20); assert.equal(f.remaining(11), 0);
  assert.equal(f.minerTick().status, "Booster accepts compressed ore only; raw ore stays aboard.");
  assert.equal(f.calls.filter(c => c.kind === "compress").length, 0);
});

test("both or raw-only acceptance never waits for compression and never decompresses rejected ore", () => {
  for (const acceptsCompressed of [true, false]) {
    const f = fixture(acceptsCompressed, true); f.add(10); f.add(11);
    assert.equal(f.waiting(), false); f.minerTick(); f.tick();
    assert.equal(f.remaining(10), 0); assert.equal(f.remaining(11), acceptsCompressed ? 0 : 20);
    assert.equal(f.calls.filter(c => c.kind === "compress").length, 0);
    if (!acceptsCompressed) assert.equal(f.minerTick(5000).status, "Booster accepts uncompressed ore only; compressed ore stays aboard.");
  }
});

test("both admissions off leaves miner ore untouched and cannot invoke facility compression", () => {
  const f = fixture(false, false); f.add(10); f.add(11);
  assert.equal(f.waiting(), false); assert.equal(f.minerTick().status, "Fleet ore admission is off."); const result = f.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.remaining(10), 20); assert.equal(f.remaining(11), 20); assert.equal(result.event, null);
});

test("guest permission and committed inventory receipts still gate admission", () => {
  const blocked = fixture(true, false); blocked.add(10); blocked.access(false);
  assert.equal(blocked.waiting(), false); blocked.tick(); assert.equal(blocked.calls.length, 0);
  const uncommitted = fixture(true, true); uncommitted.add(10); uncommitted.commit(false);
  const result = uncommitted.tick(); assert.match(result.status, /could not be confirmed/);
  assert.equal(uncommitted.remaining(10), 20); assert.equal(result.event, null);
});

test("raw admission respects both native storage buffers and retains untransferred quantity", () => {
  const f = fixture(false, true); f.add(10, 20); f.add(10, 100, 101, 134); f.add(10, 95, 101, 155);
  const result = f.tick(); assert.equal(f.remaining(10), 15); assert.equal(result.event.quantity, 5);
  assert.equal(result.event.storedUnits, 0); assert.equal(f.calls.filter(c => c.kind === "compress").length, 0);
});

test("waiting for one compressed-only receiver never excludes intake by another raw-accepting receiver", () => {
  const f = fixture(true, false), second = { characterID: 3, shipID: 103 };
  const secondState = { job: "boosting", enabled: true, receiveFleetOre: true, compressorEnabled: true,
    receiveFleetAcceptCompressed: false, receiveFleetAcceptUncompressed: true };
  f.sessions.set(3, second); f.states.set(3, secondState); f.fleet.members.set(3, {});
  f.ships.set(3, { itemID: 103, mode: "STOP", radius: 100, position: { x: 2000, y: 0, z: 0 } });
  f.capacities.set("103:134", 100); f.capacities.set("103:155", 100); f.add(10);
  assert.equal(f.waiting(), true); assert.equal(f.minerTick().status, "Waiting for fleet compression.");
  f.tick(); assert.equal(f.remaining(10), 20);
  f.service.tick(second, secondState, f.scene, f.ships.get(3), null, 0);
  assert.equal(f.remaining(10), 0); assert.equal(f.waiting(), false);
  assert.deepEqual(f.calls.filter(c => c.kind === "move" && c.source === 102).map(c => [c.target, c.typeID]), [[103, 10]]);
});
