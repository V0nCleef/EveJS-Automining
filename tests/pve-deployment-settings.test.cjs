"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {featurePreferences,featureRequest}=require("../lib/featureSettings");
const {cleanProfiles,captureProfile,switchProfile}=require("../lib/jobProfiles");

test("old PVE records remain belt jobs; deployment defaults are bounded and opt-in",()=>{
  const old=featurePreferences({job:"pve",pveBeltID:123});
  assert.equal(old.pveMode,"belt");assert.equal(old.pveMaxJumps,2);assert.equal(old.pveFleetID,0);
  assert.equal(old.pveAnchorID,0);assert.equal(old.pveHomeStationID,0);
  assert.equal(old.reinforcementAutoCall,false);assert.equal(old.reinforcementResponderLimit,1);
  const broken=featurePreferences({pveMode:"all",pveFleetID:-1,pveAnchorID:NaN,pveHomeStationID:0,pveMaxJumps:51,reinforcementResponderLimit:100});
  assert.equal(broken.pveMode,"belt");assert.equal(broken.pveMaxJumps,2);assert.equal(broken.reinforcementResponderLimit,1);
});

test("deployment settings preserve same-system zero and independent drafts with strict RPC validation",()=>{
  const current=featurePreferences();
  const next=featureRequest({pveMode:"escort",pveFleetID:10,pveAnchorID:20,pveHomeStationID:600,pveMaxJumps:0,
    reinforcementAutoCall:true,reinforcementResponderLimit:8},current);
  assert.equal(next.pveMaxJumps,0);assert.equal(next.pveFleetID,10);assert.equal(next.reinforcementResponderLimit,8);
  assert.equal(featureRequest({pveMode:"standby",pveFleetID:0},next).pveHomeStationID,600);
  assert.equal(featureRequest({pveMode:"escort",pveHomeStationID:0,pveFleetID:0},current).pveMode,"escort","incomplete Save drafts remain allowed; Start validates native eligibility");
  for(const [key,values] of Object.entries({pveMode:["all",null,1],pveFleetID:[-1,1.5,"10"],pveAnchorID:[-1,true],pveHomeStationID:[-1,"600"],
    pveMaxJumps:[-1,51,1.5,"2"],reinforcementResponderLimit:[0,9,true],reinforcementAutoCall:[1,"true",null]}))
    for(const value of values)assert.throws(()=>featureRequest({[key]:value},current),/Invalid/);
});

test("PVE archive restores deployment choices while requester settings stay shared",()=>{
  const pve={job:"pve",pveMode:"standby",pveFleetID:10,pveAnchorID:20,pveHomeStationID:600,pveMaxJumps:2,pveBeltID:123,
    reinforcementAutoCall:true,reinforcementResponderLimit:3};
  const archived=captureProfile(pve);assert.equal(Object.hasOwn(archived,"reinforcementAutoCall"),false);
  assert.equal(Object.hasOwn(archived,"reinforcementResponderLimit"),false);
  const current={job:"mining",pveMode:"escort",pveMaxJumps:5,reinforcementAutoCall:false,jobProfiles:{pve:archived}};
  const restored=switchProfile({job:"pve"},current);assert.equal(restored.pveMode,"standby");assert.equal(restored.pveHomeStationID,600);
  assert.equal(restored.pveMaxJumps,2);assert.equal(cleanProfiles({pve:{pveBeltID:123}}).pve.pveMode,"belt");
});
