"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createController}=require("../lib/controller"),{createPreferences}=require("../lib/preferences");
test("readonly job preview and saved PVE roundtrip isolate all drone settings without altering shared safety",t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"am-job-profiles-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename=path.join(directory,"players.json"),prefs=createPreferences(filename),id=42;
  const mining={enabled:true,job:"mining",ores:["veldspar"],order:"nearest",approach:false,lock:true,survey:false,surveySeconds:60,compress:false,haulThreshold:95,haulEnabled:false,
    launchDrones:true,droneGroupKey:'["named","miners"]',mineDrones:true,mineDroneOrder:"largest",mineDroneMode:"focus",
    ratDefenseEnabled:true,ratMiningGroupKey:'["named","miners"]',ratFighterGroupKey:'["named","fighters"]',recallDrones:false,
    stationID:600,storageKey:"personal",defenseEnabled:true,defenseShieldEnabled:true,defenseShieldThreshold:80,defenseArmorEnabled:false,defenseArmorThreshold:80,
    fleetEnabled:true,fleetMode:"manual",fleetGroupID:"saved"};prefs.save(id,mining);
  const session={characterID:id,shipid:100,stationid:600,sendNotification(){}},calls=[];
  const factory=preferences=>createController(()=>({modules:()=>[]}),()=>({getSceneForSession:()=>null}),e=>{throw Error(e);},preferences,null,
    {station:stationID=>({stationID,systemID:300}),storage:()=>({key:"personal"})},null,null,
    {pveAmmo:{tick(){calls.push("mutation");},view(s,settings,ship){calls.push(["view",settings.job,ship.itemID]);return {items:[{typeID:123,target:0}],ready:false};}}});
  const c=factory(prefs),before=fs.readFileSync(filename,"utf8"),initial=c.snapshot(session),preview=c.jobProfile(session,"pve");
  assert.equal(preview.settings.launchDrones,false);assert.equal(preview.settings.droneGroupKey,"");assert.equal(preview.settings.ratDefenseEnabled,false);
  assert.equal(preview.settings.pveDronesEnabled,false);assert.equal(preview.settings.pveDroneGroupKey,"");assert.equal(preview.settings.recallDrones,true);
  assert(preview.fields.includes("recallDrones"));assert.deepEqual(preview.pveAmmo.items,[{typeID:123,target:0}]);assert.equal(calls.includes("mutation"),false);
  assert.equal(fs.readFileSync(filename,"utf8"),before);assert.equal(c.snapshot(session).settings.job,"mining");assert.equal(c.snapshot(session).enabled,true);
  assert.equal(preview.settings.stationID,600);assert.equal(preview.settings.defenseEnabled,true);assert.equal(preview.settings.fleetGroupID,"saved");
  c.applySettings(session,JSON.stringify({revision:initial.revision,settings:preview.settings}));
  const pveSnapshot=c.snapshot(session);assert.equal(pveSnapshot.settings.job,"pve");assert.equal(pveSnapshot.settings.launchDrones,false);
  const reread=factory(createPreferences(filename)),miningPreview=reread.jobProfile(session,"mining");
  assert.equal(miningPreview.settings.launchDrones,true);assert.equal(miningPreview.settings.droneGroupKey,mining.droneGroupKey);assert.equal(miningPreview.settings.mineDrones,true);
  assert.equal(miningPreview.settings.ratMiningGroupKey,mining.ratMiningGroupKey);assert.equal(miningPreview.settings.ratFighterGroupKey,mining.ratFighterGroupKey);assert.equal(miningPreview.settings.recallDrones,false);
  reread.applySettings(session,JSON.stringify({revision:miningPreview.revision,settings:miningPreview.settings}));
  const restored=reread.snapshot(session);assert.equal(restored.settings.job,"mining");assert.equal(restored.settings.mineDroneOrder,"largest");assert.equal(restored.settings.mineDroneMode,"focus");
  assert.equal(restored.settings.stationID,600);assert.equal(restored.settings.defenseEnabled,true);assert.equal(restored.settings.fleetGroupID,"saved");assert.equal(restored.enabled,false);
});

test("readonly archived PVE preview resolves its own belt metadata without changing the running Mining record",t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"am-job-belt-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename=path.join(directory,"players.json"),prefs=createPreferences(filename),id=42,session={characterID:id,shipid:100,stationid:600,sendNotification(){}};
  prefs.save(id,{...prefs.get(id),enabled:true,job:"mining",pveBeltID:701,jobProfiles:{pve:{pveBeltID:700}}});
  const target={beltID:700,systemID:300,name:"Archived PVE belt"},reads=[];
  const pve={view:()=>({belt:{beltID:701,name:"Current hidden belt"},job:null,status:"PVE stopped."}),
    belt:id=>{reads.push(id);if(id===700)return target;throw Error("missing");},tick:()=>{throw Error("Preview must not tick");}};
  const c=createController(()=>({modules:()=>[]}),()=>({getSceneForSession:()=>null}),e=>{throw Error(e);},prefs,null,null,null,null,{pve});
  const before=fs.readFileSync(filename,"utf8"),preview=c.jobProfile(session,"pve");
  assert.equal(preview.settings.pveBeltID,700);assert.deepEqual(preview.pve.belt,target);assert.deepEqual(reads,[700]);
  assert.equal(preview.pve.status,"PVE stopped.");assert.equal(c.snapshot(session).enabled,true);assert.equal(c.snapshot(session).settings.job,"mining");
  assert.equal(c.snapshot(session).pve.belt.beltID,701);assert.equal(fs.readFileSync(filename,"utf8"),before);
});
