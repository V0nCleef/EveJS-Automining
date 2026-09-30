"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createController}=require("../lib/controller"),{createMiningDrones}=require("../lib/miningDrones");
function fixture(settings={}) {
  let state,departing=false,defending=false;
  const calls=[],errors=[],session={characterID:42,shipid:100,sendNotification(){}};
  const manualEffect={targetID:8},ship={kind:"ship",itemID:100,mode:"STOP",position:{x:0,y:0,z:0},
    activeModuleEffects:new Map([[51,manualEffect]]),lockedTargets:new Map([[8,true]]),pendingTargetLocks:new Map()};
  const entities=new Map([21,22,23].map(itemID=>[itemID,{kind:"drone",itemID,controllerID:100,ownerID:42,droneCommand:"IDLE"}]));
  const rocks=[
    {id:8,name:"Veldspar",distance:10,state:{yieldKind:"ore",remainingQuantity:100,unitVolume:.1}},
    {id:9,name:"Hedbergite",distance:20,state:{yieldKind:"ore",remainingQuantity:100,unitVolume:3}},
    {id:10,name:"Hedbergite IV-Grade",distance:30,state:{yieldKind:"ore",remainingQuantity:200,unitVolume:3}},
  ];
  const scene={systemID:300,sessions:new Map([[42,session]]),getShipEntityForSession:()=>ship,getEntityByID:id=>entities.get(id),
    getCurrentSimTimeMs:()=>10000,deactivateGenericModule:(_,id)=>calls.push(["deactivate",id]),removeTarget:(_,id)=>calls.push(["unlock",id])};
  const api={modules:()=>{calls.push(["modules"]);return [{item:{itemID:51}}];},candidates:()=>{calls.push(["scan"]);return [...rocks];},
    target:(_,__,id)=>rocks.find(r=>r.id===id),surveyGrid:()=>"belt",surveyResource:()=>9,miningSite:()=>true,
    oreHold:()=>({flagID:134,capacity:100,full:false}),hasSurveyor:()=>{throw Error("Boosting must not enter the laser survey planner");}};
  const native={isDroneEntity:d=>d?.kind==="drone",DRONE_COMMAND_RETURN_BAY:"RETURN_BAY",DRONE_COMMAND_RETURN_HOME:"RETURN_HOME",DRONE_COMMAND_MINE:"MINE",
    commandMineRepeatedly:(_,ids,target)=>{calls.push(["mine",ids[0],target]);Object.assign(entities.get(ids[0]),{droneCommand:"MINE",targetID:target});return {type:"dict",entries:[]};}};
  const miningDrones=createMiningDrones("unused",{getAPI:()=>api,pendingDeparture:()=>departing,native,logError:e=>errors.push(e)});
  const controller=createController(()=>api,()=>({getSceneForSession:()=>scene}),e=>errors.push(e),
    {get:()=>({job:"boosting",ores:["hedbergite"],order:"largest",mineDrones:true,autoBoost:true,coreEnabled:true,
      mineDroneOrder:"largest",mineDroneMode:"spread",launchDrones:false,stackOreHold:false,stackFleetHangar:false,...settings}),save(){}},
    null,null,null,null,{
      miningDrones,
      boosters:{tick:(_,s)=>{calls.push(["boost"]);s.boostStatus="Mining boosts are active.";},stop(){},pause(){},miningModules:()=>[]},
      ratDefense:{tick:()=>defending,clear(){}},
      industrial:{tick:()=>calls.push(["industrial"]),resume(){},stop(){},requestDeparture:()=>false,snapshot:()=>({modules:[],fuel:{}})},
      fleetOre:{tick:()=>calls.push(["fleetOre"]),view:s=>{state=s;return {};},waitingForCompression:()=>false},
      transport:{tick(){},view:()=>({}),cancel(){}}});
  controller.snapshot(session);controller.command(session,{action:"on"});state.miningDroneIDs=new Set([21,22]);
  controller.setDepartureGuard({pending:()=>departing});
  return {controller,session,ship,scene,api,calls,entities,manualEffect,get s(){return state;},departing:v=>{departing=v;},defending:v=>{defending=v;},
    tick:now=>{controller.tick(scene,now);assert.deepEqual(errors,[]);}};
}
test("Boosting runs only opted-in owned mining drones alongside boost/core/receiver work without entering the laser planner",()=>{
  const f=fixture();assert.equal(f.calls.some(c=>["modules","deactivate"].includes(c[0])),false,"Start must not adopt or stop manual lasers");
  f.tick(1000);
  assert.deepEqual(f.calls.filter(c=>c[0]==="mine"),[["mine",21,10],["mine",22,9]]);
  assert.deepEqual(f.calls.filter(c=>["boost","industrial","fleetOre"].includes(c[0])).map(c=>c[0]),["boost","industrial","fleetOre"]);
  assert.equal(f.s.status,"Mining boosts are active.");assert.match(f.controller.snapshot(f.session).mineDroneStatus,/2 drone/);
  assert.equal(f.s.launchDrones,false,"mining orders must not enable automatic launch");assert.equal(f.ship.activeModuleEffects.get(51),f.manualEffect);
  assert.equal(f.calls.some(c=>c[0]==="modules"),false);f.tick(2000);
  assert.equal(f.calls.filter(c=>c[0]==="scan").length,1,"existing orders retain the bounded scan cache");
  f.controller.command(f.session,{action:"filter",ores:["veldspar"]});f.tick(3000);
  assert.deepEqual(f.calls.filter(c=>c[0]==="mine").slice(-2),[["mine",21,8],["mine",22,8]]);
  assert.equal(f.calls.some(c=>["modules","deactivate","unlock"].includes(c[0])),false,"filter edits must not manipulate manual lasers or locks");
});
test("Boosting mining orders remain off by default and preserve manually returned or unowned drones",()=>{
  const off=fixture({mineDrones:false});off.tick(1000);assert.equal(off.calls.some(c=>c[0]==="mine"),false);assert.equal(off.s.mineDrones,false);
  const f=fixture();f.entities.get(21).droneCommand="RETURN_HOME";f.entities.get(22).ownerID=99;f.tick(1000);
  assert.equal(f.calls.some(c=>c[0]==="mine"),false);assert.equal(f.entities.get(23).droneCommand,"IDLE","unregistered drones remain untouched");
});
test("a Boosting ship with zero mining lasers still sends native mining drone orders and boosts without a surveyor",()=>{
  const f=fixture();f.api.modules=()=>[];f.ship.activeModuleEffects.clear();f.ship.lockedTargets.clear();
  f.tick(1000);assert.deepEqual(f.calls.filter(c=>c[0]==="mine"),[["mine",21,10],["mine",22,9]]);
  assert.equal(f.s.enabled,true);assert.equal(f.s.surveyorBlocked,undefined);assert.equal(f.s.status,"Mining boosts are active.");
});
test("Boosting drone orders yield to warp, docking, departure and rat defense, then resume on their owned grid",()=>{
  for(const block of ["warp","dock","departure","rats","Defense"]) {
    const f=fixture();
    if(block==="warp")f.ship.mode="WARP";
    if(block==="dock")f.ship.pendingDock={};
    if(block==="departure")f.departing(true);
    if(block==="rats")f.defending(true);
    if(block==="Defense"){f.s.defenseEnabled=true;f.ship.shieldCapacity=100;f.ship.conditionState={shieldCharge:.1};}
    f.tick(1000);assert.equal(f.calls.some(c=>c[0]==="mine"),false,block);
    f.ship.mode="STOP";delete f.ship.pendingDock;f.departing(false);f.defending(false);f.s.defenseEnabled=false;f.s.next=0;
    f.tick(2000);assert(f.calls.some(c=>c[0]==="mine"),`${block} resume`);
  }
});
test("Hauling and PVE do not run mining drones even when an inherited toggle remains on",()=>{
  for(const job of ["hauling","pve"]) {
    const f=fixture();f.s.job=job;if(job==="hauling")f.s.shipRole="transport";
    f.tick(1000);assert.equal(f.calls.some(c=>c[0]==="mine"),false,job);
  }
});
test("Boosting rat group validation depends on the mining opt-in and rejects invalid drafts before stopping the job",()=>{
  const f=fixture({mineDrones:false}),fighters=JSON.stringify(["fighters","1"]),miners=JSON.stringify(["miners","2"]);
  const apply=changes=>{const before=f.controller.snapshot(f.session);return f.controller.applySettings(f.session,JSON.stringify({revision:before.revision,settings:{...before.settings,...changes}}));};
  apply({ratDefenseEnabled:true,ratFighterGroupKey:fighters,ratMiningGroupKey:""});assert.equal(f.s.enabled,true);
  const archive=JSON.stringify(f.s.jobProfiles);
  assert.throws(()=>apply({mineDrones:true}),/separate mining and fighter/);assert.equal(f.s.enabled,true);assert.equal(f.s.mineDrones,false);assert.equal(JSON.stringify(f.s.jobProfiles),archive);
  assert.throws(()=>apply({mineDrones:true,ratMiningGroupKey:fighters}),/separate mining and fighter/);
  apply({mineDrones:true,ratMiningGroupKey:miners});assert.equal(f.s.mineDrones,true);assert.equal(f.s.ratMiningGroupKey,miners);
});
