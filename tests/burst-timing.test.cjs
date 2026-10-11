"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createBoosters}=require('../lib/boosters');
const {featurePreferences,featureRequest}=require('../lib/featureSettings');
const {captureProfile,switchProfile}=require('../lib/jobProfiles');
function fixture({interval,variant=42528}={}){
 let now=0,refused=false,duration=60000;
 const session={characterID:1},ship={kind:'ship',itemID:10,activeModuleEffects:new Map()};
 const s={autoBoost:true,boostOwned:new Map(),boostIntervals:interval?{[variant]:interval}:{}};
 const calls=[];
 const scene={getPublicGridClusterKeyForEntity:()=> 'belt',
  activateGenericModule(_,item,name,options){calls.push({at:now,repeat:options.repeat});
   if(refused)return {success:false,errorMsg:'NotEnoughCapacitor'};
   ship.activeModuleEffects.set(item.itemID,{nextCycleAtMs:now+duration,remainingCycles:options.repeat===0?1:null});return {success:true};},
  deactivateGenericModule(_,id,options){calls.push({stop:id,options});ship.activeModuleEffects.get(id).deactivateAtMs=ship.activeModuleEffects.get(id).nextCycleAtMs;}};
 const native={fitting:{getFittedModuleItems:()=>[{itemID:100,typeID:variant},{itemID:101,typeID:99}],isModuleOnline:()=>true,
  getTypeEffectRecords:type=>[{name:type===variant?'mining':'shield'}]},
  bursts:{resolveCommandBurstDefinition:e=>({family:e.name})},dogma:{getEntityRuntimeShipItem:()=>ship,getEntityRuntimeSkillMap:()=>new Map()},
  attributes:{getGenericModuleRuntimeAttributes:()=>({durationMs:duration})}};
 const api=createBoosters('unused',{native,state:()=>s,getAPI:()=>({miningSite:()=>true}),logError:()=>{}});
 return {api,s,ship,session,scene,calls,tick(at){now=at;api.tick(session,s,scene,ship,now);},
  refuse(value){refused=value;},duration(value){duration=value;},view(at){return api.snapshot(session,s,ship,at);}};
}
test('every native mining-burst variant gets its effective fitted cycle default',()=>{
 for(const variant of [42528,43551,99999]){
  const f=fixture({variant});assert.equal(f.api.miningModules(f.session,f.ship).length,1);
  const view=f.view(0);assert.equal(view[0].defaultSeconds,60);assert.equal(view[0].intervalSeconds,60);
  f.tick(0);f.tick(5000);assert.deepEqual(f.calls,[{at:5000,repeat:undefined}]);
 }
});
test('custom spacing uses a single native cycle and times from successful starts',()=>{
 const f=fixture({interval:300});f.tick(0);f.tick(5000);
 assert.deepEqual(f.calls,[{at:5000,repeat:0}]);f.ship.activeModuleEffects.clear();
 f.tick(65000);assert.equal(f.view(65000)[0].cooldownSeconds,240);
 f.tick(304999);assert.equal(f.calls.length,1);f.tick(305000);assert.equal(f.calls.length,2);
});
test('failed activation retries without spending the activation interval',()=>{
 const f=fixture({interval:300});f.refuse(true);f.tick(0);f.tick(5000);f.tick(14999);assert.equal(f.calls.length,1);
 f.refuse(false);f.tick(15000);assert.equal(f.calls.length,2);f.ship.activeModuleEffects.clear();
 f.tick(314999);assert.equal(f.calls.length,2);f.tick(315000);assert.equal(f.calls.length,3);
});
test('editing a continuous timer defers its owned current cycle; manual effects are left alone',()=>{
 const f=fixture();f.tick(0);f.tick(5000);const live=f.ship.activeModuleEffects.get(100);live.nextCycleAtMs=125000;
 f.s.boostIntervals={42528:300};f.tick(66000);
 assert.deepEqual(f.calls.at(-1),{stop:100,options:{reason:'autominingBurstInterval',deferUntilCycle:true}});
 f.ship.activeModuleEffects.clear();f.tick(364999);assert.equal(f.calls.length,2);f.tick(365000);assert.equal(f.calls.length,3);
 const manual={nextCycleAtMs:500000};f.ship.activeModuleEffects.set(100,manual);f.tick(366000);
 assert.equal(f.calls.length,3);f.api.pause(f.s,f.scene,f.session,f.ship);assert.equal(f.ship.activeModuleEffects.get(100),manual);
});
test('refitting raises live minimum and boost interval settings persist only with their job profile',()=>{
 const f=fixture({interval:70});assert.equal(f.view(0)[0].intervalSeconds,70);f.duration(90000);assert.equal(f.view(1000)[0].intervalSeconds,90);
 const prefs=featurePreferences({job:'boosting',boostIntervals:{42528:300}});assert.deepEqual(prefs.boostIntervals,{42528:300});
 assert.deepEqual(captureProfile(prefs).boostIntervals,{42528:300});
 assert.deepEqual(switchProfile({job:'boosting'},{job:'mining',jobProfiles:{boosting:{boostIntervals:{42528:300}}}}).boostIntervals,{42528:300});
 assert.throws(()=>featureRequest({...prefs,boostIntervals:{42528:-1}},prefs));
});
