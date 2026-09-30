"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createTransport}=require("../lib/transport");
function fixture() {
  let now=100000,jets=0;
  const sessions=new Map(),states=new Map(),membership=new Map(),inventory=new Map(),cans=new Map(),events=[];
  const scene={systemID:300,entities:new Map(),getEntityByID(id){return this.entities.get(id);},getShipEntityForSession(s){return s.ship;}};
  const fleet=id=>({fleetID:id,members:new Map(),advert:{fleetName:"Fleet "+id}}),a=fleet(10),b=fleet(20);
  function pilot(id,job,fl=null,docked=false) {
    const session={characterID:id,shipid:id*100,shipTypeID:job==="hauling"?656:100,scene:scene,
      stationid:docked?600:0,sendNotification(name,target,args){events.push({id,name,args});}};
    session.ship={itemID:session.shipid,typeID:session.shipTypeID,position:{x:0,y:0,z:0},mode:"STOP"};
    const s={enabled:true,job,shipRole:job==="hauling"?"transport":"mining",oreMode:"pickup",pickupStyle:"binFirst",transportEnabled:true,transportClientReady:true,transportStationID:600,transportStorageKey:"personal",transportThreshold:95,transportStationReady:true};
    sessions.set(id,session);states.set(id,s);inventory.set(session.shipid,[]);
    if(fl){membership.set(id,fl);fl.members.set(id,{characterID:id});}
    return {session,s,ship:session.ship};
  }
  const miner=pilot(1,"mining",a),hauler=pilot(2,"hauling",null,true);
  inventory.set(100,[{itemID:7,typeID:10,quantity:40}]);
  const native={type:id=>({published:true,volume:2}),ore:r=>r.typeID===10,list:(s,id)=>inventory.get(id)||[],can:id=>cans.get(id),
    right:(s,c)=>c.abandoned||membership.get(s.characterID)?.fleetID===c.lootFleetID,local:()=>true,
    capacity:(s,id,flag)=>({capacity:flag===134?100:0,used:(inventory.get(id)||[]).reduce((n,r)=>n+r.quantity*2,0)}),
    fleets:{FLEET:{FLEET_ROLE_MEMBER:4},runtimeState:{invitesByCharacter:new Map()},
      inviteCharacter(session,fleetID,id,wing,squad,role,options){assert.equal(membership.get(session.characterID)?.fleetID,fleetID);assert.equal(options.autoAccept,true);assert.equal(options.inviterCharID,undefined);assert.equal(membership.has(id),false);this.runtimeState.invitesByCharacter.set(id,{fleetID,inviterCharID:session.characterID});events.push({invite:id,fleetID});},
      rejectInvite(session,fleetID){assert.equal(this.runtimeState.invitesByCharacter.get(session.characterID).fleetID,fleetID);this.runtimeState.invitesByCharacter.delete(session.characterID);events.push({reject:session.characterID});},
      initFleet(session,id){assert.equal(membership.get(session.characterID)?.fleetID,id);events.push({init:id});},
      leaveFleet(session,id){const f=membership.get(session.characterID);assert.equal(f.fleetID,id);f.members.delete(session.characterID);membership.delete(session.characterID);events.push({leave:session.characterID});}}};
  const dest={stored:{},station:id=>({stationID:id,systemID:301}),storage:()=>({key:"personal",locationID:600,flagID:4}),totals:()=>({...dest.stored})};
  const transport=createTransport({getSpace:()=>({getSceneForSession:s=>s.scene}),getFleet:id=>membership.get(id)||null,getSession:id=>sessions.get(id),getState:s=>states.get(s.characterID),destinations:dest,clock:()=>now,native,
    oreHandling:{jettison(session,s,sc,ship){jets++;const id=900;cans.set(id,{itemID:id,typeID:23,ownerID:session.characterID,locationID:300,createdAtMs:1,expiresAtMs:now+1000000,lootFleetID:membership.get(session.characterID)?.fleetID});scene.entities.set(id,{itemID:id,position:{...ship.position},radius:0});inventory.set(id,(inventory.get(id)||[]).concat(inventory.get(ship.itemID)));inventory.set(ship.itemID,[]);s.jettisonCan={containerID:id};}},
    statistics:{recordTransport(session,id,kind){events.push({stat:kind,fleetID:membership.get(session.characterID)?.fleetID});}}});
  const tick=p=>transport.tick(p.session,p.s,p.session.scene,p.ship);
  function action(name,p=hauler,payload={}){const op=p.s.transportJob;return transport.action(p.session,p.s,op.id,name,{nonce:op.nonce,...payload});}
  function accept(p=hauler) {const invite=native.fleets.runtimeState.invitesByCharacter.get(p.session.characterID);assert.ok(invite);const fl=invite.fleetID===a.fleetID?a:b;membership.set(p.session.characterID,fl);fl.members.set(p.session.characterID,{characterID:p.session.characterID});native.fleets.runtimeState.invitesByCharacter.delete(p.session.characterID);}
  function assign(){transport.request(miner.session,miner.s);tick(hauler);}
  function arrive(){assign();accept();action("poll");hauler.session.stationid=0;action("poll");now+=3000;action("poll");action("poll");action("authorizeWarp");assert.equal(hauler.s.transportJob.phase,"approachPickup");action("arrived");}
  return {transport,miner,hauler,scene,a,b,native,sessions,states,membership,inventory,cans,events,dest,pilot,tick,action,accept,assign,arrive,advance:n=>now+=n,get jets(){return jets;}};
}
test("unfleeted docked hauler claims global FIFO and cannot move before actual native acceptance",()=>{
  const f=fixture();f.assign();assert.equal(f.hauler.s.transportJob.phase,"joining");assert.equal(f.transport.view(f.hauler.session,f.hauler.s).binReservation.canID,900);
  assert.equal(f.events.find(e=>e.invite).fleetID,10);assert.equal(f.events.some(e=>e.init),false);
  assert.throws(()=>f.action("authorizeWarp"),/Not ready/);assert.equal(f.hauler.session.stationid,600);
  f.action("poll");assert.equal(f.hauler.s.transportJob.phase,"joining");f.accept();f.action("poll");assert.equal(f.hauler.s.transportJob.phase,"undocking");assert.equal(f.events.find(e=>e.init).init,10);
});
test("same abandoned can requested by two fleets has one request and one global claim",()=>{
  const f=fixture();f.transport.request(f.miner.session,f.miner.s);f.cans.get(900).abandoned=true;
  const second=f.pilot(3,"mining",f.b);second.s.jettisonCan={containerID:900};f.transport.request(second.session,second.s);
  assert.equal(f.transport.view(second.session,second.s).pool.requests,1);f.tick(f.hauler);
  const other=f.pilot(4,"hauling",null,true);f.tick(other);assert.equal(other.s.transportJob,undefined);assert.equal(f.events.filter(e=>e.invite).length,1);
  f.transport.cancel(second.session,second.s);assert.equal(f.transport.view(second.session,second.s).request,null);assert.equal(f.transport.view(second.session,second.s).pool.requests,1);
});
test("temporary claim survives native can despawn and delivery records before exact owned leave",()=>{
  const f=fixture();f.arrive();f.action("authorizeTransfer");f.inventory.delete(900);f.cans.delete(900);f.scene.entities.delete(900);f.inventory.set(200,[{itemID:70,typeID:10,quantity:40}]);f.action("loaded",f.hauler,{itemID:7});
  assert.equal(f.hauler.s.transportJob.phase,"outbound");assert.equal(f.transport.view(f.hauler.session,f.hauler.s).binReservation.canID,900);
  f.miner.s.enabled=false;f.hauler.session.scene={...f.scene,systemID:301};f.action("poll");assert.ok(f.hauler.s.transportJob);
  for(let i=0;i<20;i++){f.advance(30000);f.action("poll");}
  assert.equal(f.transport.view(f.hauler.session,f.hauler.s).binReservation.canID,900,"ordinary outbound heartbeats retain the global claim on a long trip");
  f.hauler.session.stationid=600;f.action("poll");f.action("authorizeUnload");f.inventory.set(200,[]);f.dest.stored[10]=40;
  const reply=f.action("unloaded");assert.equal(reply.job,null);assert.equal(f.hauler.s.transportFleetLease,null);assert.equal(f.membership.has(2),false);
  const stat=f.events.findIndex(e=>e.stat==="delivery"),leave=f.events.findIndex(e=>e.leave===2);assert.ok(stat<leave);assert.equal(f.events[stat].fleetID,10);
});
test("manual native fleet is neither stolen for another fleet nor automatically left",()=>{
  const f=fixture();f.membership.set(2,f.b);f.b.members.set(2,{characterID:2});f.transport.request(f.miner.session,f.miner.s);f.tick(f.hauler);
  assert.equal(f.hauler.s.transportJob,undefined);assert.match(f.hauler.s.transportStatus,/leave the current fleet/);assert.equal(f.events.some(e=>e.invite),false);
  f.membership.set(2,f.a);f.b.members.delete(2);f.a.members.set(2,{characterID:2});f.tick(f.hauler);assert.equal(f.hauler.s.transportFleetLease,undefined);
  f.transport.cancel(f.hauler.session,f.hauler.s);assert.equal(f.membership.get(2),f.a);assert.equal(f.events.some(e=>e.leave),false);
});
test("cancellation retains temporary membership until docking and never leaves replacement membership",()=>{
  const f=fixture();f.assign();f.accept();f.action("poll");f.hauler.session.stationid=0;f.transport.cancel(f.hauler.session,f.hauler.s,"Defense");
  assert.equal(f.hauler.s.transportFleetLease.cleanupPending,true);assert.equal(f.membership.get(2),f.a);f.hauler.session.stationid=600;f.transport.cleanup(f.hauler.session,f.hauler.s);assert.equal(f.membership.has(2),false);
  const g=fixture();g.assign();g.accept();g.action("poll");g.hauler.session.stationid=0;g.transport.cancel(g.hauler.session,g.hauler.s);g.membership.set(2,g.b);g.b.members.set(2,{characterID:2});g.hauler.session.stationid=600;g.transport.cleanup(g.hauler.session,g.hauler.s);assert.equal(g.membership.get(2),g.b);assert.equal(g.events.some(e=>e.leave),false);
});
test("join timeout withdraws only its own invite, frees claim, and allows another hauler",()=>{
  const f=fixture();f.assign();f.advance(60001);f.hauler.s.transportJob.heartbeat=160001;f.tick(f.hauler);assert.equal(f.hauler.s.enabled,false);assert.equal(f.hauler.s.transportFleetLease,null);assert.equal(f.events.some(e=>e.reject===2),true);
  const other=f.pilot(4,"hauling",null,true);f.tick(other);assert.equal(other.s.transportJob.phase,"joining");
});
test("reused can ID and disconnected lease owner cannot retain or revive an old claim",()=>{
  const f=fixture();f.assign();f.sessions.delete(2);const other=f.pilot(4,"hauling",null,true);f.tick(other);assert.equal(f.hauler.s.transportJob,null);assert.equal(f.hauler.s.enabled,false);assert.equal(other.s.transportJob.phase,"joining");
  const g=fixture();g.assign();g.cans.get(900).createdAtMs=2;g.tick(g.hauler);assert.equal(g.hauler.s.transportJob,null);assert.equal(g.transport.view(g.miner.session,g.miner.s).pool.requests,0);
});
test("miner preflight identifies disabled job and wrong ore mode without enabling anything",()=>{
  const f=fixture();f.miner.s.oreMode="unload";assert.throws(()=>f.transport.request(f.miner.session,f.miner.s),/Choose Fleet pickup/);assert.equal(f.jets,0);f.miner.s.enabled=false;assert.throws(()=>f.transport.request(f.miner.session,f.miner.s),/Start the Mining job/);assert.equal(f.miner.s.enabled,false);
});
test("manual undock while join is pending cancels the assigned automation",()=>{
  const f=fixture();f.assign();f.hauler.session.stationid=0;f.tick(f.hauler);assert.equal(f.hauler.s.transportJob,null);assert.equal(f.events.some(e=>e.init),false);
});
test("failed invitation notification withdraws its own invite; replacement invite is never rejected",()=>{
  const f=fixture(),original=f.native.fleets.inviteCharacter;
  f.native.fleets.inviteCharacter=function(...args){original.apply(this,args);throw Error("native notification failed");};
  f.assign();assert.equal(f.hauler.s.transportJob,null);assert.equal(f.hauler.s.transportFleetLease,null);assert.equal(f.events.some(e=>e.reject===2),true);
  const g=fixture();g.assign();const replacement={fleetID:20,inviterCharID:3};g.native.fleets.runtimeState.invitesByCharacter.set(2,replacement);g.tick(g.hauler);
  assert.equal(g.hauler.s.transportJob,null);assert.equal(g.native.fleets.runtimeState.invitesByCharacter.get(2),replacement);assert.equal(g.events.some(e=>e.reject),false);
});
