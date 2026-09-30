"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createPVEDeployment}=require("../lib/pveDeployment");
function fixture({accept=true,canUndock=()=>true}={}){
  let now=100000,next=100,participantsReads=0;const sessions=new Map(),states=new Map(),fleets=new Map(),membership=new Map(),calls=[];
  const links=new Map([[300,[301,303]],[301,[300,302]],[302,[301,304]],[303,[300,304]],[304,[303,302]]]);
  const scenes=new Map([...links.keys()].map(sys=>[sys,{systemID:sys,entities:new Map(),getShipEntityForSession:s=>!s.stationid&&s.scene===scenes.get(sys)?s.ship:null,
    getEntityByID(id){return this.entities.get(id);},getLivePublicGridClusterKeyForEntity:e=>e?.grid}]));
  const gates=sys=>(links.get(sys)||[]).map(dest=>({itemID:sys*1000+dest,destinationSolarSystemID:dest}));
  for(const [sys,sc]of scenes)for(const g of gates(sys))sc.entities.set(g.itemID,{...g,kind:"stargate"});
  const runtime={FLEET:{FLEET_ROLE_MEMBER:4},runtimeState:{invitesByCharacter:new Map()},getFleetForCharacter:id=>membership.get(id),
    inviteCharacter(inviter,fid,id,w,q,role,opt){const f=membership.get(inviter.characterID);assert.equal(f.fleetID,fid);assert(f.members.has(inviter.characterID));assert.equal(role,4);assert.equal(opt.autoAccept,true);
      calls.push(["invite",id]);const invite={fleetID:fid,inviterCharID:inviter.characterID};runtime.runtimeState.invitesByCharacter.set(id,invite);if(accept)join(id,f);},
    reconnectCharacter(s,fid){const f=membership.get(s.characterID);assert.equal(f?.fleetID,fid);f.members.set(s.characterID,{...f.members.get(s.characterID)});s.fleetid=fid;calls.push(["reconnect",s.characterID,fid]);},
    initFleet(s,fid){calls.push(["init",s.characterID,fid]);},rejectInvite(s,fid){const i=runtime.runtimeState.invitesByCharacter.get(s.characterID);assert.equal(i.fleetID,fid);runtime.runtimeState.invitesByCharacter.delete(s.characterID);calls.push(["reject",s.characterID]);},
    leaveFleet(s,fid){assert.equal(membership.get(s.characterID).fleetID,fid);membership.get(s.characterID).members.delete(s.characterID);membership.delete(s.characterID);calls.push(["leave",s.characterID]);}};
  function join(id,f){f.members.set(id,{charID:id,job:0});membership.set(id,f);runtime.runtimeState.invitesByCharacter.delete(id);}
  function pilot(id,job="mining",sys=302){const session={characterID:id,characterName:"Pilot "+id,shipid:id*100,solarsystemid2:sys,scene:scenes.get(sys),sendNotification(name,target,args){calls.push(["notify",id,name]);}};
    session.ship={kind:"ship",itemID:session.shipid,pilotCharacterID:id,mode:"STOP",grid:"belt",typeID:1};
    const s={enabled:true,hudReady:true,job,fleetEnabled:false,pveMode:job==="pve"?"standby":"belt",pveClientReady:true,pveReadyAt:now,pveHomeStationID:4000,pveMaxJumps:2,reinforcementResponderLimit:1};
    if(job==="pve")session.stationid=4000;sessions.set(id,session);states.set(id,s);return {session,s,ship:session.ship};}
  function makeFleet(p){const f={fleetID:next++,members:new Map(),advert:{fleetName:"Miners"}};fleets.set(f.fleetID,f);join(p.session.characterID,f);return f;}
  const miner=pilot(1),f=makeFleet(miner),defender=pilot(2,"pve",300);
  const deployment=createPVEDeployment({getSpace:()=>({getSceneForSession:s=>s.scene}),getSession:id=>sessions.get(id),getState:s=>states.get(s.characterID),getFleet:id=>membership.get(id),getShip:s=>s.ship,
    getParticipants:()=>{participantsReads++;return [...sessions.values()].map(session=>({session,s:states.get(session.characterID),name:session.characterName}));},
    destinations:{station(id){if(id!==4000)throw Error("no station");return {stationID:id,systemID:300,name:"Home"};}},clock:()=>now,save:()=>"",canUndock,
    native:{fleets:runtime,scope:e=>({valid:true,scoped:!!e.private}),local:(a,b)=>a.grid===b.grid,gates,system:id=>({solarSystemName:"System "+id}),type:()=>({groupName:"Asteroid Guristas Frigate"})},
    onBegin:()=>calls.push(["reserve"]),onInterrupt:(session,s)=>deployment.cancel(session,s)});
  deployment.setAttackAvailable(true);
  function call(p=miner){return deployment.call(p.session,p.s);}
  function plan(p=defender,systems=[300,301,302],homeSystems=systems){const offer=deployment.view(p.session,p.s).offers[0];return deployment.plan(p.session,p.s,{offerID:offer.id,shipID:p.session.shipid,systems,homeSystems});}
  function action(name,p=defender,extra={}){return deployment.action(p.session,p.s,p.s.pveJob,name,{nonce:p.s.pveJob.nonce,...extra});}
  function tick(p=defender){return deployment.tick(p.session,p.s,p.session.scene,p.ship,now);}
  function move(p,sys,grid="gate"){delete p.session.stationid;p.session.scene=scenes.get(sys);p.session.solarsystemid2=sys;p.ship.grid=grid;}
  function heartbeat(p=defender){p.s.pveReadyAt=now;if(p.s.pveJob)p.s.pveJob.heartbeat=now;}
  return {deployment,miner,defender,f,call,plan,action,tick,move,heartbeat,pilot,makeFleet,join,membership,sessions,states,scenes,runtime,calls,advance:n=>{now+=n;heartbeat();},rawAdvance:n=>{now+=n;},get now(){return now;},get participantsReads(){return participantsReads;}};
}
test("native manual fleets with management OFF are discoverable and engaging PVE can call",()=>{
  const x=fixture();assert.equal(x.deployment.fleetRows(x.defender.session)[0].fleetID,x.f.fleetID);x.miner.s.job="pve";x.miner.s.pveJob={phase:"engaging"};
  assert.ok(x.call().incidentID);x.miner.s.pveTravel={};assert.throws(()=>x.call(),/public space/);
});

test("unassigned incidents expire on a new call even when no defender has ticked",()=>{
  const f=fixture();f.defender.s.enabled=false;const first=f.call().incidentID;f.rawAdvance(120001);
  const second=f.call().incidentID;assert.notEqual(first,second);assert.equal(f.deployment.view(f.miner.session,f.miner.s).queue.length,1);
  assert.equal(f.calls.some(c=>c[0]==="invite"),false);
});
test("incident dedup and atomic responder reservation precede joining",()=>{
  const x=fixture();const a=x.call();assert.equal(x.call().incidentID,a.incidentID);const second=x.pilot(3,"pve",300);x.plan();
  assert.equal(x.deployment.view(second.session,second.s).offers.length,0);assert.equal(x.deployment.view(x.miner.session,x.miner.s).requestStatus.responders,1);
  assert(x.calls.findIndex(c=>c[0]==="reserve")<x.calls.findIndex(c=>c[0]==="invite"));assert.equal(x.defender.s.pveJob.phase,"joining");
  assert.equal(x.action("authorizeUndock").authorized,false); // phase change requires a fresh token
  assert.equal(x.action("authorizeUndock").authorized,true);
});
test("selected longer safe path reports validated jumps and remains unclaimed",()=>{
  const x=fixture();x.call();assert.equal(x.plan(x.defender,[300,303,304,302]),null);const v=x.deployment.view(x.defender.session,x.defender.s);
  assert.deepEqual(v.range,{jumps:3,limit:2});assert.equal(v.queue[0].jumps,3);assert.match(v.queue[0].status,/outside/);assert.equal(v.requestStatus.responders,0);assert.equal(x.calls.some(c=>c[0]==="invite"),false);
  assert.ok(x.plan(x.defender,[300,301,302]));
});
test("unavailable route is visible without fabricated jump count",()=>{
  const x=fixture();x.call();assert.equal(x.plan(x.defender,[300,302]),null);const row=x.deployment.view(x.defender.session,x.defender.s).queue[0];assert.match(row.status,/unavailable/);assert.equal(row.jumps,undefined);
});
test("standby stays available at home with no belt and preserves manual memberships",()=>{
  const x=fixture();x.tick();assert.equal(x.defender.s.enabled,true);assert.equal(x.defender.s.pveJob,undefined);assert.equal(x.deployment.view(x.defender.session,x.defender.s).pool.available,1);
  x.makeFleet(x.defender);x.call();assert.equal(x.deployment.view(x.defender.session,x.defender.s).offers.length,0);assert.equal(x.calls.some(c=>c[0]==="leave"),false);
});
test("join waits natively; manual undock before confirmation invalidates ownership",()=>{
  const x=fixture({accept:false});x.call();x.plan();assert.equal(x.action("authorizeUndock").authorized,false);x.move(x.defender,300);assert.throws(()=>x.action("poll"),/belongs/);
});
test("requester cancellation before undock releases claim safely without disabling standby",()=>{
  const x=fixture({accept:false});x.call();x.plan();x.miner.s.enabled=false;x.tick();assert.equal(x.defender.s.pveJob,null);assert.equal(x.defender.s.enabled,true);assert.equal(x.defender.s.pveFleetLease,null);assert(x.calls.some(c=>c[0]==="reject"));
});
test("exact next-edge gate permissions reject arbitrary warp and route preference changes",()=>{
  const x=fixture();x.call();x.plan();x.action("poll");x.move(x.defender,300);x.tick();x.advance(3001);x.tick();const op=x.defender.s.pveJob;assert.equal(op.phase,"routeFleet");
  assert.throws(()=>x.action("authorizeRoute",x.defender,{systems:[300,303,304,302]}),/outside/);x.action("authorizeGate",x.defender,{gateID:300301});
  assert.equal(x.deployment.autopilotNavigation(x.defender.session,"Handle_CmdStargateJump",[300303]),false);
  assert.equal(x.deployment.autopilotNavigation(x.defender.session,"Handle_CmdStargateJump",[300301]),true);
  assert.equal(x.deployment.allowNavigation(x.defender.session,"warp",{warpType:"item",targetID:300301,minRange:15000,fleet:false}),true);
  x.move(x.defender,301);assert.equal(x.deployment.autopilotNavigation(x.defender.session,"Handle_CmdStargateJump",[300301]),false);x.tick();
  assert.equal(x.action("authorizeRoute",x.defender,{systems:[301,302]}).authorized,true);
});
test("same-system offgrid call still warps and verifies arrival before clear timer",()=>{
  const x=fixture();x.move(x.miner,300,"belt");x.defender.s.pveMaxJumps=0;x.call();x.plan(x.defender,[300]);x.action("poll");x.move(x.defender,300,"gate");x.tick();x.advance(3001);x.tick();
  assert.equal(x.defender.s.pveJob.phase,"warpFleet");assert.equal(x.action("authorizeWarp").authorized,true);
  assert.equal(x.deployment.allowNavigation(x.defender.session,"warp",{warpType:"char",targetID:1,minRange:0,fleet:false}),true);
  assert.equal(x.deployment.combatClear(x.defender.session,x.defender.s,x.defender.session.scene,x.defender.ship,false),false);
  x.move(x.defender,300,"belt");assert.equal(x.tick(),true);assert.equal(x.defender.s.pveJob.phase,"engaging");
  assert.equal(x.deployment.combatClear(x.defender.session,x.defender.s,x.defender.session.scene,x.defender.ship,false),false);
  x.advance(60000);assert.equal(x.deployment.combatClear(x.defender.session,x.defender.s,x.defender.session.scene,x.defender.ship,false),true);
  assert.equal(x.deployment.view(x.defender.session,x.defender.s).queue.length,0);x.defender.session.stationid=4000;x.tick();assert.equal(x.defender.s.pveJob,null);assert.equal(x.membership.has(2),false);
  assert.equal(x.deployment.view(x.defender.session,x.defender.s).offers.length,0);assert.ok(x.call().incidentID);
});

test("a new incident replaces completed request feedback while the former responder still owns its homeward claim",()=>{
  const f=fixture();f.move(f.miner,300,"belt");const first=f.call().incidentID;f.plan(f.defender,[300]);f.action("poll");f.move(f.defender,300,"belt");f.tick();
  f.deployment.combatClear(f.defender.session,f.defender.s,f.defender.session.scene,f.defender.ship,false);f.advance(60000);
  assert.equal(f.deployment.combatClear(f.defender.session,f.defender.s,f.defender.session.scene,f.defender.ship,false),true);
  const next=f.call();assert.notEqual(next.incidentID,first);assert.equal(next.status,"Reinforcements requested.");assert.equal(next.responders,0);
  assert.equal(f.defender.s.pveJob.incident.id,first);assert.equal(f.defender.s.pveJob.phase,"returning");assert.equal(f.deployment.view(f.miner.session,f.miner.s).queue[0].id,next.incidentID);
});
test("committed hostile hits reset clear regardless auto-call; presence and duplicate receipts do not call",()=>{
  const x=fixture();x.move(x.miner,300);x.call();x.plan(x.defender,[300]);x.action("poll");x.move(x.defender,300,"belt");x.tick();const scene=x.defender.session.scene;
  x.deployment.combatClear(x.defender.session,x.defender.s,scene,x.defender.ship,false);x.advance(50000);
  const rat={kind:"ship",nativeNpc:true,operatorKind:"asteroidBeltRat",typeID:20,grid:"belt"},result={damageResult:{success:true,data:{beforeLayers:{shield:100},afterLayers:{shield:90}}}};
  assert.equal(x.deployment.attack(scene,rat,x.defender.ship,result),false);x.advance(10001);assert.equal(x.deployment.combatClear(x.defender.session,x.defender.s,scene,x.defender.ship,false),false);
  x.miner.s.reinforcementAutoCall=true;assert.equal(x.deployment.attack(scene,rat,x.miner.ship,result),false);assert.equal(x.deployment.view(x.miner.session,x.miner.s).queue.length,1);
});
test("escort stays on selected anchor and is never borrowed or sent home after a clear wave",()=>{
  const x=fixture();x.defender.s.pveMode="escort";x.defender.s.pveFleetID=x.f.fleetID;x.defender.s.pveHomeStationID=0;x.defender.s.pveMaxJumps=0;
  assert.ok(x.plan(x.defender,[300,303,304,302]));x.action("poll");x.move(x.defender,302,"belt");x.defender.s.pveJob.routeIndex=3;x.tick();x.advance(60000);
  assert.equal(x.deployment.combatClear(x.defender.session,x.defender.s,x.defender.session.scene,x.defender.ship,false),false);assert.equal(x.defender.s.pveJob.phase,"engaging");
  x.call();assert.equal(x.deployment.view(x.defender.session,x.defender.s).offers.length,0);x.deployment.cancel(x.defender.session,x.defender.s);assert.equal(x.membership.get(2),x.f);assert.equal(x.calls.some(c=>c[0]==="leave"),false);
});
test("fresh heartbeat keeps assigned incident beyond queue TTL and disconnect releases only owned claim",()=>{
  const x=fixture();x.call();x.plan();x.action("poll");for(let i=0;i<4;i++){x.advance(30000);x.tick();}assert.equal(x.deployment.view(x.miner.session,x.miner.s).requestStatus.responders,1);
  x.sessions.delete(2);x.advance(5000);x.tick(x.miner);assert.equal(x.deployment.view(x.miner.session,x.miner.s).requestStatus.responders,0);assert.equal(x.defender.s.enabled,false);
});
test("controller immediate docked Ready and Plan use the same ammo readiness gate without a belt",t=>{
  let ready=false;const f=fixture({canUndock:()=>ready}),{createController}=require("../lib/controller"),{createPVE}=require("../lib/pve");
  const originalNow=Date.now;Date.now=()=>f.now;t.after(()=>Date.now=originalNow);
  const checks=[],errors=[],ss=f.defender.session;
  const ammo={tick(session,s,scene,ship){checks.push(["tick",ship?.itemID]);},ready(){checks.push(["ready"]);return ready;},view:()=>({ready})};
  const pve=createPVE({getSpace:()=>({getSceneForSession:s=>s.scene}),getSession:id=>f.sessions.get(id),getState:s=>f.states.get(s.characterID),getFleet:id=>f.membership.get(id),deployment:f.deployment,clock:()=>f.now,
    native:{scope:e=>({valid:true,scoped:false}),local:()=>true,weapons:()=>[],drone:{isDroneEntity:()=>false},type:()=>({}),health:()=>({})}});
  const originalView=pve.view;pve.view=(session,s)=>{f.states.set(session.characterID,s);if(session===ss)f.defender.s=s;return originalView(session,s);};
  const c=createController(()=>({modules:()=>[]}),()=>({getSceneForSession:s=>s.scene}),e=>errors.push(e),{get:()=>f.defender.s,save(){}},null,
    {station:id=>{if(id!==4000)throw Error("Unavailable home");return {stationID:id,systemID:300};},storage:()=>({})},null,null,{pve,pveDeployment:f.deployment,pveAmmo:ammo,getSession:id=>f.sessions.get(id)});
  c.snapshot(ss);const incident=f.call();c.pveReady(ss);assert.equal(c.snapshot(ss).enabled,true);assert(checks.some(r=>r[0]==="tick"&&r[1]===ss.shipid));assert.equal(c.snapshot(ss).pve.deployment.offers.length,0);
  const payload=JSON.stringify({offerID:incident.incidentID,shipID:ss.shipid,systems:[300,301,302],homeSystems:[300,301,302]});
  assert.equal(c.pvePlan(ss,payload).pve.job,null);assert.equal(f.calls.some(r=>r[0]==="invite"),false);
  ready=true;c.pveReady(ss);const view=c.pvePlan(ss,payload);assert.equal(view.pve.job.phase,"joining");assert.equal(view.pveHomeDestination.stationID,4000);assert.deepEqual(errors,[]);
  const priorJob=f.defender.s.pveJob,priorProfiles=JSON.stringify(f.defender.s.jobProfiles);
  assert.throws(()=>c.applySettings(ss,JSON.stringify({revision:view.revision,settings:{...view.settings,pveHomeStationID:9999}})),/Unavailable home/);
  assert.equal(f.defender.s.pveJob,priorJob);assert.equal(f.defender.s.enabled,true);assert.equal(JSON.stringify(f.defender.s.jobProfiles),priorProfiles);
});
test("return permits a longer safe route and exact home actions while empty ammo never traps it",()=>{
  const f=fixture();f.call();f.plan();f.action("poll");f.move(f.defender,302,"belt");f.defender.s.pveJob.routeIndex=2;f.tick();
  f.miner.s.enabled=false;f.tick();assert.equal(f.defender.s.pveJob.phase,"returning");assert.equal(f.deployment.view(f.defender.session,f.defender.s).queue.length,0);
  assert.equal(f.action("authorizeRoute",f.defender,{systems:[302,304,303,300]}).authorized,true);
  f.move(f.defender,300);f.defender.s.pveJob.routeIndex=3;f.action("authorizeWarp");
  assert.equal(f.deployment.allowNavigation(f.defender.session,"warp",{warpType:"item",targetID:4001,minRange:0,fleet:false}),false);
  assert.equal(f.deployment.allowNavigation(f.defender.session,"warp",{warpType:"item",targetID:4000,minRange:0,fleet:false}),true);
  assert.equal(f.action("authorizeDock").authorized,true);assert.equal(f.deployment.allowNavigation(f.defender.session,"dock",{targetID:4000}),true);
  assert.equal(f.defender.s.pveJob.phase,"returning","grant or client acknowledgement cannot infer native docking");
  const stranded=fixture({canUndock:()=>false});stranded.defender.session.stationid=4001;
  assert.equal(stranded.deployment.view(stranded.defender.session,stranded.defender.s).offers[0].id,"home");
  assert.equal(stranded.plan(stranded.defender,[300]).phase,"returning");assert.equal(stranded.action("authorizeUndock").authorized,true);
});
test("continuous escort pauses unavailable anchor without movement or time-based reassignment",()=>{
  const f=fixture();f.defender.s.pveMode="escort";f.defender.s.pveFleetID=f.f.fleetID;f.plan();f.action("poll");f.move(f.defender,302,"belt");f.defender.s.pveJob.routeIndex=2;f.tick();
  f.miner.session.stationid=4000;f.tick();assert.equal(f.defender.s.pveJob.paused,true);f.advance(300001);f.tick();assert.equal(f.defender.s.enabled,true);
  assert.equal(f.action("authorizeRoute",f.defender,{systems:[302]}).authorized,false);delete f.miner.session.stationid;f.tick();assert.equal(f.defender.s.pveJob.paused,false);
});

test("idle Escort anchor attestation is readonly and resolves only its verified selected live public ship",()=>{
  const f=fixture();f.defender.s.pveMode="escort";f.defender.s.pveFleetID=f.f.fleetID;f.plan();f.action("poll");
  assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);
  f.move(f.defender,302,"belt");f.defender.s.pveJob.routeIndex=2;f.tick();
  const op=f.defender.s.pveJob,before={nonce:op.nonce,phase:op.phase,heartbeat:op.heartbeat},calls=f.calls.length;
  const anchor=f.deployment.idleAnchor(f.defender.session,f.defender.s);
  assert.equal(anchor.itemID,f.miner.ship.itemID);assert.equal(anchor.session,f.miner.session);assert.equal(anchor.ship,f.miner.ship);
  assert.deepEqual({nonce:op.nonce,phase:op.phase,heartbeat:op.heartbeat},before);assert.equal(f.calls.length,calls);
  f.defender.s.pveStatus="Escorting the selected pilot.";assert.equal(f.deployment.view(f.defender.session,f.defender.s).assignment.status,f.defender.s.pveStatus);
  f.miner.ship.grid="other";assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);
  f.defender.ship.grid="other";assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null,"An old arrival cannot authorize a new grid");
  f.miner.ship.grid=f.defender.ship.grid="belt";
  f.miner.ship.private=true;assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);delete f.miner.ship.private;
  f.miner.session.stationid=4000;assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);delete f.miner.session.stationid;
  f.miner.session.shipid++;assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);f.miner.session.shipid--;
  const member=f.f.members.get(1);f.f.members.delete(1);assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);f.f.members.set(1,member);
  f.defender.ship.itemID++;assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);f.defender.ship.itemID--;
  f.defender.s.fleetReservation={retreated:true};assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);f.defender.s.fleetReservation=null;
  f.defender.s.defenseEnabled=true;f.defender.s.defenseShieldEnabled=true;f.defender.s.defenseShieldThreshold=30;f.defender.ship.shieldCapacity=100;f.defender.ship.conditionState={shieldCharge:.1};
  assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);f.defender.s.defenseEnabled=false;
  f.miner.s.enabled=false;assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);f.miner.s.enabled=true;
  f.defender.s.enabled=false;assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s),null);
});
test("native attack availability fails closed while manual calls remain available",()=>{
  const f=fixture();f.deployment.setAttackAvailable(false);f.miner.s.reinforcementAutoCall=true;
  const rat={kind:"ship",nativeNpc:true,operatorKind:"asteroidBeltRat",typeID:20,grid:"belt"},receipt={damageResult:{success:true,data:{beforeLayers:{shield:100},afterLayers:{shield:90}}}};
  assert.equal(f.deployment.attack(f.miner.session.scene,rat,f.miner.ship,receipt),false);assert.equal(f.deployment.view(f.miner.session,f.miner.s).automaticAvailable,false);assert.ok(f.call().incidentID);
  f.deployment.setAttackAvailable(true);assert.equal(f.deployment.attack(f.miner.session.scene,rat,f.miner.ship,receipt),true);
  assert.equal(f.deployment.attack(f.miner.session.scene,rat,f.miner.ship,receipt),false);
});

test("independent heartbeat keeps a recall-blocked worker alive without renewing grants and rejects changed ownership",()=>{
  const f=fixture(),{createPVE}=require("../lib/pve");f.move(f.miner,300,"belt");f.call();f.plan(f.defender,[300]);f.action("poll");f.move(f.defender,300,"gate");f.tick();f.advance(3001);f.tick();
  assert.equal(f.action("authorizeWarp").authorized,true);
  const pve=createPVE({getSpace:()=>({getSceneForSession:s=>s.scene}),getSession:id=>f.sessions.get(id),getState:s=>f.states.get(s.characterID),getFleet:id=>f.membership.get(id),deployment:f.deployment,clock:()=>f.now});
  const op=f.defender.s.pveJob,nonce=op.nonce,grant=op.grant,expiry=op.grantExpires;
  for(let i=0;i<10;i++){f.rawAdvance(20000);assert.equal(pve.heartbeat(f.defender.session,f.defender.s,op.id),true);}
  assert.equal(op.phase,"warpFleet");assert.equal(op.nonce,nonce);assert.equal(op.grant,grant);assert.equal(op.grantExpires,expiry,"Heartbeat cannot renew a movement authorization");
  assert.throws(()=>pve.heartbeat(f.defender.session,f.defender.s,"other"),/active/);
  f.defender.s.enabled=false;assert.throws(()=>pve.heartbeat(f.defender.session,f.defender.s,op.id),/belongs/);f.defender.s.enabled=true;
  f.defender.session.shipid++;assert.throws(()=>pve.heartbeat(f.defender.session,f.defender.s,op.id),/belongs/);f.defender.session.shipid--;
  f.sessions.set(2,{...f.defender.session});assert.throws(()=>pve.heartbeat(f.defender.session,f.defender.s,op.id),/belongs/);f.sessions.set(2,f.defender.session);
  f.defender.session.socket={destroyed:true};assert.throws(()=>pve.heartbeat(f.defender.session,f.defender.s,op.id),/belongs/);delete f.defender.session.socket;
  f.rawAdvance(45001);assert.throws(()=>pve.heartbeat(f.defender.session,f.defender.s,op.id),/belongs/);
});

test("escort confirms existing authoritative membership and repairs stale native session without leaving any fleet",()=>{
  const f=fixture();f.defender.s.pveMode="escort";f.defender.s.pveFleetID=f.f.fleetID;
  f.join(2,f.f);f.defender.session.fleetid=999;
  f.plan();assert.equal(f.defender.session.fleetid,f.f.fleetID);
  assert(f.calls.some(c=>c[0]==="notify"&&c[1]===2&&c[2]==="OnAutoMiningFleetReady"));
  f.move(f.defender,302,"belt");f.tick();f.defender.session.fleetid=999;f.tick();
  assert.equal(f.defender.session.fleetid,f.f.fleetID);
  assert.equal(f.calls.some(c=>["leave","invite"].includes(c[0])),false);
  f.membership.delete(2);assert.throws(()=>f.tick(),/belongs/);
});

test("escort falls back only to a verified local fleet member, retains preferred pilot and returns when that pilot is local",()=>{
  const f=fixture();f.defender.s.pveMode="escort";f.defender.s.pveFleetID=f.f.fleetID;f.defender.s.pveAnchorID=1;
  f.plan();f.action("poll");f.move(f.defender,302,"belt");f.tick();
  const fallback=f.pilot(3),foreign=f.pilot(4),privatePilot=f.pilot(5),away=f.pilot(6);
  f.makeFleet(foreign);f.join(3,f.f);f.join(5,f.f);privatePilot.ship.private=true;f.join(6,f.f);away.ship.grid="other";
  f.miner.ship.pendingWarp={};assert.equal(f.tick(),true);
  const op=f.defender.s.pveJob;assert.equal(op.anchor.characterID,3);assert.equal(op.preferredAnchor.characterID,1);
  assert.equal(f.defender.s.pveAnchorID,1);assert.equal(f.deployment.idleAnchor(f.defender.session,f.defender.s).itemID,300);
  f.move(f.miner,303,"belt");f.miner.ship.pendingWarp=null;assert.equal(f.tick(),true);assert.equal(op.anchor.characterID,3);
  f.move(f.miner,302,"belt");assert.equal(f.tick(),true);assert.equal(op.anchor.characterID,1);
  f.miner.ship.pendingWarp={};fallback.ship.pendingWarp={};assert.equal(f.tick(),false);
  assert.equal(op.paused,true);assert.equal(op.targetID,null);assert.equal(op.orbitRange,0);
  assert.equal(f.defender.s.enabled,true);assert.equal(f.calls.some(c=>c[0]==="leave"),false);
});

test("fleet discovery visits the participant registry once even with many anchors",()=>{
  const f=fixture();for(let id=3;id<35;id++){const p=f.pilot(id);f.join(id,f.f);}
  const reads=f.participantsReads;
  assert.equal(f.deployment.fleetRows(f.defender.session)[0].anchors.length,33);
  assert.equal(f.participantsReads-reads,1);
});
