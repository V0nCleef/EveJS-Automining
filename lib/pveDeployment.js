"use strict";
const path = require("node:path"), { randomUUID } = require("node:crypto");
const { retreatReason } = require("./defense");
const idOf = s => Number(s?.characterID || s?.charid || 0);
const shipOf = s => Number(s?.shipID || s?.shipid || 0);
const dockOf = s => Number(s?.structureID || s?.structureid || s?.stationID || s?.stationid || 0);
const modeOf = s => s.pveMode || "belt";
const moving = ship => !ship || ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock || ship.dockingTargetID || ship.cloaked || ship.isCloaked;
const busy = s => !!(s.haul || s.transportJob || s.pveJob || s.travelReservation || s.fleetReservation?.retreated);
const LABELS = { joining: "Joining the defense fleet.", undocking: "PVE undocking.", routeFleet: "Travelling to the defense fleet.",
  warpFleet: "Warping to the defense fleet.", engaging: "Engaging hostile rats.", returning: "Returning to the standby station." };

function createPVEDeployment({ root, getSpace, getSession, getState, getFleet, getParticipants = () => [], getShip,
  destinations, save = () => "", clock = Date.now, native = null, onBegin = () => {}, onInterrupt = () => {}, canUndock = () => true }) {
  const incidents = new Map(), defenders = new Map(), active = new Map(), attackReceipts = new WeakSet();
  let runtime, lastSweep = -Infinity,attackAvailable=false;
  function deps() {
    if (native) return native;
    if (runtime) return runtime;
    const load = p => require(path.join(root, "server/src", p));
    const world = load("space/worldData.js"), fleets = load("services/fleets/fleetRuntime.js"),
      scope = load("space/destiny/identity/interactionScope.js"), types = load("services/inventory/itemTypeRegistry.js");
    return runtime = { fleets, scope: e => scope.resolveEntityInteractionScope(e), local: scope.canEntitiesInteractLocally,
      system: id => world.ensureLoaded().solarSystemsById.get(Number(id)),
      gates: id => world.ensureLoaded().stargatesBySystem.get(Number(id)) || [],
      type: id => types.resolveItemByTypeID(id) };
  }
  function live(session) { const scene = getSpace()?.getSceneForSession(session); return { scene, ship: scene?.getShipEntityForSession(session) }; }
  function fleet(id) { return getFleet ? getFleet(id) : deps().fleets.getFleetForCharacter(id); }
  function grid(scene, ship) { return scene?.getLivePublicGridClusterKeyForEntity?.(ship) || scene?.getPublicGridClusterKeyForEntity?.(ship); }
  function publicShip(session, scene, ship) {
    if (!scene || !ship || dockOf(session) || moving(ship) || session.spaceInstanceID || session._space?.instanceID || scene.instanceID) return false;
    const scope = deps().scope(ship); return !!grid(scene, ship) && scope?.valid === true && !scope.scoped &&
      !scope.hasAbyssalScope && !scope.hasAirScope && !scope.hasDungeonScope;
  }
  function systemOf(session, scene) {
    return Number(scene?.systemID || session.solarSystemID || session.solarsystemid2 || session.solarsystemid ||
      (dockOf(session) && destinations?.station(dockOf(session), session).systemID) || 0);
  }
  function sameSession(session) { return getSession(idOf(session)) === session && !session.socket?.destroyed; }
  function participant(session, s) { return sameSession(session) && s?.enabled && !s.fleetReservation?.retreated; }
  function anchor(session, name) {
    const v = live(session); return { characterID: idOf(session), shipID: shipOf(session), systemID: Number(v.scene?.systemID),
      grid: grid(v.scene, v.ship), name: String(name || session.characterName || session.charname || idOf(session)).slice(0, 100) };
  }
  function rows() {
    return getParticipants().slice(0, 256).filter(r => sameSession(r.session) && participant(r.session, r.s));
  }
  function fleetRows(session) {
    const groups = new Map(), current = fleet(idOf(session));
    for (const r of rows()) {
      const f = fleet(idOf(r.session)), v = live(r.session);
      if (!f?.members.has(idOf(r.session)) || !publicShip(r.session, v.scene, v.ship) || !["mining", "boosting"].includes(r.s.job)) continue;
      if (!groups.has(f)) groups.set(f, []); groups.get(f).push({ ...anchor(r.session, r.name), boosting: r.s.job === "boosting" });
    }
    return [...groups].slice(0, 64).map(([f, anchors]) => {
      anchors.sort((a, b) => Number(b.boosting) - Number(a.boosting) || a.characterID - b.characterID);
      const a = anchors[0], limit = Math.min(Number(f.maxSize) || 256, Number(f.advert?.advertJoinLimit) || 256, 256);
      return { fleetID: Number(f.fleetID), name: String(f.advert?.fleetName || "").slice(0, 160),anchorName:a.name, systemID: a.systemID,
        systemName: String(deps().system(a.systemID)?.solarSystemName || a.systemID), memberCount: f.members.size,
        joinable: (!current || current === f) && (current === f || f.members.size < limit) &&
          !deps().fleets.runtimeState.invitesByCharacter.has(idOf(session)), anchorID: a.characterID, anchors };
    });
  }
  function selected(session, s) {
    const row = fleetRows(session).find(f => f.fleetID === Number(s.pveFleetID));
    const a = row?.anchors.find(a => a.characterID === (Number(s.pveAnchorID) || row.anchorID));
    if (!row || !a) return null;
    const owner = getSession(a.characterID), f = owner && fleet(a.characterID);
    return owner && f ? { fleet: f, anchor: a, inviter: owner } : null;
  }
  function validateSettings(session, s) {
    if (modeOf(s) === "standby") {
      if (!destinations || !s.pveHomeStationID) throw Error("Choose a standby station before starting PVE.");
      destinations.station(s.pveHomeStationID, session);
    } else if (modeOf(s) === "escort") {
      const target = selected(session, s), current = fleet(idOf(session));
      if (!target) throw Error("Choose an active public fleet and anchor for escort.");
      if (current && current !== target.fleet) throw Error("Existing manual fleet is preserved.");
    }
  }
  function requestValid(r) {
    for (const [id, reporter] of r.reporters) {
      const s = sameSession(reporter.session) && getState(reporter.session), v = live(reporter.session);
      if (!s || !participant(reporter.session, s) || fleet(id) !== r.fleet || shipOf(reporter.session) !== reporter.shipID ||
          !publicShip(reporter.session, v.scene, v.ship) || Number(v.scene.systemID) !== r.systemID || grid(v.scene, v.ship) !== r.grid || s.haul){r.reporters.delete(id);if(s?.reinforcementIncidentID===r.id)s.reinforcementStatus="No reinforcement request.";}
    }
    if (!r.reporters.size){r.cancelled=true;return false;}
    const reporter = [...r.reporters.values()].sort((a, b) => idOf(a.session) - idOf(b.session))[0];
    r.anchor = anchor(reporter.session); r.inviter = reporter.session; return true;
  }
  function call(session, s, automatic = false) {
    sweep(clock());
    const v = live(session), f = fleet(idOf(session));
    if (!participant(session, s) || !f?.members.has(idOf(session)) || !publicShip(session, v.scene, v.ship) || s.haul || s.transportJob || s.pveTravel || s.travelReservation)
      throw Error("Reinforcements need an enabled fleet pilot in public space.");
    const key = `${Number(f.fleetID)}:${Number(v.scene.systemID)}:${String(grid(v.scene, v.ship))}`;
    let r = [...incidents.values()].find(r => r.key === key && r.fleet === f && !r.completed && !r.cancelled);
    if (!r) {
      if (incidents.size >= 128) throw Error("Reinforcement queue is full.");
      r = { id: randomUUID(), key, fleet: f, systemID: Number(v.scene.systemID), grid: grid(v.scene, v.ship), created: clock(), refreshed: clock(),
        limit: Math.max(1, Math.min(8, Number(s.reinforcementResponderLimit) || 1)), reporters: new Map(), claims: new Map() }; incidents.set(r.id, r);
    }
    r.refreshed = clock(); r.reporters.set(idOf(session), { session, shipID: shipOf(session) }); requestValid(r);
    s.reinforcementStatus = automatic ? "Automatic reinforcements requested." : "Reinforcements requested.";
    s.reinforcementIncidentID=r.id;
    return requestView(session, s);
  }
  function attack(scene, attacker, target, result) {
    if(!attackAvailable)return false;
    const receipt = result?.damageResult, data = receipt?.success === true && receipt.data;
    if (!receipt || typeof receipt !== "object" || attackReceipts.has(receipt) || !data) return false;
    const damage = ["shield", "armor", "structure"].reduce((sum, layer) => sum + Math.max(0, Number(data.beforeLayers?.[layer]) - Number(data.afterLayers?.[layer]) || 0), 0);
    const pirate = /^Asteroid (Angel Cartel|Blood Raiders|Guristas|Sansha.s Nation|Serpentis) /i.test(String(deps().type(attacker?.typeID)?.groupName || ""));
    if (!(damage > 0) || attacker?.nativeNpc !== true || attacker.kind !== "ship" || !(attacker.operatorKind === "asteroidBeltRat" || pirate)) return false;
    const session = getSession(Number(target?.pilotCharacterID || target?.characterID));
    const s = session && getState(session), v = session && live(session);
    if (!s?.enabled || v.scene !== scene || v.ship !== target || !publicShip(session, scene, target) ||
        !deps().local(attacker, target) || grid(scene, attacker) !== grid(scene, target)) return false;
    attackReceipts.add(receipt);
    for(const r of incidents.values())if(r.fleet===fleet(idOf(session))&&r.systemID===Number(scene.systemID)&&r.grid===grid(scene,target)&&
      (r.reporters.has(idOf(session))||r.claims.has(idOf(session)))){
      r.lastAttack=clock();for(const op of r.claims.values())op.clearSince=null;
    }
    if(!s.reinforcementAutoCall)return false;
    if (clock() < (s.nextReinforcementAttack || 0)) return false; s.nextReinforcementAttack = clock() + 5000;
    try { call(session, s, true); return true; } catch { return false; }
  }
  function pathFor(value, source, destination, maximum = 255) {
    if (!Array.isArray(value) || !value.length || value.length > 256 || value.some(x => !Number.isSafeInteger(x) || x <= 0) ||
        value[0] !== source || value.at(-1) !== destination || value.length - 1 > maximum || new Set(value).size !== value.length)
      throw Error("Selected route is outside the reinforcement range.");
    for (let i = 1; i < value.length; i++) if (!deps().gates(value[i - 1]).some(g => Number(g.destinationSolarSystemID) === value[i]))
      throw Error("Selected route is unavailable.");
    return [...value];
  }
  function recordPreview(session,s,offer,payload) {
    const target=offer.anchor?.systemID||offer.home?.systemID,source=systemOf(session,live(session).scene);
    // Validate every edge before exposing a jump count. A client number alone
    // is not an authoritative route preview.
    const systems=pathFor(payload.systems,source,target),home=offer.anchor&&offer.home?pathFor(payload.homeSystems,offer.home.systemID,target):systems;
    const jumps=Math.max(systems.length-1,home.length-1),limit=offer.maxJumps;
    s.pvePreviews ||= new Map();s.pvePreviews.set(offer.id,{jumps,maxJumps:limit,at:clock(),status:limit!==null&&jumps>limit?"Selected route is outside the reinforcement range.":"Reinforcements requested."});
    if(s.pvePreviews.size>32)s.pvePreviews.delete(s.pvePreviews.keys().next().value);
    if(limit!==null&&jumps>limit){s.pveRange={jumps,limit};s.pveStatus="Selected route is outside the reinforcement range.";return false;}
    s.pveRange=null;return true;
  }
  function available(session, s) {
    return sameSession(session) && s.enabled && s.job === "pve" && modeOf(s) === "standby" && s.pveClientReady && !busy(s) &&
      !s.pveFleetLease && !fleet(idOf(session)) && dockOf(session) === Number(s.pveHomeStationID) && !defenders.has(idOf(session)) && clock()-(s.pveReadyAt||0)<=45000&&canUndock(session,s,getShip?.(session,live(session).scene))===true;
  }
  function offers(session, s) {
    if (!s.enabled || s.job !== "pve" || modeOf(s) === "belt" || busy(s) || s.pveFleetLease || !s.pveClientReady) return [];
    if (modeOf(s) === "escort") {
      if(dockOf(session)&&canUndock(session,s,getShip?.(session,live(session).scene))!==true)return [];
      const target = selected(session, s);
      return target && (!fleet(idOf(session)) || fleet(idOf(session)) === target.fleet) ?
        [{ id: "escort", fleetID: target.fleet.fleetID, anchor: target.anchor, home: null, maxJumps: null }] : [];
    }
    if (fleet(idOf(session))) return [];
    const home = destinations.station(s.pveHomeStationID, session);
    if (dockOf(session) !== home.stationID) return [{ id: "home", fleetID: 0, anchor: null, home, maxJumps: null }];
    if (!available(session, s)) return [];
    return [...incidents.values()].sort((a, b) => a.created - b.created).filter(r => !r.completed && !r.cancelled && requestValid(r) && r.claims.size < r.limit)
      .slice(0, 8).map(r => ({ id: r.id, fleetID: r.fleet.fleetID, anchor: r.anchor, home, maxJumps: Number(s.pveMaxJumps) || 0 }));
  }
  function notify(session, op) { try { session.sendNotification("OnAutoMiningPVE", "clientID", [JSON.stringify(publicJob(op))]); } catch {} }
  function publicJob(op) {
    return op ? { id: op.id, nonce: op.nonce, version: op.version, shipID: op.shipID, deployment: true, phase: op.phase,
      anchor: op.anchor || null, home: op.home || null, route: op.route || null, fleetID: op.fleet?.fleetID || 0,
      incidentID: op.incident?.id || null, paused:!!op.paused, status: LABELS[op.phase] || "PVE standby is ready.", targetID: op.targetID || null,
      orbitRange: op.orbitRange || 0, grant: op.grant || null } : null;
  }
  function phase(session, s, op, value) {
    op.phase = value; op.changed = clock(); op.progressAt = clock(); op.nonce = randomUUID(); op.version++; op.grant = null; op.gatePermit=null;
    s.pveTravel = value === "engaging" ? null : op; s.pveStatus = LABELS[value]; notify(session, op);
  }
  function join(session, s, op, inviter, temporary) {
    const current = fleet(idOf(session));
    if (current && current !== op.fleet) throw Error("Existing manual fleet is preserved.");
    if (current === op.fleet) { fleetReady(session, op.fleet); return; }
    const fs = deps().fleets;
    if (!sameSession(inviter) || fleet(idOf(inviter)) !== op.fleet || fs.runtimeState.invitesByCharacter.has(idOf(session)))
      throw Error("Defense fleet join is unavailable.");
    const lease = { session, characterID: idOf(session), shipID: shipOf(session), fleet: op.fleet, fleetID: op.fleet.fleetID,
      temporary, member: null, invite: null, cleanupPending: false }; s.pveFleetLease = lease;
    op.joinDock = dockOf(session); phase(session, s, op, "joining");
    try { fs.inviteCharacter(inviter, op.fleet.fleetID, idOf(session), null, null, fs.FLEET?.FLEET_ROLE_MEMBER ?? 4, { autoAccept: true }); }
    finally { const invite = fs.runtimeState.invitesByCharacter.get(idOf(session)); if (invite?.fleetID === op.fleet.fleetID && invite.inviterCharID === idOf(inviter)) lease.invite = invite; }
    if (!lease.invite && fleet(idOf(session)) !== op.fleet) throw Error("Defense fleet join is unavailable.");
  }
  function fleetReady(session, target) {
    if (fleet(idOf(session)) !== target || !target.members.has(idOf(session))) throw Error("Defense fleet join is unavailable.");
    const lease = getState(session)?.pveFleetLease;
    const owned = lease?.session === session && lease.fleet === target && lease.member === target.members.get(idOf(session));
    // initFleet's existing-member branch does not reapply session fleet fields.
    // Reconnect attests this exact member and synchronises the native session.
    deps().fleets.reconnectCharacter?.(session, target.fleetID);
    deps().fleets.initFleet(session, target.fleetID);
    // Native reconnect/init replaces the member snapshot. Preserve only the
    // lease that owned the exact snapshot before those calls.
    if (owned) lease.member = target.members.get(idOf(session));
    session.sendNotification?.("OnAutoMiningFleetReady", "clientID", [target.fleetID]);
  }
  function cleanup(session, s) {
    const lease = s.pveFleetLease; if (!lease || s.pveJob) return false;
    const current = fleet(idOf(session));
    if (!sameSession(session) || lease.session !== session || lease.characterID !== idOf(session) || lease.shipID !== shipOf(session) || current && current !== lease.fleet) {
      s.pveFleetLease = null; return false;
    }
    const fs = deps().fleets;
    if (!current) {
      if (lease.invite && fs.runtimeState.invitesByCharacter.get(idOf(session)) === lease.invite) fs.rejectInvite(session, lease.fleetID);
      s.pveFleetLease = null; return true;
    }
    if (!lease.temporary) { s.pveFleetLease = null; return true; }
    if (!current.members.has(idOf(session)) || lease.member && current.members.get(idOf(session)) !== lease.member) { s.pveFleetLease = null; return false; }
    if (!dockOf(session)) { lease.cleanupPending = true; return false; }
    lease.member ||= current.members.get(idOf(session)); fs.leaveFleet(session, lease.fleetID);
    if (fleet(idOf(session)) === lease.fleet) { lease.cleanupPending = true; return false; }
    s.pveFleetLease = null; return true;
  }
  function release(op) {
    if (!op) return; if (defenders.get(op.characterID) === op) defenders.delete(op.characterID);
    if (op.incident?.claims.get(op.characterID) === op) op.incident.claims.delete(op.characterID); active.delete(op.id);
  }
  function cancel(session, s) { const op = s.pveJob?.deployment && s.pveJob; release(op); s.pveJob = null; s.pveTravel = null; cleanup(session, s); }
  function cancelRequests(session) {
    for (const r of incidents.values()) { r.reporters.delete(idOf(session)); if (!r.reporters.size) r.cancelled = true; }
    const s=getState(session);if(s?.reinforcementIncidentID)s.reinforcementStatus="No reinforcement request.";
  }
  function plan(session, s, payload) {
    if (!payload || typeof payload !== "object" || busy(s) || !sameSession(session) || !s.enabled || s.job !== "pve" || !s.pveClientReady)
      throw Error("PVE deployment is no longer available.");
    validateSettings(session, s);
    const offered = offers(session, s).find(o => o.id === payload.offerID); if (!offered || Number(payload.shipID)!==shipOf(session)) throw Error("PVE deployment is no longer available.");
    try{if(!recordPreview(session,s,offered,payload))return null;}catch(error){s.pveStatus="Selected route is unavailable.";s.pvePreviews||=new Map();s.pvePreviews.set(offered.id,{at:clock(),status:s.pveStatus});return null;}
    const v = live(session), ship = getShip?.(session, v.scene) || v.ship;
    if (!ship || ship.itemID !== shipOf(session) || retreatReason(s, ship)) throw Error("PVE deployment is no longer available.");
    const targetSystem = offered.anchor?.systemID || offered.home.systemID, source = systemOf(session, v.scene);
    const systems = pathFor(payload.systems, source, targetSystem, offered.maxJumps ?? 255);
    if (modeOf(s) === "standby" && offered.id !== "home") pathFor(payload.homeSystems, offered.home.systemID, targetSystem, Number(s.pveMaxJumps) || 0);
    const incident = incidents.get(offered.id), escort = offered.id === "escort" ? selected(session, s) : null;
    if (incident && (!available(session, s) || !requestValid(incident) || incident.cancelled || incident.claims.size >= incident.limit)) throw Error("PVE deployment is no longer available.");
    const op = { id: randomUUID(), nonce: randomUUID(), version: 1, deployment: true, characterID: idOf(session), session, state: s,
      shipID: ship.itemID, mode: modeOf(s), fleet: incident?.fleet || escort?.fleet || null, incident: incident || null,
      anchor: offered.anchor, preferredAnchor: offered.anchor, home: offered.home, route: { systems, destinationID: targetSystem, destinationSystemID: targetSystem },
      routeIndex: 0, phase: offered.id === "home" ? "returning" : dockOf(session) ? "undocking" : "routeFleet", started: clock(), changed: clock(),
      progressAt: clock(), heartbeat: clock(), targetID: null, orbitRange: 0 };
    // All claims precede notifications, native invites and movement.
    defenders.set(idOf(session), op); if (incident) incident.claims.set(idOf(session), op); active.set(op.id, op);
    s.pveInterrupted = true; s.pveJob = op; s.pveShipID = ship.itemID; s.pveOwned = new Map(); s.pveLocks = new Set(); s.pveTravel = op;
    try {
      if (save(session, s)) throw Error("Could not save PVE safety state."); onBegin(session, s);
      if (op.fleet) join(session, s, op, incident?.inviter || escort.inviter, !!incident);
      s.pveStatus = LABELS[op.phase]; notify(session, op); return publicJob(op);
    } catch (error) { cancel(session, s); s.enabled = false; save(session, s); throw error; }
  }
  function validate(session, s, op) {
    if (!op?.deployment || s.pveJob !== op || !sameSession(session) || op.session !== session || !s.enabled || s.job !== "pve" || modeOf(s) !== op.mode ||
        !s.pveClientReady || shipOf(session) !== op.shipID || s.haul || defenders.get(idOf(session)) !== op || clock() - op.heartbeat > 45000)
      throw Error("PVE deployment no longer belongs to this pilot.");
    const v = live(session);
    if (v.ship && retreatReason(s, v.ship)) throw Error("PVE deployment no longer belongs to this pilot.");
    if (op.fleet && op.phase !== "joining" && (fleet(idOf(session)) !== op.fleet || !op.fleet.members.has(idOf(session)))) throw Error("PVE deployment no longer belongs to this pilot.");
    if (op.fleet && op.phase !== "joining" && Number(session.fleetid || session.fleetID || 0) !== Number(op.fleet.fleetID)) fleetReady(session, op.fleet);
    if (op.phase === "joining" && op.joinDock !== dockOf(session)) throw Error("PVE deployment no longer belongs to this pilot.");
    if (v.ship && !dockOf(session)) { const scope = deps().scope(v.ship); if (!scope?.valid || scope.scoped) throw Error("Instanced or gated PVE is not supported."); }
    return v;
  }
  function anchorLive(op, target = op.anchor) {
    const session = target && getSession(target.characterID), s = session && getState(session), v = session && live(session);
    if (!session || !participant(session, s) || fleet(idOf(session)) !== op.fleet || !op.fleet?.members.has(idOf(session)) ||
        shipOf(session) !== target.shipID || Number(v.ship?.itemID) !== target.shipID || !publicShip(session, v.scene, v.ship)) return null;
    const a = anchor(session, target.name);
    if (op.incident && (a.systemID !== op.incident.systemID || a.grid !== op.incident.grid)) return null;
    return { session, ...v, anchor: a };
  }
  function escortAnchor(session, op, v) {
    const preferred = anchorLive(op, op.preferredAnchor || op.anchor);
    const local = a => a && a.session !== session && a.scene === v.scene && publicShip(session, v.scene, v.ship) &&
      grid(v.scene, v.ship) === a.anchor.grid && deps().local(v.ship, a.ship);
    if (local(preferred)) return preferred;
    // Keep a verified local fallback stable while the chosen pilot is away.
    const current = anchorLive(op);
    if (local(current)) return current;
    const candidates = rows().filter(r => r.session !== session && fleet(idOf(r.session)) === op.fleet)
      .sort((a,b) => Number(b.s.job === "boosting")-Number(a.s.job === "boosting") || idOf(a.session)-idOf(b.session));
    for (const r of candidates) {
      const candidate = anchorLive(op, anchor(r.session, r.name));
      if (local(candidate)) return candidate;
    }
    return preferred;
  }
  // Native identities remain server-side so an orbit grant can be rechecked
  // after a reconnect or entity replacement, even when an item ID is reused.
  function idleAnchor(session,s) {
    const op=s?.pveJob;
    if(!op?.deployment||op.mode!=="escort"||op.phase!=="engaging"||!op.arrived||op.paused||s.fleetReservation?.retreated)return null;
    try {
      const v=validate(session,s,op),a=anchorLive(op);
      if(!a||a.scene!==v.scene||a.ship===v.ship||Number(v.ship?.itemID)!==op.shipID||Number(a.ship?.itemID)!==op.anchor.shipID||
        !op.fleet?.members.has(idOf(session))||!op.fleet.members.has(idOf(a.session))||!publicShip(session,v.scene,v.ship)||
        a.anchor.systemID!==op.anchor.systemID||a.anchor.grid!==op.anchor.grid||grid(v.scene,v.ship)!==a.anchor.grid||
        !deps().local(v.ship,a.ship))return null;
      return {itemID:Number(a.ship.itemID),session:a.session,ship:a.ship};
    }catch{return null;}
  }
  function returnHome(session, s, op) {
    if (!op.home) throw Error("PVE standby destination is unavailable.");
    op.route = null; op.routeIndex = 0; op.targetID = null; op.orbitRange = 0; phase(session, s, op, "returning");
  }
  function observe(session, s, op) {
    const v = validate(session, s, op), dock = dockOf(session), currentSystem = systemOf(session, v.scene);
    if(op.mode==="standby"&&op.incident&&(!requestValid(op.incident)||op.incident.cancelled||op.incident.completed)&&op.phase!=="returning") {
      if(dock===op.home.stationID) {
        release(op);s.pveJob=null;s.pveTravel=null;s.pveInterrupted=false;cleanup(session,s);save(session,s);
        try{session.sendNotification("OnAutoMiningPVE","clientID",[JSON.stringify({cancel:op.id})]);}catch{}
        s.pveStatus="PVE standby is ready.";return false;
      }
      returnHome(session,s,op);
    }
    if (op.phase === "joining") {
      if (clock() - op.changed > 60000) throw Error("Defense fleet join timed out.");
      if (fleet(idOf(session)) !== op.fleet) {
        const lease = s.pveFleetLease;
        if (!lease?.invite || deps().fleets.runtimeState.invitesByCharacter.get(idOf(session)) !== lease.invite) throw Error("Defense fleet join is unavailable.");
        return false;
      }
      const lease = s.pveFleetLease; if (!lease || !op.fleet.members.has(idOf(session))) throw Error("Defense fleet join is unavailable.");
      lease.member = op.fleet.members.get(idOf(session)); lease.invite = null; fleetReady(session, op.fleet);
      phase(session, s, op, dock ? "undocking" : "routeFleet");
    }
    if (op.phase === "returning" && dock === op.home.stationID) {
      release(op); s.pveJob = null; s.pveTravel = null; s.pveInterrupted = false; cleanup(session, s); save(session, s);
      s.pveStatus = "PVE standby is ready."; return false;
    }
    if (dock && !["joining", "undocking", "returning"].includes(op.phase)) throw Error("PVE docked outside its assigned destination.");
    if (op.phase === "undocking" && !dock && !moving(v.ship)) {
      op.undockedAt ??= clock(); if (clock() - op.undockedAt >= 3000) phase(session, s, op, op.anchor ? "routeFleet" : "returning");
    }
    if (op.route && ["routeFleet", "returning"].includes(op.phase)) {
      const route = op.route.systems;
      if (currentSystem === route[op.routeIndex + 1]) { op.routeIndex++; op.progressAt = clock(); }
      else if (currentSystem !== route[op.routeIndex]) throw Error("PVE route changed manually.");
      if (op.phase === "routeFleet" && !dock && currentSystem === op.anchor.systemID && !moving(v.ship)) phase(session, s, op, "warpFleet");
    }
    if (!op.paused&&["undocking", "routeFleet", "warpFleet", "returning"].includes(op.phase) && clock() - op.progressAt > 300000) throw Error("PVE route made no progress.");
    if (op.phase === "returning") return false;
    const a = op.mode === "escort" ? escortAnchor(session, op, v) : anchorLive(op);
    if (!a) {
      if (op.mode === "standby") returnHome(session, s, op);
      else {
        if(!op.paused){op.paused=true;op.route=null;op.targetID=null;op.orbitRange=0;op.orbitKind=null;phase(session,s,op,"routeFleet");}
        s.pveStatus = "Waiting for the selected public fleet anchor."; op.clearSince = null;
      }
      return false;
    }
    if(op.paused){op.paused=false;op.anchor=a.anchor;op.route=null;phase(session,s,op,"routeFleet");return false;}
    if (op.mode === "escort" && (a.anchor.characterID !== op.anchor.characterID || a.anchor.systemID !== op.anchor.systemID || a.anchor.grid !== op.anchor.grid)) {
      op.anchor = a.anchor; op.route = null;
      if (!(v.scene === a.scene && grid(v.scene,v.ship) === a.anchor.grid && deps().local(v.ship,a.ship))) {
        phase(session, s, op, "routeFleet"); return false;
      }
    }
    if (!dock && v.scene === a.scene && publicShip(session, v.scene, v.ship) && grid(v.scene, v.ship) === grid(a.scene, a.ship) && deps().local(v.ship, a.ship)) {
      if (op.phase !== "engaging") { op.arrived = true; phase(session, s, op, "engaging"); }
      return true;
    }
    if (op.phase === "engaging") { if (op.mode === "standby") returnHome(session, s, op); else phase(session, s, op, "warpFleet"); }
    return false;
  }
  function combatClear(session, s, scene, ship, hasRats) {
    const op = s.pveJob; if (!op?.deployment || op.mode !== "standby" || op.phase !== "engaging" || !op.arrived) return false;
    const a = anchorLive(op); if (!a || a.scene !== scene || !publicShip(session, scene, ship) || grid(scene, ship) !== grid(a.scene, a.ship)) { op.clearSince = null; return false; }
    if (hasRats) { op.clearSince = null; return false; }
    op.clearSince=Math.max(op.clearSince??clock(),op.incident?.lastAttack??-Infinity);if(clock()-op.clearSince<60000)return false;
    if(op.incident){op.incident.completed=true;for(const r of op.incident.reporters.values()){const state=getState(r.session);if(state?.reinforcementIncidentID===op.incident.id)state.reinforcementStatus="Reinforcements completed.";}}
    returnHome(session, s, op); return true;
  }
  function sweep(now) {
    if (now - lastSweep >= 5000) {
      lastSweep = now;
      for (const r of incidents.values()) if (!r.claims.size && (!requestValid(r) || r.cancelled || r.completed || now - r.refreshed > 120000)) {
        incidents.delete(r.id);
        if(!r.completed)for(const reporter of r.reporters.values()){
          const state=getState(reporter.session);if(state?.reinforcementIncidentID===r.id)state.reinforcementStatus="No reinforcement request.";
        }
      }
      for (const op of active.values()) if (!sameSession(op.session) || shipOf(op.session) !== op.shipID || now - op.heartbeat > 45000) {
        release(op); if (op.state.pveJob === op) {
          onInterrupt(op.session,op.state,"PVE deployment interrupted; use Start / Resume to retry.");
          op.state.enabled=false;op.state.pveInterrupted=true;op.state.pveStatus="PVE deployment interrupted; use Start / Resume to retry.";
          save(op.session,op.state);
        }
      }
    }
  }
  function tick(session, s, scene, ship, now = clock()) {
    cleanup(session, s);
    sweep(now);
    if (!s.enabled || s.job !== "pve" || modeOf(s) === "belt") return false;
    if (s.pveJob?.deployment) return observe(session, s, s.pveJob);
    if(s.pveRange)return false;
    s.pveStatus = modeOf(s) === "escort" ? "Waiting for the selected public fleet anchor." :
      fleet(idOf(session)) ? "Existing manual fleet is preserved." : dockOf(session) === Number(s.pveHomeStationID) ? "PVE standby is ready." : "Returning to the standby station.";
    return false;
  }
  function requestView(session, s) {
    const current=incidents.get(s.reinforcementIncidentID);
    const r=current?.reporters.has(idOf(session))&&!current.cancelled?current:
      [...incidents.values()].find(r => r.reporters.has(idOf(session))&&!r.cancelled&&!r.completed);
    return { status: r?.completed?"Reinforcements completed.":!r&&s.reinforcementAutoCall&&!attackAvailable?"Automatic reinforcement calls are unavailable.":s.reinforcementStatus || "No reinforcement request.", incidentID: r?.id || null, responders: r?.claims.size || 0, needed: r?.limit || 0 };
  }
  function view(session, s) {
    let list = []; try { list = offers(session, s); } catch {}
    return { mode: modeOf(s), status: s.pveStatus || "PVE standby is ready.", offer: list[0] || null, offers: list,
      assignment: s.pveJob?.deployment ? { incidentID: s.pveJob.incident?.id || null, fleetID: s.pveJob.fleet?.fleetID || 0, phase: s.pveJob.phase,
        status:s.pveJob.phase==="engaging"?s.pveStatus||LABELS.engaging:LABELS[s.pveJob.phase],fleetName:String(s.pveJob.fleet?.advert?.fleetName||""),anchorName:s.pveJob.anchor?.name||"",anchorID:s.pveJob.anchor?.characterID||0 } : null,
      range:s.pveRange||null,automaticAvailable:attackAvailable,
      homeStationID: s.pveHomeStationID || 0, maxJumps: s.pveMaxJumps ?? 2,
      requestStatus:requestView(session,s),
      pool: { available: getParticipants().slice(0,256).filter(r => available(r.session, r.s)).length, requests: [...incidents.values()].filter(r=>!r.completed&&!r.cancelled).length },
      queue: [...incidents.values()].filter(r=>!r.completed&&!r.cancelled).slice(0, 32).map(r => ({ id: r.id, fleetID: r.fleet.fleetID,
        fleetName:String(r.fleet.advert?.fleetName||""),anchorName:r.anchor?.name||"",anchorID:r.anchor?.characterID||0,systemID: r.systemID,systemName:String(deps().system(r.systemID)?.solarSystemName||r.systemID),ageSeconds:Math.max(0,Math.floor((clock()-r.created)/1000)),
        requesterID: r.anchor?.characterID || 0, responders: r.claims.size, needed: r.limit, created: r.created,
        ...(clock()-(s.pvePreviews?.get(r.id)?.at||0)<45000?s.pvePreviews.get(r.id):{status:"Reinforcements requested."}) })) };
  }
  function action(session, s, op, action, payload) {
    validate(session, s, op); op.heartbeat = clock(); op.grant = null;
    observe(session, s, op); if (s.pveJob !== op) return { authorized: false };
    if(action!=="poll"&&payload.nonce!==op.nonce)return {authorized:false};
    let authorized = false;
    if (action === "authorizeRoute" && !op.paused&&["routeFleet", "returning"].includes(op.phase)) {
      const target = op.phase === "returning" ? op.home.systemID : op.anchor.systemID;
      const systems=pathFor(payload.systems, systemOf(session, live(session).scene), target);
      if(op.mode==="standby"&&op.phase==="routeFleet"&&JSON.stringify(systems)!==JSON.stringify(op.route?.systems.slice(op.routeIndex)))throw Error("Selected route is outside the reinforcement range.");
      op.route = { systems,
        destinationID: target, destinationSystemID: target }; op.routeIndex = 0; op.progressAt = clock(); authorized = true;
    } else if(action==="authorizeGate"&&op.route&&["routeFleet","returning"].includes(op.phase)&&!op.paused) {
      const v=live(session),next=op.route.systems[op.routeIndex+1],gate=v.scene?.getEntityByID(Number(payload.gateID));
      if(gate?.kind==="stargate"&&next&&Number(gate.destinationSolarSystemID)===next&&deps().gates(systemOf(session,v.scene)).some(g=>Number(g.itemID)===gate.itemID&&Number(g.destinationSolarSystemID)===next)) {
        op.gatePermit={gateID:gate.itemID,systemID:systemOf(session,v.scene),next,expires:clock()+10000};authorized=true;
      }
    } else if (action === "authorizeUndock" && ["undocking", "returning"].includes(op.phase) && dockOf(session)) authorized = op.phase==="returning"||canUndock(session,s,getShip?.(session,live(session).scene))===true;
    else if (action === "authorizeWarp" && op.phase === "warpFleet") {
      const a = anchorLive(op), v = live(session);
      if (a && v.scene?.systemID === a.anchor.systemID && !moving(v.ship)) authorized = true;
    } else if (action === "authorizeDock" && op.phase === "returning" && !dockOf(session) && live(session).scene?.systemID === op.home.systemID) {
      destinations.station(op.home.stationID, session); authorized = true;
    } else if(action==="authorizeWarp"&&op.phase==="returning"&&!dockOf(session)&&live(session).scene?.systemID===op.home.systemID&&!moving(live(session).ship)) {
      destinations.station(op.home.stationID,session);authorized=true;
    } else if (!["poll", "warped", "docked", "undocked","authorizeRoute","authorizeGate","authorizeUndock","authorizeWarp","authorizeDock"].includes(action)) throw Error("Unknown PVE deployment action.");
    if (authorized) { op.nonce = randomUUID(); op.version++; op.grant = action;op.grantExpires=clock()+2000; }
    return { authorized };
  }
  function allowNavigation(session, kind, args) {
    const s = getState(session), op = s?.pveJob;
    if (!op?.deployment) return false; try { validate(session, s, op); } catch { return false; }
    if(kind==="warp"&&op.gatePermit&&clock()<=op.gatePermit.expires&&["routeFleet","returning"].includes(op.phase)&&args.warpType==="item"&&Number(args.targetID)===op.gatePermit.gateID&&Number(args.minRange||0)>=0&&Number(args.minRange||0)<=15000&&args.fleet!==true)
      return autopilotNavigation(session,"Handle_CmdFollowBall",[op.gatePermit.gateID,0]);
    if(clock()>op.grantExpires||op.paused)return false;
    const match = kind === "warp" && op.grant === "authorizeWarp" && op.phase === "warpFleet" && args.warpType === "char" &&
      Number(args.targetID) === op.anchor.characterID && Number(args.minRange || 0) === 0 && args.fleet !== true;
    const dock = kind === "dock" && op.grant === "authorizeDock" && op.phase === "returning" && Number(args.targetID) === op.home.stationID;
    const homeWarp=kind==="warp"&&op.grant==="authorizeWarp"&&op.phase==="returning"&&args.warpType==="item"&&Number(args.targetID)===op.home.stationID&&Number(args.minRange||0)===0&&args.fleet!==true;
    if(match){const a=anchorLive(op),v=live(session);if(!a||a.anchor.systemID!==v.scene?.systemID||moving(v.ship))return false;}
    if(dock||homeWarp){try{destinations.station(op.home.stationID,session);}catch{return false;}if(live(session).scene?.systemID!==op.home.systemID)return false;}
    if (match || dock || homeWarp) { op.grant = null; return true; } return false;
  }
  function routeAction(session,s,op,action,payload,destination) {
    if(action==="authorizeRoute"){
      const systems=pathFor(payload.systems,systemOf(session,live(session).scene),destination);
      op.route={systems,destinationID:destination,destinationSystemID:destination};op.routeIndex=0;return true;
    }
    if(action!=="authorizeGate"||!op.route)return false;
    const v=live(session),sys=systemOf(session,v.scene),route=op.route.systems;
    if(sys===route[op.routeIndex+1])op.routeIndex++;
    if(sys!==route[op.routeIndex])return false;
    const next=route[op.routeIndex+1],gate=v.scene?.getEntityByID(Number(payload.gateID));
    if(gate?.kind!=="stargate"||!next||!deps().gates(sys).some(g=>Number(g.itemID)===gate.itemID&&Number(g.destinationSolarSystemID)===next))return false;
    op.gatePermit={gateID:gate.itemID,systemID:sys,next,expires:clock()+10000};return true;
  }
  function routeNavigation(session,op,method,args){
    if(!op.route||!op.gatePermit||clock()>op.gatePermit.expires||!["Handle_CmdFollowBall","Handle_CmdStargateJump"].includes(method))return false;
    const v=live(session),sys=systemOf(session,v.scene),next=op.route.systems[op.routeIndex+1],gate=v.scene?.getEntityByID(Number(args?.[0]));
    return !!next&&sys===op.gatePermit.systemID&&next===op.gatePermit.next&&gate?.kind==="stargate"&&gate.itemID===op.gatePermit.gateID&&
      Number(gate.destinationSolarSystemID)===next&&deps().gates(sys).some(g=>Number(g.itemID)===gate.itemID&&Number(g.destinationSolarSystemID)===next)&&
      (method!=="Handle_CmdFollowBall"||Number(args?.[1]||0)===0);
  }
  function autopilotNavigation(session, method, args) {
    const s = getState(session), op = s?.pveJob; if (!op?.deployment || !op.route || op.paused || !op.gatePermit || clock()>op.gatePermit.expires || !["routeFleet", "returning"].includes(op.phase)) return false;
    try { validate(session, s, op); } catch { return false; }
    if (!["Handle_CmdFollowBall", "Handle_CmdStargateJump"].includes(method)) return false;
    const v = live(session), next = op.route.systems[op.routeIndex + 1], gate = v.scene?.getEntityByID(Number(args?.[0]));
    return !!next && gate?.kind === "stargate" && gate.itemID===op.gatePermit.gateID && systemOf(session,v.scene)===op.gatePermit.systemID && next===op.gatePermit.next && Number(gate.destinationSolarSystemID) === next &&
      deps().gates(systemOf(session, v.scene)).some(g => Number(g.itemID) === gate.itemID && Number(g.destinationSolarSystemID) === next) &&
      (method !== "Handle_CmdFollowBall" || Number(args?.[1] || 0) === 0);
  }
  return { tick, view, publicJob, plan, action, validate, validateSettings, fleetRows, call, attack, requestView, cancel, cancelRequests,
    cleanup, combatClear, idleAnchor, allowNavigation, autopilotNavigation,routeAction,routeNavigation,setAttackAvailable:value=>{attackAvailable=value===true;} };
}
module.exports = { createPVEDeployment };
