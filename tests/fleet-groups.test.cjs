"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createFleetGroups}=require("../lib/fleetGroups");
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"am-fleet-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let now=0,serial=100;const sessions=new Map(),states=new Map(),fleets=new Map(),membership=new Map(),calls=[],identities=new Map();
  const runtime={FLEET:{FLEET_JOB_CREATOR:1},runtimeState:{invitesByCharacter:new Map()},getFleetForCharacter:id=>fleets.get(membership.get(id)),
    createFleetRecord(session){const f={fleetID:serial++,creatorCharID:session.characterID,members:new Map([[session.characterID,{charID:session.characterID,job:1}]])};fleets.set(f.fleetID,f);membership.set(session.characterID,f.fleetID);calls.push(["create",session.characterID]);return f;},
    initFleet(session,id){calls.push(["init",session.characterID,id]);},
    leaveFleet(session,id){const f=fleets.get(id);assert(f.members.has(session.characterID));f.members.delete(session.characterID);membership.delete(session.characterID);calls.push(["leave",session.characterID]);if(![...f.members.values()].some(m=>m.job===1)&&f.members.size)f.members.values().next().value.job=1;},
    inviteCharacter(session,id,characterID,w,s,r,opts){assert.equal(opts.autoAccept,true);const f=fleets.get(id);assert.equal(f.members.get(session.characterID).job,1);f.members.set(characterID,{charID:characterID,job:0});membership.set(characterID,id);calls.push(["invite",characterID]);},
    makeLeader(session,id,char){const f=fleets.get(id);assert.equal(f.members.get(session.characterID).job,1);f.members.get(session.characterID).job=0;f.members.get(char).job=1;calls.push(["boss",char]);}};
  const scene={systemID:300,getLivePublicGridClusterKeyForEntity:ship=>ship.grid};
  const group=createFleetGroups({root:directory,getSpace:()=>({getSceneForSession:()=>scene}),getSession:id=>sessions.get(id),getState:s=>states.get(s.characterID),clock:()=>now,
    native:{filename:path.join(directory,"groups.json"),fleets:runtime,characters:{peekCharacterRecord:id=>identities.get(id)},scope:{resolveEntityInteractionScope:ship=>({valid:true,hasAbyssalScope:!!ship.private})}}});
  function pilot(id,mode="automatic"){const session={characterID:id,characterName:"Pilot "+id,sendNotification(){}};const s={hudReady:true,fleetEnabled:true,fleetMode:mode,fleetGroupID:"",enabled:true};const ship={itemID:id+1000,kind:"ship",grid:"belt"};sessions.set(id,session);states.set(id,s);return {session,s,ship};}
  function tick(p,time){now=time;group.tick(p.session,p.s,scene,p.ship,now);}
  return {group,pilot,tick,runtime,sessions,states,scene,calls,membership,fleets,identities,file:path.join(directory,"groups.json")};
}

test("Hauling never rejoins preserved manual or automatic fleet preferences while waiting docked",t=>{
  for(const mode of ["manual","automatic"]) {
    const f=fixture(t),a=f.pilot(1,mode);a.s.job="hauling";
    if(mode==="manual")a.s.fleetGroupID=f.group.action(a.session,a.s,"savePreset",{revision:0,name:"Saved",characterIDs:[1]}).presets[0].id;
    const selected=a.s.fleetGroupID;f.tick(a,0);f.tick(a,20000);
    assert.equal(f.membership.has(1),false);assert.equal(a.s.fleetGroupID,selected);assert.equal(a.s.fleetEnabled,true);
    assert.equal(a.s.fleetGroupStatus,"Fleet coordination is managed by the hauling job.");
  }
});

test("escort and standby deployment own membership while preserved fleet preferences stay intact",t=>{
  for(const pveMode of ["escort","standby"]){
    const f=fixture(t),a=f.pilot(1,"manual");a.s.job="pve";a.s.pveMode=pveMode;
    a.s.fleetGroupID=f.group.action(a.session,a.s,"savePreset",{revision:0,name:"Saved",characterIDs:[1]}).presets[0].id;
    const selected=a.s.fleetGroupID;f.tick(a,0);f.tick(a,20000);
    assert.equal(f.membership.has(1),false);assert.equal(a.s.fleetGroupID,selected);assert.equal(a.s.fleetEnabled,true);
    assert.equal(a.s.fleetGroupStatus,"Fleet coordination is managed by the PVE deployment.");
  }
});
test("manual presets are shared, revision checked, explicit and preserve outside members",t=>{
  const f=fixture(t),a=f.pilot(1,"manual"),b=f.pilot(2,"manual"),outsider=f.pilot(3,"manual");outsider.s.fleetEnabled=false;
  const result=f.group.action(a.session,a.s,"savePreset",{revision:0,name:"Mining",characterIDs:[1,2]});const id=result.presets[0].id;
  assert.throws(()=>f.group.action(b.session,b.s,"deletePreset",{revision:0,id}),/changed/);
  assert.equal(f.group.view(b.session,b.s).presets[0].name,"Mining");
  a.s.fleetGroupID=id;b.s.fleetGroupID=id;
  const existing=f.runtime.createFleetRecord(a.session);f.runtime.inviteCharacter(a.session,existing.fleetID,3,null,null,null,{autoAccept:true});
  f.tick(a,0);f.tick(b,2000);assert.equal(f.membership.get(1),f.membership.get(2));assert(existing.members.has(3));
  assert.equal(f.calls.some(c=>c[0]==="leave"&&c[1]===3),false);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).revision,1);
});
test("automatic groups settle, prefer a booster, split and merge only opted managed pilots",t=>{
  const f=fixture(t),a=f.pilot(1),b=f.pilot(2);b.s.autoBoost=true;
  f.tick(a,0);f.tick(b,2000);f.tick(a,14000);assert.equal(f.membership.size,0);f.tick(b,18000);
  assert.equal(f.membership.get(1),f.membership.get(2));const shared=f.membership.get(2);assert.equal(f.fleets.get(shared).members.get(2).job,1);
  b.ship.grid="other";f.tick(b,20000);f.tick(a,36000);assert.notEqual(f.membership.get(1),f.membership.get(2));
  b.ship.grid="belt";f.tick(b,38000);f.tick(a,54000);assert.equal(f.membership.get(1),f.membership.get(2));
});
test("automatic fleet stays together through leader alignment and a cancelled warp",t=>{
  const f=fixture(t),leader=f.pilot(1),miner=f.pilot(2);
  leader.s.job="boosting";miner.s.job="mining";
  f.tick(leader,0);f.tick(miner,2000);f.tick(leader,18000);
  const original=f.membership.get(1);assert.equal(f.membership.get(2),original);
  leader.ship.pendingWarp={};f.tick(leader,20000);f.tick(miner,22000);
  assert.equal(f.membership.get(1),original);assert.equal(f.membership.get(2),original);
  assert.equal(f.calls.filter(c=>c[0]==="leave").length,0);
  leader.ship.pendingWarp=null;f.tick(leader,24000);f.tick(miner,26000);
  assert.equal(f.membership.get(1),original);assert.equal(f.membership.get(2),original);
  f.tick(miner,38000);f.tick(leader,40000);
  assert.equal(f.membership.get(1),original);assert.equal(f.membership.get(2),original);
  assert.equal(f.calls.filter(c=>c[0]==="leave").length,0);
});
test("automatic leader remains in flight longer than the grace period then settles before regrouping",t=>{
  const f=fixture(t),leader=f.pilot(1),miner=f.pilot(2);leader.s.job="boosting";
  f.tick(leader,0);f.tick(miner,2000);f.tick(leader,18000);const original=f.membership.get(1);
  leader.ship.mode="WARP";f.tick(miner,20000);f.tick(miner,40000);f.tick(miner,60000);
  assert.equal(f.membership.get(2),original);
  leader.ship.mode="STOP";leader.ship.grid="other";f.tick(leader,62000);f.tick(miner,76000);
  assert.equal(f.membership.get(1),original);assert.equal(f.membership.get(2),original);
  f.tick(leader,78000);assert.notEqual(f.membership.get(1),f.membership.get(2));
});
test("automatic grouping preserves manual fleets and excludes warp or private grids",t=>{
  const f=fixture(t),a=f.pilot(1),b=f.pilot(2),c=f.pilot(3);const manual=f.runtime.createFleetRecord(a.session);
  b.ship.pendingWarp=true;c.ship.private=true;f.tick(a,0);f.tick(b,2000);f.tick(c,4000);f.tick(a,20000);
  assert.equal(f.membership.get(1),manual.fleetID);assert.equal(f.membership.has(2),false);assert.equal(f.membership.has(3),false);assert.equal(f.calls.some(c=>c[0]==="leave"),false);
});

test("active escort preserves its assigned automatic fleet through split grids and a full fleet warp",t=>{
  const f=fixture(t),leader=f.pilot(1),miner=f.pilot(2),escort=f.pilot(3);leader.s.job="boosting";
  escort.s.job="pve";escort.s.pveMode="escort";escort.s.enabled=true;
  f.tick(leader,0);f.tick(miner,2000);f.tick(escort,4000);f.tick(leader,20000);
  const fid=f.membership.get(1),fleet=f.fleets.get(fid);
  f.runtime.inviteCharacter(leader.session,fid,3,null,null,4,{autoAccept:true});
  escort.s.pveJob={deployment:true,fleet,mode:"escort",phase:"engaging"};
  leader.ship.grid="another belt";f.tick(leader,22000);f.tick(miner,42000);
  assert.equal(f.membership.get(1),fid);assert.equal(f.membership.get(2),fid);assert.equal(f.membership.get(3),fid);
  const newcomer=f.pilot(4);newcomer.s.job="boosting";f.tick(newcomer,44000);f.tick(miner,64000);
  assert.notEqual(f.membership.get(4),fid);assert.equal(f.membership.get(2),fid);
  miner.ship.grid=escort.ship.grid="another belt";f.tick(miner,66000);f.tick(escort,68000);f.tick(leader,84000);
  assert.equal(f.membership.get(1),fid);assert.equal(f.membership.get(2),fid);assert.equal(f.membership.get(3),fid);
  assert.equal(f.calls.some(c=>c[0]==="leave"),false);
});
test("travel reservation retains origin fleet and retreat needs explicit restart release",t=>{
  const f=fixture(t),a=f.pilot(1),b=f.pilot(2);f.tick(a,0);f.tick(b,2000);f.tick(a,18000);const original=f.membership.get(1);
  f.group.reserve(a.session,a.s);a.s.haul={phase:"outbound"};a.ship.grid="station";f.tick(a,20000);f.tick(a,40000);
  assert.equal(f.membership.get(1),original);assert.equal(f.group.release(a.session,a.s),false);
  f.group.reserve(a.session,a.s,{retreated:true});a.s.haul=null;a.s.enabled=false;f.tick(a,42000);assert(a.s.fleetReservation.retreated);
  a.s.enabled=true;assert.equal(f.group.release(a.session,a.s,{retreatedOnly:true}),true);f.tick(a,44000);assert.equal(a.s.fleetReservation,null);
});
test("remembered roster retains offline pilots and bad shared schema stays untouched",t=>{
  const f=fixture(t),a=f.pilot(1);f.tick(a,30000);f.sessions.delete(1);f.tick(a,32000);
  assert.equal(f.group.view(a.session,a.s).roster[0].status,"Offline");
  fs.writeFileSync(f.file,"{\"schemaVersion\":9}");assert.throws(()=>f.group.action(a.session,a.s,"savePreset",{revision:0,name:"X",characterIDs:[1]}),/preserved/);
  assert.equal(fs.readFileSync(f.file,"utf8"),"{\"schemaVersion\":9}");
});
test("reservation without a fleet blocks mid-trip joining and releases only after public grid settles",t=>{
  const f=fixture(t),a=f.pilot(1);a.s.haul={phase:"outbound"};f.group.reserve(a.session,a.s);
  assert.equal(a.s.fleetReservation.fleetID,0);f.tick(a,0);f.tick(a,20000);assert.equal(f.membership.has(1),false);
  a.ship.grid="return";a.s.haul=null;f.tick(a,22000);assert(a.s.fleetReservation);f.tick(a,38000);
  assert.equal(a.s.fleetReservation,null);assert.equal(f.membership.has(1),true);
});
test("canonical character identity fills missing session name and portrait uses stable character ID",t=>{
  const f=fixture(t),a=f.pilot(1);delete a.session.characterName;f.identities.set(1,{characterName:"Native Name"});f.tick(a,0);
  const row=f.group.view(a.session,a.s).roster[0];assert.equal(row.name,"Native Name");assert.equal(row.portraitID,1);
  f.sessions.delete(1);f.tick(a,2000);assert.equal(f.group.view(a.session,a.s).roster[0].name,"Native Name");
});
test("changed session identity and missing HUD readiness cannot be recruited from stale registry",t=>{
  const f=fixture(t),a=f.pilot(1),b=f.pilot(2);f.tick(a,0);f.tick(b,2000);
  f.sessions.set(1,{characterID:1});b.s.hudReady=false;f.tick(b,20000);
  assert.equal(f.membership.size,0);assert(f.group.view(b.session,b.s).roster.every(row=>!row.online));
});
test("native boss disconnect keeps existing fleet and transfers boss only through eligible native member",t=>{
  const f=fixture(t),a=f.pilot(1),b=f.pilot(2),c=f.pilot(3);f.tick(a,0);f.tick(b,2000);f.tick(c,4000);f.tick(a,20000);
  const original=f.membership.get(1);f.runtime.leaveFleet(a.session,original);f.sessions.delete(1);c.s.job="boosting";
  f.tick(b,22000);assert.equal(f.membership.get(2),original);assert.equal(f.membership.get(3),original);
  assert.equal(f.fleets.get(original).members.get(3).job,1);assert(f.calls.some(call=>call[0]==="boss"&&call[1]===3));
  assert.equal(f.calls.filter(call=>call[0]==="create").length,1);
});
test("deleting a selected preset preserves existing membership and requests a new explicit selection",t=>{
  const f=fixture(t),a=f.pilot(1,"manual"),b=f.pilot(2,"manual");const view=f.group.action(a.session,a.s,"savePreset",{revision:0,name:"Crew",characterIDs:[1,2]});
  const id=view.presets[0].id;a.s.fleetGroupID=id;b.s.fleetGroupID=id;f.tick(a,0);f.tick(b,2000);const original=f.membership.get(1);
  f.group.action(a.session,a.s,"deletePreset",{revision:1,id});f.tick(a,4000);
  assert.equal(f.membership.get(1),original);assert.equal(f.membership.get(2),original);assert.match(a.s.fleetGroupStatus,/Choose a fleet preset/);
});
test("PVE with preserved boost preferences is not preferred over the actual Boosting job",t=>{
  const f=fixture(t),a=f.pilot(1),b=f.pilot(2);a.s.job="pve";a.s.autoBoost=true;b.s.job="boosting";
  f.tick(a,0);f.tick(b,2000);f.tick(a,18000);assert.equal(f.fleets.get(f.membership.get(1)).members.get(2).job,1);
});
