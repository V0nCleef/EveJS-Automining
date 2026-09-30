"use strict";
const crypto = require("node:crypto");
const path = require("node:path");
const { retreatReason } = require("./defense");
const TYPES = new Set([656, 42244, 28606, 28352]);
const COMMAND = new Set([42244, 28606, 28352]);
const idOf = s => Number(s?.characterID || s?.charid || 0);
const shipOf = s => Number(s?.shipID || s?.shipid || 0);
const dockOf = s => Number(s?.structureID || s?.structureid || s?.stationID || s?.stationid || 0);
const qty = r => Math.max(0, Number(r.quantity || r.stacksize) || 0);
const distance = (a, b) => a && b && [a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite) ? Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) : Infinity;
const moving = ship => !ship || ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock || ship.dockingTargetID || ship.cloaked || ship.isCloaked;
const privateSpace = (session, scene, ship) => Boolean(session.spaceInstanceID || session._space?.instanceID || scene?.instanceID || ship?.dungeonCurrentInstanceID || ship?.dungeonCurrentRoomKey);
const LABELS = { joining:"Joining the pickup fleet.", routePickup:"Travelling to fleet pickup system.", warpPickup:"Warping to fleet pickup.", approachPickup:"Approaching fleet pickup.", loading:"Collecting fleet ore.", outbound:"Transporting ore to station.", unloading:"Docked; unloading collected ore.", undocking:"Transport undocking." };
const fleetName = fleet => String(fleet?.advert?.fleetName || "").slice(0,160);
const canIdentity = record => record && JSON.stringify([Number(record.itemID),Number(record.typeID),Number(record.ownerID)||0,Number(record.locationID),record.createdAtMs??null]);

// The server owns leases and inventory receipts. Movement and inventory mutation
// remain ordinary client/native commands, with an authorization immediately before
// each operation. No scene enumeration or fleet-wide tick is needed.
function createTransport({ root, getAPI, getSpace, getFleet, getSession, getState, destinations, oreHandling,
  industrial, save = () => "", statistics, clock = Date.now, native = null, onBegin = () => {}, random = Math.random }) {
  const queues = new Map(), registered = new Map(), grants = new Map(), binClaims = new Map(), activeJobs = new Map();
  let lastSweep = -Infinity;
  let runtime;
  function deps() {
    if (native) return native;
    if (runtime) return runtime;
    const load = p => require(path.join(root, "server/src", p));
    const items = load("services/inventory/itemStore.js"), types = load("services/inventory/itemTypeRegistry.js");
    const mining = load("services/mining/miningInventory.js"), loot = load("services/_shared/spaceLootEntitlement.js");
    const interaction = load("space/destiny/identity/interactionScope.js"), InvBroker = load("services/inventory/invBrokerService.js"), fleets = load("services/fleets/fleetRuntime.js");
    function broker(session,id) {
      const b = Object.create(InvBroker.prototype); b._boundContexts = new Map(); let context;
      b._getBoundContext = () => context; b._makeBoundSubstruct = value => { context = value; return value; };
      b.Handle_GetInventoryFromId([id],session,{}); return b;
    }
    runtime = { type: id => types.resolveItemByTypeID(id),
      ore: row => mining.classifyMiningMaterialType(types.resolveItemByTypeID(row.typeID))?.kind === "ore",
      list: (session,id,flag) => items.listContainerItems(id === shipOf(session) ? idOf(session) : null,id,flag),
      can: id => items.findItemById(id),
      capacity: (session,id,flag) => Object.fromEntries(broker(session,id).Handle_GetCapacity([flag],session,{}).args.entries),
      right: (session,can) => loot.sessionHasSpaceLootRight(session,loot.buildSpaceLootSourceFromItem(can)),
      local: (a,b) => interaction.canEntitiesInteractLocally(a,b),scope:entity=>interaction.resolveEntityInteractionScope(entity),fleets };
    return runtime;
  }
  function live(session) {
    const scene = getSpace().getSceneForSession(session);
    return { scene, ship: scene?.getShipEntityForSession(session) || null };
  }
  function isPrivate(session,scene,ship) {
    if(privateSpace(session,scene,ship))return true;
    const scope=ship&&deps().scope?.(ship);
    return Boolean(scope&&(scope.scoped||!scope.valid));
  }
  function list(session,id,flag) { return deps().list(session,id,flag).filter(r => qty(r)>0 && deps().ore(r)); }
  function total(rows,typeID) { return rows.reduce((n,r)=>n+(Number(r.typeID)===Number(typeID)?qty(r):0),0); }
  function hold(session,ship) {
    for (const flagID of [182,134]) {
      let c;try { c=deps().capacity(session,ship.itemID,flagID); } catch { continue; }
      if (Number(c?.capacity)>0) return { flagID, capacity:Number(c.capacity), used:Number(c.used)||0, free:Math.max(0,Number(c.capacity)-(Number(c.used)||0)) };
    }
    return null;
  }
  function eligibility(session,ship) {
    const typeID = Number(ship?.typeID || session.shipTypeID || 0);
    if (!TYPES.has(typeID) || !ship || Number(ship.itemID)!==shipOf(session)) return { eligible:false,dualRole:COMMAND.has(typeID) };
    try {
      const type=deps().type(typeID), h=hold(session,ship);
      return { eligible:Boolean(type && type.published!==false && type.published!==0 && h),dualRole:COMMAND.has(typeID),holdFlag:h?.flagID,capacity:h?.capacity };
    } catch { return {eligible:false,dualRole:COMMAND.has(typeID)}; }
  }
  function queue(fleet) { let q=queues.get(fleet); if (!q) { q=new Map(); queues.set(fleet,q); } return q; }
  function requests() { return Array.from(queues.values()).flatMap(q=>Array.from(q.values())).slice(0,256); }
  function dropRequest(r) {
    const q=queues.get(r.fleet);if(q?.get(r.characterID)===r)q.delete(r.characterID);
    if(q&&!q.size)queues.delete(r.fleet);
  }
  function canCurrent(r) {
    const can=deps().can(r.canID);
    return !!can && (!r.canIdentity || canIdentity(can)===r.canIdentity) && !(Number(can.expiresAtMs)>0&&Number(can.expiresAtMs)<=clock());
  }
  function reserveBin(op,canID) {
    if(!canID)return;
    const record=deps().can(canID), existing=binClaims.get(canID);
    if(existing&&existing!==op)throw Error("Pickup bin is already reserved by another hauler.");
    if(!record||Number(record.typeID)!==23||Number(record.expiresAtMs)>0&&Number(record.expiresAtMs)<=clock())throw Error("Assigned jetcan is unavailable or has no fleet loot rights.");
    if(op.request?.canIdentity&&canIdentity(record)!==op.request.canIdentity)throw Error("Assigned jetcan is unavailable or has no fleet loot rights.");
    binClaims.set(canID,op);op.reservedCanID=canID;op.canIdentity=canIdentity(record);
  }
  function releaseClaim(op) {
    if(op?.reservedCanID&&binClaims.get(op.reservedCanID)===op)binClaims.delete(op.reservedCanID);
    if(op?.request&&op.request.ownerJobID===op.id&&op.request.haulerID===op.haulerID) {
      Object.assign(op.request,{haulerID:0,ownerSession:null,ownerState:null,ownerJobID:null});
    }
  }
  function ownedInvite(lease) { return deps().fleets?.runtimeState?.invitesByCharacter?.get(lease.characterID)===lease.invite; }
  function cleanup(session,s) {
    const lease=s.transportFleetLease;if(!lease||s.transportJob)return false;
    const current=getFleet(idOf(session));
    if(getSession(lease.characterID)!==session||lease.session!==session||shipOf(session)!==lease.shipID||idOf(session)!==lease.characterID||current&&current!==lease.fleet) {
      s.transportFleetLease=null;return false; // Never act on a replacement pilot, ship or manual fleet.
    }
    if(!current) {
      if(lease.invite&&ownedInvite(lease))deps().fleets.rejectInvite(session,lease.fleetID);
      s.transportFleetLease=null;return true;
    }
    if(!lease.fleet.members?.has(lease.characterID)||lease.member&&lease.fleet.members.get(lease.characterID)!==lease.member) {s.transportFleetLease=null;return false;}
    lease.member ||= lease.fleet.members.get(lease.characterID);
    if(!dockOf(session)) {lease.cleanupPending=true;s.transportStatus="Temporary pickup fleet will be left after docking.";return false;}
    try{deps().fleets.leaveFleet(session,lease.fleetID);}catch(error){lease.cleanupPending=true;s.transportStatus=`Transport paused: ${error.message||error}`;return false;}
    if(getFleet(lease.characterID)===lease.fleet){lease.cleanupPending=true;return false;}
    s.transportFleetLease=null;return true;
  }
  function notify(session,job) { try { session.sendNotification("OnAutoMiningTransport","clientID",[JSON.stringify(job)]); } catch {} }
  function publicJob(op) {
    if (!op) return null;
    return { id:op.id,nonce:op.nonce,version:op.version,phase:op.phase,status:LABELS[op.phase],shipID:op.shipID,
      miner:op.request?{characterID:op.request.characterID,shipID:op.request.shipID,systemID:op.request.systemID,fleetID:Number(op.fleet?.fleetID||0),fleetName:fleetName(op.fleet),
        targetID:op.request.binFirst?op.request.canID:op.request.characterID,warpType:op.request.binFirst?"item":"char",
        approachID:op.request.binFirst?op.request.canID:op.request.shipID}:null,
      station:op.station,storage:op.storage,flagID:op.flagID,canID:op.canID||null,resumePhase:op.resumePhase||null,
      approachRange:100,approachNeeded:op.approachNeeded!==false,
      transfers:op.transfer?[{...op.transfer}]:[],items:op.phase==="unloading"?(op.items||[]).map(r=>({itemID:r.itemID,typeID:r.typeID,quantity:qty(r)})):[],grant:op.grant||null };
  }
  function view(session,s,snapshotShip=null) {
    const fleet=getFleet(idOf(session)), all=requests(), own=all.find(r=>r.characterID===idOf(session)||s.transportRequestedBin?.requestID===r.id), ship=snapshotShip||live(session).ship;
    const e=eligibility(session,ship || (shipOf(session)?{itemID:shipOf(session),typeID:session.shipTypeID}:null));
    return {...e,registered:registered.has(idOf(session)),status:s.transportStatus||"Transport is off.",job:publicJob(s.transportJob),
      queue:all.filter(r=>s.job==="hauling"||r.fleet===fleet).slice(0,32).map(r=>({characterID:r.characterID,shipID:r.shipID,systemID:r.systemID,fleetID:Number(r.fleet?.fleetID||0),claimed:Boolean(r.haulerID),canID:r.canID||null})),
      request:own?{queued:true,claimed:Boolean(own.haulerID)}:null,
      pool:{haulers:registered.size,available:Array.from(registered.values()).filter(r=>!r.s.transportJob&&!r.s.transportFleetLease).length,requests:all.length},
      temporaryFleet:s.transportFleetLease?{fleetID:s.transportFleetLease.fleetID,fleetName:fleetName(s.transportFleetLease.fleet),joining:s.transportJob?.phase==="joining",cleanupPending:!!s.transportFleetLease.cleanupPending}:null,
      binReservation:s.transportJob?.reservedCanID?{canID:s.transportJob.reservedCanID,jobID:s.transportJob.id,haulerID:idOf(session)}:null,authorized:false};
  }
  function phase(session,op,value) { op.phase=value; op.changed=clock(); op.nonce=crypto.randomUUID(); op.version++; op.grant=null; op.transfer=null; grants.delete(idOf(session)); notify(session,publicJob(op)); }
  function stillMember(session,fleet) { return getSession(idOf(session))===session && getFleet(idOf(session))===fleet && (!fleet||fleet.members?.has(idOf(session))); }
  function minerValid(r,fleet) {
    const session=getSession(r.characterID); if (!session || !stillMember(session,fleet) || shipOf(session)!==r.shipID) return false;
    const s=getState(session), {scene,ship}=live(session);
    if(r.binFirst) {
      const can=deps().can(r.canID), entity=r.scene?.getEntityByID?.(r.canID);
      const pending=r.ownerState?.transportJob?.request===r && (r.ownerState.transportJob.receipt||r.ownerState.transportJob.pickupComplete) && r.ownerState.transportJob.canID===r.canID;
      return s.enabled && (!s.job || s.job==="mining") && s.oreMode==="pickup" &&
        (pending || can && canCurrent(r) && entity && Number(can.locationID)===r.systemID && !isPrivate(session,r.scene,entity) && list(session,r.canID,0).length>0);
    }
    return s.enabled && s.shipRole!=="transport" && s.oreMode==="pickup" && !s.haul && scene && ship?.itemID===r.shipID &&
      !retreatReason(s,ship) && scene.systemID===r.systemID && !isPrivate(session,scene,ship);
  }
  function cancel(session,s,reason="Transport cancelled.") {
    const op=s.transportJob, id=idOf(session); grants.delete(id); registered.delete(id);
    releaseClaim(op);if(op)activeJobs.delete(op.id);
    // A miner cancellation removes its own queue entry; a hauler cancellation
    // leaves ore and any partially emptied can available for another lease.
    for (const [fleet,q] of queues) { q.delete(id); if (!q.size) queues.delete(fleet); }
    s.transportJob=null; s.transportRequestedBin=null;s.transportInterrupted=false; s.transportStatus=reason;
    cleanup(session,s);save(session,s); if(op) notify(session,{cancel:op.id});
  }
  function fail(session,s,error) { cancel(session,s,`Transport paused: ${error.message||error}`); s.enabled=false; save(session,s); }
  function reclaimLease(r,fleet) {
    if(!r.haulerID)return;
    const owner=getSession(r.haulerID),state=owner&&getState(owner),op=state?.transportJob;
    const current=owner===r.ownerSession&&state===r.ownerState&&(getFleet(r.haulerID)===fleet||op?.phase==="joining"&&!getFleet(r.haulerID))&&
      op?.id===r.ownerJobID&&op.request===r&&op.fleet===fleet&&state.enabled&&
      state.shipRole==="transport"&&state.transportEnabled&&state.transportClientReady&&
      shipOf(owner)===op.shipID&&!state.haul&&Number.isFinite(op.heartbeat)&&clock()-op.heartbeat<=45000;
    if(current)return;
    // Inspect only this queued claim. Keep the original session/state so a
    // disconnected owner, which receives no scene tick, can still be paused.
    // Never cancel an unrelated replacement job belonging to the same pilot.
    const oldState=r.ownerState,oldOp=oldState?.transportJob;
    if(oldOp?.id===r.ownerJobID&&oldOp.request===r&&oldOp.fleet===fleet)
      fail(r.ownerSession,oldState,Error("Transport client or trip timed out."));
    r.haulerID=0;r.ownerSession=null;r.ownerState=null;r.ownerJobID=null;
  }
  function request(session,s) {
    const fleet=getFleet(idOf(session)), {scene,ship}=live(session);
    if(!s.enabled||s.shipRole==="transport"||s.job&&s.job!=="mining")throw Error("Start the Mining job before requesting pickup.");
    if(s.oreMode!=="pickup")throw Error("Choose Fleet pickup in Ore handling before requesting pickup.");
    if(!fleet)throw Error("Join a native fleet before requesting pickup.");
    if(!stillMember(session,fleet))throw Error("Pickup session is no longer current.");
    if(dockOf(session))throw Error("Undock the mining ship before requesting pickup.");
    if(!scene||ship?.itemID!==shipOf(session))throw Error("Pickup requires the current mining ship in space.");
    if(isPrivate(session,scene,ship))throw Error("Fleet pickup is unavailable in private space.");
    if(moving(ship))throw Error("Wait for warp or docking to finish before requesting pickup.");
    if(s.haul||s.transportJob||retreatReason(s,ship))throw Error("Finish the current trip before requesting pickup.");
    const h=hold(session,ship), binFirst=s.pickupStyle==="binFirst";
    if (!h) throw Error("No ore is available for fleet pickup.");
    if(binFirst && list(session,ship.itemID,h.flagID).length) oreHandling.jettison(session,s,scene,ship,h,clock());
    const priorID=Number(s.jettisonCan?.containerID||0), priorCan=priorID&&deps().can(priorID), priorEntity=priorID&&scene.getEntityByID?.(priorID);
    const canID=binFirst?priorID:priorCan&&priorEntity&&Number(priorCan.locationID)===scene.systemID&&
      Math.max(0,distance(ship.position,priorEntity.position)-(Number(priorEntity.radius)||0))<=2500?priorID:0;
    if(binFirst ? !canID || !deps().can(canID) || !list(session,canID,0).length : !list(session,ship.itemID,h.flagID).length)
      throw Error("No ore is available for fleet pickup.");
    const existing=queues.get(fleet)?.get(idOf(session));
    if (existing && existing.shipID===ship.itemID && existing.systemID===scene.systemID && (!binFirst || existing.canID===canID)) return view(session,s);
    if(canID) {
      const identity=canIdentity(deps().can(canID)),same=requests().find(r=>r.canID===canID&&r.canIdentity===identity);
      if(same) {s.transportRequestedBin={requestID:same.id};s.transportStatus="Fleet pickup requested.";return view(session,s);}
    }
    if(requests().length>=256&&!existing)throw Error("Global pickup queue is full; try again shortly.");
    if (existing?.haulerID) { const hs=getSession(existing.haulerID); if(hs) cancel(hs,getState(hs),"Pickup cancelled after miner location changed."); }
    s.transportRequestedBin=null;
    queue(fleet).set(idOf(session),{id:crypto.randomUUID(),fleet,characterID:idOf(session),shipID:ship.itemID,systemID:scene.systemID,created:clock(),haulerID:0,canID,canIdentity:canID?canIdentity(deps().can(canID)):null,binFirst,scene,holdFlag:h.flagID});
    s.transportStatus="Fleet pickup requested."; return view(session,s);
  }
  function safeDeparture(session,s,scene,ship) {
    if (!scene || !ship) return true;
    return !industrial || industrial.requestDeparture(session,s,scene,ship,scene.getCurrentSimTimeMs?.()??clock());
  }
  function start(session,s,ship,h,r,fleet) {
    const station=destinations.station(s.transportStationID,session), storage=destinations.storage(session,station.stationID,s.transportStorageKey);
    s.transportInterrupted=true;
    if(save(session,s)) { s.transportInterrupted=false; throw Error("Could not save transport safety state."); }
    const op={id:crypto.randomUUID(),nonce:crypto.randomUUID(),version:1,shipID:ship.itemID,flagID:h.flagID,station,storage,storageKey:s.transportStorageKey,
      fleet,haulerID:idOf(session),session,state:s,request:r||null,phase:r&&dockOf(session)?"undocking":r?"routePickup":"outbound",resumePhase:r?"routePickup":"outbound",started:clock(),changed:clock(),heartbeat:clock(),lastReceipt:clock()};
    if(r?.canID)reserveBin(op,r.canID); // Synchronous claim precedes invites or movement.
    if(r) {r.haulerID=idOf(session);r.ownerSession=session;r.ownerState=s;r.ownerJobID=op.id;}
    if(r?.binFirst)op.canID=r.canID;
    s.transportJob=op;activeJobs.set(op.id,op);
    if(r&&!getFleet(idOf(session))) {
      if(s.job!=="hauling")throw Error("Transport lease no longer belongs to this pilot.");
      const fs=deps().fleets, miner=getSession(r.characterID);
      if(!fs||fs.runtimeState.invitesByCharacter.has(idOf(session))||!miner||!stillMember(miner,fleet))throw Error("Transport lease no longer belongs to this pilot.");
      op.phase="joining";op.joinDock=dockOf(session);
      const lease={fleet,fleetID:Number(fleet.fleetID),characterID:idOf(session),shipID:shipOf(session),session,member:null,invite:null,cleanupPending:false};
      s.transportFleetLease=lease;
      try{fs.inviteCharacter(miner,lease.fleetID,lease.characterID,null,null,fs.FLEET?.FLEET_ROLE_MEMBER??4,{autoAccept:true});}
      finally {
        const invite=fs.runtimeState.invitesByCharacter.get(lease.characterID);
        if(invite?.fleetID===lease.fleetID&&invite.inviterCharID===r.characterID)lease.invite=invite;
      }
      if(!lease.invite)throw Error("Transport lease no longer belongs to this pilot.");
    }
    s.transportStatus=LABELS[op.phase];onBegin(session,s);notify(session,publicJob(op));
  }
  function validateOwner(session,s,op) {
    const pending=op?.phase==="joining"&&!getFleet(idOf(session))&&getSession(idOf(session))===session&&s.transportFleetLease?.session===session;
    if(!op || !s.enabled || s.shipRole!=="transport" || !s.transportEnabled || !s.transportClientReady || !(pending||stillMember(session,op.fleet)) || shipOf(session)!==op.shipID || s.haul) throw Error("Transport lease no longer belongs to this pilot.");
    if(clock()-op.heartbeat>45000 || clock()-op.started>7200000) throw Error("Transport client or trip timed out.");
    if(pending&&!ownedInvite(s.transportFleetLease))throw Error("Transport lease no longer belongs to this pilot.");
    if(op.reservedCanID&&!op.pickupComplete&&!op.receipt&&(!canCurrent({canID:op.reservedCanID,canIdentity:op.canIdentity})||binClaims.get(op.reservedCanID)!==op)) {
      if(op.request)dropRequest(op.request);
      throw Error("Assigned jetcan is unavailable or has no fleet loot rights.");
    }
    if(op.request && ((!op.pickupComplete&&!minerValid(op.request,op.fleet)) || op.request.haulerID!==idOf(session))) throw Error("Pickup miner changed fleet, ship or location.");
    const {scene,ship}=live(session);
    if(isPrivate(session,scene,ship)) throw Error("Instanced or gated transport is not supported.");
    if(ship && !eligibility(session,ship).eligible) throw Error("Transport ship no longer has an eligible ore hold.");
    return {scene,ship};
  }
  function observe(session,s,op) {
    const {scene,ship}=validateOwner(session,s,op), dock=dockOf(session);
    if(op.phase==="joining") {
      if(op.joinDock&&dock!==op.joinDock)throw Error("Transport lease no longer belongs to this pilot.");
      if(clock()-op.changed>60000)throw Error("Pickup fleet join timed out.");
      const lease=s.transportFleetLease;
      if(getFleet(idOf(session))!==op.fleet) {s.transportStatus=LABELS.joining;return;}
      if(!lease||!op.fleet.members.has(idOf(session)))throw Error("Transport lease no longer belongs to this pilot.");
      lease.member=op.fleet.members.get(idOf(session));lease.invite=null;
      deps().fleets.initFleet(session,lease.fleetID);
      try{session.sendNotification("OnAutoMiningFleetReady","clientID",[lease.fleetID]);}catch{}
      phase(session,op,dock?"undocking":"routePickup");
    }
    if(dock && op.phase!=="undocking" && !(op.phase==="outbound"&&dock===op.station.stationID) && !(op.phase==="unloading"&&dock===op.station.stationID)) throw Error("Transport docked outside its assigned destination.");
    if(op.phase==="routePickup" && !dock && scene?.systemID===op.request.systemID && ship?.itemID===op.shipID && !moving(ship)) phase(session,op,"warpPickup");
    if(op.phase==="outbound" && dock===op.station.stationID) {
      op.storage=destinations.storage(session,op.station.stationID,op.storageKey,op.storage);op.items=list(session,op.shipID,op.flagID);
      if(!op.items.length) {
        if(s.job==="hauling"&&!op.request) {s.transportStationReady=true;finish(session,s,op);return;}
        throw Error("Collected ore disappeared before unload receipt.");
      }
      op.before=destinations.totals(op.storage);phase(session,op,"unloading");
    }
    if(op.phase==="undocking" && !dock && ship?.itemID===op.shipID && !moving(ship)) {
      if(op.undockedAt==null) op.undockedAt=clock();
      if(clock()-op.undockedAt>=3000) {
        if(op.completedUnload) { finish(session,s,op);return; }
        phase(session,op,op.resumePhase);
      }
    }
    if(["warpPickup","approachPickup","loading","unloading","undocking"].includes(op.phase) && clock()-op.changed>300000) throw Error("Transport operation timed out.");
    s.transportStatus=LABELS[op.phase];
  }
  function finish(session,s,op) {
    if(op.sourceExhausted&&op.request)dropRequest(op.request);
    releaseClaim(op);activeJobs.delete(op.id);
    s.transportJob=null;s.transportInterrupted=false;s.transportStatus=s.job==="hauling"?"Transport ready for global fleet pickups.":"Transport ready for fleet pickup.";
    cleanup(session,s);
    grants.delete(idOf(session));if(save(session,s)) throw Error("Could not save transport completion.");notify(session,{cancel:op.id});
  }
  function proximity(session,op,can=false) {
    const {scene,ship}=live(session), ms=getSession(op.request?.characterID), m=ms&&live(ms);
    if(op.request?.binFirst) {
      const entity=scene?.getEntityByID?.(op.canID), record=deps().can(op.canID);
      if(!ms||scene!==op.request.scene||scene.systemID!==op.request.systemID||ship?.itemID!==op.shipID||moving(ship))return null;
      if(!entity&&!record&&!can&&op.receipt)return {scene,ship,miner:m?.ship,minerSession:ms,minerState:getState(ms)};
      if(!entity||!record||Number(record.typeID)!==23||!deps().local(ship,entity)||!deps().right(session,record)) {
        dropRequest(op.request);const error=Error("Assigned jetcan is unavailable or has no fleet loot rights.");fail(session,getState(session),error);throw error;
      }
      if(Math.max(0,distance(ship.position,entity.position)-(Number(entity.radius)||0))>2500)return null;
      return {scene,ship,entity,record,miner:m?.ship,minerSession:ms,minerState:getState(ms)};
    }
    if(!ms || !m?.scene || scene!==m.scene || scene.systemID!==op.request.systemID || ship?.itemID!==op.shipID || m.ship?.itemID!==op.request.shipID || moving(ship) || moving(m.ship)) return null;
    if(isPrivate(session,scene,ship)||isPrivate(ms,m.scene,m.ship)||!deps().local(ship,m.ship)) return null;
    // One centimetre covers floating-point cancellation at system coordinates.
    if(!can) return Math.max(0,distance(ship.position,m.ship.position)-(Number(ship.radius)||0)-(Number(m.ship.radius)||0))<=100.01?{scene,ship,miner:m.ship,minerSession:ms,minerState:getState(ms)}:null;
    const entity=scene.getEntityByID?.(op.canID), record=deps().can(op.canID);
    if(!entity || !record || Number(record.typeID)!==23 || Number(record.locationID)!==scene.systemID || !deps().local(ship,entity) || !deps().right(session,record)) {
      dropRequest(op.request);const error=Error("Assigned jetcan is unavailable or has no fleet loot rights.");fail(session,getState(session),error);throw error;
    }
    if(Math.max(0,distance(ship.position,entity.position)-(Number(entity.radius)||0))>2500) return null;
    return {scene,ship,entity,record,miner:m.ship,minerSession:ms,minerState:getState(ms)};
  }
  function loadingPlan(session,s,op) {
    function exhausted(loaded) {
      op.pickupComplete=true;op.sourceExhausted=true;
      if(s.job==="hauling"||s.transportFleetLease) {phase(session,op,"outbound");return false;}
      dropRequest(op.request);releaseClaim(op);op.request=null;
      if(loaded.used>=loaded.capacity*Math.min(100,Math.max(1,Number(s.transportThreshold)||95))/100)phase(session,op,"outbound");else finish(session,s,op);
      return false;
    }
    if(op.request?.binFirst && !list(session,op.canID,0).length) {
      return exhausted(hold(session,live(session).ship));
    }
    const pair=proximity(session,op);if(!pair)return false;
    const rows=list(session,op.canID,0), p=rows.length?proximity(session,op,true):pair;if(!p)return false;
    const h=hold(session,p.ship);if(!h) throw Error("Transport ore hold is unavailable.");
    if(!rows.length) {
      return exhausted(hold(session,p.ship));
    }
    if(h.used>=h.capacity*Math.min(100,Math.max(1,Number(s.transportThreshold)||95))/100) {op.pickupComplete=true;phase(session,op,"outbound");return false;}
    for(const row of rows.slice(0,32)) {
      const volume=Number(deps().type(row.typeID)?.volume);if(!(volume>0)) continue;
      const quantity=Math.min(qty(row),Math.floor((h.free+1e-8)/volume));
      if(quantity>0) { op.transfer={itemID:Number(row.itemID),typeID:Number(row.typeID),sourceLocationID:op.canID,quantity,flagID:op.flagID};return true; }
    }
    if(h.used>0) {op.pickupComplete=true;phase(session,op,"outbound");}else throw Error("No ore stack fits the transport hold.");return false;
  }
  function tick(session,s,scene,ship,givenHold) {
    try {
      if(clock()-lastSweep>=5000) {
        lastSweep=clock();
        for(const op of activeJobs.values()) {
          try{validateOwner(op.session,op.state,op);}catch(error){fail(op.session,op.state,error);}
        }
        for(const [id,row]of registered)if(getSession(id)!==row.session||!row.s.enabled||row.s.shipRole!=="transport"||!row.s.transportEnabled||!row.s.transportClientReady||shipOf(row.session)!==row.shipID)registered.delete(id);
      }
      if(s.transportJob) { observe(session,s,s.transportJob);return; }
      if(s.transportFleetLease) {cleanup(session,s);if(s.transportFleetLease)return;}
      if(!s.enabled||s.shipRole!=="transport"||!s.transportEnabled||s.haul) { registered.delete(idOf(session));return; }
      const fleet=getFleet(idOf(session));
      if(!s.transportClientReady) { registered.delete(idOf(session));s.transportStatus="Transport needs a fleet and updated client companion.";return; }
      const entity=ship || {itemID:shipOf(session),typeID:session.shipTypeID};
      if(!eligibility(session,entity).eligible||isPrivate(session,scene,ship)) { registered.delete(idOf(session));s.transportStatus="Ship is not eligible for public fleet transport.";return; }
      if(!safeDeparture(session,s,scene,ship)) {registered.delete(idOf(session));s.transportStatus="Waiting for industrial equipment to stop before Transport.";return;}
      registered.set(idOf(session),{session,s,shipID:shipOf(session)});s.transportStatus=s.job==="hauling"?"Transport ready for global fleet pickups.":"Transport ready for fleet pickup.";
      const h=givenHold?.capacity>0?givenHold:hold(session,entity), rows=list(session,entity.itemID,h.flagID);
      if(s.job==="hauling") {
        if(dockOf(session)===s.transportStationID)s.transportStationReady=true;
        if(!s.transportStationReady) {start(session,s,entity,h,null,fleet);return;}
      }
      if(!stillMember(session,fleet)||!fleet&&s.job!=="hauling") {registered.delete(idOf(session));s.transportStatus="Transport needs a fleet and updated client companion.";return;}
      if(rows.length) {
        if(s.transportIdleSince==null)s.transportIdleSince=clock();
        if(h.used>=h.capacity*(Number(s.transportThreshold)||95)/100||clock()-s.transportIdleSince>=(Number(s.transportIdleSeconds)||60)*1000) {start(session,s,entity,h,null,fleet);return;}
      } else s.transportIdleSince=null;
      let otherFleetWaiting=false;
      for(const r of requests().sort((a,b)=>a.created-b.created||a.characterID-b.characterID)) {
        reclaimLease(r,r.fleet);
        if(!r.haulerID&&!minerValid(r,r.fleet)) {dropRequest(r);continue;}
        if(r.haulerID)continue;
        if(fleet&&r.fleet!==fleet) {otherFleetWaiting=true;continue;}
        if(!fleet&&s.job!=="hauling")continue;
        if(r.canID&&binClaims.has(r.canID))continue;
        start(session,s,entity,h,r,r.fleet);break;
      }
      if(!s.transportJob&&otherFleetWaiting)s.transportStatus="For requests in another fleet, leave the current fleet first.";
      if(s.job==="hauling"&&!s.transportJob&&!dockOf(session))start(session,s,entity,h,null,fleet);
    } catch(error) {fail(session,s,error);}
  }
  function authorize(session,op,kind,target) {
    op.nonce=crypto.randomUUID();op.version++;op.grant=kind;
    if(kind==="warp"||kind==="approach") grants.set(idOf(session),{kind,target,warpType:op.request?.binFirst?"item":"char",shipID:op.shipID,id:op.id,expires:clock()+2000});
  }
  function allowNavigation(session,kind,args) {
    const g=grants.get(idOf(session));if(!g)return false;
    const s=getState(session),op=s.transportJob;
    if(clock()>g.expires||!op||op.id!==g.id||shipOf(session)!==g.shipID) {grants.delete(idOf(session));return false;}
    try {validateOwner(session,s,op);}catch {grants.delete(idOf(session));return false;}
    const match=kind===g.kind&&(kind==="warp"?args.warpType===g.warpType&&Number(args.targetID)===g.target&&Number(args.minRange||0)===0&&args.fleet!==true:Number(args.targetID)===g.target&&Number(args.range)===100);
    if(match) {
      grants.delete(idOf(session));op.grant=null;
      if(kind==="warp")op.warpPermit={session,state:s,op,nonce:op.nonce,shipID:op.shipID,targetID:g.target,warpType:g.warpType,taken:false,used:false};
      return true;
    }return false;
  }
  function takeWarpArrival(session,args) {
    const s=getState(session),op=s.transportJob,p=op?.warpPermit;
    if(!p||p.taken||p.used||p.session!==session||p.state!==s||p.nonce!==op.nonce||p.warpType!==args.warpType||p.targetID!==Number(args.targetID))throw Error("Transport job changed.");
    validateOwner(session,s,op);p.taken=true;return p;
  }
  function planWarpArrival(session,p,scene,point,options) {
    const s=getState(session),op=s.transportJob;
    if(!p||p.used||!p.taken||p.session!==session||p.state!==s||p.op!==op||op?.warpPermit!==p||op.nonce!==p.nonce||op.phase!=="warpPickup"||shipOf(session)!==p.shipID)throw Error("Transport job changed.");
    validateOwner(session,s,op);
    const current=live(session),ms=getSession(op.request.characterID),m=ms&&live(ms);
    const target=op.request.binFirst?scene.getEntityByID?.(op.request.canID):m?.ship;
    if(current.scene!==scene||scene.systemID!==op.request.systemID||current.ship?.itemID!==p.shipID||!target||moving(current.ship)||moving(target)||
        Number(options?.targetEntityID)!==Number(target.itemID)||distance(point,target.position)>1||!deps().local(current.ship,target)||
        isPrivate(session,scene,current.ship)||!ms||!stillMember(ms,op.fleet))throw Error("Transport job changed.");
    if(op.request.binFirst&&(!canCurrent(op.request)||!deps().right(session,deps().can(op.request.canID))))throw Error("Assigned jetcan is unavailable or has no fleet loot rights.");
    const radius=Math.max(0,Number(current.ship.radius)||0),targetRadius=Math.max(0,Number(target.radius)||0);
    function landing(bearing) {
      let extent=radius+targetRadius+100;
      // Only the requesting miner is an additional obstacle. No field scan.
      if(op.request.binFirst&&m?.scene===scene&&m.ship?.itemID===op.request.shipID) {
        if(![m.ship.position?.x,m.ship.position?.y,m.ship.position?.z,Number(m.ship.radius||0)].every(Number.isFinite))throw Error("Transport job changed.");
        const delta={x:m.ship.position.x-point.x,y:m.ship.position.y-point.y,z:m.ship.position.z-point.z};
        const projection=delta.x*bearing.x+delta.y*bearing.y+delta.z*bearing.z;
        const separation=radius+Math.max(0,Number(m.ship.radius)||0)+100;
        const discriminant=separation*separation-(delta.x*delta.x+delta.y*delta.y+delta.z*delta.z-projection*projection);
        if(discriminant>0)extent=Math.max(extent,projection+Math.sqrt(discriminant));
      }
      if(op.request.binFirst&&extent-targetRadius>2500)return null;
      return {x:point.x+bearing.x*extent,y:point.y+bearing.y*extent,z:point.z+bearing.z*extent};
    }
    if(!op.arrivalBearing) {
      for(let attempt=0;attempt<16;attempt++) {
        const angle=random()*2*Math.PI,z=random()*2-1,radial=Math.sqrt(Math.max(0,1-z*z));
        const bearing={x:Math.cos(angle)*radial,y:Math.sin(angle)*radial,z};
        if(landing(bearing)){op.arrivalBearing=bearing;break;}
      }
    }
    const arrival=op.arrivalBearing&&landing(op.arrivalBearing);
    if(!arrival)throw Error("Transport job changed.");
    p.used=true;
    return {point:arrival,options:{...options,stopDistance:0,minimumRange:0}};
  }
  function action(session,s,id,action,payload={}) {
    const op=s.transportJob;
    if(!op||op.id!==id) throw Error("Transport job is no longer active.");
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||JSON.stringify(payload).length>2048) throw Error("Invalid transport action payload.");
    try {validateOwner(session,s,op);} catch(error) {fail(session,s,error);throw error;}
    if(action!=="poll" && action!=="cancel" && (typeof payload.nonce!=="string"||payload.nonce!==op.nonce)) throw Error("Transport action token expired.");
    op.heartbeat=clock();op.grant=null;
    if(action==="cancel") {
      const reason=typeof payload.reason==="string"?payload.reason.replace(/[\x00-\x1f\x7f]/g," ").trim().slice(0,200):"";
      cancel(session,s,reason?`Transport paused: ${reason}`:"Transport cancelled by client.");
      s.enabled=false;save(session,s);return view(session,s);
    }
    observe(session,s,op);if(!s.transportJob)return view(session,s);
    // A poll can retrieve a token after server-observed travel changes. Mutations
    // cannot silently execute in the new phase with an old token.
    if(action!=="poll"&&payload.nonce!==op.nonce)return view(session,s);
    let authorized=false;
    if(action==="authorizeWarp") {
      if(op.phase!=="warpPickup")throw Error("Not ready for pickup warp.");
      const {scene,ship}=live(session);
      const minerSession=getSession(op.request.characterID), miner=minerSession&&live(minerSession);
      const target=op.request.binFirst?scene?.getEntityByID?.(op.request.canID):miner?.ship;
      if(target && scene?.systemID===op.request.systemID && !moving(ship) && safeDeparture(session,s,scene,ship) &&
          distance(ship?.position,target.position)<150000) phase(session,op,"approachPickup");
      else if(scene?.systemID===op.request.systemID&&!moving(ship)&&safeDeparture(session,s,scene,ship)) {authorize(session,op,"warp",op.request.binFirst?op.request.canID:op.request.characterID);op.warpAuthorized=true;authorized=true;}
    } else if(action==="warped") {
      if(op.phase!=="warpPickup"||!op.warpAuthorized)throw Error("Unexpected pickup warp acknowledgment.");
      phase(session,op,"approachPickup");
    } else if(action==="authorizeApproach") {
      if(op.phase!=="approachPickup")throw Error("Not ready for pickup approach.");
      const {scene,ship}=live(session), ms=getSession(op.request.characterID), m=ms&&live(ms);
      const target=op.request.binFirst?scene?.getEntityByID?.(op.canID):m?.ship;
      if(scene&&target&&scene.systemID===op.request.systemID&&!moving(ship)&&!moving(target)&&deps().local(ship,target)) {
        op.approachNeeded=!proximity(session,op);
        authorize(session,op,"approach",op.request.binFirst?op.canID:op.request.shipID);authorized=true;
      }
    } else if(action==="arrived") {
      if(op.phase!=="approachPickup")throw Error("Not ready for pickup arrival.");
      const p=proximity(session,op);if(p) {
        if(op.request.binFirst) {phase(session,op,"loading");loadingPlan(session,s,op);return view(session,s);}
        const prior=Number(p.minerState.jettisonCan?.containerID||0);
        if(prior) {const c=deps().can(prior),e=p.scene.getEntityByID?.(prior);if(c&&e&&distance(e.position,p.miner.position)<=2500&&!deps().right(session,c)&&!p.minerState.jettisonAbandon) {
          dropRequest(op.request);const error=Error("Existing jetcan has no current fleet loot rights.");fail(session,s,error);throw error;
        }}
        // This is the only automatic jettison entrypoint: exact arrival is
        // proven against both current ships, native scene and fleet membership.
        oreHandling.jettison(p.minerSession,p.minerState,p.scene,p.miner,hold(p.minerSession,p.miner),clock());
        op.canID=Number(p.minerState.jettisonCan?.containerID||0);
        if(op.canID) {
          if(op.reservedCanID&&op.reservedCanID!==op.canID)releaseClaim(op);
          op.request.canID=op.canID;op.request.canIdentity=canIdentity(deps().can(op.canID));
          Object.assign(op.request,{haulerID:op.haulerID,ownerSession:session,ownerState:s,ownerJobID:op.id});
          reserveBin(op,op.canID);if(proximity(session,op,true)) {phase(session,op,"loading");loadingPlan(session,s,op);}
        }
      }
    } else if(action==="authorizeTransfer") {
      if(op.phase!=="loading")throw Error("Not ready to collect ore.");
      if(!op.receipt&&loadingPlan(session,s,op)) {
        const row=op.transfer;
        if(payload.itemID!=null&&Number(payload.itemID)!==row.itemID)throw Error("Pickup stack changed.");
        const canEntity=live(session).scene.getEntityByID(op.canID);
        op.receipt={...row,sourceBefore:qty(deps().list(session,op.canID,0).find(r=>Number(r.itemID)===row.itemID)||{}),targetBefore:total(list(session,op.shipID,op.flagID),row.typeID),canPosition:{...canEntity.position},canRadius:Number(canEntity.radius)||0};
        authorize(session,op,"transfer");authorized=true;
      }
    } else if(action==="loaded") {
      if(op.phase!=="loading"||!op.receipt||Number(payload.itemID)!==op.receipt.itemID)throw Error("No authorized ore transfer to confirm.");
      // Native Add despawns a temporary can after the last item is removed.
      // Keep the authorized can position for that final receipt, while still
      // rechecking the current ships, scene and both inventory deltas.
      const pair=proximity(session,op),canExists=deps().can(op.canID);
      if(!pair || (canExists?!proximity(session,op,true):Math.max(0,distance(pair.ship.position,op.receipt.canPosition)-op.receipt.canRadius)>2500))throw Error("Pickup moved outside native transfer range.");
      const r=op.receipt, source=qty(deps().list(session,op.canID,0).find(x=>Number(x.itemID)===r.itemID)||{}), target=total(list(session,op.shipID,op.flagID),r.typeID);
      if(r.sourceBefore-source<r.quantity || target-r.targetBefore<r.quantity)throw Error("Native ore transfer receipt could not be verified.");
      const eventID=op.id+":"+op.nonce,volume=r.quantity*Number(deps().type(r.typeID)?.volume);
      op.receipt=null;op.transfer=null;op.lastReceipt=clock();s.transportIdleSince=clock();op.nonce=crypto.randomUUID();op.version++;
      // Attribution observes actual native membership before any completion cleanup.
      const completed=!list(session,op.canID,0).length||hold(session,pair.ship).used>=hold(session,pair.ship).capacity*(Number(s.transportThreshold)||95)/100;
      statistics?.recordTransport?.(session,eventID,"pickup",volume,completed);loadingPlan(session,s,op);
    } else if(action==="authorizeUnload") {
      if(op.phase!=="unloading"||dockOf(session)!==op.station.stationID)throw Error("Not ready to unload collected ore.");
      destinations.storage(session,op.station.stationID,op.storageKey,op.storage);authorize(session,op,"unload");op.unloadAuthorized=true;authorized=true;
    } else if(action==="unloaded") {
      if(op.phase!=="unloading"||dockOf(session)!==op.station.stationID||!op.unloadAuthorized)throw Error("Unexpected unload acknowledgment.");
      const storage=destinations.storage(session,op.station.stationID,op.storageKey,op.storage), actual=destinations.totals(storage);
      if(storage.key!==op.storage.key||list(session,op.shipID,op.flagID).length)throw Error("Collected ore remains aboard.");
      for(const typeID of new Set(op.items.map(r=>r.typeID)))if((actual[typeID]||0)<(op.before[typeID]||0)+total(op.items,typeID))throw Error("Collected ore was not received in the selected storage.");
      statistics?.recordTransport?.(session,op.id,"delivery",op.items.reduce((n,r)=>n+qty(r)*Number(deps().type(r.typeID)?.volume),0),true);op.completedUnload=true;s.transportIdleSince=null;
      if(s.job==="hauling") {s.transportStationReady=true;finish(session,s,op);}else phase(session,op,"undocking");
    } else if(action!=="poll")throw Error("Unknown transport action.");
    if(!s.transportJob)return view(session,s);
    return {...view(session,s),authorized};
  }
  return {eligibility,tick,request,action,cancel,cleanup,view,allowNavigation,takeWarpArrival,planWarpArrival};
}
module.exports={createTransport};
