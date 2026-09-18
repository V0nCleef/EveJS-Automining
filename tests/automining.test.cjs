"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parse, matchesOre, installChat, installPlainChat } = require("../lib/commands");
const { createController } = require("../lib/controller");

function fixture({ count = 3, pending = false, cap = 10, deferred = false, compress = null, preferences = null } = {}) {
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
  const stats = {discoveries:0, modules:0, lookups:0};
  const api = {
    modules: () => {stats.modules++; return modules;},
    candidates: () => {stats.discoveries++;return rocks.filter(r => r.quantity > 0);},
    target: (_,__,id) => {stats.lookups++;return rocks.find(r=>r.id===id && r.quantity>0)||null;},
    hasRoom: (_,__,id) => rocks.some(r=>r.id===id) ? free : null,
    compatible: (_, __, module, rock, now, ignoreRange) => free && (ignoreRange || rock.distance <= module.range) && rock.family === (module.family || "ore"),
  };
  session.sendNotification = (event, scope, args) => { assert.equal(event, "OnAutoMiningSurvey"); assert.equal(scope, "clientID"); assert.deepEqual(args, []); scans.push(now); };
  const controller = createController(() => api, () => ({ getSceneForSession: () => spaceShip ? scene : null }), e => errors.push(e), preferences, compress);
  return { session, ship, modules, rocks, scene, started, stopped, removed, errors, controller, approaches, scans, stats, api,
    command: text => controller.command(session, parse(text)),
    tick(elapsed = 1000) { now += elapsed; controller.tick(scene, now); assert.deepEqual(errors, []); },
    finish() { ship.activeModuleEffects.clear(); },
    lock() { for (const id of ship.pendingTargetLocks.keys()) ship.lockedTargets.set(id, {}); ship.pendingTargetLocks.clear(); },
    setShip(value) { spaceShip = value; }, setFree(value) { free = value; },
  };
}

test("case-insensitive slash, exclamation and plain commands; only exact command name", () => {
  for (const p of ["/", "!", ""]) assert.deepEqual(parse(`${p}AuToMiNiNg ON`), { action: "on" });
  assert.equal(parse("!autominingdrones on"), null);
  assert.equal(parse("hi automining on"), null);
  assert.deepEqual(parse("/AutoMining Veldspar, Scordite,veldspar"), { action: "filter", ores: ["veldspar", "scordite"] });
  assert.equal(parse("/AutoMining veldspar,,scordite").action, "help");
});
test("whole-word ore families include variants without accidental substring matches", () => {
  assert(matchesOre("Dense Veldspar", ["veldspar"]));
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
    assert.deepEqual(store.get(43), { enabled: false, order: "nearest", ores: [], approach: false, compress: false, lock: true, survey: false, surveySeconds: 60 });
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
test("an empty scene backs off discovery; survey remains independent and defaults off",()=>{
  const f=fixture();f.rocks.forEach(r=>r.quantity=0);f.controller.clientReady(f.session);
  f.command("automining on");for(let i=0;i<60;i++)f.tick();
  assert.equal(f.stats.discoveries,12);assert.equal(f.scans.length,0);
  f.command("automining survey 6");f.command("automining survey on");f.tick();f.tick(6000);
  assert.equal(f.scans.length,2);
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
