"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createController}=require("../lib/controller"),{createPreferences}=require("../lib/preferences");
function fixture({destinations=null,pve=null,industrial=null}={}) {
 let s,waiting=true,full=true;const calls=[],errors=[];
 const session={characterID:42,shipid:100,sendNotification(){}},ship={kind:"ship",itemID:100,mode:"STOP",position:{x:0,y:0,z:0},
   activeModuleEffects:new Map(),lockedTargets:new Map(),pendingTargetLocks:new Map()};
 const scene={systemID:300,sessions:new Map([[42,session]]),getShipEntityForSession:()=>ship,getCurrentSimTimeMs:()=>10000,
   removeTarget:(session,id)=>{calls.push(["unlock",id]);ship.lockedTargets.delete(id);},stop(){}};
 const api={modules:()=>[],candidates:()=>[],surveyGrid:()=>"belt",surveyResource:()=>9,miningSite:()=>true,
   oreHold:()=>{calls.push(["hold"]);return {flagID:134,capacity:100,full};}};
 const controller=createController(()=>api,()=>({getSceneForSession:()=>scene}),e=>errors.push(e),
   {get:()=>({job:"mining",stackOreHold:false,stackFleetHangar:false,oreMode:"fleetHangar"}),save(){}},null,destinations,null,null,{
   pve,industrial,
   oreHandling:{tick:()=>calls.push(["ore"]),view:()=>({})},
   transport:{tick:()=>calls.push(["transport"]),request:()=>calls.push(["pickup"]),view:()=>({}),cancel(){},eligibility:()=>({eligible:true})},
   fleetOre:{tick(){},waitingForCompression:()=>waiting,view:state=>{s=state;return {};}}});
 controller.snapshot(session);controller.command(session,{action:"on"});
 return {controller,session,scene,ship,api,calls,get s(){return s;},waiting:v=>{waiting=v;},full:v=>{full=v;},
   tick:now=>{controller.tick(scene,now);assert.deepEqual(errors,[]);}};
}
test("explicit fleet hangar full raw wait precedes competing ore actions and then resumes existing work",()=>{
 const f=fixture();f.s.locks.add(9);f.ship.lockedTargets.set(9,true);f.tick(1000);
 assert.equal(f.s.status,"Waiting for fleet compression.");assert.equal(f.s.fleetCompressionPaused,true);
 assert.equal(f.calls.some(c=>["ore","transport","pickup"].includes(c[0])),false);assert.deepEqual(f.calls.filter(c=>c[0]==="unlock"),[["unlock",9]]);
 f.s.locks.add(10);f.ship.lockedTargets.set(10,true);f.tick(2000);assert.equal(f.calls.filter(c=>c[0]==="unlock").length,1);
 f.waiting(false);f.tick(3000);assert.equal(f.s.fleetCompressionPaused,false);assert(f.calls.some(c=>c[0]==="ore"));assert.equal(f.calls.some(c=>c[0]==="pickup"),false);
});
test("other ore modes are never hijacked by compression waiting",()=>{
 for(const mode of ["leave","pickup","jettison","unload"]) {
   const f=fixture();f.s.oreMode=mode;f.tick(1000);assert(f.calls.some(c=>c[0]==="hold"));assert.notEqual(f.s.fleetCompressionPaused,true);
   assert(f.calls.some(c=>c[0]==="ore"));if(mode==="pickup")assert(f.calls.some(c=>c[0]==="pickup"));
 }
});

test("compression wait stops only owned mining effects and preserves locks used by manual mining",()=>{
 const f=fixture(),owned={targetID:9},manual={targetID:10};f.s.owned.set(51,owned);f.s.locks.add(9);f.s.locks.add(10);
 f.ship.activeModuleEffects.set(51,owned);f.ship.activeModuleEffects.set(52,manual);f.ship.lockedTargets.set(9,true);f.ship.lockedTargets.set(10,true);
 f.api.modules=()=>[51,52].map(itemID=>({item:{itemID}}));
 f.scene.deactivateGenericModule=(session,id)=>{f.calls.push(["deactivate",id]);f.ship.activeModuleEffects.delete(id);};
 f.tick(1000);assert.deepEqual(f.calls.filter(c=>c[0]==="deactivate"),[["deactivate",51]]);
 assert.equal(f.ship.activeModuleEffects.get(52),manual);assert.equal(f.ship.lockedTargets.has(10),true);assert.equal(f.ship.lockedTargets.has(9),false);
});
test("invalid archive draft does not change jobs or overwrite prior profiles",()=>{
 const f=fixture(),before=f.controller.snapshot(f.session);f.s.jobProfiles={mining:{compress:false},boosting:{receiveFleetOre:true}};
 assert.throws(()=>f.controller.applySettings(f.session,JSON.stringify({revision:before.revision,settings:{...before.settings,job:"boosting",receiveFleetOre:"yes"}})),/Invalid/);
 assert.equal(f.s.job,"mining");assert.equal(f.s.enabled,true);assert.deepEqual(f.s.jobProfiles,{mining:{compress:false},boosting:{receiveFleetOre:true}});
 assert.equal(f.controller.combatStatisticsEnabled({characterID:99}),false);assert.equal(f.controller.combatStatisticsEnabled(f.session),true);
});
test("per-job reception and profile archives persist sanitized without accepting global keys",t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"am-profile-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const preferences=createPreferences(path.join(directory,"players.json"));preferences.save(42,{...preferences.get(42),job:"boosting",receiveFleetOre:true,
   jobProfiles:{boosting:{receiveFleetOre:true,stackOreHold:false,stationID:600},mining:{ores:["ore"],ratFighterGroupKey:"fighters",fleetEnabled:true}}});
 const saved=preferences.get(42);assert.equal(saved.receiveFleetOre,true);
 assert.deepEqual(saved.jobProfiles,{mining:{ores:["ore"],ratFighterGroupKey:"fighters"},boosting:{receiveFleetOre:true,
   receiveFleetAcceptCompressed:true,receiveFleetAcceptUncompressed:true,stackOreHold:false}});
 preferences.save(42,{...saved,job:"mining",oreMode:"fleetHangar",haulEnabled:true,jobProfiles:{mining:{oreMode:"fleetHangar"}}});
 const restored=createPreferences(path.join(directory,"players.json")).get(42);
 assert.equal(restored.oreMode,"fleetHangar");assert.equal(restored.haulEnabled,false);assert.equal(restored.jobProfiles.mining.oreMode,"fleetHangar");
});

test("fleet hangar mode rejects manual jettison and does not start stale unloading",()=>{
 const f=fixture();f.waiting(false);f.s.haulEnabled=true;
 assert.throws(()=>f.controller.jettison(f.session),/unavailable/);f.tick(1000);assert.equal(f.calls.some(c=>c[0]==="pickup"),false);
});

test("booster arrival at a mining site resumes without a mineable resource",()=>{
 const resumed=[],industrial={resume:(s,ship)=>resumed.push(ship.itemID),snapshot:()=>({modules:[],fuel:{}}),stop(){}};
 const f=fixture({industrial});f.s.job="boosting";f.s.pausedForWarp=true;f.api.surveyResource=()=>null;
 f.tick(1000);assert.equal(f.s.pausedForWarp,false);assert.equal(resumed.at(-1),100);
 f.s.pausedForWarp=true;f.s.nextResumeCheck=0;f.api.miningSite=()=>false;f.tick(2000);assert.equal(f.s.pausedForWarp,true);
});

test("Hauling Start rejects inaccessible storage before clearing interruption or enabling work",()=>{
 const checks=[],destinations={station:(id,session)=>{checks.push(["station",id,session.characterID]);return {};},
   storage:(session,id,key)=>{checks.push(["storage",id,key]);throw Error("Native storage access denied");}};
 const f=fixture({destinations});f.s.job="hauling";f.s.enabled=false;f.s.transportStationID=600;f.s.transportStorageKey="corp:1";
 f.s.transportInterrupted=true;f.s.departureStatus="Keep this";
 assert.throws(()=>f.controller.command(f.session,{action:"on"}),/Native storage access denied/);
 assert.equal(f.s.enabled,false);assert.equal(f.s.transportInterrupted,true);assert.equal(f.s.departureStatus,"Keep this");
 assert.deepEqual(checks,[["station",600,42],["storage",600,"corp:1"]]);
});

test("validated PVE belt changes stop the old job, while unavailable belts leave it untouched",()=>{
 let stopped=0;const pve={searchBelts:()=>[{beltID:9},{beltID:10}],view:()=>({}),stop:(session,s)=>{stopped++;s.pveTravel=null;s.pveJob=null;}};
 const f=fixture({pve});f.s.job="pve";f.s.pveBeltID=9;f.s.pveTravel={target:9};f.s.pveJob={target:9};
 let snapshot=f.controller.snapshot(f.session);
 assert.throws(()=>f.controller.applySettings(f.session,JSON.stringify({revision:snapshot.revision,settings:{...snapshot.settings,pveBeltID:11}})),/unavailable/);
 assert.equal(f.s.enabled,true);assert.equal(f.s.pveJob.target,9);assert.equal(stopped,0);
 snapshot=f.controller.snapshot(f.session);
 f.controller.applySettings(f.session,JSON.stringify({revision:snapshot.revision,settings:{...snapshot.settings,pveBeltID:10,jobProfiles:{pve:{pveBeltID:11}}}}));
 assert.equal(f.s.enabled,false);assert.equal(f.s.pveBeltID,10);assert.equal(f.s.pveJob,null);assert.equal(f.s.pveTravel,null);assert.equal(stopped,1);
 assert.equal(f.s.jobProfiles.pve.pveBeltID,10);
 pve.searchBelts=()=>[];assert.throws(()=>f.controller.command(f.session,{action:"on"}),/unavailable/);assert.equal(f.s.enabled,false);
});
