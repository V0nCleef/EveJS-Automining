"use strict";
const path=require("node:path");
const {fleetOreAcceptance}=require("./featureSettings");
const idOf=s=>Number(s?.characterID||s?.charid||0);
const shipOf=s=>Number(s?.shipID||s?.shipid||0);
const qty=r=>Math.max(0,Number(r.quantity??r.stacksize)||0);
const busy=s=>!!(s.haul||s.transportJob||s.pveTravel||s.fleetReservation?.retreated);
const docked=s=>!!(s.stationID||s.stationid||s.structureID||s.structureid);
function stationary(ship) {
  if(!ship||ship.pendingWarp||ship.mode==="WARP"||ship.pendingDock||ship.dockingTargetID||ship.cloaked||ship.isCloaked)return false;
  const v=ship.velocity;
  if(v&&[v.x,v.y,v.z].every(Number.isFinite))return Math.hypot(v.x,v.y,v.z)<=0.5;
  return ship.mode==="STOP"&&(ship.speed===undefined||Math.abs(Number(ship.speed))<=0.5);
}
const available=ship=>ship&&!ship.pendingWarp&&ship.mode!=="WARP"&&!ship.pendingDock&&!ship.dockingTargetID&&!ship.cloaked&&!ship.isCloaked;
function createFleetOre({root,getSpace,getSession,getState,compress,clock=Date.now,logError=console.error,native=null}) {
  let runtime;const peerCache=new Map();
  function deps() {
    if(native)return native;if(runtime)return runtime;
    const load=p=>require(path.join(root,"server/src",p)),items=load("services/inventory/itemStore.js"),types=load("services/inventory/itemTypeRegistry.js"),
      mining=load("services/mining/miningInventory.js"),industry=load("services/mining/miningIndustry.js"),Broker=load("services/inventory/invBrokerService.js"),
      fleets=load("services/fleets/fleetRuntime.js"),scope=load("space/destiny/identity/interactionScope.js"),services=load("services/ship/shipServiceAccess.js");
    function broker(session,id) {
      const b=Object.create(Broker.prototype);b._boundContexts=new Map();let context=null;
      b._getBoundContext=()=>context;b._makeBoundSubstruct=value=>{context=value;return value;};
      b.Handle_GetInventoryFromId([id],session,{});return b;
    }
    return runtime={list:(session,id,flag,all=false)=>items.listContainerItems(all?null:idOf(session),id,flag),
      type:id=>types.resolveItemByTypeID(id),ore:row=>mining.classifyMiningMaterialType(types.resolveItemByTypeID(row.typeID))?.kind==="ore",
      compressed:row=>industry.isCompressedType(row.typeID),fleet:id=>fleets.getFleetForCharacter(id),
      local:(a,b)=>scope.canEntitiesInteractLocally(a,b),
      access:(session,id,flag)=>{const item=items.findItemById(id);return !!item&&services.canUseShipServiceFlag(session,item,flag);},
      capacity:(session,id,flag)=>Object.fromEntries(broker(session,id).Handle_GetCapacity([flag],session,{}).args.entries),
      move:(session,target,source,row,quantity,flag)=>broker(session,target).Handle_Add([row.itemID,source],session,{flag,qty:quantity})};
  }
  function live(session) {const scene=getSpace().getSceneForSession(session);return {scene,ship:scene?.getShipEntityForSession(session)};}
  function miner(s){return s.enabled&&s.oreMode==="fleetHangar"&&(s.job==="mining"||s.job===undefined&&!s.autoBoost&&s.shipRole!=="transport")&&!busy(s);}
  function receiver(s){return s.enabled&&s.receiveFleetOre===true&&(s.job==="boosting"||s.job===undefined&&s.autoBoost)&&!busy(s);}
  function oreRows(session,id,flag,all=false){return deps().list(session,id,flag,all).filter(r=>qty(r)>0&&deps().ore(r));}
  function accepted(row,policy){return deps().compressed(row)?policy.compressed:policy.uncompressed;}
  function compressionRequired(s){const policy=fleetOreAcceptance(s);return policy.compressed&&!policy.uncompressed&&s.compressorEnabled===true;}
  function holdFor(session,ship,given=null) {
    if(given?.flagID&&given.capacity>0)return given;
    for(const flagID of [182,134]){const c=deps().capacity(session,ship.itemID,flagID);if(c.capacity>0)return {...c,flagID};}
    return null;
  }
  function peers(fleet,now) {
    let saved=peerCache.get(fleet.fleetID);
    if(!saved||saved.fleet!==fleet||now-saved.at>=5000) {
      if(peerCache.size>=64)peerCache.delete(peerCache.keys().next().value);
      saved={fleet,at:now,ids:[...fleet.members.keys()].slice(0,256).map(Number)};peerCache.set(fleet.fleetID,saved);
    }
    return saved.ids;
  }
  function near(a,b,scene) {
    if(!available(a)||!available(b)||!deps().local(a,b))return false;
    const ga=scene.getLivePublicGridClusterKeyForEntity?.(a)||scene.getPublicGridClusterKeyForEntity?.(a),
      gb=scene.getLivePublicGridClusterKeyForEntity?.(b)||scene.getPublicGridClusterKeyForEntity?.(b);
    if(!ga||ga!==gb)return false;
    const p=a.position,q=b.position;
    if(!p||!q||![p.x,p.y,p.z,q.x,q.y,q.z].every(Number.isFinite))return false;
    // TQ build3396210 ShipFleetHangar.GetOperationalDistance returns
    // maxCargoContainerTransferDistance=2500 and checks ball.surfaceDist.
    // EveJS ship-service checks lack that distance gate, so enforce it here.
    return Math.max(0,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)-Math.max(0,Number(a.radius)||0)-Math.max(0,Number(b.radius)||0))<=2500;
  }
  function matching(a,b) {
    const fa=deps().fleet(idOf(a)),fb=deps().fleet(idOf(b));
    return fa&&fa===fb&&fa.members.has(idOf(a))&&fa.members.has(idOf(b));
  }
  function eligibleReceiver(session,s,scene,ship) {
    return receiver(s)&&!docked(session)&&stationary(ship)&&ship.itemID===shipOf(session)&&scene?.getShipEntityForSession(session)===ship&&getSession(idOf(session))===session;
  }
  function receiverForMiner(session,s,scene,ship,now) {
    if(!miner(s)||!scene||!available(ship)||ship.itemID!==shipOf(session)||docked(session)||getSession(idOf(session))!==session)
      return {status:"Fleet ore reception waits while travelling."};
    const fleet=deps().fleet(idOf(session));
    if(!fleet?.members.has(idOf(session)))return {status:"Fleet ore delivery needs an enabled receiver in this fleet."};
    let status="Fleet ore delivery needs an enabled receiver in this fleet.";
    for(const id of peers(fleet,now)) {
      if(id===idOf(session))continue;const rs=getSession(id);if(!rs)continue;const state=getState(rs);
      if(!state||!receiver(state))continue;
      if(status==="Fleet ore delivery needs an enabled receiver in this fleet.")status="Fleet ore delivery needs a nearby stationary booster within 2500 m.";
      const r=live(rs);
      if(r.scene!==scene||!eligibleReceiver(rs,state,scene,r.ship)||!matching(session,rs)||!near(ship,r.ship,scene))continue;
      if(!deps().access(session,r.ship.itemID,155)||!(deps().capacity(session,r.ship.itemID,155).capacity>0)||!holdFor(rs,r.ship)) {
        status="Fleet ore delivery needs fleet hangar access.";continue;
      }
      const policy=fleetOreAcceptance(state);
      if(!policy.compressed&&!policy.uncompressed){status="Fleet ore admission is off.";continue;}
      return {session:rs,state,ship:r.ship,status:null};
    }
    return {status};
  }
  function deliveryStatus(session,s,scene,ship,now) {
    const r=receiverForMiner(session,s,scene,ship,now);if(r.status)return r.status;
    const h=holdFor(session,ship),rows=h?oreRows(session,ship.itemID,h.flagID):[];
    if(!rows.length)return s.fleetOreDelivered?"Ore delivered to the booster's fleet hangar.":"Waiting for ore to deliver to the fleet hangar.";
    const policy=fleetOreAcceptance(r.state),raw=rows.some(row=>!deps().compressed(row));
    if(!policy.uncompressed&&raw)return compressionRequired(r.state)?"Waiting for fleet compression.":"Booster accepts compressed ore only; raw ore stays aboard.";
    if(!rows.some(row=>accepted(row,policy)))return "Booster accepts uncompressed ore only; compressed ore stays aboard.";
    const bay=deps().capacity(session,r.ship.itemID,155),rh=holdFor(r.session,r.ship),ore=deps().capacity(r.session,r.ship.itemID,rh.flagID);
    if(bay.used>=bay.capacity&&ore.used>=ore.capacity)return "Fleet ore storage is full.";
    return "Ore ready for delivery to the fleet hangar.";
  }
  function amount(session,id,flag,typeID,all=false) {return oreRows(session,id,flag,all).filter(r=>Number(r.typeID)===Number(typeID)).reduce((n,r)=>n+qty(r),0);}
  function transfer(session,source,target,row,flag,allSource=false) {
    const c=deps().capacity(session,target,flag),volume=Number(deps().type(row.typeID)?.volume);
    if(!(volume>0)||!(c.capacity>0))return 0;
    const quantity=Math.min(qty(row),Math.max(0,Math.floor((Number(c.capacity)-Number(c.used)+1e-8)/volume)));
    if(!quantity)return 0;
    const before=amount(session,source,row.flagID,row.typeID,allSource),afterTarget=amount(session,target,flag,row.typeID,true);
    deps().move(session,target,source,row,quantity,flag);
    const confirmed=Math.min(before-amount(session,source,row.flagID,row.typeID,allSource),amount(session,target,flag,row.typeID,true)-afterTarget);
    if(confirmed<quantity)throw Error("Native fleet ore transfer could not be confirmed.");
    return confirmed;
  }
  function waitingForCompression(session,s,scene,ship) {
    if(!miner(s)||!scene||!available(ship)||ship.itemID!==shipOf(session)||docked(session)||getSession(idOf(session))!==session)return false;
    try {
      const r=receiverForMiner(session,s,scene,ship,clock());
      if(r.state&&compressionRequired(r.state)) {
        const h=holdFor(session,ship);return !!h&&oreRows(session,ship.itemID,h.flagID).some(row=>!deps().compressed(row));
      }
    }catch(error){logError(`[AutoMining] Fleet compression check failed: ${error.message}`);}
    return false;
  }
  function tick(session,s,scene,ship,hold,now=clock()) {
    if(s.oreMode==="fleetHangar"&&(s.job==="mining"||s.job===undefined)) {
      if(now<(s.nextFleetOre||0))return view(s);s.nextFleetOre=now+5000;
      try{s.fleetOreStatus=deliveryStatus(session,s,scene,ship,now);}
      catch(error){s.fleetOreStatus="Fleet ore delivery paused: "+error.message;logError(`[AutoMining] Fleet ore delivery check failed: ${error.message}`);}
      return view(s);
    }
    if(!receiver(s)){s.fleetOreStatus="Fleet ore reception is off.";return view(s);}
    const policy=fleetOreAcceptance(s);
    if(!policy.compressed&&!policy.uncompressed){s.fleetOreStatus="Fleet ore admission is off.";return view(s);}
    if(now<(s.nextFleetOre||0))return view(s);s.nextFleetOre=now+5000;
    if(!eligibleReceiver(session,s,scene,ship)){s.fleetOreStatus="Fleet ore reception waits while travelling.";return view(s);}
    try {
      const fleet=deps().fleet(idOf(session)),h=holdFor(session,ship,hold);
      if(!fleet?.members.has(idOf(session))||!h||!(deps().capacity(session,ship.itemID,155).capacity>0)){
        s.fleetOreStatus="Fleet ore reception needs a fleet hangar and mining hold.";return view(s);
      }
      let received=0,stored=0,operations=0,compressions=0,waiting=false;
      function drain() {
        for(const row of oreRows(session,ship.itemID,155,true).slice(0,8)) {
          if(operations>=12||!eligibleReceiver(session,s,scene,ship))break;
          operations++;stored+=transfer(session,ship.itemID,ship.itemID,row,h.flagID,true);
        }
      }
      drain();
      const ids=peers(fleet,now).filter(id=>id!==idOf(session));
      const start=(s.fleetOreCursor||0)%Math.max(1,ids.length);s.fleetOreCursor=start+8;
      for(let index=0;index<Math.min(8,ids.length)&&operations<12;index++) {
        const ps=getSession(ids[(start+index)%ids.length]);if(!ps)continue;const state=getState(ps),p=live(ps);
        if(!state||!miner(state)||docked(ps)||p.ship?.itemID!==shipOf(ps)||p.scene!==scene||!matching(session,ps)||!near(ship,p.ship,scene))continue;
        try { if(!deps().access(ps,ship.itemID,155)||!(deps().capacity(ps,ship.itemID,155).capacity>0))continue; }
        catch { continue; } // A closed guest bay must not stall or compress this miner.
        const ph=holdFor(ps,p.ship);if(!ph)continue;
        let rows=oreRows(ps,p.ship.itemID,ph.flagID);
        if(compressionRequired(s)&&rows.some(row=>!deps().compressed(row))) {
          if(compress&&compressions<2){compressions++;compress(scene,ps,p.ship,ship.itemID);rows=oreRows(ps,p.ship.itemID,ph.flagID);}
          waiting ||= rows.some(row=>!deps().compressed(row));
        }
        rows=rows.filter(row=>accepted(row,policy));
        for(const row of rows.slice(0,4)) {
          if(operations>=12||getSession(idOf(ps))!==ps||!miner(state)||!eligibleReceiver(session,s,scene,ship)||!matching(session,ps)||!near(ship,p.ship,scene))break;
          operations++;const transferred=transfer(ps,p.ship.itemID,ship.itemID,row,155);received+=transferred;
          if(transferred>0) {
            state.fleetOreDelivered=true;state.fleetOreStatus="Ore delivered to the booster's fleet hangar.";
            state.fleetOreEvent={id:`${p.ship.itemID}:${ship.itemID}:${now}:${operations}`,at:now,quantity:transferred,storedUnits:0};
            state.nextHaulCheck=0;state.nextFleetOre=0;
          }
        }
      }
      drain();
      const finalOre=deps().capacity(session,ship.itemID,h.flagID),finalFleet=deps().capacity(session,ship.itemID,155);
      s.fleetOreStatus=!stored&&!received&&finalOre.used>=finalOre.capacity&&finalFleet.used>=finalFleet.capacity?"Fleet ore storage is full.":
        waiting?"Waiting for fleet compression.":stored>0?"Fleet ore received into the mining hold.":received>0?
        "Fleet ore received into the fleet hangar.":"Waiting for nearby mining pilots and fleet hangar access.";
      if(received>0||stored>0)s.fleetOreEvent={id:`${ship.itemID}:${now}`,at:now,quantity:received,storedUnits:stored};
    }catch(error){s.fleetOreStatus="Fleet ore reception paused: "+error.message;logError(`[AutoMining] Fleet ore reception failed: ${error.message}`);}
    return view(s);
  }
  function view(s){return {status:s.fleetOreStatus||"Fleet ore reception is off.",event:s.fleetOreEvent||null};}
  return {tick,view,waitingForCompression};
}
module.exports={createFleetOre};
