"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createFleetCommand } = require("../lib/fleetCommand");
const { installHUD } = require("../lib/hud");
function fixture() {
  let time = 10000;
  const sessions = new Map([1,2,3,4].map(characterID => [characterID, { characterID, characterName: `Pilot ${characterID}`, socket: {} }]));
  const states = new Map([...sessions].map(([id]) => [id, { job: id === 3 ? "boosting" : "mining", enabled: false, ores: ["scordite"], lock: true, approach: false, order: "nearest", survey: false, compress: false, surveySeconds: 60 }]));
  const fleet = { fleetID: 90, leader: 1, members: new Map([1,2,3].map(id => [id, {}])) };
  const membership = new Map([1,2,3].map(id => [id, fleet]));
  const reset = [], controls = [];
  const service = createFleetCommand({ getFleet: id => membership.get(id), getSession: id => sessions.get(id),
    isFleetBoss: (f,id) => f.leader === id, state: s => states.get(s.characterID),
    command: (s,c) => { controls.push([s.characterID,c.action]); states.get(s.characterID).enabled = c.action === "on"; return ""; },
    stopFleet: (s,ids,recall) => { controls.push([ids[0],recall?"recall":"stop"]); if(!recall) states.get(ids[0]).enabled=false; return { recallFailed: 0, recallOrdered: 2 }; },
    reset: s => reset.push(s.characterID), catalog: () => [{name:"Veldspar"},{name:"Scordite"}], now: () => time++ * 2000 });
  return { service, sessions, states, fleet, membership, reset, controls,
    send: (action, pilots = [2], extra = {}) => service.action(sessions.get(1), { action, pilots, ...extra }) };
}
test("leader pushes an ordered temporary filter only to selected miners; personal state never changes", () => {
  const f=fixture(), s=f.sessions.get(2), personal=f.states.get(2);
  const result=f.send("filter", [2,3,4], { ores:["veldspar","scordite"] });
  assert.equal(result.pilots.find(row=>row.characterID===2).name,"Pilot 2");
  assert.equal(result.order.results[0].name,"Pilot 2");
  f.membership.delete(2);f.fleet.members.delete(2);
  assert.equal(f.service.view(f.sessions.get(1)).orders[0].results[0].name,"Pilot 2");
  f.membership.set(2,f.fleet);f.fleet.members.set(2,{});
  assert.deepEqual(result.order.results.map(row=>row.result),["applied","notMiner","notMember"]);
  assert.deepEqual(f.service.effective(s,personal),["veldspar","scordite"]);
  assert.deepEqual(personal.ores,["scordite"]);
  assert.deepEqual(f.reset,[2]);
  personal.ores=["veldspar"]; // a separate personal settings edit during override
  f.send("restore");
  assert.strictEqual(f.service.effective(s,personal),personal.ores);
  assert.deepEqual(personal.ores,["veldspar"]);
});
test("nonleaders cannot read roster, load source or issue any controls", () => {
  const f=fixture();
  for(const action of ["filter","restore","start","stop","recall"])
    assert.throws(()=>f.service.action(f.sessions.get(2),{action,pilots:[1],ores:["veldspar"]}),/current fleet leader/);
  assert.throws(()=>f.service.view(f.sessions.get(4)),/current fleet leader/);
  class Service {}
  installHUD(Service,{fleetCommand:f.service},()=>[]);
  const rpc=new Service();
  assert.equal(JSON.parse(rpc.Handle_AutoMiningFleetCommandSource([],f.sessions.get(2))).success,false);
  assert.deepEqual(f.controls,[]);
});
test("leaving, leader replacement, job switch and character reuse revoke temporary orders", () => {
  for(const mutate of [f=>f.membership.delete(2),f=>f.fleet.leader=3,f=>f.states.get(2).job="pve",f=>f.sessions.get(2).characterID=4]) {
    const f=fixture(),s=f.sessions.get(2),state=f.states.get(2);
    f.send("filter",[2],{ores:["veldspar"]}); mutate(f);
    assert.strictEqual(f.service.effective(s,state),state.ores);
  }
});
test("offline or forged recipients and invalid ore names cannot receive orders",()=>{
  const f=fixture();f.sessions.get(2).socket.destroyed=true;
  assert.equal(f.send("start").order.results[0].result,"offline");
  for(const request of [{action:"start",pilots:[2,2]}, {action:"start",pilots:["2"]},
    {action:"filter",pilots:[2],ores:["not a real ore"]}, {action:"filter",pilots:[2],ores:[]}])
    assert.throws(()=>f.service.action(f.sessions.get(1),request),/Invalid fleet order|valid fleet ore/);
  assert.deepEqual(f.controls,[]);
});
test("selected stop and recall do not touch other pilots; log stays bounded",()=>{
  const f=fixture();f.send("start");f.send("recall");
  assert.equal(f.states.get(2).enabled,true);
  f.send("stop");assert.equal(f.states.get(2).enabled,false);
  assert.deepEqual(f.controls,[[2,"on"],[2,"recall"],[2,"stop"]]);
  for(let i=0;i<40;i++)f.send("restore");
  assert.equal(f.service.view(f.sessions.get(1)).orders.length,25);
});

test("mining orders merge with filters, never mutate preferences, and restore independently", () => {
  const f=fixture(), target=f.sessions.get(2), s=f.states.get(2), original=structuredClone(s);
  const settings={lock:false,approach:true,order:"furthest",survey:true,compress:true,surveySeconds:300};
  f.send("filter",[2],{ores:["veldspar"]});
  assert.equal(f.send("mining",[2,3],{settings}).order.results[0].result,"miningApplied");
  assert.deepEqual(f.service.mining(target,s),settings);
  assert.deepEqual(f.service.effective(target,s),["veldspar"]);
  assert.deepEqual(s,original);
  assert.deepEqual(f.service.notice(target).values,{ores:["veldspar"],...settings});
  f.service.sourceAuthorized(target); // receiving UI can fetch its notice, never leader orders
  assert.throws(()=>f.service.authorized(target),/current fleet leader/);
  f.send("restoreMining");
  assert.deepEqual(f.service.mining(target,s),Object.fromEntries(Object.keys(settings).map(k=>[k,s[k]])));
  assert.deepEqual(f.service.effective(target,s),["veldspar"]);
  f.send("mining",[2],{settings});f.send("restore");
  assert.strictEqual(f.service.effective(target,s),s.ores);
  assert.deepEqual(f.service.mining(target,s),settings);
  f.send("stop");assert.equal(f.service.notice(target),null);
  assert.deepEqual(s,original);
});

test("mining order validation is atomic; stop, disconnect, new leader and new session revoke controls", () => {
  const settings={lock:true,approach:true,order:"largest",survey:true,compress:false,surveySeconds:90};
  for(const invalid of [{...settings,approach:1},{...settings,surveySeconds:5},{...settings,surveySeconds:90.5},
      {...settings,order:"evil"},{...settings,enabled:true},null]) {
    const f=fixture();assert.throws(()=>f.send("mining",[2],{settings:invalid}),/valid fleet mining/);
    assert.equal(f.service.notice(f.sessions.get(2)),null);assert.deepEqual(f.reset,[]);
  }
  for(const mutate of [f=>f.service.clear(f.sessions.get(2)), f=>f.service.clear(f.sessions.get(1),f.states.get(1),true),
      f=>f.sessions.get(1).socket.destroyed=true, f=>f.sessions.set(1,{characterID:1,socket:{}}),
      f=>f.membership.delete(2),f=>f.fleet.leader=3]) {
    const f=fixture();f.send("mining",[2],{settings});mutate(f);
    assert.equal(f.service.notice(f.sessions.get(2)),null);
    assert.equal(f.service.mining(f.sessions.get(2),f.states.get(2)).approach,false);
  }
});
