"use strict";
const path=require("node:path"),{randomUUID}=require("node:crypto");
const {retreatReason}=require("./defense");
const idOf=s=>Number(s.characterID||s.charid||0),shipOf=s=>Number(s.shipID||s.shipid||0);
const dockOf=s=>Number(s.stationID||s.stationid||s.structureID||s.structureid||0);
const moving=ship=>!ship||ship.pendingWarp||ship.mode==="WARP"||ship.pendingDock||ship.dockingTargetID||ship.cloaked||ship.isCloaked;
const distance=(a,b)=>a&&b&&[a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite)?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):Infinity;
const LABELS={undocking:"PVE undocking.",routeBelt:"Travelling to the selected belt.",warpBelt:"Warping to the selected belt.",engaging:"Engaging hostile rats."};
const directFamilies=new Set(["laserTurret","hybridTurret","projectileTurret","precursorTurret","missileLauncher"]);
const shot=s=>Object.values(s?.rawShotDamage||{}).reduce((n,v)=>n+Math.max(0,Number(v)||0),0);

function createPVE({root,getAPI,getSpace,getSession,getState,getFleet,save=()=>"",clock=Date.now,native=null,drones=null,onBegin=null,deployment=null,canUndock=()=>true,logError=console.error}) {
  let runtime,beltIndex;
  const claims=new WeakMap(),fields=new WeakMap(),grants=new Map(),issuedOrbits=new WeakMap();
  function deps() {
    if(native)return native;if(runtime)return runtime;
    const load=p=>require(path.join(root,"server/src",p));
    const dogma=load("space/runtime/entityDogmaView.js"),fit=load("services/fitting/liveFittingState.js"),group=load("services/moduleGrouping/moduleGroupingRuntime.js");
    const weapon=load("space/runtime/weaponSnapshot.js"),bank=load("space/runtime/groupedWeaponBank.js"),scope=load("space/destiny/identity/interactionScope.js");
    const world=load("space/worldData.js"),damage=load("space/combat/damage.js"),drone=load("services/drone/droneRuntime.js"),auto=load("space/runtime/autoTargetingMissiles.js"),types=load("services/inventory/itemTypeRegistry.js");
    runtime={belts:()=>world.ensureLoaded().asteroidBelts,belt:id=>world.ensureLoaded().asteroidBeltsById.get(Number(id)),
      system:id=>world.ensureLoaded().solarSystemsById.get(Number(id)),scope:e=>scope.resolveEntityInteractionScope(e),local:scope.canEntitiesInteractLocally,
      health:damage.getEntityMaxHealthLayers,currentHealth:damage.getEntityCurrentHealthLayers,type:id=>types.resolveItemByTypeID(id),drone,
      weapons:ship=>{
        const result=[],seen=new Set();
        for(const item of dogma.getEntityRuntimeFittedItems(ship)) {
          if(!fit.isModuleOnline(item))continue;
          const master=group.getMasterModuleID(ship.itemID,item.itemID)||item.itemID;
          if(Number(master)!==Number(item.itemID)||seen.has(master))continue;seen.add(master);
          const charge=dogma.getEntityRuntimeLoadedCharge(ship,item);
          if(auto.isAutoTargetingMissileCharge(charge))continue;
          const snapshot=weapon.buildWeaponSnapshotForEntity(ship,item,charge);
          if(!snapshot||!directFamilies.has(snapshot.family)||snapshot.isDefenderMissile||!(shot(snapshot)>0))continue;
          const context=bank.resolveGroupedWeaponBankContext(ship,null,item,{family:snapshot.family});
          result.push({item,snapshot:bank.buildBankedWeaponSnapshot(snapshot,context)});
        }
        return result;
      }};
    return runtime;
  }
  function live(session) {const scene=getSpace().getSceneForSession(session);return {scene,ship:scene?.getShipEntityForSession(session)};}
  function publicSpace(session,scene,ship) {
    if(session.spaceInstanceID||session._space?.instanceID||scene?.instanceID)return false;
    const scope=ship&&deps().scope(ship);return !scope||scope.valid&&!scope.scoped;
  }
  function belt(id) {
    const b=deps().belt(Number(id));if(!b)throw Error("Select an existing asteroid belt.");
    const systemID=Number(b.solarSystemID||b.systemID),system=deps().system(systemID);
    return {beltID:Number(b.itemID||b.beltID),name:String(b.itemName||b.name||b.beltName||b.itemID),systemID,
      systemName:String(system?.solarSystemName||system?.name||systemID)};
  }
  function searchBelts(session,query) {
    if(typeof query!=="string"||query.length<2||query.length>200)throw Error("Enter at least two characters of the belt or system name.");
    const term=query.trim().toLowerCase();if(term.length<2)throw Error("Enter at least two characters of the belt or system name.");
    if(/^\d+$/.test(term)){try{return [belt(Number(term))];}catch{
      if(!deps().system(Number(term)))return [];
      if(!beltIndex)beltIndex=deps().belts().map(b=>belt(b.itemID||b.beltID));
      return beltIndex.filter(b=>b.systemID===Number(term)).slice(0,40);
    }}
    if(!beltIndex)beltIndex=deps().belts().map(b=>belt(b.itemID||b.beltID));
    return beltIndex.filter(b=>(b.name+" "+b.systemName).toLowerCase().includes(term)||term.startsWith(b.systemName.toLowerCase()+" - ")).slice(0,40);
  }
  function catalogBelts(session,offset=0,limit=500) {
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error("Invalid belt catalog page.");
    if(!beltIndex)beltIndex=deps().belts().map(b=>belt(b.itemID||b.beltID));
    return {belts:beltIndex.slice(offset,offset+limit),more:offset+limit<beltIndex.length};
  }
  function grid(scene,e) {return scene?.getLivePublicGridClusterKeyForEntity?.(e)||scene?.getPublicGridClusterKeyForEntity?.(e);}
  function hostile(scene,ship,e) {
    // Native belt-rat provenance proves hostility. A bounty or ship-like name
    // alone does not: those can also belong to neutral NPCs or player ships.
    const nativeGroup=String(deps().type?.(e?.typeID)?.groupName||"");
    const pirateGroup=/^Asteroid (Angel Cartel|Blood Raiders|Guristas|Sansha.s Nation|Serpentis) /i.test(nativeGroup);
    return e?.kind==="ship"&&e.nativeNpc===true&&(e.operatorKind==="asteroidBeltRat"||pirateGroup)&&e.itemID!==ship.itemID&&
      !e.destroyed&&!e.exploding&&!moving(e)&&publicSpace({},scene,e)&&deps().local(ship,e)&&grid(scene,e)===grid(scene,ship);
  }
  function rats(scene,ship) {
    const key=grid(scene,ship);if(!key)return [];
    let cache=fields.get(scene);if(!cache){cache=new Map();fields.set(scene,cache);}
    const source=scene.dynamicEntities,old=cache.get(key);
    let entry=old;
    if(!old||old.source!==source||old.size!==source?.size||clock()-old.at>=1000) {
      entry={source,size:source?.size,at:clock(),ids:[...(source?.values()||[])].filter(e=>hostile(scene,ship,e)).map(e=>e.itemID)};
      cache.set(key,entry);if(cache.size>32)for(const [g,c] of cache)if(clock()-c.at>5000)cache.delete(g);
    }
    return entry.ids.map(id=>scene.getEntityByID(id)).filter(e=>hostile(scene,ship,e));
  }
  function strength(e) {return Object.values(deps().health(e)||{}).reduce((n,v)=>n+Math.max(0,Number(v)||0),0);}
  function shipClass(e) {
    const name=String(deps().type?.(e.typeID)?.groupName||"").toLowerCase();
    for(const [word,rank] of [["titan",10],["supercarrier",9],["carrier",8],["dreadnought",7],["battleship",6],["battlecruiser",5],["cruiser",4],["destroyer",3],["frigate",2]])if(name.includes(word))return rank;
    return 0;
  }
  function remaining(e) {return deps().currentHealth?Object.values(deps().currentHealth(e)||{}).reduce((n,v)=>n+Math.max(0,Number(v)||0),0):strength(e);}
  function ranked(rows,priority,ship) {
    const direction=priority==="weakest"?1:-1;
    return rows.slice().sort((a,b)=>{
      const ac=shipClass(a),bc=shipClass(b),classes=ac&&bc?ac-bc:strength(a)-strength(b);
      return direction*classes||direction*(remaining(a)-remaining(b))||distance(ship.position,a.position)-distance(ship.position,b.position)||Number(a.itemID)-Number(b.itemID);
    });
  }
  function claimSet(scene,session,ship) {
    let gridClaims=claims.get(scene);if(!gridClaims){gridClaims=new Map();claims.set(scene,gridClaims);}
    const key=grid(scene,ship);let gridSet=gridClaims.get(key);if(!gridSet){gridSet=new Map();gridClaims.set(key,gridSet);}
    const fleet=getFleet?.(idOf(session)),owner=fleet||session;let set=gridSet.get(owner);
    if(!set){set={units:new Map(),focus:0,at:clock()};gridSet.set(owner,set);}
    for(const [unit,c] of set.units) {
      const client=getSession(c.characterID),state=client&&getState(client),view=client&&live(client);
      if(clock()-c.at>10000||!state?.enabled||state.job!=="pve"||view?.scene!==scene||grid(scene,view.ship)!==key||getFleet?.(c.characterID)!==fleet)set.units.delete(unit);
    }
    return set;
  }
  function weapons(ship) {
    return deps().weapons(ship).filter(w=>directFamilies.has(w.snapshot?.family)&&shot(w.snapshot)>0&&Number.isFinite(Number(w.snapshot.durationMs))&&Number(w.snapshot.durationMs)>0)
      .map(w=>{const range=Number(w.snapshot.family==="missileLauncher"?w.snapshot.approxRange:w.snapshot.optimalRange);return {...w,dps:shot(w.snapshot)*1000/Number(w.snapshot.durationMs),range:Number.isFinite(range)&&range>0?range*(w.snapshot.family==="missileLauncher"?0.8:1):0};})
      .filter(w=>Number.isFinite(w.dps)&&w.dps>0)
      .sort((a,b)=>b.dps-a.dps||a.item.itemID-b.item.itemID);
  }
  function orbitRange(s,ship,kind){
    const override=Number(s.pveOrbitOverride);
    if(Number.isFinite(override)&&override>0)return override;
    return kind==="escort"?2500:weapons(ship)[0]?.range||0;
  }
  function setOrbit(session,s,targetID,range,kind){const op=s.pveJob;if(op.targetID!==targetID||op.orbitRange!==range||op.orbitKind!==kind){op.targetID=targetID;op.orbitRange=range;op.orbitKind=kind;op.nonce=randomUUID();op.version++;op.grant=null;grants.delete(idOf(session));notify(session,jobView(op));}}
  function jobView(op) {if(op?.deployment)return {...deployment.publicJob(op),orbitKind:op.orbitKind||null};return op?{id:op.id,nonce:op.nonce,version:op.version,shipID:op.shipID,phase:op.phase,belt:op.belt,route:op.route||null,status:LABELS[op.phase],targetID:op.targetID||null,orbitRange:op.orbitRange||0,orbitKind:op.orbitKind||null,grant:op.grant||null}:null;}
  function view(session,s) {
    if(Number(s.pveBeltID)!==s.pveBelt?.beltID) {try{s.pveBelt=Number(s.pveBeltID)?belt(s.pveBeltID):null;}catch{s.pveBelt=null;}}
    return {status:s.pveStatus||"PVE is off.",belt:s.pveBelt||null,fireMode:s.pveFireMode||"focus",priority:s.pvePriority||"strongest",
      orbitRange:s.pveOrbitRange||0,automaticRange:s.pveAutomaticRange||0,weaponCount:s.pveWeaponCount||0,targets:s.pveTargets||[],job:jobView(s.pveJob),deployment:deployment?.view(session,s)||null,authorized:false};
  }
  function notify(session,data) {try{session.sendNotification("OnAutoMiningPVE","clientID",[JSON.stringify(data)]);}catch{}}
  function phase(session,s,op,value) {
    op.phase=value;op.changed=clock();op.nonce=randomUUID();op.version++;op.grant=null;grants.delete(idOf(session));
    s.pveTravel=value==="engaging"?null:op;s.pveStatus=LABELS[value];notify(session,jobView(op));
  }
  function quiet(session,s,scene,ship,preserveOrbit=false) {
    const owned=s.pveOwned||new Map();
    if(scene&&ship?.itemID===s.pveShipID)for(const [id,effect] of owned)if(ship.activeModuleEffects?.get(id)===effect)
      try{scene.deactivateGenericModule(session,id,{deferUntilCycle:true});}catch{}
    if(scene&&ship?.itemID===s.pveShipID)for(const id of s.pveLocks||[]) {
      try{if(ship.pendingTargetLocks?.has(id))scene.cancelAddTarget?.(session,id);
      else if(ship.lockedTargets?.has(id))scene.removeTarget?.(session,id);}catch{}
    }
    const nativeDrone=deps().drone,ids=[...(s.pveManagedDroneIDs||[])].filter(id=>{
      const e=scene?.getEntityByID(id);return nativeDrone?.isDroneEntity(e)&&Number(e.ownerID)===idOf(session)&&Number(e.controllerID)===ship?.itemID;
    });
    if(ids.length)try{nativeDrone.commandReturnBay(session,ids);}catch{}
    s.pveManagedDroneIDs=new Set();s.pveOwned=new Map();s.pveLocks=new Set();s.pveStopRequested=new Set();
    // Combat cleanup must not forget the movement a paused escort still
    // needs to stop. Retire it only after the authorized Stop or job cleanup.
    if(!preserveOrbit)s.pveOwnedOrbit=null;
    s.pveTargets=[];grants.delete(idOf(session));
  }
  function stop(session,s,scene,ship) {
    issuedOrbits.delete(session);
    deployment?.cancelRequests(session);
    if(!s.pveJob&&!s.pveOwned?.size&&!s.pveLocks?.size&&!s.pveManagedDroneIDs?.size){deployment?.cleanup(session,s);return;}
    const op=s.pveJob;if(op)notify(session,{cancel:op.id});
    quiet(session,s,scene,ship);
    if(op?.deployment)deployment.cancel(session,s);
    s.pveJob=null;s.pveTravel=null;s.pveInterrupted=false;s.pveQuiet=false;
    s.pveTargets=[];s.pveStatus="PVE stopped.";grants.delete(idOf(session));save(session,s);
  }
  function fail(session,s,scene,ship) {stop(session,s,scene,ship);s.enabled=false;s.pveStatus="PVE paused; use Start / Resume to retry.";save(session,s);}
  function valid(session,s,op) {
    if(op?.deployment)return deployment.validate(session,s,op);
    if(!op||!s.enabled||s.job!=="pve"||!s.pveClientReady||session.socket?.destroyed||getSession(idOf(session))!==session||shipOf(session)!==op.shipID||Number(s.pveBeltID)!==op.belt.beltID||s.haul)throw Error("PVE job no longer belongs to this pilot.");
    if(clock()-op.heartbeat>45000||clock()-op.started>7200000&&op.phase!=="engaging")throw Error("PVE client or trip timed out.");
    const {scene,ship}=live(session);if(!publicSpace(session,scene,ship))throw Error("Instanced or gated PVE is not supported.");
    if(ship&&retreatReason(s,ship))throw Error("PVE job no longer belongs to this pilot.");
    return {scene,ship};
  }
  function atBelt(scene,ship,op) {const entity=scene?.getEntityByID(op.belt.beltID);return entity&&grid(scene,ship)&&grid(scene,ship)===grid(scene,entity);}
  function observe(session,s,op) {
    const {scene,ship}=valid(session,s,op);
    if(op.phase==="undocking"&&!dockOf(session)&&!moving(ship)) {
      if(op.undockedAt==null)op.undockedAt=clock();if(clock()-op.undockedAt>=3000)phase(session,s,op,"routeBelt");
    }
    if(op.phase==="routeBelt"&&!dockOf(session)&&scene?.systemID===op.belt.systemID&&!moving(ship))phase(session,s,op,atBelt(scene,ship,op)?"engaging":"warpBelt");
    if(op.phase==="warpBelt"&&!moving(ship)&&atBelt(scene,ship,op))phase(session,s,op,"engaging");
    if(op.phase==="engaging"&&(!ship||dockOf(session)||!atBelt(scene,ship,op)))throw Error("PVE job no longer belongs to this pilot.");
    if(op.phase==="engaging"&&s.pveInterrupted) {s.pveInterrupted=false;if(save(session,s))throw Error("Could not save PVE completion.");}
  }
  function begin(session,s,scene,ship) {
    const target=belt(s.pveBeltID),op={id:randomUUID(),nonce:randomUUID(),version:1,shipID:ship.itemID,belt:target,
      phase:dockOf(session)?"undocking":scene?.systemID===target.systemID?atBelt(scene,ship,{belt:target})?"engaging":"warpBelt":"routeBelt",started:clock(),changed:clock(),heartbeat:clock()};
    s.pveInterrupted=true;if(save(session,s)){s.pveInterrupted=false;throw Error("Could not save PVE safety state.");}
    s.pveJob=op;s.pveTravel=op.phase==="engaging"?null:op;s.pveBelt=target;s.pveShipID=ship.itemID;s.pveOwned=new Map();s.pveLocks=new Set();
    s.pveStatus=LABELS[op.phase];if(s.pveTravel)onBegin?.(session,s);notify(session,jobView(op));
  }
  function controlledDrones(session,s,scene,ship,rows,claims) {
    if(!s.pveDronesEnabled||!s.pveDroneGroupKey)return;
    const n=deps().drone,selected=[...(s.pveManagedDroneIDs||[])].map(id=>scene.getEntityByID(id)).filter(e=>n?.isDroneEntity(e)&&Number(e.ownerID)===idOf(session)&&Number(e.controllerID)===ship.itemID);
    if(!selected.length) {
      if(clock()>=(s.nextPVEDroneRequest||0)&&!s.droneLaunchGrant){s.nextPVEDroneRequest=clock()+15000;drones?.requestGroup(session,s,scene,ship,s.pveDroneGroupKey,"pve");}return;
    }
    for(const e of selected) {
      const target=choose(rows,s,claims,idOf(session)+":drone:"+e.itemID);
      if(target&&e.droneCommand!==n.DRONE_COMMAND_RETURN_BAY&&(e.droneCommand!==n.DRONE_COMMAND_ENGAGE||Number(e.targetID)!==target.itemID))
        n.commandEngage(session,[e.itemID],target.itemID);
    }
  }
  function choose(rows,s,set,key) {
    if(!rows.length)return null;
    let target;
    if(s.pveFireMode!=="spread") {
      target=rows.find(e=>e.itemID===set.focus)||rows[0];set.focus=target.itemID;
    } else {
      const counts=new Map();for(const [unit,c] of set.units)if(unit!==key)counts.set(c.targetID,(counts.get(c.targetID)||0)+1);
      const prior=set.units.get(key),lowest=Math.min(...rows.map(e=>counts.get(e.itemID)||0));
      target=rows.find(e=>e.itemID===prior?.targetID&&(counts.get(e.itemID)||0)===lowest)||rows.find(e=>(counts.get(e.itemID)||0)===lowest);
    }
    set.units.set(key,{characterID:s.characterID||Number(key.split(":")[0]),targetID:target.itemID,at:clock()});return target;
  }
  function discardLocks(session,s,scene,ship,chosen) {
    for(const id of s.pveLocks)if(!chosen.has(id)&&![...s.pveOwned.values()].some(e=>Number(e.targetID)===id)) {
      if(ship.pendingTargetLocks?.has(id))scene.cancelAddTarget?.(session,id);else if(ship.lockedTargets?.has(id))scene.removeTarget?.(session,id);s.pveLocks.delete(id);
    }
  }
  function tick(session,s,scene,ship,now) {
    if(!s.enabled||s.job!=="pve")return;
    const deployed=s.pveMode&&s.pveMode!=="belt";
    if(!deployed&&!Number(s.pveBeltID)){s.pveStatus="Choose an asteroid belt for PVE.";return;}
    if(!s.pveClientReady){s.pveStatus="PVE needs the updated client companion.";return;}
    try {
      if(deployed){
        const ready=deployment.tick(session,s,scene,ship,now);
        if(!ready||moving(ship)){if(!s.pveQuiet){quiet(session,s,scene,ship,s.pveJob?.mode==="escort"&&s.pveJob.paused&&!moving(ship));s.pveQuiet=true;}return;}
      }else{
        if(!s.pveJob){if(!ship)return;begin(session,s,scene,ship);}
        observe(session,s,s.pveJob);if(s.pveJob.phase!=="engaging"||moving(ship))return;
      }
      s.pveQuiet=false;s.pveOwned||=new Map();s.pveLocks||=new Set();
      if(clock()<(s.nextPVETick||0))return;s.nextPVETick=clock()+1000;
      const units=weapons(ship),rows=ranked(rats(scene,ship),s.pvePriority,ship),set=claimSet(scene,session,ship);
      if(deployed&&deployment.combatClear(session,s,scene,ship,rows.length>0)){quiet(session,s,scene,ship);s.pveQuiet=true;return;}
      const unitKeys=new Set(units.map(u=>idOf(session)+":"+u.item.itemID));
      for(const [id,effect] of s.pveOwned)if(ship.activeModuleEffects?.get(id)!==effect){s.pveOwned.delete(id);s.pveStopRequested?.delete(effect);}
      for(const id of s.pveLocks)if(!ship.pendingTargetLocks?.has(id)&&!ship.lockedTargets?.has(id))s.pveLocks.delete(id);
      for(const key of set.units.keys())if(key.startsWith(idOf(session)+":")&&!key.includes(":drone:")&&!unitKeys.has(key))set.units.delete(key);
      s.pveWeaponCount=units.length;s.pveAutomaticRange=units[0]?.range||0;
      s.pveOrbitRange=Number(s.pveOrbitOverride)>0?Number(s.pveOrbitOverride):s.pveAutomaticRange;
      s.pveTargets=[];
      if(!rows.length){
        s.pveStopRequested||=new Set();
        for(const [id,effect] of s.pveOwned)if(ship.activeModuleEffects?.get(id)===effect&&!s.pveStopRequested.has(effect)){scene.deactivateGenericModule(session,id,{deferUntilCycle:true});s.pveStopRequested.add(effect);}
        discardLocks(session,s,scene,ship,new Set());
        for(const key of set.units.keys())if(key.startsWith(idOf(session)+":"))set.units.delete(key);
        const anchor=deployment?.idleAnchor(session,s);
        if(anchor){s.pveOrbitRange=orbitRange(s,ship,"escort");setOrbit(session,s,anchor.itemID,s.pveOrbitRange,"escort");s.pveStatus="Escorting the selected pilot.";}
        else{setOrbit(session,s,null,0,null);s.pveStatus="No hostile rats on this belt grid.";}return;
      }
      if(!units.length&&!s.pveDronesEnabled){s.pveStatus="No usable offensive weapons are fitted.";return;}
      let orbitTarget=null,waiting=false,fired=false;
      for(const unit of units) {
        const key=idOf(session)+":"+unit.item.itemID,target=choose(rows,s,set,key);
        if(!orbitTarget)orbitTarget=target;
        if(!s.pveTargets.some(t=>t.itemID===target.itemID))s.pveTargets.push({itemID:target.itemID,name:String(target.itemName||target.typeName||target.itemID)});
        const active=ship.activeModuleEffects?.get(unit.item.itemID);
        if(active){if(s.pveOwned.get(unit.item.itemID)===active){
          if(Number(active.targetID)!==target.itemID){s.pveStopRequested||=new Set();if(!s.pveStopRequested.has(active)){scene.deactivateGenericModule(session,unit.item.itemID,{deferUntilCycle:true});s.pveStopRequested.add(active);}}
          else fired=true;
        }continue;}
        if(!ship.lockedTargets?.has(target.itemID)) {
          if(!ship.pendingTargetLocks?.has(target.itemID)) {const result=scene.addTarget(session,target.itemID);if(result?.success)s.pveLocks.add(target.itemID);}
          waiting=true;continue;
        }
        const result=scene.activateGenericModule(session,unit.item,unit.snapshot.activationEffectName,{targetID:target.itemID,repeat:0});
        if(result?.success){const effect=ship.activeModuleEffects?.get(unit.item.itemID);if(effect)s.pveOwned.set(unit.item.itemID,effect);fired=true;}
      }
      controlledDrones(session,s,scene,ship,rows,set);
      const chosen=new Set(s.pveTargets.map(t=>t.itemID));
      discardLocks(session,s,scene,ship,chosen);
      if(orbitTarget&&s.pveOrbitRange>0)setOrbit(session,s,orbitTarget.itemID,s.pveOrbitRange,"hostile");
      else if(s.pveJob.orbitKind==="escort")setOrbit(session,s,null,0,null);
      s.pveStatus=fired?"Engaging hostile rats.":waiting?"Waiting for native target locks.":"Waiting for native weapon range or ammunition.";
    } catch(error) {
      reportFailure(session,s,"server",error?.message||"Unknown PVE error.");
      fail(session,s,scene,ship);
    }
  }
  function reportFailure(session,s,source,reason) {
    const text=String(reason||"Unknown PVE error.").replace(/[\r\n\x00-\x1f\x7f]/g," ").slice(0,240);
    try{logError(`[AutoMining] PVE paused source=${source} characterID=${idOf(session)} shipID=${shipOf(session)} phase=${s.pveJob?.phase||"none"} reason=${text}`);}catch{}
  }
  function ready(session,s) {
    s.pveClientReady=true;s.pveReadyAt=clock();
    const op=s.pveJob;
    if(op&&s.enabled&&s.job==="pve"&&getSession(idOf(session))===session&&!session.socket?.destroyed&&shipOf(session)===op.shipID&&(!op.deployment||op.session===session))op.heartbeat=clock();
    return true;
  }
  function heartbeat(session,s,id){const op=s.pveJob;if(!op||op.id!==id)throw Error("PVE job is no longer active.");valid(session,s,op);op.heartbeat=clock();return true;}
  function action(session,s,id,action,payload={}) {
    const op=s.pveJob;if(!op||op.id!==id)throw Error("PVE job is no longer active.");
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||JSON.stringify(payload).length>16384)throw Error("Invalid PVE action payload.");
    const {scene,ship}=valid(session,s,op);
    // Phase/target updates can race the client's next request. Deny the stale
    // action and return the current token; it must not cancel a valid job.
    // Ownership and session checks above still reject a genuinely stale job.
    if(action!=="poll"&&action!=="cancel"&&payload.nonce!==op.nonce)return view(session,s);
    op.heartbeat=clock();op.grant=null;
    if(action==="cancel"){
      if(typeof payload.reason==="string")reportFailure(session,s,"client",payload.reason);
      stop(session,s,scene,ship);s.enabled=false;s.pveStatus="PVE cancelled by client.";save(session,s);return view(session,s);
    }
    if(op.deployment&&!["authorizeOrbit","authorizeStopOrbit","orbited","orbitStopped"].includes(action)){
      const before=op.phase,result=deployment.action(session,s,op,action,payload);
      if(before==="engaging"&&op.phase!=="engaging"){quiet(session,s,scene,ship,op.mode==="escort"&&op.paused&&!moving(ship));s.pveQuiet=true;}
      return {...view(session,s),...result};
    }
    if(op.deployment)deployment.tick(session,s,scene,ship,clock());else observe(session,s,op);
    if(action!=="poll"&&payload.nonce!==op.nonce)return view(session,s);
    let authorized=false;
    if(!op.deployment&&action==="authorizeUndock"){authorized=!!dockOf(session)&&op.phase==="undocking"&&canUndock(session,s,ship)===true;op.grant=authorized?"authorizeUndock":null;}
    else if(!op.deployment&&["authorizeRoute","authorizeGate"].includes(action)&&op.phase==="routeBelt"){
      authorized=deployment?.routeAction(session,s,op,action,payload,op.belt.systemID)===true;
      if(authorized){op.nonce=randomUUID();op.version++;op.grant=action;}
    }else if(action==="authorizeWarp") {
      if(op.phase==="warpBelt"&&!moving(ship)&&scene?.systemID===op.belt.systemID) {
        const target=scene.getEntityByID(op.belt.beltID);
        if(target&&distance(ship.position,target.position)>=150000) {
          op.nonce=randomUUID();op.version++;op.grant="warp";grants.set(idOf(session),{id:op.id,kind:"warp",targetID:op.belt.beltID,range:0,expires:clock()+2000});authorized=true;
        }
      }
    } else if(action==="authorizeOrbit") {
      const target=scene?.getEntityByID(op.targetID),anchor=op.orbitKind==="escort"?deployment?.idleAnchor(session,s):null;
      const allowed=op.orbitKind==="escort"?anchor&&target===anchor.ship&&target.itemID===anchor.itemID:hostile(scene,ship,target);
      if(op.phase==="engaging"&&!moving(ship)&&op.orbitRange>0&&op.orbitRange===orbitRange(s,ship,op.orbitKind)&&allowed) {
        op.nonce=randomUUID();op.version++;op.grant="orbit";const grant={id:op.id,shipID:ship.itemID,kind:"orbit",orbitKind:op.orbitKind||"hostile",anchorSession:anchor?.session,anchorShip:anchor?.ship,targetID:op.targetID,range:op.orbitRange,expires:clock()+2000};grants.set(idOf(session),grant);issuedOrbits.set(session,grant);authorized=true;
      }
    } else if(action==="authorizeStopOrbit") {
      const owned=s.pveOwnedOrbit;
      if((op.phase==="engaging"||op.deployment&&op.mode==="escort"&&op.paused)&&!op.targetID&&!moving(ship)&&owned&&ship.mode==="ORBIT"&&Number(ship.targetEntityID)===owned.targetID&&Number(ship.orbitDistance)===owned.range) {
        op.nonce=randomUUID();op.version++;op.grant="stop";grants.set(idOf(session),{id:op.id,kind:"stop",owned,expires:clock()+2000});authorized=true;
      }
    } else if(action==="warped"||action==="orbited"||action==="orbitStopped") {
      // Acknowledgments never infer arrival or native movement success.
    } else if(action!=="poll")throw Error("Unknown PVE action.");
    return {...view(session,s),authorized};
  }
  function allowNavigation(session,kind,args) {
    const s=getState(session),op=s.pveJob;
    if(op?.deployment&&deployment.allowNavigation(session,kind,args))return true;
    if(!op?.deployment&&op?.phase==="routeBelt"&&kind==="warp"&&args.warpType==="item"&&Number(args.minRange||0)>=0&&Number(args.minRange||0)<=15000&&args.fleet!==true){
      try{valid(session,s,op);if(deployment?.routeNavigation(session,op,"Handle_CmdFollowBall",[Number(args.targetID),0]))return true;}catch{}
    }
    const grant=grants.get(idOf(session));if(!grant||op?.id!==grant.id||clock()>grant.expires)return false;
    let current;try{current=valid(session,s,op);}catch{grants.delete(idOf(session));return false;}
    if(grant.kind==="stop"&&(moving(current.ship)||s.pveOwnedOrbit!==grant.owned||current.ship.mode!=="ORBIT"||
      Number(current.ship.targetEntityID)!==grant.owned.targetID||Number(current.ship.orbitDistance)!==grant.owned.range)) {
      grants.delete(idOf(session));return false;
    }
    if(grant.kind==="orbit"){
      if(moving(current.ship)){grants.delete(idOf(session));return false;}
      const anchor=grant.orbitKind==="escort"?deployment?.idleAnchor(session,s):null;
      if(op.targetID!==grant.targetID||(op.orbitKind||"hostile")!==grant.orbitKind||grant.range!==orbitRange(s,current.ship,grant.orbitKind)||
        (grant.orbitKind==="escort"?anchor?.session!==grant.anchorSession||anchor?.ship!==grant.anchorShip||anchor?.itemID!==grant.targetID:!hostile(current.scene,current.ship,current.scene?.getEntityByID(grant.targetID)))){grants.delete(idOf(session));return false;}
    }
    const matches=grant.kind===kind&&(kind==="stop"?!op.targetID:Number(args.targetID)===grant.targetID&&(kind==="warp"?args.warpType==="item"&&Number(args.minRange||0)===0&&args.fleet!==true:Number(args.range)===grant.range));
    if(matches){grants.delete(idOf(session));op.grant=null;if(kind==="orbit"){s.pveOwnedOrbit={targetID:grant.targetID,range:grant.range};issuedOrbits.delete(session);}if(kind==="stop")s.pveOwnedOrbit=null;return true;}return false;
  }
  function orbitNavigation(session,args){
    const s=getState(session),op=s.pveJob,issued=issuedOrbits.get(session);
    const retryable=issued&&clock()<=issued.expires+3000;
    if(issued&&!retryable)issuedOrbits.delete(session);
    const exact=retryable&&issued.id===op?.id&&issued.shipID===shipOf(session)&&Number(args.targetID)===issued.targetID&&Number(args.range)===issued.range;
    const allowed=allowNavigation(session,"orbit",args);if(allowed)return {allowed:true,skipped:false};
    if(!exact)return {allowed:false,skipped:false};issuedOrbits.delete(session);
    try{valid(session,s,op);if(getSession(idOf(session))!==session)return {allowed:false,skipped:false};}
    catch{return {allowed:false,skipped:false};}
    return {allowed:false,skipped:true};
  }
  function autopilotNavigation(session,method,args){const s=getState(session),op=s.pveJob;try{valid(session,s,op);}catch{return false;}
    return op.deployment?deployment.autopilotNavigation(session,method,args):op.phase==="routeBelt"&&deployment?.routeNavigation(session,op,method,args)===true;
  }
  return {tick,stop,view,searchBelts,catalogBelts,ready,heartbeat,action,allowNavigation,orbitNavigation,autopilotNavigation,belt};
}
module.exports={createPVE};
