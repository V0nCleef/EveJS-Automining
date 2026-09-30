"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {cleanProfiles,captureProfile,switchProfile}=require("../lib/jobProfiles");
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
test("capture keeps each job allowlist and excludes shared global or another job settings",()=>{
  const s={job:"mining",ores:["veldspar"],stackOreHold:true,ratFighterGroupKey:"miners-fighters",fleetEnabled:true,
    recallDrones:false,stationID:600,defenseEnabled:true,actionNotifications:true,pveBeltID:123,transportStationID:700,fuelStationID:800};
  assert.deepEqual(captureProfile(s),{ores:["veldspar"],stackOreHold:true,ratFighterGroupKey:"miners-fighters",recallDrones:false});
  assert.deepEqual(captureProfile(s,"hauling"),{transportStationID:700,stackOreHold:true,ratFighterGroupKey:"miners-fighters",recallDrones:false});
  assert.deepEqual(captureProfile(s,"pve"),{pveBeltID:123,ratFighterGroupKey:"miners-fighters",recallDrones:false});
});
test("job switch restores archived unchanged values while explicit new draft values win",()=>{
  const current={job:"mining",stackOreHold:true,compress:true,ratFighterGroupKey:"mining",jobProfiles:{boosting:{stackOreHold:false,
    compress:false,ratFighterGroupKey:"boosters",coreEnabled:true,coreIntervals:{123:600}}}};
  const draft={job:"boosting",stackOreHold:true,compress:false,ratFighterGroupKey:"custom",jobProfiles:{boosting:{coreEnabled:false}},fleetEnabled:true};
  const result=switchProfile(draft,current);
  assert.deepEqual(pick(result,["job","stackOreHold","compress","ratFighterGroupKey","fleetEnabled","coreEnabled","coreIntervals","receiveFleetAcceptCompressed","receiveFleetAcceptUncompressed"]),{job:"boosting",stackOreHold:false,compress:false,ratFighterGroupKey:"custom",fleetEnabled:true,coreEnabled:true,coreIntervals:{123:600},
    receiveFleetAcceptCompressed:true,receiveFleetAcceptUncompressed:true});
  result.coreIntervals[123]=1;assert.equal(current.jobProfiles.boosting.coreIntervals[123],600);
  assert.equal(Object.hasOwn(result,"jobProfiles"),false);
});
test("first visit uses its own job defaults and same job edits do not restore stale archive",()=>{
  const current={job:"mining",compress:true,jobProfiles:{mining:{compress:false}}};
  const first=switchProfile({job:"hauling",compress:true},current);assert.equal(first.transportThreshold,95);assert.equal(first.transportStationID,0);assert.equal(first.launchDrones,false);assert.equal(first.droneGroupKey,"");assert.equal(first.recallDrones,true);
  assert.deepEqual(switchProfile({job:"mining",compress:true},current),{job:"mining",compress:true});
});
test("round trip keeps independent shared drone stack and rat fighter choices",()=>{
  const mining={job:"mining",droneGroupKey:"mining-drones",stackFleetHangar:true,ratFighterGroupKey:"mining-fighters"};
  const boosting={job:"boosting",droneGroupKey:"booster-drones",stackFleetHangar:false,ratFighterGroupKey:"booster-fighters"};
  const current={...boosting,jobProfiles:{mining:captureProfile(mining),boosting:captureProfile(boosting)}};
  const restored=switchProfile({...boosting,job:"mining"},current);
  assert.equal(restored.droneGroupKey,"mining-drones");assert.equal(restored.stackFleetHangar,true);assert.equal(restored.ratFighterGroupKey,"mining-fighters");
});
test("Boosting keeps its own optional mining drone filter and orders across a Mining round trip",()=>{
  const mining={job:"mining",ores:["veldspar"],mineDrones:false,mineDroneOrder:"nearest",mineDroneMode:"spread",ratMiningGroupKey:"mining-group"};
  const boosting={job:"boosting",ores:["hedbergite"],mineDrones:true,mineDroneOrder:"largest",mineDroneMode:"focus",ratMiningGroupKey:"booster-group"};
  const profiles=cleanProfiles({mining:captureProfile(mining),boosting:captureProfile(boosting)});
  assert.deepEqual(profiles.boosting,{ores:["hedbergite"],mineDrones:true,mineDroneOrder:"largest",mineDroneMode:"focus",ratMiningGroupKey:"booster-group",
    receiveFleetAcceptCompressed:true,receiveFleetAcceptUncompressed:true});
  const restoredMining=switchProfile({...boosting,job:"mining"},{...boosting,jobProfiles:profiles});
  assert.deepEqual(pick(restoredMining,Object.keys(mining)),mining);
  const restoredBoosting=switchProfile({...restoredMining,job:"boosting"},{...restoredMining,jobProfiles:profiles});
  assert.deepEqual(pick(restoredBoosting,[...Object.keys(boosting),"receiveFleetAcceptCompressed","receiveFleetAcceptUncompressed"]),{...boosting,receiveFleetAcceptCompressed:true,receiveFleetAcceptUncompressed:true});
  const explicit=switchProfile({...mining,job:"boosting",mineDrones:true,ores:["scordite"]},{...mining,jobProfiles:profiles});
  assert.deepEqual(explicit.ores,["scordite"],"new draft filter wins over the saved Boosting filter");
});
test("first PVE visit and old partial profiles never inherit Mining drones or recall preferences",()=>{
  const mining={job:"mining",launchDrones:true,droneGroupKey:"mining-group",mineDrones:true,ratDefenseEnabled:true,ratMiningGroupKey:"miners",ratFighterGroupKey:"fighters",recallDrones:false,stationID:600,fleetEnabled:true,defenseEnabled:true};
  for(const job of ["boosting","hauling","pve"]){
    const p=switchProfile({...mining,job},{...mining,jobProfiles:job==="pve"?{pve:{pveBeltID:700}}:{}});
    assert.equal(p.launchDrones,false);assert.equal(p.droneGroupKey,"");assert.equal(p.ratDefenseEnabled,false);assert.equal(p.ratMiningGroupKey,"");assert.equal(p.ratFighterGroupKey,"");assert.equal(p.recallDrones,true);
    assert.equal(p.stationID,600);assert.equal(p.fleetEnabled,true);assert.equal(p.defenseEnabled,true);
    if(job==="pve"){assert.equal(p.pveDronesEnabled,false);assert.equal(p.pveDroneGroupKey,"");assert.equal(p.pveBeltID,700);}
  }
  const pve={job:"pve",launchDrones:false,droneGroupKey:"",recallDrones:true,pveDronesEnabled:false,pveDroneGroupKey:""};
  const restored=switchProfile({...mining,...pve},{...mining,...pve,jobProfiles:{mining:captureProfile(mining)}});
  const returned=switchProfile({...restored,job:"mining"},{...restored,jobProfiles:{mining:captureProfile(mining)}});
  assert.equal(returned.launchDrones,true);assert.equal(returned.droneGroupKey,"mining-group");assert.equal(returned.recallDrones,false);
});

test("fleet hangar routing remains a mining profile choice across jobs",()=>{
  const mining={job:"mining",oreMode:"fleetHangar"},boosting={job:"boosting",receiveFleetOre:true};
  const profiles=cleanProfiles({mining:captureProfile(mining),boosting:captureProfile({...boosting,oreMode:"pickup"})});
  assert.deepEqual(profiles,{mining:{oreMode:"fleetHangar"},boosting:{receiveFleetOre:true,receiveFleetAcceptCompressed:true,receiveFleetAcceptUncompressed:true}});
  assert.equal(switchProfile({...boosting,job:"mining"},{...boosting,jobProfiles:profiles}).oreMode,"fleetHangar");
});
test("clean archive clones bounded plain data, strips unknown jobs fields and rejects prototype accessors",()=>{
  const malicious=JSON.parse('{"mining":{"ores":["ore"],"constructor":{},"stationID":42},"boosting":{"coreIntervals":{"__proto__":{"polluted":true}}},"pve":{"pveBeltID":1},"other":{"ores":["x"]}}');
  let calls=0;Object.defineProperty(malicious.pve,"pveFireMode",{enumerable:true,get(){calls++;return "focus";}});
  const cleaned=cleanProfiles(malicious);
  assert.deepEqual(cleaned,{mining:{ores:["ore"]},boosting:{},pve:{pveBeltID:1,pveMode:"belt"}});assert.equal(calls,0);assert.equal({}.polluted,undefined);
  cleaned.mining.ores.push("other");assert.deepEqual(malicious.mining.ores,["ore"]);
  assert.deepEqual(cleanProfiles(new Date()),{});
  assert.deepEqual(captureProfile({job:"mining",ores:Array(1025).fill("x"),surveySeconds:Infinity}),{});
});
test("profile byte limit and cyclic or nonplain nested values fail safely",()=>{
  const huge={mining:{ores:Array(100).fill("汉".repeat(200))}};assert.deepEqual(cleanProfiles(huge),{mining:{}});
  const cycle={};cycle.self=cycle;
  assert.deepEqual(captureProfile({job:"boosting",coreIntervals:cycle,compressorIntervals:new Map()}),{});
});
