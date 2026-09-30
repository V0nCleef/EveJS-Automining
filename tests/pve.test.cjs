"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createPVE}=require("../lib/pve");
const {retreatReason}=require("../lib/defense");
function fixture(options={}) {
  let time=100000,saveError="";
  const sessions=new Map(),states=new Map(),events=[],orders=[],errors=[],fleet={},weapons=new Map();
  const belt={itemID:700,solarSystemID:300,itemName:"Test Belt"};
  const scene={systemID:300,dynamicEntities:new Map(),entities:new Map([[700,{itemID:700,kind:"asteroidBelt",position:{x:0,y:0,z:0},grid:"belt"}]]),
    getEntityByID(id){return this.entities.get(id)||this.dynamicEntities.get(id);},getShipEntityForSession:s=>s.scene===scene?s.ship:null,
    getLivePublicGridClusterKeyForEntity:e=>e?.grid,
    addTarget(s,id){orders.push(["lock",s.characterID,id]);s.ship.pendingTargetLocks.set(id,{});return {success:true};},
    activateGenericModule(s,item,effect,options){orders.push(["fire",s.characterID,item.itemID,options]);s.ship.activeModuleEffects.set(item.itemID,{moduleID:item.itemID,targetID:options.targetID});return {success:true};},
    deactivateGenericModule(s,id,options){orders.push(["stop",s.characterID,id,options]);s.ship.activeModuleEffects.delete(id);return {success:true};},
    cancelAddTarget(s,id){orders.push(["cancelLock",id]);s.ship.pendingTargetLocks.delete(id);},removeTarget(s,id){orders.push(["unlock",id]);s.ship.lockedTargets.delete(id);}};
  const native={belts:()=>[belt],belt:id=>id===700?belt:null,system:()=>({solarSystemName:"Test System"}),scope:e=>({valid:true,scoped:!!e?.private}),local:(a,b)=>a.grid===b.grid,
    health:e=>({shield:e.hp||100}),currentHealth:e=>({shield:e.remaining??e.hp??100}),type:id=>({groupName:id===20?"Asteroid Guristas Battleship":id===21?"Asteroid Guristas Frigate":id===22?"Asteroid Guristas Cruiser":"Unknown"}),weapons:s=>weapons.get(s.itemID)||[],
    drone:{isDroneEntity:e=>e?.kind==="drone",commandReturnBay(s,ids){orders.push(["recall",ids]);},commandEngage(s,ids,target){orders.push(["drone",ids,target]);},DRONE_COMMAND_RETURN_BAY:"return",DRONE_COMMAND_ENGAGE:"engage"}};
  function pilot(id) {
    const session={characterID:id,shipid:id*100,scene,sendNotification(name,target,args){events.push([name,JSON.parse(args[0])]);}};
    session.ship={kind:"ship",itemID:session.shipid,typeID:1,mode:"STOP",position:{x:0,y:0,z:0},grid:"belt",activeModuleEffects:new Map(),lockedTargets:new Map(),pendingTargetLocks:new Map()};
    const s={characterID:id,enabled:true,job:"pve",pveBeltID:700,pveClientReady:true,pveFireMode:"focus",pvePriority:"strongest",pveOrbitOverride:0};sessions.set(id,session);states.set(id,s);
    weapons.set(session.shipid,[{item:{itemID:id*1000,locationID:session.shipid},snapshot:{family:"hybridTurret",durationMs:1000,rawShotDamage:{kinetic:100},optimalRange:10000,activationEffectName:"turretFired",bankSize:2}}]);
    return {session,s,ship:session.ship};
  }
  const pilot1=pilot(1);
  function rat(id,typeID=20,hp=100,extra={}){const e={kind:"ship",itemID:id,typeID,nativeNpc:true,operatorKind:"asteroidBeltRat",mode:"STOP",position:{x:5000,y:0,z:0},grid:"belt",hp,...extra};scene.dynamicEntities.set(id,e);return e;}
  const pve=createPVE({getSpace:()=>({getSceneForSession:s=>s.scene}),getSession:id=>sessions.get(id),getState:s=>states.get(s.characterID),getFleet:()=>fleet,save:()=>saveError,clock:()=>time,native,
    deployment:options.deployment,logError:message=>errors.push(message),
    drones:{requestGroup(s,state,sc,ship,key,kind){orders.push(["launch",key,kind]);return true;}},onBegin:(session,s)=>{orders.push(["begin",s.pveTravel.phase,events.length]);options.onBegin?.(session,s);}});
  function tick(p=pilot1){pve.tick(p.session,p.s,p.session.scene,p.ship,time);}
  function action(name,extra={}){const op=pilot1.s.pveJob;return pve.action(pilot1.session,pilot1.s,op.id,name,{nonce:op.nonce,...extra});}
  return {pve,pilot1,scene,sessions,states,events,orders,errors,weapons,native,rat,pilot,tick,action,advance:n=>time+=n,saveFails:()=>saveError="error"};
}
test("PVE locks natively then fires exact bank master once per native cycle",()=>{const f=fixture();f.rat(9);f.tick();assert.deepEqual(f.orders[0],["lock",1,9]);assert.equal(f.orders.filter(o=>o[0]==="fire").length,0);f.pilot1.ship.pendingTargetLocks.clear();f.pilot1.ship.lockedTargets.set(9,{});f.advance(1000);f.tick();assert.deepEqual(f.orders.find(o=>o[0]==="fire").slice(1),[1,1000,{targetID:9,repeat:0}]);f.advance(1000);f.tick();assert.equal(f.orders.filter(o=>o[0]==="fire").length,1);});
test("priority ranks native hull class before HP and remaining health breaks class ties",()=>{const f=fixture();f.rat(9,21,10000);f.rat(10,20,100,{remaining:50});f.rat(11,20,100,{remaining:80});f.tick();assert.equal(f.pilot1.s.pveTargets[0].itemID,11);const w=fixture();w.pilot1.s.pvePriority="weakest";w.rat(9,21,10000);w.rat(10,20,1);w.tick();assert.equal(w.pilot1.s.pveTargets[0].itemID,9);});
test("focus mode shares live fleet target and spread distributes firing units and pilots",()=>{const f=fixture();f.rat(9);f.rat(10);const other=f.pilot(2);f.tick();f.tick(other);assert.equal(f.pilot1.s.pveTargets[0].itemID,other.s.pveTargets[0].itemID);const spread=fixture();spread.pilot1.s.pveFireMode="spread";const second=spread.pilot(2);second.s.pveFireMode="spread";spread.rat(9);spread.rat(10);spread.tick();spread.tick(second);assert.notEqual(spread.pilot1.s.pveTargets[0].itemID,second.s.pveTargets[0].itemID);});
test("public native hostile provenance excludes players, neutral NPCs and private rats",()=>{const f=fixture();f.rat(9,20,100,{nativeNpc:false});f.rat(10,1,100,{operatorKind:"neutral",bounty:9000});f.rat(11,20,100,{private:true});f.rat(12,20,100,{grid:"other"});f.tick();assert.equal(f.orders.length,0);assert.equal(f.pilot1.s.pveStatus,"No hostile rats on this belt grid.");});
test("GM-spawned native pirate group provenance works without belt operator marker",()=>{const f=fixture();f.rat(9,20,100,{operatorKind:null});f.tick();assert.equal(f.pilot1.s.pveTargets[0].itemID,9);});
test("highest effective DPS bank supplies range, missiles use margin, override wins",()=>{const f=fixture();f.rat(9);f.weapons.get(100).push({item:{itemID:1001},snapshot:{family:"missileLauncher",rawShotDamage:{explosive:300},durationMs:1000,approxRange:50000}});f.tick();assert.equal(f.pilot1.s.pveAutomaticRange,40000);assert.equal(f.pilot1.s.pveOrbitRange,40000);f.pilot1.s.pveOrbitOverride=12000;f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveOrbitRange,12000);});
test("orbit grants exact target/range, expire and are single use",()=>{const f=fixture();f.rat(9);f.tick();const r=f.action("authorizeOrbit");assert.equal(r.authorized,true);assert.equal(f.pve.allowNavigation(f.pilot1.session,"orbit",{targetID:9,range:1}),false);assert.equal(f.pve.allowNavigation(f.pilot1.session,"orbit",{targetID:9,range:10000}),true);assert.equal(f.pve.allowNavigation(f.pilot1.session,"orbit",{targetID:9,range:10000}),false);f.action("authorizeOrbit");f.advance(2001);assert.equal(f.pve.allowNavigation(f.pilot1.session,"orbit",{targetID:9,range:10000}),false);});
test("target changing between poll and orbit authorization returns current state without stopping PVE",()=>{
  const f=fixture();f.rat(9);f.tick();const stale=f.pilot1.s.pveJob.nonce;
  f.scene.dynamicEntities.delete(9);f.rat(10);f.advance(1000);f.tick();
  const result=f.action("authorizeOrbit",{nonce:stale});
  assert.equal(result.authorized,false);assert.equal(result.job.targetID,10);assert.equal(f.pilot1.s.enabled,true);
  assert.equal(f.pve.allowNavigation(f.pilot1.session,"orbit",{targetID:9,range:10000}),false);
  assert.equal(f.action("authorizeOrbit",{nonce:result.job.nonce}).authorized,true);
});
test("phase changing between poll and undock authorization denies stale movement and preserves ownership checks",()=>{
  const f=fixture();f.pilot1.session.stationid=600;f.tick();const op=f.pilot1.s.pveJob,stale=op.nonce;
  assert.equal(op.phase,"undocking");delete f.pilot1.session.stationid;f.action("poll");f.advance(3000);f.action("poll");
  assert.equal(op.phase,"engaging");const result=f.action("authorizeUndock",{nonce:stale});
  assert.equal(result.authorized,false);assert.equal(result.job.phase,"engaging");assert.equal(f.pilot1.s.enabled,true);
  f.pilot1.session.shipid++;assert.throws(()=>f.action("authorizeUndock",{nonce:stale}),/belongs/);
});
test("PVE failures record bounded client reason or server timeout before stopping",()=>{
  const f=fixture();f.tick();f.action("cancel",{reason:'action=authorizeOrbit phase=engaging native error\n'+"x".repeat(400)});
  assert.equal(f.pilot1.s.enabled,false);assert.equal(f.errors.length,1);
  assert.match(f.errors[0],/source=client characterID=1 shipID=100 phase=engaging reason=action=authorizeOrbit/);
  assert.equal(f.errors[0].includes('\n'),false);assert.ok(f.errors[0].length<400);
  const g=fixture();g.tick();g.advance(45001);g.tick();
  assert.match(g.errors[0],/source=server.*PVE client or trip timed out/);assert.equal(g.pilot1.s.enabled,false);
});
test("stop deactivates only owned effect and preserves manual activation",()=>{const f=fixture();f.rat(9);f.pilot1.ship.lockedTargets.set(9,{});f.tick();f.pilot1.ship.activeModuleEffects.set(1001,{manual:true});f.pve.stop(f.pilot1.session,f.pilot1.s,f.scene,f.pilot1.ship);assert.equal(f.pilot1.ship.activeModuleEffects.has(1000),false);assert.equal(f.pilot1.ship.activeModuleEffects.has(1001),true);assert.equal(f.orders.find(o=>o[0]==="stop")[3].deferUntilCycle,true);assert.equal(f.orders.some(o=>o[0]==="unlock"),false);});
test("ship, instance and Defense changes revoke movement and combat",()=>{for(const mutate of [f=>f.pilot1.session.shipid=101,f=>f.pilot1.ship.private=true,f=>{f.pilot1.s.defenseEnabled=true;f.pilot1.s.defenseShieldEnabled=true;f.pilot1.s.defenseShieldThreshold=50;f.pilot1.ship.shieldCapacity=100;f.pilot1.ship.conditionState={shieldCharge:0.2};}]){const f=fixture();f.rat(9);f.tick();mutate(f);assert.throws(()=>f.action("authorizeOrbit"));f.advance(1000);f.tick();assert.equal(f.pilot1.s.enabled,false);}});
test("belt finder uses stable IDs and numeric exact lookup",()=>{const f=fixture();assert.equal(f.pve.searchBelts(f.pilot1.session,"Test")[0].beltID,700);assert.equal(f.pve.searchBelts(f.pilot1.session,"700")[0].systemID,300);assert.deepEqual(f.pve.searchBelts(f.pilot1.session,"999"),[]);assert.throws(()=>f.pve.searchBelts(f.pilot1.session,"x"));});
test("save failure starts no worker and timeout stops enabled PVE",()=>{const f=fixture();f.saveFails();f.tick();assert.equal(f.pilot1.s.enabled,false);assert.equal(f.events.filter(e=>e[1].phase).length,0);const timeout=fixture();timeout.rat(9);timeout.tick();timeout.advance(45001);timeout.tick();assert.equal(timeout.pilot1.s.enabled,false);assert.equal(timeout.pilot1.s.pveJob,null);});
test("named PVE drone group launches through existing grant then controls only verified selected drones",()=>{const f=fixture();f.rat(9);f.pilot1.s.pveDronesEnabled=true;f.pilot1.s.pveDroneGroupKey='["named","group"]';f.tick();assert.deepEqual(f.orders.find(o=>o[0]==="launch"),["launch",'["named","group"]',"pve"]);f.pilot1.s.pveManagedDroneIDs=new Set([50,51]);f.scene.entities.set(50,{kind:"drone",itemID:50,ownerID:1,controllerID:100,droneCommand:"idle"});f.scene.entities.set(51,{kind:"drone",itemID:51,ownerID:2,controllerID:200});f.advance(1000);f.tick();assert.deepEqual(f.orders.find(o=>o[0]==="drone"),["drone",[50],9]);f.pve.stop(f.pilot1.session,f.pilot1.s,f.scene,f.pilot1.ship);assert.deepEqual(f.orders.find(o=>o[0]==="recall"),["recall",[50]]);});
test("crosssystem belt route reserves fleet before notification and warp uses exact native item grant",()=>{
  const f=fixture();f.scene.systemID=299;f.pilot1.ship.grid="origin";f.tick();assert.equal(f.pilot1.s.pveJob.phase,"routeBelt");assert.deepEqual(f.orders[0],["begin","routeBelt",0]);
  f.scene.systemID=300;f.action("poll");assert.equal(f.pilot1.s.pveJob.phase,"warpBelt");f.pilot1.ship.position.x=200000;
  const result=f.action("authorizeWarp");assert.equal(result.authorized,true);assert.equal(f.pve.allowNavigation(f.pilot1.session,"warp",{warpType:"item",targetID:700,minRange:0,fleet:true}),false);
  assert.equal(f.pve.allowNavigation(f.pilot1.session,"warp",{warpType:"item",targetID:700,minRange:0,fleet:false}),true);f.action("warped");assert.equal(f.pilot1.s.pveJob.phase,"warpBelt");
  f.pilot1.ship.grid="belt";f.action("poll");assert.equal(f.pilot1.s.pveJob.phase,"engaging");assert.equal(f.pilot1.s.pveTravel,null);assert.equal(f.pilot1.s.pveInterrupted,false);
});
test("on-grid start never reserves a nonexistent fleet departure",()=>{const f=fixture();f.tick();assert.equal(f.orders.some(o=>o[0]==="begin"),false);});
test("normal mining Stop performs no PVE dependency load or persistence",()=>{let saved=0;const p=createPVE({getSpace:()=>({}),getSession:()=>null,getState:()=>({}),save:()=>saved++});p.stop({characterID:1},{enabled:true},null,null);assert.equal(saved,0);});
test("no rats clear orbit target and stop grant only matches the owned native orbit",()=>{
  const f=fixture();f.rat(9);f.tick();f.action("authorizeOrbit");assert.equal(f.pve.allowNavigation(f.pilot1.session,"orbit",{targetID:9,range:10000}),true);
  f.pilot1.ship.mode="ORBIT";f.pilot1.ship.targetEntityID=9;f.pilot1.ship.orbitDistance=10000;f.scene.dynamicEntities.clear();f.advance(1000);f.tick();
  assert.equal(f.pilot1.s.pveJob.targetID,null);assert.equal(f.pilot1.s.pveJob.orbitRange,0);assert.equal(f.action("authorizeStopOrbit").authorized,true);assert.equal(f.pve.allowNavigation(f.pilot1.session,"stop",{}),true);
  f.pilot1.s.pveOwnedOrbit={targetID:9,range:10000};f.pilot1.ship.targetEntityID=90;assert.equal(f.action("authorizeStopOrbit").authorized,false);
});
test("owned active cycle defers retarget and removes stale bank claims",()=>{
  const f=fixture();f.rat(9);f.pilot1.ship.lockedTargets.set(9,{});f.tick();f.rat(10);f.scene.dynamicEntities.delete(9);f.advance(1000);f.tick();assert.ok(f.orders.some(o=>o[0]==="stop"&&o[3].deferUntilCycle));
  f.weapons.set(100,[]);f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveWeaponCount,0);
});
test("belt catalog pages are bounded and reject invalid offsets or limits",()=>{const f=fixture();assert.deepEqual(f.pve.catalogBelts(f.pilot1.session,0,1),{belts:[{beltID:700,name:"Test Belt",systemID:300,systemName:"Test System"}],more:false});assert.deepEqual(f.pve.catalogBelts(f.pilot1.session,1,500),{belts:[],more:false});for(const [offset,limit] of [[-1,500],[0,501],[0,0],[0.5,1],[100001,1]])assert.throws(()=>f.pve.catalogBelts(f.pilot1.session,offset,limit),/catalog/);});

function escortFixture(options={}){
  let f;const deployment={tick:options.tick||(()=>true),combatClear:()=>false,validate:()=>{
    if(!f.pilot1.s.enabled||f.pilot1.session.shipid!==f.pilot1.ship.itemID||retreatReason(f.pilot1.s,f.pilot1.ship))throw Error('owner changed');
    return {scene:f.scene,ship:f.pilot1.ship};},
    idleAnchor:()=>f.anchorAllowed&&f.pilot1.s.pveMode==='escort'&&f.anchor.ship.grid==='belt'&&!f.anchor.ship.pendingWarp?{itemID:200,session:f.anchor.session,ship:f.anchor.ship}:null,
    publicJob:op=>({id:op.id,nonce:op.nonce,shipID:op.shipID,phase:op.phase,deployment:true,anchor:op.anchor,targetID:op.targetID,orbitRange:op.orbitRange,grant:op.grant}),
    view:()=>({mode:'escort'}),action:options.action||(()=>({authorized:false})),allowNavigation:()=>false,cancelRequests:()=>{},cleanup:()=>{},cancel:()=>{f.pilot1.s.pveJob=null;}};
  f=fixture({deployment});f.anchor=f.pilot(2);f.anchorAllowed=true;f.scene.entities.set(200,f.anchor.ship);
  f.pilot1.s.pveMode='escort';f.pilot1.s.pveShipID=100;f.pilot1.s.pveJob={id:'escort',nonce:'initial',version:1,shipID:100,deployment:true,mode:'escort',phase:'engaging',arrived:true,anchor:{characterID:2,shipID:200,systemID:300}};
  return f;
}
test('Escort idle anchor -> highest-DPS rat -> next living rat -> anchor only after the grid clears',()=>{
  const f=escortFixture();f.tick();assert.equal(f.pilot1.s.pveJob.targetID,200);assert.equal(f.pilot1.s.pveJob.orbitKind,'escort');assert.equal(f.pilot1.s.pveJob.orbitRange,2500);assert.equal(f.pilot1.s.pveStatus,'Escorting the selected pilot.');
  f.rat(9,20);f.rat(10,21);f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.targetID,9);assert.equal(f.pilot1.s.pveJob.orbitKind,'hostile');assert.equal(f.pilot1.s.pveJob.orbitRange,10000);
  f.scene.dynamicEntities.get(9).destroyed=true;f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.targetID,10);
  f.scene.dynamicEntities.clear();f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.targetID,200);assert.equal(f.pilot1.s.pveJob.orbitKind,'escort');assert.equal(f.pilot1.s.pveJob.orbitRange,2500);
});
test('Escort grants only the selected native anchor and consume once; pending native anchor identities cannot be reused',()=>{
  const f=escortFixture();f.tick();assert.equal(f.action('authorizeOrbit').authorized,true);
  assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:10001}),false);
  assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:201,range:2500}),false);
  assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:2500}),true);
  assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:2500}),false);
  for(const mutate of [g=>g.anchorAllowed=false,g=>g.anchor.session={...g.anchor.session},g=>{g.anchor.ship={...g.anchor.ship};g.scene.entities.set(200,g.anchor.ship);},g=>g.anchor.ship.grid='other',g=>g.anchor.ship.pendingWarp={},g=>g.pilot1.ship.pendingWarp={}]){
    const g=escortFixture();g.tick();assert.equal(g.action('authorizeOrbit').authorized,true);mutate(g);assert.equal(g.pve.allowNavigation(g.pilot1.session,'orbit',{targetID:200,range:2500}),false);
  }
  const g=escortFixture();g.tick();g.scene.entities.set(201,{kind:'ship',itemID:201,grid:'belt'});g.pilot1.s.pveJob.targetID=201;assert.equal(g.action('authorizeOrbit').authorized,false);
});
test('Escort rechecks current native range at issue and consumption; bank DPS is total damage per cycle, not slot or shot size',()=>{
  const f=escortFixture();f.weapons.set(100,[
    {item:{itemID:1},snapshot:{family:'hybridTurret',durationMs:4000,rawShotDamage:{kinetic:500},optimalRange:7000}},
    {item:{itemID:2},snapshot:{family:'laserTurret',durationMs:2000,rawShotDamage:{em:150,thermal:150},optimalRange:19000,bankSize:3}},
    {item:{itemID:3},snapshot:{family:'projectileTurret',durationMs:1000,rawShotDamage:{explosive:120},optimalRange:5000}}]);
  f.tick();assert.equal(f.pilot1.s.pveAutomaticRange,19000);assert.equal(f.pilot1.s.pveJob.orbitRange,2500);
  f.rat(9);f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.orbitRange,19000);
  f.scene.dynamicEntities.clear();f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.orbitRange,2500);
  f.weapons.get(100)[1].snapshot.optimalRange=17000;assert.equal(f.action('authorizeOrbit').authorized,true);f.pilot1.s.pveOrbitOverride=9000;
  assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:2500}),false);
  f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.orbitRange,9000);
});
test('invalid native cycles cannot win range selection; idle Escort uses a close range with or without weapons',()=>{
  const f=escortFixture();f.weapons.get(100).push({item:{itemID:99},snapshot:{family:'hybridTurret',durationMs:NaN,rawShotDamage:{kinetic:10000},optimalRange:50000}});
  f.tick();assert.equal(f.pilot1.s.pveJob.orbitRange,2500);f.weapons.set(100,[]);f.pilot1.s.pveDronesEnabled=true;f.pilot1.s.pveDroneGroupKey='["named","group"]';f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.orbitRange,2500);
  f.rat(9);f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.targetID,null);assert.equal(f.pilot1.s.pveJob.orbitRange,0);assert.ok(f.orders.some(row=>row[0]==='launch'));
  f.scene.dynamicEntities.clear();f.advance(1000);f.tick();assert.equal(f.pilot1.s.pveJob.targetID,200);
  const standby=escortFixture();standby.pilot1.s.pveMode='standby';standby.tick();assert.equal(standby.pilot1.s.pveJob.targetID,null);
});
test('Escort Stop revokes pending anchor grant and preserves unrelated manual modules',()=>{
  const f=escortFixture();f.tick();f.action('authorizeOrbit');f.pilot1.ship.activeModuleEffects.set(500,{manual:true});
  f.pve.stop(f.pilot1.session,f.pilot1.s,f.scene,f.pilot1.ship);assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:2500}),false);
  assert.equal(f.pilot1.ship.activeModuleEffects.has(500),true);
});
test('exact stale issued orbits skip once without permission widening; wrong manual input and stopped jobs never skip',()=>{
  for(const mutate of [f=>f.anchorAllowed=false,f=>f.anchor.session={...f.anchor.session},f=>{f.pilot1.s.pveOrbitOverride=9000;},f=>f.advance(2001)]){
    const f=escortFixture();f.tick();f.action('authorizeOrbit');mutate(f);
    assert.deepEqual(f.pve.orbitNavigation(f.pilot1.session,{targetID:200,range:2500}),{allowed:false,skipped:true});
    assert.equal(f.pilot1.s.enabled,true);assert.deepEqual(f.pve.orbitNavigation(f.pilot1.session,{targetID:200,range:2500}),{allowed:false,skipped:false});
  }
  const f=escortFixture();f.rat(9);f.tick();f.action('authorizeOrbit');f.scene.dynamicEntities.clear();f.advance(1000);f.tick();
  assert.deepEqual(f.pve.orbitNavigation(f.pilot1.session,{targetID:9,range:10000}),{allowed:false,skipped:true});assert.equal(f.pilot1.s.pveJob.targetID,200);
  const g=escortFixture();g.tick();g.action('authorizeOrbit');assert.deepEqual(g.pve.orbitNavigation(g.pilot1.session,{targetID:999,range:2500}),{allowed:false,skipped:false});
  g.pve.stop(g.pilot1.session,g.pilot1.s,g.scene,g.pilot1.ship);assert.deepEqual(g.pve.orbitNavigation(g.pilot1.session,{targetID:200,range:2500}),{allowed:false,skipped:false});
  const expired=escortFixture();expired.tick();expired.action('authorizeOrbit');expired.advance(5001);
  assert.deepEqual(expired.pve.orbitNavigation(expired.pilot1.session,{targetID:200,range:2500}),{allowed:false,skipped:false});
  for(const mutate of [h=>h.pilot1.s.enabled=false,h=>h.pilot1.session.shipid=101,h=>{h.pilot1.s.defenseEnabled=true;h.pilot1.s.defenseShieldEnabled=true;h.pilot1.s.defenseShieldThreshold=50;h.pilot1.ship.shieldCapacity=100;h.pilot1.ship.conditionState={shieldCharge:0.2};}]){
    const h=escortFixture();h.tick();h.action('authorizeOrbit');mutate(h);
    assert.deepEqual(h.pve.orbitNavigation(h.pilot1.session,{targetID:200,range:2500}),{allowed:false,skipped:false});
  }
});

test('paused escort can stop its exact owned orbit; a manual motion change after approval revokes Stop',()=>{
  for(const changed of [false,true]){
    const f=escortFixture();f.tick();f.action('authorizeOrbit');
    assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:2500}),true);
    f.pilot1.ship.mode='ORBIT';f.pilot1.ship.targetEntityID=200;f.pilot1.ship.orbitDistance=2500;
    Object.assign(f.pilot1.s.pveJob,{phase:'routeFleet',paused:true,targetID:null,orbitRange:0,orbitKind:null});
    assert.equal(f.action('authorizeStopOrbit').authorized,true);
    if(changed)f.pilot1.ship.targetEntityID=999;
    assert.equal(f.pve.allowNavigation(f.pilot1.session,'stop',{}),!changed);
  }
});

test('losing the last escort anchor retains the owned orbit through real combat cleanup until native Stop',()=>{
  for(const origin of ['tick','poll']){
    let lost=false;
    const pause=s=>{if(lost)Object.assign(s.pveJob,{phase:'routeFleet',paused:true,targetID:null,orbitRange:0,orbitKind:null});};
    const f=escortFixture({tick:(_session,s)=>{pause(s);return !lost;},action:(_session,s)=>{pause(s);return {authorized:false};}});
    f.tick();f.action('authorizeOrbit');
    assert.equal(f.pve.allowNavigation(f.pilot1.session,'orbit',{targetID:200,range:2500}),true);
    Object.assign(f.pilot1.ship,{mode:'ORBIT',targetEntityID:200,orbitDistance:2500});
    const owned=f.pilot1.s.pveOwnedOrbit;
    const effect={targetID:9};f.pilot1.ship.activeModuleEffects.set(1000,effect);f.pilot1.s.pveOwned.set(1000,effect);
    lost=true;f.advance(1000);
    if(origin==='tick')f.tick();else f.action('poll');
    assert.equal(f.pilot1.s.pveQuiet,true);
    assert.equal(f.pilot1.ship.activeModuleEffects.has(1000),false);
    assert.equal(f.pilot1.s.pveOwnedOrbit,owned);
    assert.equal(f.action('authorizeStopOrbit').authorized,true);
    assert.equal(f.pve.allowNavigation(f.pilot1.session,'stop',{}),true);
    assert.equal(f.pilot1.s.pveOwnedOrbit,null);
    assert.equal(f.pilot1.s.enabled,true);
    assert.equal(f.pve.allowNavigation(f.pilot1.session,'stop',{}),false);
  }
});
