"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const stores = new Map();
const idOf = s => Number(s?.characterID || s?.charid || 0);
const validID = id => Number.isSafeInteger(id) && id > 0;
const boosting = s => s.enabled && (s.job === "boosting" || s.job === undefined && s.autoBoost && s.shipRole !== "transport");
const travelling = s => !!(s.haul || s.transportJob || s.transportFleetLease || s.pveFleetLease || s.pveTravel || s.travelReservation);
const statusOf = s => s.fleetReservation?.retreated ? "Retreated" :
  s.haul?.phase === "resupplying" ? "Refueling" :
  s.haul?.phase === "unloading" || s.transportJob?.phase === "unloading" ? "Unloading" :
  s.transportJob?.phase === "loading" ? "Collecting" : travelling(s) ? "Travelling" : s.enabled ? "Working" : "Ready";

function validate(data) {
  if (data?.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.presets) || data.presets.length > 64 || !Array.isArray(data.roster) || data.roster.length > 256)
    throw Error("Invalid fleet preset file. Existing file was preserved.");
  const ids = new Set();
  for (const p of data.presets) {
    if (typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id) ||
        typeof p.name !== "string" || !p.name.trim() || p.name.length > 80 ||
        !Array.isArray(p.characterIDs) || p.characterIDs.length > 256 || p.characterIDs.some(id => !validID(id)) ||
        new Set(p.characterIDs).size !== p.characterIDs.length) throw Error("Invalid fleet preset file. Existing file was preserved.");
    ids.add(p.id);
  }
  for (const r of data.roster) if (!validID(r.characterID) || typeof r.name !== "string" || r.name.length > 100)
    throw Error("Invalid fleet preset file. Existing file was preserved.");
  return data;
}
function sharedStore(filename) {
  if (!stores.has(filename)) stores.set(filename,{data:null,dirty:false,lastWrite:0});
  const store=stores.get(filename);
  if (!store.data) store.data=fs.existsSync(filename)?validate(JSON.parse(fs.readFileSync(filename,"utf8"))):{schemaVersion:1,revision:0,presets:[],roster:[]};
  return store;
}

function createFleetGroups({root,getSpace,getSession,getState,save=()=>"",clock=Date.now,native=null}) {
  const filename=native?.filename || path.join(root,"config/autoMining.fleetGroups.json");
  const registry=new Map(), managed=new Map();
  let lastSweep=-Infinity, runtime;
  function deps() {
    if(native)return native;
    return runtime ||= {fleets:require(path.join(root,"server/src/services/fleets/fleetRuntime.js")),
      characters:require(path.join(root,"server/src/services/character/characterState.js")),
      scope:require(path.join(root,"server/src/space/destiny/identity/interactionScope.js"))};
  }
  function store(){return sharedStore(filename);}
  function write() {
    const st=store();if(!st.dirty)return;
    const temporary=filename+"."+process.pid+"."+crypto.randomUUID()+".tmp";
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(temporary,JSON.stringify(st.data)+"\n","utf8");fs.renameSync(temporary,filename);
    st.dirty=false;st.lastWrite=clock();
  }
  function fleet(id){return deps().fleets.getFleetForCharacter(id);}
  function boss(f) {
    if(!f)return 0;
    const flag=deps().fleets.FLEET.FLEET_JOB_CREATOR;
    for(const [id,m] of f.members)if((Number(m.job)&flag)!==0)return Number(m.charID||id);
    return Number(f.creatorCharID||0);
  }
  function remember(session,s,scene,ship,now) {
    const id=idOf(session);if(!validID(id))return;
    let row=registry.get(id);
    if(!row) { if(registry.size>=256)return;row={id,grid:null,settledAt:now};registry.set(id,row); }
    Object.assign(row,{session,s,scene,ship,seen:now});
    const st=store(), old=st.data.roster.find(r=>r.characterID===id);
    // Native sessions normally carry characterName, but reconnect/control
    // transitions may not. peekCharacterRecord is the canonical read-only view;
    // getCharacterRecord can normalize and persist, so never use it for names.
    if(row.identityCheckedAt===undefined||now-row.identityCheckedAt>=30000) {
      const record=deps().characters?.peekCharacterRecord?.(id);
      row.nativeName=record?.characterName||null;row.identityCheckedAt=now;
    }
    const name=String(row.nativeName||session.characterName||session.charName||session.charname||old?.name||id).slice(0,100);
    if(!old&&st.data.roster.length<256) {st.data.roster.push({characterID:id,name});st.dirty=true;}
    else if(old&&old.name!==name&&name!==String(id)){old.name=name;st.dirty=true;}
  }
  function publicGrid(row) {
    const {session,s,scene,ship}=row;
    if(!s.fleetEnabled||s.fleetMode!=="automatic"||!scene||!ship||
        session.stationID||session.stationid||session.structureID||session.structureid||
        ship.pendingWarp||ship.mode==="WARP"||ship.pendingDock||ship.dockingTargetID||ship.cloaked||ship.isCloaked)return null;
    const scope=deps().scope.resolveEntityInteractionScope(ship);
    if(!scope.valid||scope.hasAbyssalScope||scope.hasAirScope||scope.hasDungeonScope||
        ship.dungeonCurrentInstanceID||ship.dungeonCurrentRoomKey)return null;
    const key=scene.getLivePublicGridClusterKeyForEntity?.(ship)||scene.getPublicGridClusterKeyForEntity?.(ship);
    return key?`${scene.systemID}:${String(key)}`:null;
  }
  function reserve(session,s,{retreated=false}={}) {
    const current=fleet(idOf(session));
    if(!s.fleetReservation) s.fleetReservation={fleetID:Number(current?.fleetID||0),groupKey:s.fleetActiveGroup||"",retreated:!!retreated};
    else if(s.fleetReservation&&retreated)s.fleetReservation.retreated=true;
    return s.fleetReservation||null;
  }
  function release(session,s,{retreatedOnly=false}={}) {
    if(travelling(s)||retreatedOnly&&!s.fleetReservation?.retreated)return false;
    s.fleetReservation=null;return true;
  }
  function ready(session,f) {
    deps().fleets.initFleet(session,f.fleetID);
    session.sendNotification?.("OnAutoMiningFleetReady","clientID",[f.fleetID]);
  }
  function enabledMember(id,key) {
    const r=registry.get(Number(id));return r&&r.s.fleetEnabled&&r.s.fleetActiveGroup===key;
  }
  function escorted(f,cache) {
    if(!f)return false;
    if(cache.has(f))return cache.get(f);
    const value=[...f.members.keys()].some(id => {
      const r=registry.get(Number(id)), op=r?.s.pveJob;
      return r && getSession(r.id)===r.session && r.s.enabled && r.s.job==="pve" &&
        r.s.pveMode==="escort" && op?.deployment && op.fleet===f;
    });
    cache.set(f,value);return value;
  }
  function coordinator(key,rows,now,escortCache) {
    const f=deps().fleets;
    rows.sort((a,b)=>a.id-b.id);
    let candidates=rows.filter(r=>!r.s.fleetReservation);
    if(!candidates.length)return;
    const boost=candidates.find(r=>boosting(r.s));
    const existing=candidates.find(r=>{const current=fleet(r.id);return current&&managed.get(current.fleetID)===key&&boss(current)===r.id;});
    let leader=boost||existing||candidates[0], current=fleet(leader.id);
    // Automatic grouping never appropriates a manually formed fleet.
    if(current&&!managed.has(current.fleetID)&&key.startsWith("auto:")) {
      candidates=candidates.filter(r=>!fleet(r.id)||managed.has(fleet(r.id).fleetID));
      leader=candidates.find(r=>boosting(r.s))||candidates[0];
      if(!leader)return;current=fleet(leader.id);
    }
    if(current&&managed.has(current.fleetID)&&managed.get(current.fleetID)!==key&&!escorted(current,escortCache))current=null;
    // A manual preset may use an existing fleet, but only its participating
    // current boss can authorize joins/leadership. Never kick its other members.
    if(current&&boss(current)!==leader.id) {
      const owner=rows.find(r=>r.id===boss(current)&&!r.s.fleetReservation);
      if(owner)leader=owner;
      else {
        // An assigned escort owns this fleet relationship across grids. Do
        // not strand it in a replacement/solo fleet while its boss travels.
        if(escorted(current,escortCache))return;
        // Keep the managed fleet while its boss aligns or warps. Otherwise
        // the pilots still on grid leave it before a cancelled warp can stop.
        const away=registry.get(boss(current));
        if(key.startsWith("auto:")&&away&&getSession(away.id)===away.session&&
            now < (away.fleetHoldUntil||0)) return;
        current=null;
      }
    }
    if(!current) {
      const prior=fleet(leader.id);
      if(prior) {if(leader.s.fleetReservation)return;f.leaveFleet(leader.session,prior.fleetID);}
      current=f.createFleetRecord(leader.session);managed.set(current.fleetID,key);ready(leader.session,current);
    }
    if(managed.get(current.fleetID)===key&&boost&&boss(current)!==boost.id&&current.members.has(boost.id)&&
        [...current.members.keys()].every(id=>enabledMember(id,key))) {
      const old=registry.get(boss(current));if(old){f.makeLeader(old.session,current.fleetID,boost.id);leader=boost;}
    }
    const leaderSession=getSession(boss(current));if(!leaderSession)return;
    for(const r of rows) {
      const present=fleet(r.id);
      if(present?.fleetID===current.fleetID){r.s.fleetGroupStatus="Fleet group ready.";continue;}
      if(present&&key.startsWith("auto:")&&escorted(present,escortCache)){r.s.fleetGroupStatus="Fleet coordination is managed by the PVE deployment.";continue;}
      if(r.s.fleetReservation){r.s.fleetGroupStatus="Keeping the origin fleet during travel.";continue;}
      if(present&&key.startsWith("auto:")&&!managed.has(present.fleetID)){r.s.fleetGroupStatus="Existing manual fleet is preserved.";continue;}
      if(f.runtimeState.invitesByCharacter.has(r.id)){r.s.fleetGroupStatus="Waiting for the existing fleet invite.";continue;}
      if(present)f.leaveFleet(r.session,present.fleetID);
      f.inviteCharacter(leaderSession,current.fleetID,r.id,null,null,undefined,{autoAccept:true});
      const joined=fleet(r.id);if(joined?.fleetID===current.fleetID)ready(r.session,joined);
      r.s.fleetGroupStatus="Fleet group ready.";
    }
  }
  function sweep(now) {
    if(now-lastSweep<2000)return;lastSweep=now;
    const groups=new Map(), st=store();
    for(const r of registry.values()) {
      if(getSession(r.id)!==r.session||!r.s.hudReady){registry.delete(r.id);continue;}
      if(r.s.job==="hauling"||r.s.transportFleetLease){r.s.fleetGroupStatus="Fleet coordination is managed by the hauling job.";continue;}
      if(r.s.pveFleetLease||r.s.job==="pve"&&["escort","standby"].includes(r.s.pveMode)){r.s.fleetGroupStatus="Fleet coordination is managed by the PVE deployment.";continue;}
      if(r.ship?.pendingWarp||r.ship?.mode==="WARP")r.fleetHoldUntil=now+15000;
      if(travelling(r.s))reserve(r.session,r.s,{retreated:!!r.s.haul?.retreat});
      if(!r.s.fleetEnabled){r.s.fleetGroupStatus="Fleet coordination is off.";continue;}
      let key;
      if(r.s.fleetMode==="manual") {
        const p=st.data.presets.find(p=>p.id===r.s.fleetGroupID&&p.characterIDs.includes(r.id));
        if(!p){r.s.fleetGroupStatus="Choose a fleet preset containing this pilot.";continue;}key="manual:"+p.id;
      }else {
        const grid=publicGrid(r);
        if(grid!==r.grid){
          r.grid=grid;r.settledAt=now;
          // The boss must also finish the normal grid-settle delay after a
          // cancelled/completed warp before other members can regroup.
          r.fleetHoldUntil=Math.max(r.fleetHoldUntil||0,now+15000);
        }
        if(!grid||now-r.settledAt<15000){r.s.fleetGroupStatus="Waiting for a settled public grid.";continue;}key="auto:"+grid;
      }
      if(r.s.fleetReservation&&!r.s.fleetReservation.retreated&&!travelling(r.s))release(r.session,r.s);
      if(r.s.fleetReservation){r.s.fleetGroupStatus="Keeping the origin fleet during travel.";continue;}
      r.s.fleetActiveGroup=key;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
    }
    const escortCache=new Map();
    for(const [key,rows]of groups) {
      try{coordinator(key,rows,now,escortCache);}catch(error){for(const r of rows)r.s.fleetGroupStatus="Fleet coordination paused: "+error.message;}
    }
    if(st.dirty&&now-st.lastWrite>=30000)write();
  }
  function tick(session,s,scene,ship,now=clock()) {
    try{remember(session,s,scene,ship,now);sweep(now);}catch(error){s.fleetGroupStatus="Fleet coordination paused: "+error.message;}
  }
  function view(session,s) {
    const st=store(), current=fleet(idOf(session));
    return {revision:st.data.revision,mode:s.fleetMode||"manual",enabled:!!s.fleetEnabled,groupID:s.fleetGroupID||"",
      status:s.fleetGroupStatus||"Fleet coordination is off.",fleetID:current?.fleetID||0,bossID:boss(current),reservation:s.fleetReservation||null,
      presets:st.data.presets.map(p=>({...p,characterIDs:[...p.characterIDs]})),
      roster:st.data.roster.map(r=>{
        const row=registry.get(r.characterID),online=!!row&&getSession(r.characterID)===row.session;
        return {...r,portraitID:r.characterID,online,fleetID:online?fleet(r.characterID)?.fleetID||0:0,
          status:online?statusOf(row.s):"Offline",enabled:online&&!!row.s.fleetEnabled,mode:online?row.s.fleetMode:null,groupID:online?row.s.fleetGroupID||"":""};
      })};
  }
  function action(session,s,action,payload={}) {
    if(action==="refresh")return view(session,s);
    if(!["savePreset","deletePreset"].includes(action)||!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("Invalid fleet preset action.");
    const st=store();
    if(fs.existsSync(filename)) {
      const disk=validate(JSON.parse(fs.readFileSync(filename,"utf8")));
      if(disk.revision!==st.data.revision){st.data=disk;st.dirty=false;}
    }
    if(payload.revision!==st.data.revision)throw Error("Fleet presets changed. Refresh and try again.");
    const id=payload.id||crypto.randomUUID();
    if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw Error("Invalid fleet preset.");
    if(action==="deletePreset") {
      if(!st.data.presets.some(p=>p.id===id))throw Error("Fleet preset no longer exists.");
      st.data.presets=st.data.presets.filter(p=>p.id!==id);
    }else {
      const name=typeof payload.name==="string"?payload.name.trim():"", members=payload.characterIDs;
      if(!name||name.length>80||!Array.isArray(members)||members.length>256||members.some(id=>!validID(id))||new Set(members).size!==members.length)throw Error("Invalid fleet preset.");
      const index=st.data.presets.findIndex(p=>p.id===id), preset={id,name,characterIDs:[...members].sort((a,b)=>a-b)};
      if(index<0){if(st.data.presets.length>=64)throw Error("Fleet preset limit reached.");st.data.presets.push(preset);}else st.data.presets[index]=preset;
    }
    st.data.revision++;st.dirty=true;write();save(session,s);return view(session,s);
  }
  function participants() {
    return [...registry.values()].filter(r=>getSession(r.id)===r.session&&r.s.hudReady&&!r.session.socket?.destroyed)
      .map(r=>({session:r.session,s:r.s,name:r.nativeName||r.session.characterName||store().data.roster.find(p=>p.characterID===r.id)?.name||String(r.id)}));
  }
  return {tick,view,action,reserve,release,participants};
}
module.exports={createFleetGroups};
