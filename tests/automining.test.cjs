"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parse, matchesOre, installChat, installPlainChat } = require("../lib/commands");
const { createController } = require("../lib/controller");

function fixture({ count = 3, pending = false, cap = 10, deferred = false, compress = null, preferences = null, crystals = null } = {}) {
  const session = { characterID: 42 };
  const ship = { kind: "ship", itemID: 100, activeModuleEffects: new Map(), lockedTargets: new Map(), pendingTargetLocks: new Map() };
  const modules = Array.from({ length: count }, (_, i) => ({ item: { itemID: i + 1 }, effect: { name: "miningLaser" }, range: 100, snapshot: { maxRangeMeters: 100 } }));

  const rocks = [
    { id: 11, name: "Veldspar", distance: 10, quantity: 10, family: "ore" },
    { id: 12, name: "Dense Veldspar", distance: 20, quantity: 10, family: "ore" },
    { id: 13, name: "Scordite", distance: 30, quantity: 10, family: "ore" },
    { id: 14, name: "Pyroxeres", distance: 150, quantity: 10, family: "ore" },
  ];
  const started = [], stopped = [], removed = [], errors = [], approaches = [], scans = [];
  let spaceShip = ship, now = 0, free = true;
  const scene = {
    sessions: new Map([[42, session]]),
    getShipEntityForSession: () => spaceShip,
    getTargets: () => [...ship.lockedTargets.keys()],
    addTarget(_, id) {
      if (ship.lockedTargets.has(id)) return { success: true, data: { pending: false } };
      if (ship.pendingTargetLocks.has(id)) return { success: true, data: { pending: true } };
      if (ship.lockedTargets.size + ship.pendingTargetLocks.size >= cap) return { success: false };
      (pending ? ship.pendingTargetLocks : ship.lockedTargets).set(id, {});
      return { success: true, data: { pending } };
    },
    activateGenericModule(_, item, effect, options) {
      assert.equal(options.repeat, 0);
      assert(ship.lockedTargets.has(options.targetID));
      const state = { moduleID: item.itemID, targetID: options.targetID };
      ship.activeModuleEffects.set(item.itemID, state);
      started.push([item.itemID, options.targetID]);
      return { success: true, data: { effectState: state } };
    },
    deactivateGenericModule(_, id) { stopped.push(id); if (!deferred) ship.activeModuleEffects.delete(id); return { success: true }; },
    removeTarget(_, id) { removed.push(id); ship.lockedTargets.delete(id); for (const [moduleID,effect] of ship.activeModuleEffects) if (effect.targetID === id) ship.activeModuleEffects.delete(moduleID); },
    cancelAddTarget(_, id) { removed.push(id); ship.pendingTargetLocks.delete(id); },
    followBall(_, id, range) { approaches.push([id, range]); ship.mode = "FOLLOW"; ship.targetEntityID = id; ship.followRange = range; return true; },
    stop() { ship.mode = "STOP"; },
  };
  const stats = {discoveries:0, modules:0, lookups:0, surveySearches:0, surveyLookups:0};
  const api = {
    surveyGrid: () => ship.grid || 'belt',
    surveyResource: (_, __, previousID) => {
      if (previousID) stats.surveyLookups++;
      const present = r => r.quantity > 0 && (r.grid || 'belt') === (ship.grid || 'belt');
      if (previousID && rocks.some(r => r.id === previousID && present(r))) return previousID;
      stats.surveySearches++;
      return rocks.find(present)?.id || null;
    },
    hasSurveyor: () => true,
    modules: () => {stats.modules++; return modules;},
    candidates: () => {stats.discoveries++;return rocks.filter(r => r.quantity > 0);},
    target: (_,__,id) => {stats.lookups++;return rocks.find(r=>r.id===id && r.quantity>0)||null;},
    hasRoom: (_,__,id) => rocks.some(r=>r.id===id) ? free : null,
    compatible: (_, __, module, rock, now, ignoreRange) => free && (ignoreRange || rock.distance <= module.range) && rock.family === (module.family || "ore"),
  };
  session.sendNotification = (event, scope, args) => { assert.equal(event, "OnAutoMiningSurvey"); assert.equal(scope, "clientID"); assert.deepEqual(args, []); scans.push(now); };
  const controller = createController(() => api, () => ({ getSceneForSession: () => spaceShip ? scene : null }), e => errors.push(e), preferences, compress, null, crystals);
  return { session, ship, modules, rocks, scene, started, stopped, removed, errors, controller, approaches, scans, stats, api,
    command: text => controller.command(session, parse(text)),
    tick(elapsed = 1000) { now += elapsed; controller.tick(scene, now); assert.deepEqual(errors, []); },
    finish() { ship.activeModuleEffects.clear(); },
    lock() { for (const id of ship.pendingTargetLocks.keys()) ship.lockedTargets.set(id, {}); ship.pendingTargetLocks.clear(); },
    setShip(value) { spaceShip = value; }, setFree(value) { free = value; },
  };
}

function volumes(f) {
  // Raw quantities intentionally disagree with m3 ranking.
  for (const [i, r] of f.rocks.entries()) r.state = {
    remainingQuantity: [100, 10, 5, 2][i], unitVolume: [0.1, 2, 10, 100][i],
  };
}

test("barges arriving together claim separate local rocks, then share if only one remains", () => {
  const pilots = [{characterID: 41}, {characterID: 42}];
  const ships = new Map(pilots.map((pilot, index) => [pilot, {
    kind: "ship", itemID: 100 + index, activeModuleEffects: new Map(),
    lockedTargets: new Map(), pendingTargetLocks: new Map(),
  }]));
  const rocks = [11, 12].map(id => ({id, name: "Veldspar", distance: id, quantity: 10, family: "ore"}));
  const started = [];
  const scene = {
    sessions: new Map(pilots.map(pilot => [pilot.characterID, pilot])),
    getShipEntityForSession: pilot => ships.get(pilot),
    getTargets: pilot => [...ships.get(pilot).lockedTargets.keys()],
    addTarget(pilot, id) { ships.get(pilot).lockedTargets.set(id, {}); return {success: true, data: {pending: false}}; },
    activateGenericModule(pilot, item, effect, options) {
      const ship = ships.get(pilot), cycle = {targetID: options.targetID};
      ship.activeModuleEffects.set(item.itemID, cycle);
      started.push([pilot.characterID, options.targetID]);
      return {success: true};
    },
    deactivateGenericModule(pilot, id) { ships.get(pilot).activeModuleEffects.delete(id); return {success: true}; },
    removeTarget(pilot, id) { ships.get(pilot).lockedTargets.delete(id); },
  };
  const api = {
    modules: ship => [{item: {itemID: ship.itemID + 100}, effect: {name: "miningLaser"}, snapshot: {maxRangeMeters: 100}}],
    candidates: () => rocks.filter(rock => rock.quantity > 0),
    target: (_, ship, id) => rocks.find(rock => rock.id === id && rock.quantity > 0) || null,
    compatible: (_, ship, module, rock) => rock.quantity > 0,
    hasSurveyor: () => true,
  };
  const errors = [];
  const controller = createController(() => api, () => ({getSceneForSession: () => scene}), error => errors.push(error));
  for (const pilot of pilots) controller.command(pilot, parse("automining on"));
  controller.tick(scene, 1000);
  assert.deepEqual(started, [[41, 11], [42, 12]]);
  for (const pilot of pilots) ships.get(pilot).activeModuleEffects.clear();
  rocks[1].quantity = 0;
  controller.tick(scene, 2000);
  assert.deepEqual(started.slice(2), [[41, 11], [42, 11]], "Sharing remains available when only one rock is mineable");
  assert.deepEqual(errors, []);
});

test("ordered groups mine highest grade first, then the next grade and next added ore", () => {
  const f = fixture({count: 1});
  f.rocks.splice(0, f.rocks.length,
    {id: 11, name: "Scordite IV-Grade", distance: 5, quantity: 10, family: "ore"},
    {id: 12, name: "Veldspar", distance: 10, quantity: 10, family: "ore"},
    {id: 13, name: "Veldspar II-Grade", distance: 30, quantity: 10, family: "ore"},
    {id: 14, name: "Veldspar IV-Grade", distance: 90, quantity: 10, family: "ore"});
  f.command("automining veldspar,scordite"); f.command("automining on"); f.tick();
  assert.deepEqual(f.started, [[1, 14]], "First added group and its top grade win over distance");
  for (const id of [14, 13, 12]) {
    f.finish(); f.rocks.find(rock => rock.id === id).quantity = 0; f.tick();
  }
  assert.deepEqual(f.started.map(([, id]) => id), [14, 13, 12, 11]);
  const g = fixture({count: 1});
  g.rocks.splice(0, g.rocks.length,
    {id: 11, name: "Scordite", distance: 50, quantity: 10, family: "ore"},
    {id: 12, name: "Veldspar IV-Grade", distance: 5, quantity: 10, family: "ore"});
  g.command("automining scordite,veldspar"); g.command("automining on"); g.tick();
  assert.deepEqual(g.started, [[1, 11]], "Reversing saved entries changes the actual target");
});

test("approach and crystal preparation use the ordered filter before distance", () => {
  let crystalOrder;
  const f = fixture({count: 1, crystals: ({rocks}) => { crystalOrder = rocks.map(rock => rock.id); return false; }});
  f.rocks.splice(0, f.rocks.length,
    {id: 11, name: "Scordite", distance: 10, quantity: 10, family: "ore"},
    {id: 12, name: "Veldspar II-Grade", distance: 40, quantity: 10, family: "ore"},
    {id: 13, name: "Veldspar IV-Grade", distance: 150, quantity: 10, family: "ore"});
  f.command("automining veldspar,scordite"); f.command("automining approach on");
  f.command("automining on"); f.tick();
  assert.deepEqual(crystalOrder, [13, 12, 11]);
  assert.deepEqual(f.approaches, [[13, 90]]);
});

test("changing to Hedbergite replaces or unloads an incompatible crystal before mining resumes", () => {
  for (const haveCrystal of [true, false]) {
    const { createCrystalManager } = require('../lib/crystals');
    let loaded = {itemID:70,typeID:7}, pending = false;
    const changes=[];
    const crystals=createCrystalManager(()=>({pending:()=>pending,
      load(){changes.push('load');pending=true;}, unload(){changes.push('unload');loaded=null;}}));
    const f=fixture({count:1,deferred:true,crystals});
    f.rocks[2].name='Hedbergite';
    const compatible=f.api.compatible;
    f.api.compatible=(...args)=>compatible(...args) && (!loaded || (loaded.typeID===7 ? args[3].id!==13 : args[3].id===13));
    f.api.loadedCrystal=()=>loaded;
    f.api.crystalPlan=(_,__,m,rocks)=>loaded?.typeID===7 && rocks.length && rocks.every(r=>r.id===13)
      ? {loadedID:70,chargeID:haveCrystal ? 80 : 0,chargeTypeID:8} : null;
    f.command('automining veldspar');f.command('automining on');f.tick();
    assert.equal(f.ship.activeModuleEffects.get(1).targetID,11);
    f.command('automining hedbergite');f.tick();
    assert.deepEqual(changes,[haveCrystal?'load':'unload']);
    assert.equal(f.ship.activeModuleEffects.size,0);
    if(haveCrystal){f.tick();assert.equal(changes.length,1);loaded={itemID:80,typeID:8};pending=false;}
    f.tick();assert.equal(f.ship.activeModuleEffects.get(1).targetID,13);
    f.command('automining off');f.tick();assert.equal(changes.length,1);
  }
});

test("volume sorting requires an available Surveyor, pauses on removal, and resumes on return", () => {
  const f=fixture({count:1}); volumes(f); let available=false;
  f.api.hasSurveyor=()=>available;
  f.command('automining largest'); f.command('automining approach on'); f.command('automining on'); f.tick();
  assert.equal(f.started.length,0); assert.equal(f.approaches.length,0);
  assert.match(f.controller.snapshot(f.session).status,/needs an available Mining Surveyor/);
  available=true; f.tick(); assert.equal(f.approaches.length,1);
  available=false; f.tick(); assert.equal(f.ship.mode,'STOP');
  f.command('automining nearest');f.command('automining approach off');f.tick();
  assert.equal(f.started.length,1); assert.equal(f.scans.length,0);
  f.command('automining smallest'); f.tick();
  assert.equal(f.ship.activeModuleEffects.size,0);
  available=true; f.tick(); assert.equal(f.ship.activeModuleEffects.size,1);
  assert.equal(f.scans.length,0);
});

test("volume priorities use remaining m3, respect range/filter, and spread miners", () => {
  const f = fixture({count:4}); volumes(f);
  assert.deepEqual(parse('/AUTOMINING LARGEST'), {action:'largest'});
  f.command('automining largest'); f.command('automining on'); f.tick();
  assert.deepEqual(f.started.map(x=>x[1]), [13,12,11,13]);
  assert.equal(f.approaches.length,0);
  f.finish(); f.command('automining smallest'); f.tick();
  assert.deepEqual(f.started.slice(4).map(x=>x[1]), [11,12,13,11]);
  f.finish(); f.command('automining veldspar'); f.command('automining largest'); f.tick();
  assert.deepEqual(f.started.slice(8).map(x=>x[1]), [12,11,12,12]);
});

test("Approach ranks the entire local belt even with lower-priority ore already reachable", () => {
  const f = fixture({count:1}); volumes(f);
  f.command('automining largest'); f.command('automining approach on'); f.command('automining on'); f.tick();
  assert.deepEqual(f.approaches, [[14,90]]);
  assert.equal(f.started.length,0);
  for (let i=0;i<60;i++) f.tick();
  assert.equal(f.stats.discoveries,1); assert.equal(f.approaches.length,1);
  // Another pilot changing volume must not make us turn around mid-flight.
  f.rocks[3].state.remainingQuantity=0.01;
  f.tick(); assert.equal(f.approaches.length,1);
  f.rocks[3].distance=85; f.tick();
  // The committed primary target is retained through arrival.
  assert.equal(f.ship.mode,'STOP');
  assert.deepEqual(f.started, [[1,14]]);
  f.finish(); f.rocks[3].quantity=0; f.tick();
  assert.equal(f.started.at(-1)[1],13);
});

test("smallest and furthest priorities also determine the approach destination", () => {
  for (const order of ['smallest','furthest']) {
    const f=fixture({count:1}); volumes(f);
    f.rocks[3].state.remainingQuantity=0.001;
    f.command('automining '+order); f.command('automining approach on'); f.command('automining on'); f.tick();
    assert.equal(f.approaches[0][0],14); assert.equal(f.started.length,0);
  }
});

test("turning Approach off cancels travel and immediately selects only reachable ore", () => {
  const f=fixture({count:1}); volumes(f);
  f.command('automining largest'); f.command('automining approach on'); f.command('automining on'); f.tick();
  f.command('automining approach off'); f.tick();
  assert.equal(f.ship.mode,'STOP'); assert.deepEqual(f.started,[[1,13]]);
});

test("depleted approach target is replaced; filtered-out distant ore is never chased", () => {
  const f=fixture({count:1}); volumes(f);
  f.command('automining largest'); f.command('automining approach on'); f.command('automining on'); f.tick();
  f.rocks[3].quantity=0; f.tick();
  assert.equal(f.ship.mode,'STOP'); assert.deepEqual(f.started,[[1,13]]);
  const g=fixture({count:1}); volumes(g);
  g.command('automining veldspar'); g.command('automining largest'); g.command('automining approach on'); g.command('automining on'); g.tick();
  assert.deepEqual(g.started,[[1,12]]); assert.equal(g.approaches.length,0);
});

test("new distant priority interrupts deferred cycles and approaches without waiting", () => {
  const f=fixture({count:1,deferred:true}); volumes(f);
  f.command('automining on'); f.tick();
  f.command('automining largest'); f.command('automining approach on');
  assert.deepEqual(f.removed,[11]); assert.deepEqual(f.stopped,[1]);
  assert.equal(f.ship.activeModuleEffects.size,0);
  f.tick(1);
  assert.deepEqual(f.approaches,[[14,90]]); assert.equal(f.started.length,1);
});

test("every changed priority through chat or HUD unlocks and replans active miners immediately", () => {
  const orders=['nearest','furthest','largest','smallest'];
  const expected={nearest:11,furthest:13,largest:12,smallest:13};
  for (const hud of [false,true]) for (const before of orders) for (const after of orders) {
    if (before===after) continue;
    const f=fixture({count:1,deferred:true}); volumes(f);
    [20,50,10].forEach((volume,i)=>f.rocks[i].state={remainingQuantity:volume,unitVolume:1});
    f.command('automining '+before); f.command('automining on'); f.tick();
    const oldTarget=f.started[0][1];
    // Unrelated combat targets and effects must survive the mining reset.
    f.ship.lockedTargets.set(99,{});
    const combat={targetID:99};f.ship.activeModuleEffects.set(99,combat);
    if (hud) {
      const state=f.controller.snapshot(f.session);
      f.controller.applySettings(f.session,JSON.stringify({revision:state.revision,settings:{...state.settings,order:after}}));
    } else f.command('automining '+after);
    assert.deepEqual(f.removed,[oldTarget]);
    assert.deepEqual(f.stopped,[1]);
    assert(!f.ship.activeModuleEffects.has(1));
    assert.equal(f.ship.activeModuleEffects.get(99),combat);assert(f.ship.lockedTargets.has(99));
    f.tick(1); assert.equal(f.started.at(-1)[1],expected[after]);
    const searches=f.stats.discoveries, starts=f.started.length;
    for (let i=0;i<10;i++) f.tick();
    assert.equal(f.stats.discoveries,searches);assert.equal(f.started.length,starts);
  }
});

test("priority change cancels pending locks and an old approach; same priority leaves mining alone", () => {
  const f=fixture({count:1,pending:true});
  f.command('automining on');f.tick();assert(f.ship.pendingTargetLocks.has(11));
  f.command('automining furthest');assert.equal(f.ship.pendingTargetLocks.size,0);
  f.tick(1);assert(f.ship.pendingTargetLocks.has(13));
  f.lock();f.tick();
  const starts=f.started.length,removed=f.removed.length;
  f.command('automining furthest');f.tick();
  assert.equal(f.started.length,starts);assert.equal(f.removed.length,removed);assert.equal(f.stopped.length,0);
  const g=fixture({count:1});volumes(g);
  g.command('automining largest');g.command('automining approach on');g.command('automining on');g.tick();
  assert.equal(g.ship.mode,'FOLLOW');
  g.command('automining smallest');assert.equal(g.ship.mode,'STOP');g.tick(1);
  assert.deepEqual(g.started,[[1,11]]);
});

test("priority changes while off or docked only save the choice", () => {
  const f=fixture({count:1});
  f.ship.lockedTargets.set(11,{});f.ship.activeModuleEffects.set(1,{targetID:11});
  f.command('automining largest');
  assert(f.ship.activeModuleEffects.has(1));assert.equal(f.removed.length,0);
  f.setShip(null);f.command('automining on');f.command('automining smallest');
  assert.equal(f.controller.snapshot(f.session).settings.order,'smallest');
  assert.equal(f.stopped.length,0);assert.equal(f.removed.length,0);
});

function boostedFixture(options={}) {
  const f=fixture(options); let boost=1;
  const originalModules=f.api.modules;
  f.api.modules=()=>originalModules().map(m=>({...m, range:m.range*boost, snapshot:{maxRangeMeters:m.snapshot.maxRangeMeters*boost}}));
  f.api.boostSignature=()=>String(boost);
  f.setBoost=value=>{boost=value;};
  return f;
}

test("boosted effective range includes distant ore without moving; expiry excludes it", () => {
  const f=boostedFixture({count:1}); volumes(f); f.setBoost(2);
  f.command('automining largest'); f.command('automining on'); f.tick();
  assert.deepEqual(f.started,[[1,14]]); assert.equal(f.approaches.length,0);
  f.setBoost(1); f.tick();
  assert.deepEqual(f.stopped,[1]); assert.equal(f.started.at(-1)[1],13);
  assert.equal(f.approaches.length,0);
});

test("boost gain wakes a backed-off idle miner before the five-second retry", () => {
  const f=boostedFixture({count:1}); f.rocks.forEach(r=>r.distance+=120);
  f.command('automining on'); f.tick(); assert.equal(f.started.length,0);
  f.setBoost(2); f.tick(); assert.equal(f.started.length,1);
});

test("approach range updates on boosts, honours the shortest compatible miner and stops once reachable", () => {
  const f=boostedFixture({count:2}); volumes(f);
  f.modules[0].range=50; f.modules[0].snapshot.maxRangeMeters=50;
  f.command('automining largest'); f.command('automining approach on'); f.command('automining on'); f.tick();
  assert.deepEqual(f.approaches,[[14,45]]);
  f.setBoost(2); f.tick(); assert.deepEqual(f.approaches.at(-1),[14,90]);
  f.setBoost(4); f.tick(); assert.equal(f.ship.mode,'STOP');
  assert.equal(f.started.length,2); assert(f.started.some(x=>x[1]===14));
});

test("volume ties break by distance then stable ID", () => {
  const {compareTargets}=require('../lib/targets');
  const rows=[{id:3,distance:10},{id:2,distance:10},{id:1,distance:20}].map(r=>({...r,state:{remainingQuantity:5,unitVolume:2}}));
  for (const order of ['largest','smallest']) assert.deepEqual([...rows].sort(compareTargets(order)).map(r=>r.id),[2,3,1]);
});

test("volume settings persist through HUD, character reload and Launcher presets", () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {createPreferences}=require('../lib/preferences');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'automining-volume-'));
  try {
    const filename=path.join(dir,'prefs.json');
    const f=fixture({preferences:createPreferences(filename)});
    const before=f.controller.snapshot(f.session);
    f.controller.applySettings(f.session,JSON.stringify({revision:before.revision,settings:{...before.settings,order:'largest',approach:true}}));
    assert.equal(createPreferences(filename).get(42).order,'largest');
    assert.equal(createPreferences(filename).get(43).order,'nearest');
    f.controller.applyProfile(f.session,JSON.stringify({apply:true,ores:'',order:'smallest',approach:false,lock:true,survey:false}));
    assert.equal(createPreferences(filename).get(42).order,'smallest');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test("case-insensitive slash, exclamation and plain commands; only exact command name", () => {
  for (const p of ["/", "!", ""]) assert.deepEqual(parse(`${p}AuToMiNiNg ON`), { action: "on" });
  assert.equal(parse("!autominingdrones on"), null);
  assert.equal(parse("hi automining on"), null);
  assert.deepEqual(parse("/AutoMining Veldspar, Scordite,veldspar"), { action: "filter", ores: ["veldspar", "scordite"] });
  assert.equal(parse("/AutoMining veldspar,,scordite").action, "help");
});
test("whole-word ore families include variants without accidental substring matches", () => {
  assert(matchesOre("Dense Veldspar", ["veldspar"]));
  assert(matchesOre("Veldspar 0-Grade", ["veldspar"]));
  assert(matchesOre("Veldspar II-Grade", ["veldspar"]));
  assert(matchesOre("Veldspar 0-Grade", ["veldspar 0-grade"]));
  assert(!matchesOre("Veldspar II-Grade", ["veldspar 0-grade"]));
  assert(!matchesOre("Veldspar", ["spar"]));
  assert(matchesOre("Scordite", []));
});
test("default off; on spreads three modules over nearest in-range rocks", () => {
  const f = fixture(); f.tick(); assert.equal(f.started.length, 0);
  f.command("/automining on"); f.tick();
  assert.deepEqual(f.started, [[1, 11], [2, 12], [3, 13]]);
});
test("exhaust unique rocks first, then share nearest; never mine out of range", () => {
  const f = fixture({ count: 4 }); f.command("!automining on"); f.tick();
  assert.deepEqual(f.started.map(x => x[1]), [11, 12, 13, 11]);
});
test("furthest selects in-range rocks in reverse order then shares furthest", () => {
  const f = fixture({ count: 4 }); f.command("automining furthest"); f.command("automining on"); f.tick();
  assert.deepEqual(f.started.map(x => x[1]), [13, 12, 11, 13]);
  f.finish(); f.command("automining nearest"); f.tick();
  assert.deepEqual(f.started.slice(4).map(x => x[1]), [11, 12, 13, 11]);
});
test("filter replaces list; clear restores all; neither changes on/off", () => {
  const f = fixture(); f.command("automining veldspar,scordite");
  assert.match(f.command("automining scordite"), /filter: scordite\. OFF/);
  f.tick(); assert.equal(f.started.length, 0);
  f.command("automining on"); f.tick(); assert.deepEqual(f.started.map(x => x[1]), [13, 13, 13]);
  f.finish(); f.command("automining clear"); f.tick(); assert.deepEqual(f.started.slice(3).map(x => x[1]), [11, 12, 13]);
});
test("no matching rocks waits without ignoring the filter", () => {
  const f = fixture(); f.command("automining arkonor"); f.command("automining on"); f.tick();
  assert.equal(f.started.length, 0);
});
test("wait for real locks, reserve separate targets, and off cancels owned pending locks", () => {
  const f = fixture({ pending: true }); f.command("automining on"); f.tick(); f.tick();
  assert.equal(f.started.length, 0); assert.equal(f.ship.pendingTargetLocks.size, 3);
  f.lock(); f.tick(); assert.deepEqual(f.started.map(x => x[1]), [11, 12, 13]);
  const g = fixture({ pending: true }); g.command("automining on"); g.tick(); g.command("automining off");
  assert.equal(g.ship.pendingTargetLocks.size, 0); g.tick(); assert.equal(g.started.length, 0);
});
test("depletion retargets; full hold waits and automatically resumes after unloading", () => {
  const f = fixture(); f.command("automining on"); f.tick(); f.finish(); f.rocks[0].quantity = 0; f.tick();
  assert.deepEqual(f.started.slice(3).map(x => x[1]), [12, 13, 12]);
  f.finish(); f.setFree(false); f.tick(); assert.equal(f.started.length, 6);
  f.setFree(true); f.tick(5000); assert.equal(f.started.length, 9);
});
test("off stops only its own module activations and preserves manual targets", () => {
  const f = fixture({ count: 2 }); f.ship.lockedTargets.set(99, {});
  f.ship.activeModuleEffects.set(98, { targetID: 99 });
  f.command("automining on"); f.tick(); f.command("automining off"); f.tick();
  assert.deepEqual(f.stopped, [1, 2]); assert(f.ship.lockedTargets.has(99)); assert(f.ship.activeModuleEffects.has(98));
});
test("filter change stops owned wrong-ore cycles and changes subsequent targets", () => {
  const f = fixture(); f.command("automining on"); f.tick(); f.command("automining scordite"); f.tick();
  assert(f.stopped.includes(1) && f.stopped.includes(2));
  assert.deepEqual(f.started.slice(3).map(x => x[1]), [13, 13]);
});
test("different ranges/families keep restricted modules on compatible resources", () => {
  const f = fixture(); f.modules[0].range = 15;
  f.modules[2].family = "ice"; f.rocks[2].family = "ice";
  f.command("automining on"); f.tick();
  assert.deepEqual(new Map(f.started), new Map([[1, 11], [2, 12], [3, 13]]));
});
test("target capacity fallback shares usable locks without deleting manual targets", () => {
  const f = fixture({ cap: 2 }); f.ship.lockedTargets.set(99, {});
  f.command("automining on"); f.tick(); assert.deepEqual(f.started.map(x => x[1]), [11, 11, 11]);
  assert(f.ship.lockedTargets.has(99));
});
test("warp pauses and ship change resumes; per-session controls are isolated", () => {
  const f = fixture(); f.command("automining on"); f.ship.pendingWarp = {}; f.tick(); assert.equal(f.started.length, 0);
  f.ship.pendingWarp = null; f.tick(); assert.equal(f.started.length, 3);
  f.finish(); f.ship.itemID = 101; f.tick(); assert.match(f.command("automining"), /ON/);
  const second = { characterID: 43 }; assert.match(f.controller.command(second, parse("automining")), /OFF, nearest, filter: all/);
});
test("ordinary chat is consumed privately; unrelated chat passes through", () => {
  const calls = []; const f = fixture();
  const chat = { broadcastLocalMessage: (...args) => calls.push(args), sendChannelMessage: (...args) => calls.push(args) };
  installPlainChat(chat, f.controller);
  assert.throws(() => chat.broadcastLocalMessage(f.session, "!AutoMining on"), /AutoMining ON/);
  assert.throws(() => chat.sendChannelMessage(f.session, "corp", "AUTOMINING furthest"), /furthest/);
  chat.broadcastLocalMessage(f.session, "hello"); assert.equal(calls.length, 1);
  const slash = { executeChatCommand: () => "original", AVAILABLE_SLASH_COMMANDS: [] };
  installChat(slash, f.controller);
  assert.equal(slash.executeChatCommand(f.session, "/other"), "original");
  assert.equal(slash.executeChatCommand(f.session, "/AutoMining off").handled, true);
});
test("switching characters on a reused session cannot inherit automation or filters", () => {
  const f = fixture(); f.command("automining veldspar"); f.command("automining on");
  f.session.characterID = 99; f.tick();
  assert.equal(f.started.length, 0);
  assert.match(f.command("automining"), /OFF, nearest, filter: all/);
});
test("on takes over existing mining cycles but repeated on is idempotent", () => {
  const f = fixture({ count: 1 });
  f.ship.activeModuleEffects.set(1, { moduleID: 1, targetID: 13 });
  f.command("automining on"); assert.deepEqual(f.stopped, [1]); f.tick();
  f.command("automining on"); assert.deepEqual(f.stopped, [1]);
});
test("preferences survive a new store/login without enabling automation", () => {
  const fs = require("node:fs"), path = require("node:path");
  const { createPreferences } = require("../lib/preferences");
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "automining-prefs-"));
  try {
    const file = path.join(root, "prefs.json");
    createPreferences(file).save(42, { order: "furthest", ores: ["veldspar", "scordite"] });
    const store = createPreferences(file);
    const controller = createController(() => null, () => null, console.error, store);
    assert.match(controller.command({ characterID: 42 }, parse("automining")), /OFF, furthest, filter: veldspar, scordite/);
    assert.deepEqual(store.get(43), { enabled: false, order: "nearest", ores: [], approach: false, compress: false, lock: true, survey: false, surveySeconds: 60,
      haulEnabled: false, haulThreshold: 95, stationID: 0, storageKey: "personal", haulInterrupted: false,
      defenseEnabled: false, defenseShieldEnabled: true, defenseShieldThreshold: 30, defenseArmorEnabled: false, defenseArmorThreshold: 30,
      recallDrones: true, launchDrones: false, droneGroupKey: "",
      mineDrones: false, mineDroneOrder: "nearest", mineDroneMode: "spread",
      autoBoost: false, inviteFleet: false, ratDefenseEnabled: false, ratMiningGroupKey: "", ratFighterGroupKey: "" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("mixed crystal eligibility finds separate rocks when a greedy assignment would share", () => {
  const { planDistinct } = require("../lib/targets");
  const a = { id: 11 }, b = { id: 12 }, c = { id: 13 };
  const rows = [
    { item: { itemID: 1 }, targets: [a, b] },
    { item: { itemID: 2 }, targets: [a, c] },
    { item: { itemID: 3 }, targets: [a, c] },
  ];
  const result = planDistinct(rows, new Set());
  assert.equal(result.size, 3);
  assert.equal(new Set([...result.values()].map(x => x.id)).size, 3);
  assert.equal(result.get(1).id, 12);
});
test("all four toggles parse case-insensitively and persist without turning mining on", () => {
  for (const setting of ["approach", "lock", "survey", "compress"]) {
    assert.deepEqual(parse(`!AutoMining ${setting.toUpperCase()} On`), { action: "toggle", setting, enabled: true });
    assert.equal(parse(`AutoMining ${setting} maybe`).action, setting === "survey" ? "error" : "help");
  }
  const f = fixture(); f.command("automining approach on"); f.command("automining survey off");
  assert.match(f.command("automining"), /OFF.*Approach ON, lock ON, survey OFF/);
  f.tick(); assert.equal(f.started.length, 0);
});
test("lock off uses manual locks only; turning it off cancels owned pending locks", () => {
  const f = fixture(); f.command("automining lock off"); f.command("automining on"); f.tick();
  assert.equal(f.ship.lockedTargets.size, 0); assert.equal(f.started.length, 0);
  f.ship.lockedTargets.set(12, {}); f.tick(); assert.deepEqual(f.started.map(x => x[1]), [12, 12, 12]);
  const g = fixture({ pending: true }); g.command("automining on"); g.tick(); g.command("automining lock off");
  assert.equal(g.ship.pendingTargetLocks.size, 0); g.tick(); assert.equal(g.ship.pendingTargetLocks.size, 0);
});
test("approach is opt-in, respects filter/order, does not spam movement, and stops in range", () => {
  const f = fixture(); f.rocks.forEach(r => r.distance += 200);
  f.command("automining on"); f.tick(); assert.equal(f.approaches.length, 0);
  f.command("automining veldspar"); f.command("automining furthest"); f.command("automining approach on"); f.tick();
  assert.deepEqual(f.approaches, [[12, 90]]); f.tick(); assert.equal(f.approaches.length, 1);
  f.rocks[1].distance = 80; f.tick(); assert.equal(f.ship.mode, "STOP"); assert.equal(f.started.length, 3);
});
test("approach toggle/off stops its own movement; manual steering wins; full hold does not chase ore", () => {
  const f = fixture(); f.rocks.forEach(r => r.distance += 200);
  f.command("automining approach on"); f.command("automining on"); f.tick();
  f.command("automining approach off"); assert.equal(f.ship.mode, "STOP");
  f.command("automining approach on"); f.tick(); f.ship.mode = "GOTO"; f.tick();
  assert.equal(f.ship.mode, "GOTO"); assert.match(f.command("automining"), /Approach OFF/);
  f.command("automining approach on"); f.setFree(false); f.tick(); assert.equal(f.approaches.length, 2);
  f.setFree(true); f.tick(5000); f.command("automining off"); assert.equal(f.ship.mode, "STOP");
});
test("native survey request repeats at 60 seconds and respects survey/main off", () => {
  const f = fixture(); f.command("automining survey on"); f.controller.clientReady(f.session);
  f.command("automining on"); f.tick(); assert.deepEqual(f.scans, [1000]);
  f.tick(59_000); assert.equal(f.scans.length, 1);
  f.tick(); assert.deepEqual(f.scans, [1000, 61000]);
  f.command("automining survey off"); f.tick(60_000); assert.equal(f.scans.length, 2);
  f.command("automining survey on"); f.tick(); assert.equal(f.scans.length, 3);
  f.controller.surveyAck(f.session, true, ""); assert.match(f.command("automining"), /Surveyor refreshed/);
  f.command("automining off"); f.tick(60_000); assert.equal(f.scans.length, 3);
});
test("survey waits for client handshake and pauses during warp", () => {
  const f = fixture(); f.command("automining survey on"); f.command("automining on"); f.tick();
  assert.match(f.command("automining"), /needs the AutoMining client companion/);
  assert.equal(f.scans.length, 0);
  f.controller.clientReady(f.session);
  f.ship.pendingWarp = {}; f.tick(60_000); assert.equal(f.scans.length, 0);
  f.ship.pendingWarp = null; f.tick(); assert.equal(f.scans.length, 1);
  f.controller.surveyAck(f.session, false, "not in space");
  assert.match(f.command("automining"), /Survey waiting: not in space/);
});

test('arrival survey rejected by the client retries at the rate limit, then resumes the saved interval', () => {
  for (const reason of ['ship is warping', 'not in space', 'a survey is already running']) {
    const f=fixture();
    f.command('automining survey 180'); f.command('automining survey on');
    f.controller.clientReady(f.session); f.command('automining on'); f.tick();
    assert.deepEqual(f.scans,[1000]);
    f.controller.surveyAck(f.session,false,Buffer.from(reason));
    f.tick(5000); assert.deepEqual(f.scans,[1000]);
    f.tick(); assert.deepEqual(f.scans,[1000,7000]);
    f.controller.surveyAck(f.session,false,{type:'wstring',value:reason});
    f.tick(5000); assert.equal(f.scans.length,2);
    f.tick(); assert.deepEqual(f.scans,[1000,7000,13000]);
    f.controller.surveyAck(f.session,true,'');
    f.tick(179000); assert.equal(f.scans.length,3);
    f.tick(); assert.deepEqual(f.scans,[1000,7000,13000,193000]);
    assert.equal(f.controller.snapshot(f.session).settings.surveySeconds,180);
  }
});

test('pending arrival survey retry respects Stop, survey off, warp and docking', () => {
  for (const pause of [f=>f.command('automining off'), f=>f.command('automining survey off'),
    f=>{f.ship.pendingWarp={};}, f=>f.setShip(null)]) {
    const f=fixture(); f.command('automining survey 180'); f.command('automining survey on');
    f.controller.clientReady(f.session); f.command('automining on'); f.tick();
    f.controller.surveyAck(f.session,false,'ship is warping'); pause(f);
    f.tick(6000); f.tick(180000); assert.deepEqual(f.scans,[1000]);
  }
});

test('permanent survey errors keep the configured interval rather than repeatedly retrying', () => {
  for (const reason of ['Mining Surveyor is unavailable on this ship','Mining Surveyor command failed','unknown failure']) {
    const f=fixture(); f.command('automining survey 180'); f.command('automining survey on');
    f.controller.clientReady(f.session); f.command('automining on'); f.tick();
    f.controller.surveyAck(f.session,false,Buffer.from(reason));
    f.tick(6000); assert.deepEqual(f.scans,[1000]);
    f.tick(174000); assert.deepEqual(f.scans,[1000,181000]);
  }
});

test("warp request interrupts deferred cycles and pending locks without cancelling warp or changing saved On", () => {
  const saved=[];const f=fixture({count:1,deferred:true,preferences:{get:()=>({}),save:(_,s)=>saved.push(s.enabled)}});
  f.command('automining on');f.tick();
  f.ship.lockedTargets.set(99,{});
  f.ship.pendingWarp={};f.tick(1);
  assert.deepEqual(f.removed,[11]);assert.equal(f.ship.activeModuleEffects.size,0);
  assert(f.ship.lockedTargets.has(99));assert(f.ship.pendingWarp);
  assert.equal(f.controller.snapshot(f.session).enabled,true);assert.deepEqual(saved,[true]);
  const builds=f.stats.modules;
  for(let i=0;i<10;i++)f.tick();
  assert.equal(f.stats.modules,builds);assert.equal(f.stopped.length,1);
  const g=fixture({count:1,pending:true});g.command('automining on');g.tick();
  g.ship.pendingWarp={};g.tick(1);assert.equal(g.ship.pendingTargetLocks.size,0);
});

test("cancelled warp resumes mining automatically at the current site; Stop during warp stays off", () => {
  const f=fixture({count:1,deferred:true});f.command('automining on');f.tick();
  f.ship.pendingWarp={};f.tick(1);assert.equal(f.started.length,1);
  f.ship.pendingWarp=null;f.tick();assert.equal(f.started.length,2);
  assert.equal(f.controller.snapshot(f.session).enabled,true);
  f.ship.pendingWarp={};f.tick();f.command('automining off');f.ship.pendingWarp=null;
  f.tick(60000);assert.equal(f.started.length,2);assert.equal(f.controller.snapshot(f.session).enabled,false);
});

test("cancelling warp never enables a pilot whose AutoMining was already off", () => {
  const f=fixture();
  f.command('automining off');
  f.ship.pendingWarp={};f.tick();f.ship.pendingWarp=null;f.tick();
  assert.equal(f.controller.snapshot(f.session).enabled,false);
  assert.equal(f.started.length,0);assert.equal(f.stopped.length,0);assert.equal(f.removed.length,0);
  assert.equal(f.stats.discoveries,0);assert.equal(f.stats.surveySearches,0);
  f.ship.mode='WARP';f.tick();f.ship.mode='STOP';f.tick();
  assert.equal(f.controller.snapshot(f.session).enabled,false);assert.equal(f.started.length,0);
});

test("warp pauses approach without Stop; arrival waits outside mining sites and resumes at a gas site", () => {
  let compression=0;
  const f=fixture({count:1,compress:()=>{compression++;return 'Compressed.';}});
  f.modules[0].family='gas';f.rocks.splice(0,f.rocks.length,{id:77,name:'Fullerite-C50',family:'gas',quantity:10,distance:150,grid:'belt'});
  f.command('automining approach on');f.command('automining survey on');f.command('automining compress on');
  f.controller.clientReady(f.session);f.command('automining on');f.tick();assert.equal(f.ship.mode,'FOLLOW');
  f.scene.stop=()=>assert.fail('AutoMining must not cancel the pilot warp');
  f.ship.pendingWarp={};f.tick(1);assert.equal(f.ship.mode,'FOLLOW');
  f.ship.mode='WARP';f.tick();f.ship.pendingWarp=null;f.ship.mode='STOP';f.ship.grid='station';f.tick();
  const scans=f.scans.length,compressions=compression,searches=f.stats.surveySearches;
  for(let i=0;i<20;i++)f.tick();
  assert.equal(f.scans.length,scans);assert.equal(compression,compressions);assert.equal(f.started.length,0);
  assert.equal(f.stats.surveySearches-searches,4);
  f.ship.grid='belt';f.rocks[0].distance=40;f.tick();
  assert.deepEqual(f.started,[[1,77]]);assert.equal(f.scans.length,scans+1);
});

test("gas filter selects matching clouds for gas harvesters; ore lasers cannot harvest them", () => {
  const f=fixture({count:3});
  f.modules[0].family='gas';f.modules[1].family='gas';
  f.rocks.splice(0,f.rocks.length,
    {id:71,name:'Fullerite-C50',family:'gas',quantity:10,distance:10},
    {id:72,name:'Fullerite-C50',family:'gas',quantity:10,distance:20},
    {id:73,name:'Fullerite-C60',family:'gas',quantity:10,distance:5});
  f.command('automining Fullerite-C50');f.command('automining on');f.tick();
  assert.deepEqual(f.started,[[1,71],[2,72]]);
  f.command('automining Fullerite-C60');f.tick();
  assert.deepEqual(f.started.slice(2),[[1,73],[2,73]]);
});

test("survey waits outside mining grids and scans on landing even before the old interval expires", () => {
  const f=fixture();f.ship.grid='station';
  f.command('automining survey 180');f.command('automining survey on');
  f.controller.clientReady(f.session);f.command('automining on');
  for(let i=0;i<60;i++)f.tick();
  assert.equal(f.scans.length,0);assert.equal(f.stats.surveySearches,12);
  f.ship.mode='WARP';f.ship.grid='belt';f.tick();assert.equal(f.scans.length,0);
  f.ship.mode='STOP';f.tick();assert.deepEqual(f.scans,[62000]);
  f.ship.mode='WARP';f.tick();f.ship.mode='STOP';f.ship.grid='station';f.tick();
  f.tick(10000);assert.equal(f.scans.length,1);
  f.ship.grid='belt';f.tick();assert.deepEqual(f.scans,[62000,75000]);
  f.tick(179000);assert.equal(f.scans.length,2);
  f.tick();assert.equal(f.scans.length,3);
});

test("survey recognises ore anomalies, ice and gas independently of mining filters and module range", () => {
  for(const family of ['ore','ice','gas']) {
    const f=fixture();f.rocks.splice(0,f.rocks.length,{id:77,name:'Site resource',family,grid:'anomaly',distance:9999,quantity:10});
    f.ship.grid='anomaly';f.command('automining veldspar');
    f.command('automining survey on');f.controller.clientReady(f.session);f.command('automining on');
    for(let i=0;i<120;i++)f.tick();
    assert.deepEqual(f.scans,[1000,61000]);assert.equal(f.started.length,0);
    assert.equal(f.stats.surveySearches,1);
    f.rocks[0].quantity=0;f.tick();assert.equal(f.scans.length,2);
    f.tick(60000);assert.equal(f.scans.length,2);
    f.rocks[0].quantity=10;f.tick(5000);assert.equal(f.scans.length,3);
  }
});

test("fast grid transitions respect survey rate limits and survey off does no site checks", () => {
  const f=fixture();f.command('automining on');f.controller.clientReady(f.session);f.tick();
  assert.equal(f.stats.surveySearches,0);assert.equal(f.stats.surveyLookups,0);
  f.command('automining survey on');f.tick();assert.deepEqual(f.scans,[2000]);
  f.ship.mode='WARP';f.tick();f.ship.mode='STOP';f.tick();
  assert.equal(f.scans.length,1);
  f.tick(4000);assert.deepEqual(f.scans,[2000,8000]);
  f.command('automining survey off');const searches=f.stats.surveySearches,lookups=f.stats.surveyLookups;
  f.tick(60000);assert.equal(f.stats.surveySearches,searches);assert.equal(f.stats.surveyLookups,lookups);
});
test("changing filter unlocks excluded rocks immediately even for deferred mining cycles", () => {
  const f = fixture({ deferred: true }); f.ship.lockedTargets.set(99, {});
  f.command("automining on"); f.tick();
  const matching = f.ship.activeModuleEffects.get(3);
  f.command("automining scordite");
  assert.deepEqual(f.removed, [11, 12]);
  assert.equal(f.ship.activeModuleEffects.size, 1);
  assert.equal(f.ship.activeModuleEffects.get(3), matching);
  assert(f.ship.lockedTargets.has(99)); assert(f.ship.lockedTargets.has(13));
  f.tick(); assert.deepEqual(f.started.slice(3), [[1,13],[2,13]]);
});
test("filter cancels excluded pending locks immediately and off only saves preferences", () => {
  const f = fixture({pending:true}); f.command("automining on"); f.tick();
  f.command("automining scordite"); assert.deepEqual([...f.ship.pendingTargetLocks.keys()], [13]);
  const g = fixture(); g.ship.lockedTargets.set(11,{});
  g.command("automining scordite"); assert(g.ship.lockedTargets.has(11));
});
test("unchanged Launcher profile does not reset later in-game settings across login/update", () => {
  const fs = require("node:fs"), path = require("node:path");
  const { createPreferences } = require("../lib/preferences");
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "automining-profile-"));
  try {
    const file = path.join(root, "prefs.json");
    const make = () => createController(() => null, () => null, console.error, createPreferences(file));
    const session = {characterID:42};
    const profile = {apply:true, ores:"veldspar", order:"furthest", lock:true, survey:false, approach:false};
    let controller = make(); assert(controller.applyProfile(session, JSON.stringify(profile)));
    controller.command(session, parse("automining scordite"));
    const bytes = fs.readFileSync(file);
    controller = make(); assert.equal(controller.applyProfile(session, JSON.stringify(profile)),false);
    assert.deepEqual(fs.readFileSync(file),bytes);
    assert.match(controller.command(session,parse("automining")), /OFF, furthest, filter: scordite/);
    assert(controller.applyProfile(session,JSON.stringify({...profile,order:"nearest"})));
    assert.match(controller.command(session,parse("automining")), /OFF, nearest, filter: veldspar/);
    assert.throws(()=>controller.applyProfile(session,JSON.stringify({...profile,order:"bad"})), /Invalid/);
    assert.match(controller.command({characterID:43},parse("automining")), /OFF, nearest, filter: all/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test("compression is opt-in, runs every ten seconds, and stops on travel/main off",()=>{
  let count=0; const f=fixture({compress:()=>{count++;return "Compressed.";}});
  f.command("automining on"); f.tick(); assert.equal(count,0);
  f.command("automining compress on"); f.tick(); assert.equal(count,1);
  f.tick(9000); assert.equal(count,1); f.tick(); assert.equal(count,2);
  f.ship.pendingWarp={}; f.tick(10000); assert.equal(count,2);
  f.ship.pendingWarp=null;f.command("automining compress off");f.tick();assert.equal(count,2);
  f.command("automining compress on");f.command("automining off");f.tick();assert.equal(count,2);
});
test("survey intervals accept whole seconds within native rate limits and reject malformed input",()=>{
  for(const prefix of ["!","/",""]) assert.deepEqual(parse(`${prefix}AuToMining SuRvEy 30`),{action:"surveyInterval",seconds:30});
  assert.deepEqual(parse("automining survey interval 120"),{action:"surveyInterval",seconds:120});
  for(const input of ["0","5","-1","6.5","NaN","Infinity","86401","30 seconds"])
    assert.equal(parse(`automining survey ${input}`).action,"error");
  for(const seconds of [6,60,86400])assert.equal(parse(`automining survey ${seconds}`).seconds,seconds);
  const f=fixture();f.command("automining survey off");
  assert.match(f.command("automining survey 30"),/30 seconds\. Survey OFF; main automation OFF/);
  assert.match(f.command("automining survey 0"),/whole number/);
  assert.match(f.command("automining"),/survey OFF \(30s\)/);
});
test("new survey interval reschedules against last scan without duplicate immediate scans",()=>{
  const f=fixture();f.command("automining survey on");f.controller.clientReady(f.session);f.command("automining on");f.tick();
  f.tick(15000);f.command("automining survey 30");f.tick(14000);assert.deepEqual(f.scans,[1000]);
  f.tick();assert.deepEqual(f.scans,[1000,31000]);
  f.command("automining survey 120");f.tick(119000);assert.equal(f.scans.length,2);
  f.tick();assert.deepEqual(f.scans,[1000,31000,151000]);
  f.controller.surveyAck(f.session,true,"");assert.match(f.command("automining"),/every 120 seconds/);
  f.command("automining survey off");f.command("automining survey 6");f.tick(120000);assert.equal(f.scans.length,3);
});
test("custom survey interval persists per character and legacy presets do not reset in-game settings",()=>{
  const fs=require("node:fs"),path=require("node:path"),{createPreferences}=require("../lib/preferences");
  const root=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"automining-interval-"));
  try {
    const file=path.join(root,"prefs.json"),profile={apply:true,ores:"veldspar",order:"furthest",lock:true,survey:true,approach:false,compress:false};
    const legacyStamp=JSON.stringify([["veldspar"],"furthest",true,true,false,false]);
    fs.writeFileSync(file,JSON.stringify({schemaVersion:1,characters:{42:{ores:["scordite"],order:"nearest",survey:true,profileStamp:legacyStamp}}}));
    const make=()=>createController(()=>null,()=>null,console.error,createPreferences(file));
    let c=make();const session={characterID:42},before=fs.readFileSync(file);
    assert.equal(c.applyProfile(session,JSON.stringify({...profile,surveySeconds:60})),false);
    assert.deepEqual(fs.readFileSync(file),before);
    assert.match(c.command(session,parse("automining")),/filter: scordite.*survey ON \(60s\)/);
    c.command(session,parse("automining survey 45"));c=make();
    assert.match(c.command(session,parse("automining")),/OFF.*survey ON \(45s\)/);
    assert.match(c.command({characterID:43},parse("automining")),/survey OFF \(60s\)/);
    assert.equal(c.applyProfile(session,JSON.stringify({...profile,surveySeconds:60})),false);
    assert(c.applyProfile(session,JSON.stringify({...profile,surveySeconds:90})));
    assert.equal(createPreferences(file).get(42).surveySeconds,90);
    assert.throws(()=>c.applyProfile(session,JSON.stringify({...profile,surveySeconds:1})),/Invalid.*interval/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("persistent On resumes after dock, logout, server restart and ship changes; Stop persists",()=>{
  const records=new Map();const preferences={get:id=>records.get(id)||{},save:(id,s)=>records.set(id,{enabled:s.enabled,ores:[...s.ores],survey:s.survey,surveySeconds:s.surveySeconds})};
  const f=fixture({preferences});f.setShip(null);
  assert.match(f.command("automining on"),/resume when you undock/);assert.equal(records.get(42).enabled,true);
  f.tick();assert.equal(f.started.length,0);
  f.setShip(f.ship);f.tick();assert.equal(f.started.length,3);
  const relog=fixture({preferences});relog.tick();assert.equal(relog.started.length,3);
  relog.setShip(null);relog.tick();assert.equal(relog.controller.snapshot(relog.session).enabled,true);
  relog.setShip(relog.ship);relog.ship.itemID=200;relog.tick();assert.equal(relog.controller.snapshot(relog.session).enabled,true);
  relog.command("automining off");assert.equal(records.get(42).enabled,false);
  const stopped=fixture({preferences});stopped.tick();assert.equal(stopped.started.length,0);
});
test("working modules and successive valid cycles reuse targets without rescanning the scene",()=>{
  const f=fixture();f.command("automining on");f.tick();assert.equal(f.stats.discoveries,1);
  for(let i=0;i<120;i++)f.tick();assert.equal(f.stats.discoveries,1);
  for(let i=0;i<5;i++){f.finish();f.tick();}assert.equal(f.stats.discoveries,1);
  f.finish();f.rocks[0].quantity=0;f.tick();assert.equal(f.stats.discoveries,2);
  f.command("automining scordite");f.tick();assert(f.stats.discoveries>2);
});
test("an empty scene backs off discovery and survey waits for resources",()=>{
  const f=fixture();f.rocks.forEach(r=>r.quantity=0);f.controller.clientReady(f.session);
  f.command("automining on");for(let i=0;i<60;i++)f.tick();
  assert.equal(f.stats.discoveries,12);assert.equal(f.scans.length,0);
  f.command("automining survey 6");f.command("automining survey on");f.tick();f.tick(6000);
  assert.equal(f.scans.length,0);
  assert.match(f.controller.snapshot(f.session).status,/Survey waiting: no ore, ice or gas/);
});
test("HUD settings validate atomically, preserve main state, and reject stale drafts",()=>{
  const f=fixture();const before=f.controller.snapshot(f.session);
  assert.equal(before.settings.survey,false);
  assert.throws(()=>f.controller.applySettings(f.session,JSON.stringify({revision:before.revision,settings:{...before.settings,ores:["scordite"],surveySeconds:0}})),/Invalid/);
  assert.deepEqual(f.controller.snapshot(f.session),before);
  f.command("automining on");f.tick();
  assert.match(f.controller.applySettings(f.session,JSON.stringify({revision:before.revision,settings:{...before.settings,ores:["scordite"],survey:true,surveySeconds:30}})),/applied/);
  assert.equal(f.controller.snapshot(f.session).enabled,true);assert.deepEqual(f.removed,[11,12]);
  assert.throws(()=>f.controller.applySettings(f.session,JSON.stringify({revision:before.revision,settings:before.settings})),/changed elsewhere/);
});
test("haul trigger is configurable per character and rejects invalid percentages", () => {
  const fs = require("node:fs"), path = require("node:path");
  const { createPreferences } = require("../lib/preferences");
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "automining-threshold-"));
  try {
    const file = path.join(root, "prefs.json"), f = fixture({preferences: createPreferences(file)});
    const before = f.controller.snapshot(f.session);
    assert.equal(before.settings.haulThreshold, 95);
    for (const invalid of [0, 101, 80.5, "80"]) {
      assert.throws(() => f.controller.applySettings(f.session, JSON.stringify({revision: before.revision,
        settings: {...before.settings, haulThreshold: invalid}})), /Invalid return-to-station/);
    }
    f.controller.applySettings(f.session, JSON.stringify({revision: before.revision,
      settings: {...before.settings, haulThreshold: 80}}));
    assert.equal(f.controller.snapshot(f.session).settings.haulThreshold, 80);
    const restored = fixture({preferences: createPreferences(file)});
    assert.equal(restored.controller.snapshot(restored.session).settings.haulThreshold, 80);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
test("bare command opens HUD only when the client advertises support; status remains a shortcut",()=>{
  const f=fixture(),events=[];f.session.sendNotification=(...args)=>events.push(args);
  assert.match(f.command("automining"),/OFF/);assert.equal(events.length,0);
  f.controller.clientReady(f.session,true);assert.match(f.command("/automining"),/opened/);
  assert.deepEqual(events,[["OnAutoMiningOpen","clientID",[]]]);
  assert.match(f.command("!automining status"),/OFF/);assert.equal(events.length,1);
});
test("changed survey default does not reapply an unchanged legacy Launcher preset",()=>{
  const oldStamp=JSON.stringify([["veldspar"],"nearest",true,true,false,false]);
  const preferences={get:()=>({survey:true,ores:["scordite"],profileStamp:oldStamp}),save:()=>assert.fail("must not overwrite preferences")};
  const f=fixture({preferences});
  assert.equal(f.controller.applyProfile(f.session,JSON.stringify({apply:true,ores:"veldspar",order:"nearest",lock:true,survey:false,surveyDefaulted:true,approach:false,compress:false,surveySeconds:60})),false);
  assert.equal(f.controller.snapshot(f.session).settings.survey,true);
  assert.deepEqual(f.controller.snapshot(f.session).settings.ores,["scordite"]);
});

test("a full hold immediately releases ore locks and pending locks, preserves ships and resumes after unloading",()=>{
  const f=fixture({deferred:true});f.ship.lockedTargets.set(99,{});
  f.ship.activeModuleEffects.set(98,{targetID:99});
  f.command("automining on");f.tick();assert.equal(f.started.length,3);
  f.setFree(false);f.tick();
  assert.deepEqual(f.removed,[11,12,13]);
  assert.deepEqual([...f.ship.lockedTargets.keys()],[99]);
  assert.deepEqual([...f.ship.activeModuleEffects.keys()],[98]);
  assert.equal(f.controller.snapshot(f.session).enabled,true);
  f.setFree(true);f.tick(5000);assert.equal(f.started.length,6);
  const pending=fixture({pending:true});pending.command("automining on");pending.tick();
  assert.equal(pending.ship.pendingTargetLocks.size,3);
  pending.setFree(false);pending.tick();assert.equal(pending.ship.pendingTargetLocks.size,0);
  assert.equal(pending.started.length,0);
});

test("command feedback uses an independent notification after the new client handshake",()=>{
  const f=fixture(),events=[];f.session.sendNotification=(...args)=>events.push(args);
  assert.equal(f.controller.feedback(f.session,"before handshake"),false);
  f.controller.clientReady(f.session,true);
  const reply=f.command("/automining survey on");f.controller.feedback(f.session,reply);
  assert.deepEqual(events,[["OnAutoMiningFeedback","clientID",[reply]]]);
  assert.equal(f.controller.snapshot(f.session).settings.survey,true);
});

test("HUD RPCs isolate characters, return structured errors and load the catalog only on request",()=>{
  const f=fixture(),{installHUD}=require("../lib/hud");let reads=0;
  class Service {}
  installHUD(Service,f.controller,()=>{reads++;return [{name:"Veldspar",kind:"ore"}];});
  const service=new Service(),rpc=(name,args=[],session=f.session)=>JSON.parse(service['Handle_'+name](args,session));
  const initial=rpc("AutoMiningGetState",[true]);assert.equal(reads,1);assert.equal(initial.catalog.length,1);
  rpc("AutoMiningGetState",[false]);assert.equal(reads,1);
  const changed=rpc("AutoMiningSetSettings",[JSON.stringify({revision:initial.revision,settings:{...initial.settings,survey:true,surveySeconds:15}})]);
  assert.equal(changed.settings.surveySeconds,15);assert.equal(changed.settings.survey,true);
  assert.equal(rpc("AutoMiningGetState",[],{characterID:43}).settings.survey,false);
  assert.equal(rpc("AutoMiningControl",["destroy"]).success,false);
  assert.equal(rpc("AutoMiningSetSettings",["bad JSON"]).success,false);
  assert.equal(rpc("AutoMiningGetState",[],{}).success,false);
});

test("HUD client text representations save 180 seconds and start/stop while docked",()=>{
  const {installHUD}=require("../lib/hud");
  for (const encode of [value=>value, value=>Buffer.from(value), ...["wstring","token","rawstr"].map(type=>value=>({type,value}))]) {
    const records=new Map(),preferences={get:id=>records.get(id)||{},save:(id,s)=>records.set(id,{enabled:s.enabled,surveySeconds:s.surveySeconds,ores:[...s.ores]})};
    const f=fixture({preferences});f.setShip(null);
    class Service {}
    installHUD(Service,f.controller,()=>[]);
    const svc=new Service(),rpc=(name,value)=>JSON.parse(svc['Handle_'+name]([encode(value)],f.session));
    const before=f.controller.snapshot(f.session);
    const saved=rpc("AutoMiningSetSettings",JSON.stringify({revision:before.revision,settings:{...before.settings,surveySeconds:180}}));
    assert.equal(saved.success,true,saved.message);assert.equal(saved.settings.surveySeconds,180);
    assert.equal(records.get(42).surveySeconds,180);assert.equal(saved.enabled,false);
    const started=rpc("AutoMiningControl","on");assert.equal(started.success,true,started.message);assert.equal(started.enabled,true);
    assert.equal(records.get(42).enabled,true);assert.equal(started.settings.surveySeconds,180);
    const stopped=rpc("AutoMiningControl","off");assert.equal(stopped.success,true,stopped.message);assert.equal(stopped.enabled,false);
    assert.equal(records.get(42).enabled,false);assert.equal(stopped.settings.surveySeconds,180);
  }
});

test("HUD rejects malformed, oversized and stale client requests without overwriting settings",()=>{
  const f=fixture(),{installHUD}=require("../lib/hud");class Service {}
  installHUD(Service,f.controller,()=>[]);const svc=new Service(),before=f.controller.snapshot(f.session);
  for (const invalid of [null,123,{},[],{value:"{}"},{type:"wstring",value:123},Buffer.alloc(100001,32),Buffer.from("bad JSON")]) {
    const reply=JSON.parse(svc.Handle_AutoMiningSetSettings([invalid],f.session));assert.equal(reply.success,false);
    assert.deepEqual(f.controller.snapshot(f.session),before);
  }
  const reply=JSON.parse(svc.Handle_AutoMiningSetSettings([Buffer.from(JSON.stringify({revision:"stale",settings:{...before.settings,surveySeconds:180}}))],f.session));
  assert.equal(reply.success,false);assert.match(reply.message,/changed elsewhere/);assert.deepEqual(f.controller.snapshot(f.session),before);
});
