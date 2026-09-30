"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createTransport}=require("../lib/transport");
function fixture() {
  let time=100000,saveError="",coreReady=true,jets=0;
  const members=new Map(),fleet={fleetID:10,members},states=new Map(),inventory=new Map(),canRecords=new Map(),events=[],receipts=[];
  const scene={systemID:300,instanceID:null,entities:new Map(),getEntityByID(id){return this.entities.get(id);},getShipEntityForSession(s){return s.ship;},getCurrentSimTimeMs:()=>900000};
  function pilot(id,typeID,role) {
    const session={characterID:id,shipid:id*100,shipTypeID:typeID,sendNotification(name,target,args){events.push({id,name,data:JSON.parse(args[0])});}};
    session.ship={itemID:session.shipid,typeID,mode:"STOP",position:{x:0,y:0,z:0},activeModuleEffects:new Map()};session.scene=scene;
    members.set(id,session);const s={enabled:true,shipRole:role,oreMode:"pickup",transportEnabled:true,transportClientReady:true,transportStationID:600,transportStorageKey:"personal",transportThreshold:95,transportIdleSeconds:60};states.set(id,s);inventory.set(session.shipid,[]);return {session,s,ship:session.ship};
  }
  const miner=pilot(1,100,"boosting"),hauler=pilot(2,656,"transport");
  hauler.ship.position.x=200000;
  inventory.set(miner.ship.itemID,[{itemID:7,typeID:10,quantity:40}]);
  const native={type:id=>({typeID:id,published:true,volume:2}),ore:r=>r.typeID===10,
    list:(s,id)=>inventory.get(id)||[],can:id=>canRecords.get(id),right:(s,c)=>c.right!==false,local:(a,b)=>!a.private&&!b.private,
    capacity:(s,id,flag)=>({capacity:flag===134?100:0,used:(inventory.get(id)||[]).reduce((n,r)=>n+r.quantity*2,0)})};
  const dest={station:()=>({stationID:600,systemID:301}),storage:()=>({key:"personal",locationID:600,flagID:4}),totals:()=>({...dest.stored}),stored:{},cargo:(s,id)=>inventory.get(id)||[]};
  const ore={jettison(session,s,sc,ship,hold,now){jets++;const id=900;canRecords.set(id,{itemID:id,typeID:23,locationID:sc.systemID});scene.entities.set(id,{itemID:id,position:{...ship.position},radius:0});inventory.set(id,(inventory.get(id)||[]).concat(inventory.get(ship.itemID)));inventory.set(ship.itemID,[]);s.jettisonCan={containerID:id,shipID:ship.itemID,systemID:sc.systemID};}};
  let randomCalls=0;
  const transport=createTransport({getSpace:()=>({getSceneForSession:s=>s.scene}),getFleet:id=>members.has(id)?fleet:null,getSession:id=>members.get(id),getState:s=>states.get(s.characterID),destinations:dest,oreHandling:ore,industrial:{requestDeparture:()=>coreReady},save:()=>saveError,clock:()=>time,native,random:()=>{randomCalls++;return .25;},statistics:{recordTransport(...args){receipts.push(args);}}});
  function action(name,extra={}){const op=hauler.s.transportJob;return transport.action(hauler.session,hauler.s,op.id,name,{nonce:op.nonce,...extra});}
  function assign(){transport.request(miner.session,miner.s);transport.tick(hauler.session,hauler.s,hauler.session.scene,hauler.ship);}
  function arrive(){assign();action("poll");action("authorizeWarp");assert.equal(transport.allowNavigation(hauler.session,"warp",{warpType:"char",targetID:1,minRange:0,fleet:false}),true);action("warped");hauler.ship.position.x=0;action("arrived");}
  return {transport,miner,hauler,scene,native,inventory,canRecords,members,states,events,receipts,dest,action,assign,arrive,pilot,get jets(){return jets;},get randomCalls(){return randomCalls;},setTime:n=>time=n,advance:n=>time+=n,core:v=>coreReady=v,saveFails:()=>saveError="error"};
}
test("eligibility is exact native type plus actual positive mining hold",()=>{const f=fixture();assert.equal(f.transport.eligibility(f.hauler.session,f.hauler.ship).eligible,true);f.hauler.ship.typeID=4363;assert.equal(f.transport.eligibility(f.hauler.session,f.hauler.ship).eligible,false);f.hauler.ship.typeID=42244;assert.equal(f.transport.eligibility(f.hauler.session,f.hauler.ship).dualRole,true);});
test("duplicate requests and competing haulers create only one lease",()=>{const f=fixture();f.assign();f.transport.request(f.miner.session,f.miner.s);const other=f.pilot(3,656,"transport");f.transport.tick(other.session,other.s,f.scene,other.ship);assert.equal(other.s.transportJob,undefined);assert.equal(f.transport.view(f.miner.session,f.miner.s).queue.length,1);assert.ok(f.hauler.s.transportInterrupted);});
test("cross-system route and native arrival range precede jettison",()=>{const f=fixture();f.hauler.session.scene={...f.scene,systemID:299};f.assign();f.action("poll");assert.equal(f.hauler.s.transportJob.phase,"routePickup");assert.equal(f.jets,0);f.hauler.session.scene=f.scene;f.action("poll");f.action("authorizeWarp");f.action("warped");f.hauler.ship.radius=600;f.miner.ship.radius=100;f.hauler.ship.position.x=801;f.action("arrived");assert.equal(f.jets,0);f.hauler.ship.position.x=800;f.action("arrived");assert.equal(f.jets,1);assert.equal(f.hauler.s.transportJob.phase,"loading");});
test("warp grant is exact, expires and is single use",()=>{const f=fixture();f.assign();f.action("poll");f.action("authorizeWarp");const a={warpType:"char",targetID:1,minRange:0,fleet:false};assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",{...a,fleet:true}),false);assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",a),true);assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",a),false);f.action("authorizeWarp");f.advance(2001);assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",a),false);});

function arrivalPermit(f) {
 f.assign();f.action("poll");f.action("authorizeWarp");
 const args={warpType:f.hauler.s.transportJob.request.binFirst?"item":"char",targetID:f.hauler.s.transportJob.request.binFirst?900:1,minRange:0,fleet:false};
 assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",args),true);
 return f.transport.takeWarpArrival(f.hauler.session,args);
}
test("random pickup arrival is server-owned one sample per job with hull clearance and exact native target",()=>{
 const f=fixture();f.hauler.ship.radius=250;f.miner.ship.radius=350;
 const p=arrivalPermit(f),options={targetEntityID:100,stopDistance:1000,destinationStaticInstanceID:null};
 const result=f.transport.planWarpArrival(f.hauler.session,p,f.scene,f.miner.ship.position,options);
 assert(Math.abs(Math.hypot(result.point.x,result.point.y,result.point.z)-700)<1e-8);
 assert.notEqual(result.point.y,0);assert.equal(result.options.stopDistance,0);assert.equal(result.options.destinationStaticInstanceID,null);
 assert.equal(f.randomCalls,2);assert.throws(()=>f.transport.planWarpArrival(f.hauler.session,p,f.scene,f.miner.ship.position,options),/changed/);
 f.action("authorizeWarp");const a={warpType:"char",targetID:1,minRange:0,fleet:false};assert(f.transport.allowNavigation(f.hauler.session,"warp",a));
 const p2=f.transport.takeWarpArrival(f.hauler.session,a);
 assert.deepEqual(f.transport.planWarpArrival(f.hauler.session,p2,f.scene,f.miner.ship.position,options).point,result.point);assert.equal(f.randomCalls,2);
});
test("replaced cancelled ship-changed or wrong native target permits cannot alter arrival",()=>{
 for(const change of [f=>f.action("authorizeWarp"),f=>f.transport.cancel(f.hauler.session,f.hauler.s,"Stopped"),
     f=>f.hauler.session.shipid=999,f=>f.members.delete(1)]) {
   const f=fixture(),p=arrivalPermit(f);change(f);
   assert.throws(()=>f.transport.planWarpArrival(f.hauler.session,p,f.scene,f.miner.ship.position,{targetEntityID:100}),/changed|belongs|miner/);
   assert.equal(f.randomCalls,0);
 }
 const f=fixture(),p=arrivalPermit(f);
 assert.throws(()=>f.transport.planWarpArrival(f.hauler.session,p,f.scene,{x:99,y:0,z:0},{targetEntityID:100}),/changed/);
 assert.throws(()=>f.transport.planWarpArrival(f.hauler.session,p,f.scene,f.miner.ship.position,{targetEntityID:999}),/changed/);
});
test("bin landing clears requesting barge and stays collectible without approaching back into overlap",()=>{
 const f=fixture();f.miner.s.pickupStyle="binFirst";f.hauler.ship.radius=250;f.miner.ship.radius=700;
 const p=arrivalPermit(f),can=f.scene.entities.get(900),plan=f.transport.planWarpArrival(f.hauler.session,p,f.scene,can.position,{targetEntityID:900});
 assert(Math.abs(Math.hypot(plan.point.x,plan.point.y,plan.point.z)-1050)<1e-8);
 assert(Math.hypot(plan.point.x,plan.point.y,plan.point.z)<=2500);
 f.action("warped");f.hauler.ship.position=plan.point;const authorized=f.action("authorizeApproach");
 assert.equal(authorized.job.approachNeeded,false);assert.equal(authorized.job.approachRange,100);f.action("arrived");assert.equal(f.hauler.s.transportJob.phase,"loading");
});
test("native approach grant accepts only server surface clearance",()=>{
 const f=fixture();f.hauler.ship.position.x=20000;f.assign();f.action("poll");f.action("authorizeWarp");
 const response=f.action("authorizeApproach");assert.equal(response.job.approachNeeded,true);assert.equal(response.job.approachRange,100);
 assert.equal(f.transport.allowNavigation(f.hauler.session,"approach",{targetID:100,range:0}),false);
 assert.equal(f.transport.allowNavigation(f.hauler.session,"approach",{targetID:100,range:100}),true);
});
test("large native coordinates keep nominal hundred-metre arrival within tiny surface tolerance",()=>{
 const f=fixture();f.miner.ship.position={x:1e12,y:-1e12,z:1e12};f.hauler.ship.position={x:1e12+200000,y:-1e12,z:1e12};
 f.miner.ship.radius=350;f.hauler.ship.radius=250;
 const p=arrivalPermit(f),plan=f.transport.planWarpArrival(f.hauler.session,p,f.scene,f.miner.ship.position,{targetEntityID:100});
 f.action("warped");f.hauler.ship.position=plan.point;
 assert.equal(f.action("authorizeApproach").job.approachNeeded,false);
 f.hauler.ship.position.y+=2;assert.equal(f.action("authorizeApproach").job.approachNeeded,true);
});
test("old nonce cannot mutate but poll refreshes safely",()=>{const f=fixture();f.assign();const old=f.hauler.s.transportJob.nonce;f.action("poll");assert.throws(()=>f.transport.action(f.hauler.session,f.hauler.s,f.hauler.s.transportJob.id,"authorizeWarp",{nonce:old}),/token expired/);assert.ok(f.transport.action(f.hauler.session,f.hauler.s,f.hauler.s.transportJob.id,"poll",{nonce:old}).job);});
test("core cycle wait registers no lease or movement",()=>{const f=fixture();f.core(false);f.assign();assert.equal(f.hauler.s.transportJob,undefined);assert.equal(f.transport.view(f.hauler.session,f.hauler.s).registered,false);assert.equal(f.jets,0);});
test("private instance, miner ship change and fleet removal fail closed",()=>{for(const mutate of [f=>f.miner.ship.dungeonCurrentInstanceID=3,f=>f.miner.session.shipid=999,f=>f.members.delete(1)]){const f=fixture();f.assign();mutate(f);assert.throws(()=>f.action("poll"));assert.equal(f.hauler.s.transportJob,null);assert.equal(f.jets,0);}});
test("receipt verifies both inventory sides and records only actual ore",()=>{const f=fixture();f.arrive();assert.equal(f.hauler.s.transportJob.transfer.quantity,40);const reply=f.action("authorizeTransfer");assert.equal(reply.authorized,true);assert.throws(()=>f.action("loaded",{itemID:7}),/receipt/);assert.equal(f.receipts.length,0);f.inventory.set(900,[]);f.inventory.set(200,[{itemID:70,typeID:10,quantity:40}]);f.action("loaded",{itemID:7});assert.equal(f.receipts.length,1);assert.equal(f.receipts[0][3],80);assert.equal(f.hauler.s.transportJob,null);assert.equal(f.receipts[0][4],true);});
test("bounded transfer leaves can remainder for a future lease",()=>{const f=fixture();f.inventory.set(100,[{itemID:7,typeID:10,quantity:100}]);f.arrive();f.action("authorizeTransfer");assert.equal(f.hauler.s.transportJob.transfer.quantity,50);f.inventory.set(900,[{itemID:7,typeID:10,quantity:50}]);f.inventory.set(200,[{itemID:70,typeID:10,quantity:50}]);f.action("loaded",{itemID:7});assert.equal(f.hauler.s.transportJob.phase,"outbound");f.transport.cancel(f.hauler.session,f.hauler.s,"Defense");assert.equal(f.hauler.s.enabled,true);assert.equal(f.inventory.get(900)[0].quantity,50);assert.equal(f.transport.view(f.miner.session,f.miner.s).queue[0].claimed,false);});
test("old can without snapshot fleet rights never triggers new jettison",()=>{const f=fixture();f.assign();f.action("poll");f.action("authorizeWarp");f.action("warped");f.hauler.ship.position.x=0;f.miner.s.jettisonCan={containerID:800};f.canRecords.set(800,{typeID:23,right:false});f.scene.entities.set(800,{position:{x:0,y:0,z:0}});assert.throws(()=>f.action("arrived"),/loot rights/);assert.equal(f.jets,0);});
test("unload requires native destination receipt and authorized exact storage",()=>{const f=fixture();f.arrive();f.action("authorizeTransfer");f.inventory.set(900,[]);f.inventory.set(200,[{itemID:70,typeID:10,quantity:40}]);f.action("loaded",{itemID:7});f.advance(60000);f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);f.hauler.session.stationid=600;f.hauler.session.scene=null;f.action("poll");f.action("authorizeUnload");assert.throws(()=>f.action("unloaded"),/remains/);f.inventory.set(200,[]);assert.throws(()=>f.action("unloaded"),/selected storage/);f.dest.stored[10]=40;f.action("unloaded");assert.equal(f.hauler.s.transportJob.phase,"undocking");assert.equal(f.receipts[1][2],"delivery");});
test("save failure emits no navigation job and disables failed hauler",()=>{const f=fixture();f.saveFails();f.assign();assert.equal(f.hauler.s.enabled,false);assert.equal(f.hauler.s.transportJob,null);assert.equal(f.events.filter(e=>e.name==="OnAutoMiningTransport"&&e.data.phase).length,0);});
test("client timeout releases lease; cancellation accepts stale token",()=>{const f=fixture();f.assign();const op=f.hauler.s.transportJob;f.action("poll");f.transport.action(f.hauler.session,f.hauler.s,op.id,"cancel",{nonce:"stale"});assert.equal(f.hauler.s.enabled,false);f.hauler.s.enabled=true;f.assign();f.advance(45001);f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);assert.equal(f.hauler.s.enabled,false);assert.equal(f.transport.view(f.miner.session,f.miner.s).queue[0].claimed,false);});
test("validated client cancellation retains bounded failure text without changing release or ownership",()=>{
  const f=fixture();f.miner.s.pickupStyle="binFirst";f.assign();
  const reply=f.action("cancel",{reason:"\nNative warp failed\x00"+"x".repeat(250)});
  assert.equal(reply.status,"Transport paused: "+("Native warp failed "+"x".repeat(250)).slice(0,200));
  assert.equal(f.hauler.s.enabled,false);assert.equal(reply.job,null);assert.equal(reply.binReservation,null);assert.equal(reply.queue[0].claimed,false);
  const g=fixture();g.assign();g.action("cancel",{reason:{role:"boss",fleetID:10}});assert.equal(g.hauler.s.transportStatus,"Transport cancelled by client.");
});
test("inactive transport tick never disables a miner outside a fleet",()=>{const f=fixture();f.members.delete(1);f.transport.tick(f.miner.session,f.miner.s,f.scene,f.miner.ship,{full:true});assert.equal(f.miner.s.enabled,true);assert.equal(f.jets,0);});
test("native last-stack despawn still verifies the authorized receipt",()=>{const f=fixture();f.arrive();f.action("authorizeTransfer");f.inventory.delete(900);f.canRecords.delete(900);f.scene.entities.delete(900);f.inventory.set(200,[{itemID:70,typeID:10,quantity:40}]);f.action("loaded",{itemID:7});assert.equal(f.hauler.s.transportJob,null);assert.equal(f.receipts[0][3],80);assert.equal(f.receipts[0][4],true);});
test("partial pickup waits for idle flush and can accept another queued miner",()=>{const f=fixture();f.arrive();f.action("authorizeTransfer");f.inventory.set(900,[]);f.inventory.set(200,[{itemID:70,typeID:10,quantity:40}]);f.action("loaded",{itemID:7});f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);assert.equal(f.hauler.s.transportJob,null);const next=f.pilot(3,100,"boosting");f.inventory.set(300,[{itemID:9,typeID:10,quantity:10}]);f.transport.request(next.session,next.s);f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);assert.equal(f.hauler.s.transportJob.request.characterID,3);});
test("native scope resolver rejects Abyssal, AIR and invalid identity scope",()=>{for(const scope of [{scoped:true,valid:true,hasAbyssalScope:true},{scoped:true,valid:true,hasAirScope:true},{scoped:false,valid:false}]){const f=fixture();f.native.scope=()=>scope;assert.throws(()=>f.transport.request(f.miner.session,f.miner.s),/private space/);assert.equal(f.jets,0);}});

test("miner Defense cancels the pickup before any arrival jettison",()=>{
  const f=fixture(); f.assign();
  f.miner.s.defenseEnabled=true;f.miner.s.defenseShieldEnabled=true;f.miner.s.defenseShieldThreshold=50;
  f.miner.ship.shieldCapacity=100;f.miner.ship.conditionState={shieldCharge:0.2};
  assert.throws(()=>f.action("poll"),/Pickup miner/);assert.equal(f.jets,0);
});

test("nearby miner uses approach instead of an illegal short-distance warp",()=>{
  const f=fixture();f.hauler.ship.position.x=20000;f.assign();f.action("poll");
  const result=f.action("authorizeWarp");assert.equal(result.authorized,false);
  assert.equal(f.hauler.s.transportJob.phase,"approachPickup");
  assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",{warpType:"char",targetID:1,minRange:0,fleet:false}),false);
  assert.equal(f.jets,0);
});

test("another hauler reclaims a disconnected owner's queued lease",()=>{
  const f=fixture();f.assign();const oldID=f.hauler.s.transportJob.id;
  f.members.delete(2);const next=f.pilot(3,656,"transport");
  f.transport.tick(next.session,next.s,f.scene,next.ship);
  assert.ok(next.s.transportJob);assert.notEqual(next.s.transportJob.id,oldID);
  assert.equal(next.s.transportJob.request.characterID,1);
  assert.equal(next.s.transportJob.request.haulerID,3);
  assert.equal(f.hauler.s.transportJob,null);assert.equal(f.hauler.s.enabled,false);
  assert.equal(f.hauler.s.transportInterrupted,false);assert.equal(f.jets,0);
});

test("assignment reclaims connected owner with an expired heartbeat",()=>{
  const f=fixture();f.assign();const next=f.pilot(3,656,"transport");
  f.advance(45000);f.transport.tick(next.session,next.s,f.scene,next.ship);
  assert.equal(next.s.transportJob,undefined);assert.ok(f.hauler.s.transportJob);
  f.advance(1);f.transport.tick(next.session,next.s,f.scene,next.ship);
  assert.equal(next.s.transportJob.request.haulerID,3);
  assert.equal(f.hauler.s.transportJob,null);assert.equal(f.hauler.s.enabled,false);
  assert.equal(f.transport.view(f.miner.session,f.miner.s).queue.length,1);
});

test("Hauling first parks at its drop-off even with an empty hold",()=>{
  const f=fixture();f.hauler.s.job="hauling";
  f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);
  assert.equal(f.hauler.s.transportJob.phase,"outbound");assert.equal(f.jets,0);
  f.hauler.session.stationid=600;f.action("poll");
  assert.equal(f.hauler.s.transportJob,null);assert.equal(f.hauler.s.transportStationReady,true);
  f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);
  assert.equal(f.hauler.s.transportJob,null,"empty queue keeps the ship docked");
});
test("bin-first pickup dumps before travel and grants movement to the bin itself",()=>{
  const f=fixture();f.miner.s.job="mining";f.miner.s.pickupStyle="binFirst";f.assign();
  assert.equal(f.jets,1);assert.equal(f.inventory.get(100).length,0);
  f.action("poll");f.action("authorizeWarp");
  assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",{warpType:"char",targetID:1,minRange:0,fleet:false}),false);
  assert.equal(f.transport.allowNavigation(f.hauler.session,"warp",{warpType:"item",targetID:900,minRange:0,fleet:false}),true);
  f.action("warped");f.hauler.ship.position.x=0;f.action("arrived");
  assert.equal(f.jets,1,"arrival never creates another bin");assert.equal(f.hauler.s.transportJob.phase,"loading");
});
test("bin-first final native despawn still verifies inventory receipt",()=>{
  const f=fixture();f.miner.s.pickupStyle="binFirst";f.assign();f.action("poll");f.action("authorizeWarp");f.action("warped");
  f.hauler.ship.position.x=0;f.action("arrived");f.action("authorizeTransfer");
  f.inventory.set(900,[]);f.inventory.set(200,[{itemID:70,typeID:10,quantity:40}]);
  f.canRecords.delete(900);f.scene.entities.delete(900);f.action("loaded",{itemID:7});
  assert.equal(f.hauler.s.transportJob,null);assert.equal(f.receipts.length,1);
});
test("Hauling stays docked after confirmed delivery rather than undocking into an empty queue",()=>{
  const f=fixture();f.hauler.s.job="hauling";f.hauler.s.transportStationReady=true;
  f.inventory.set(200,[{itemID:70,typeID:10,quantity:50}]);
  f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);
  f.hauler.session.stationid=600;f.action("poll");f.action("authorizeUnload");
  f.inventory.set(200,[]);f.dest.stored={10:50};f.action("unloaded");
  assert.equal(f.hauler.s.transportJob,null);assert.equal(f.hauler.session.stationid,600);
  f.transport.tick(f.hauler.session,f.hauler.s,f.scene,f.hauler.ship);
  assert.equal(f.hauler.s.transportJob,null);
});
