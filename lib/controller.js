"use strict";
const { matchesOre } = require("./commands");
const { planDistinct, ORDERS, compareTargets } = require("./targets");
const { createOrePriority } = require("./orePriority");
const { stopApproach, updateApproach, updateSurvey } = require("./assistance");
const { DEFAULT_SURVEY_SECONDS, DEFAULT_HAUL_THRESHOLD, validSurveySeconds, validHaulThreshold, MAX_ORE_FILTERS } = require("./settings");
const { clientText } = require("./hud");
const { createHauling } = require("./hauling");
const { createDroneLaunch, validGroupKey } = require("./droneLaunch");
const { createBoosters } = require("./boosters");
const { createRatDefense } = require("./ratDefense");
const { createMiningDrones } = require("./miningDrones");
const { targetClaims } = require("./targetClaims");
const { DEFAULT_DEFENSE_THRESHOLD, validDefenseThreshold, retreatReason } = require("./defense");
const { featurePreferences, featureSnapshot, featureRequest } = require("./featureSettings");
const { createIndustrialAutomation, validateIntervalSeconds } = require("./industrialAutomation");
const { createOreHandling } = require("./oreHandling");
const { createTransport } = require("./transport");
const { createPVE } = require("./pve");
const { captureProfile, switchProfile,profileFields } = require("./jobProfiles");
const { createFleetOre } = require("./fleetOre");
const { createFleetGroups } = require("./fleetGroups");
const { createPVEDeployment } = require("./pveDeployment");
const { createPVEAmmo } = require("./pveAmmo");

function createController(getAPI, getSpace, logError = console.error, preferences = null, compress = null, destinations = null, crystals = null, root = null, extensions = {}) {
  const players = new WeakMap();
  let departureGuard = null;
  const claims = (scene, session, rocks, options) => targetClaims(scene, session, rocks, players, options);
  const drones = createDroneLaunch({ getAPI, getSpace, pendingDeparture: session => departureGuard?.pending(session) });
  const boosters = extensions.boosters || (root && createBoosters(root, { getAPI, state, logError }));
  const industrial = extensions.industrial || (root && createIndustrialAutomation(root, { getAPI, logError }));
  const oreHandling = extensions.oreHandling || (root && createOreHandling(root, { save, logError }));
  const statistics = extensions.statistics;
  const activity = extensions.activity;
  const industrialTime = (scene, now = Date.now()) => scene?.getCurrentSimTimeMs?.() ?? now;
  const dockedShips = new WeakMap();
  let activeShipRecord;
  function snapshotShip(session, scene) {
    const live = scene?.getShipEntityForSession(session);
    if (live) return live;
    if (!(session.stationID || session.stationid || session.structureID || session.structureid)) return null;
    const itemID = Number(session.shipID || session.shipid || 0), characterID = Number(session.characterID || session.charid || 0);
    if (!(itemID > 0 && characterID > 0)) return null;
    const cached = dockedShips.get(session);
    if (cached?.itemID === itemID && cached.pilotCharacterID === characterID) return cached;
    let item = null;
    if (root) {
      activeShipRecord ||= require(require("node:path").join(root, "server/src/space/runtime/characterStateBridge.js")).resolveActiveShipRecord;
      item = activeShipRecord(characterID);
      if (!item || Number(item.itemID) !== itemID) return null;
    }
    const ship = { ...item, kind: "ship", itemID, typeID: Number(item?.typeID || session.shipTypeID || session.shiptypeid || 0),
      pilotCharacterID: characterID, characterID, activeModuleEffects: new Map() };
    dockedShips.set(session, ship);
    return ship;
  }
  function canStopFleet(session) {
    try {
      const id = Number(session.characterID || session.charid), fleet = extensions.getFleet?.(id);
      return !!fleet && extensions.isFleetBoss?.(fleet, id) === true;
    } catch { return false; }
  }
  let fleetDroneRuntime;
  function stopFleet(session) {
    const id = Number(session.characterID || session.charid), fleet = extensions.getFleet?.(id);
    if (!fleet || extensions.isFleetBoss?.(fleet, id) !== true || !(fleet.members instanceof Map))
      throw Error("Only the current fleet boss can stop fleet AutoMining.");
    const stillBoss = () => extensions.getFleet(id) === fleet && extensions.isFleetBoss(fleet, id) === true;
    const currentMember = memberID => {
      const memberSession = extensions.getSession?.(memberID);
      return memberSession && !memberSession.socket?.destroyed &&
        Number(memberSession.characterID || memberSession.charid) === Number(memberID) &&
        extensions.getFleet(memberID) === fleet && fleet.members.has(memberID) ? memberSession : null;
    };
    let stopped = 0, recallOrdered = 0, recallFailed = 0;
    const members = [...fleet.members.keys()];
    // Stop every enabled pilot first. A drone refusal must not leave another
    // fleet member's mining automation running.
    for (const memberID of members) {
      if (!stillBoss()) break;
      const memberSession = currentMember(memberID);
      if (!memberSession) continue;
      const memberState = state(memberSession);
      if (!memberState.enabled) continue;
      try { command(memberSession, { action: "off" }); }
      catch (error) { logError(`[AutoMining] Fleet module shutdown failed: ${error.message}`); }
      if (!memberState.enabled) stopped++;
    }
    // Already-OFF pilots also get one native recall order for their own
    // deployed miners/fighters. No wait, movement order or assumed recovery.
    for (const memberID of members) {
      if (!stillBoss()) break;
      const memberSession = currentMember(memberID);
      if (!memberSession) continue;
      let ids = [];
      try {
        const space = getSpace(), scene = space?.getSceneForSession(memberSession), ship = scene?.getShipEntityForSession(memberSession);
        if (!ship || Number(memberSession.shipID || memberSession.shipid) !== Number(ship.itemID)) continue;
        fleetDroneRuntime ||= extensions.droneRuntime || (root && require(require("node:path").join(root, "server/src/services/drone/droneRuntime.js")));
        const runtime = fleetDroneRuntime;
        if (!runtime) continue;
        const entities = scene.droneEntityIDs instanceof Set
          ? [...scene.droneEntityIDs].map(droneID => scene.getEntityByID(droneID))
          : [...(scene.dynamicEntities?.values() || [])];
        ids = [...new Set(entities.filter(entity => runtime.isDroneEntity(entity) &&
          Number(entity.ownerID) === Number(memberID) && Number(entity.controllerID) === Number(ship.itemID))
          .map(entity => Number(entity.itemID)).filter(droneID => Number.isSafeInteger(droneID) && droneID > 0))];
        if (!ids.length) continue;
        if (!stillBoss() || currentMember(memberID) !== memberSession ||
            space.getSceneForSession(memberSession) !== scene || scene.getShipEntityForSession(memberSession) !== ship ||
            Number(memberSession.shipID || memberSession.shipid) !== Number(ship.itemID)) continue;
        const result = runtime.commandReturnBay(memberSession, ids);
        if (!result || result.type !== "dict" || !Array.isArray(result.entries)) { recallFailed += ids.length; continue; }
        const failed = new Set(result.entries.map(entry => Number(entry?.[0])));
        if ([...failed].some(droneID => !ids.includes(droneID))) { recallFailed += ids.length; continue; }
        recallFailed += failed.size;
        recallOrdered += ids.length - failed.size;
      } catch (error) {
        recallFailed += ids.length;
        logError(`[AutoMining] Fleet drone recall failed: ${error.message}`);
      }
    }
    return { stopped, recallOrdered, recallFailed };
  }
  function oreActivity(session, s) {
    for (const [field, key, proof] of [["jettisonEvent", "jettisonComplete", "quantity"], ["stackEvent", "stackComplete", "merged"]]) {
      const event = s[field], last = "activity" + field;
      if (event && typeof event.id === "string" && event[proof] > 0 && s[last] !== event.id) {
        activity?.emit(session, s, { key, id: event.id });
        s[last] = event.id;
      }
    }
  }
  const ratDefense = extensions.ratDefense || (root && createRatDefense(root, { drones, getAPI, logError }));
  const miningDrones = extensions.miningDrones || (root && createMiningDrones(root, {
    getAPI, pendingDeparture: session => departureGuard?.pending(session), logError,
    claimedTargets: (scene, session, rocks) => claims(scene, session, rocks, { ownLasers: true }),
  }));
  const hauling = destinations && createHauling({ destinations, getSpace, save, resetMining: resetMiningTargets,
    onBegin: (session, s, options) => fleetGroups?.reserve(session, s, { retreated: options.retreat === true }) });
  const transport = extensions.transport || (root && createTransport({ root, getAPI, getSpace,
    getFleet: extensions.getFleet, getSession: extensions.getSession, getState: state,
    destinations, oreHandling, industrial, boosters, save, statistics, logError,
    native: extensions.transportNative, onBegin: (session, s) => fleetGroups?.reserve(session, s) }));
  const fleetGroups = extensions.fleetGroups || (root && createFleetGroups({ root, getSpace,
    getSession: extensions.getSession, getState: state, save, native: extensions.fleetNative }));
  const pveAmmo = extensions.pveAmmo || (root && createPVEAmmo({root,destinations,native:extensions.pveAmmoNative}));
  const pveDeployment = extensions.pveDeployment || (root && createPVEDeployment({root,getSpace,
    getSession:extensions.getSession,getState:state,getFleet:extensions.getFleet,getParticipants:()=>fleetGroups?.participants?.()||[],
    getShip:snapshotShip,destinations,save,native:extensions.pveDeploymentNative,
    canUndock:(session,s,ship)=>!pveAmmo||pveAmmo.ready(session,s,ship||snapshotShip(session,getSpace()?.getSceneForSession(session))),
    onBegin:(session,s)=>fleetGroups?.reserve(session,s),
    onInterrupt:(session,s)=>pve?.stop(session,s,s.scene,s.scene?.getShipEntityForSession(session))}));
  const pve = extensions.pve || (root && createPVE({ root, getAPI, getSpace,
    getSession: extensions.getSession, getState: state, getFleet: extensions.getFleet, save, drones,
    native: extensions.pveNative, deployment:pveDeployment,logError,canUndock:(session,s,ship)=>!pveAmmo||pveAmmo.ready(session,s,ship||snapshotShip(session,getSpace()?.getSceneForSession(session))),
    onBegin: (session, s) => fleetGroups?.reserve(session, s) }));
  const fleetOre = extensions.fleetOre || (root && createFleetOre({ root, getSpace,
    getSession: extensions.getSession, getState: state, compress, native: extensions.fleetOreNative, logError }));
  function prepareTransport(session, s, scene, ship, now = Date.now()) {
    if (!ship || !transport) return false;
    if (scene?.getShipEntityForSession(session) !== ship) return true;
    if (retreatReason(s, ship)) return false;
    if (s.transportQuietShip !== ship.itemID) { stop(session, s); s.transportQuietShip = ship.itemID; }
    const ready = !industrial || industrial.requestDeparture(session, s, scene, ship, industrialTime(scene, now));
    const activeIndustrial = industrial?.snapshot(session, s, scene, ship, industrialTime(scene, now)).modules.some(module => module.active);
    const activeBoost = boosters?.miningModules(session, ship).some(module => ship.activeModuleEffects?.has(module.item.itemID));
    if (!ready || activeIndustrial || activeBoost) {
      if (!s.transportBlocked || s.transportJob) transport.cancel(session, s, "Waiting for industrial equipment to stop before Transport.");
      s.transportBlocked = true; s.status = "Waiting for industrial equipment to stop before Transport."; return false;
    }
    s.transportBlocked = false; return true;
  }
  function cleanupTransportFleet(session, s) {
    // A cancelled trip can keep its owned temporary membership until docking.
    // Ordinary jobs must not load native fleet code or initialize cleanup.
    if (!s.transportFleetLease || !transport?.cleanup) return;
    try { transport.cleanup(session, s); }
    catch (error) { logError(`[AutoMining] Transport fleet cleanup failed: ${error.message}`); }
  }
  function cleanupPVEFleet(session,s){if(!s.pveFleetLease)return;try{pveDeployment?.cleanup(session,s);}catch(error){logError(`[AutoMining] PVE fleet cleanup failed: ${error.message}`);}}
  function runPVE(session,s,scene,ship,now=Date.now()){
    if(!pve||!s.enabled||s.job!=="pve"||s.haul||departureGuard?.pending(session))return;
    pveAmmo?.tick(session,s,scene,ship);
    if(scene?.getShipEntityForSession(session)===ship&&industrial&&!industrial.requestDeparture(session,s,scene,ship,industrialTime(scene,now))){s.status="Waiting for industrial core cycle before departure.";return;}
    pve.tick(session,s,scene,ship,now);
    if((session.stationID||session.stationid||session.structureID||session.structureid)&&s.pveJob?.phase!=="returning"&&pveAmmo&&!pveAmmo.ready(session,s,ship))s.pveStatus=pveAmmo.view(session,s,ship).status;
  }
  function release(scene, session, ship, id) {
    if (ship.pendingTargetLocks?.has(id)) scene.cancelAddTarget(session, id, { notifySelf: true });
    else scene.removeTarget(session, id);
  }
  function state(session) {
    const characterID = Number(session.characterID || session.charid);
    if (players.get(session)?.characterID !== characterID) players.set(session, {
      characterID, status: "Ready.",
      enabled: false, ores: [], order: "nearest", shipID: 0, scene: null, next: 0,
      approach: false, lock: true, survey: false, nextSurvey: 0, approachTarget: null, focusTarget: null,
      approachStatus: "", surveyStatus: "",
      surveyClientReady: false,
      surveySeconds: DEFAULT_SURVEY_SECONDS, lastSurveyRequestAt: null,
      compress: false, nextCompression: 0, compressionStatus: "",
      haulEnabled: false, haulThreshold: DEFAULT_HAUL_THRESHOLD, stationID: 0, storageKey: "personal", haulInterrupted: false, haul: null, haulClientReady: false, miningAnchor: null,
      defenseEnabled: false, defenseShieldEnabled: true, defenseShieldThreshold: DEFAULT_DEFENSE_THRESHOLD,
      defenseArmorEnabled: false, defenseArmorThreshold: DEFAULT_DEFENSE_THRESHOLD, defenseStatus: "Defense is off.",
      recallDrones: true, departureStatus: "",
      launchDrones: false, droneGroupKey: "", droneStatus: "Waiting for arrival at a mining location, or Start / Resume here.",
      mineDrones: false, mineDroneOrder: "nearest", mineDroneMode: "spread", mineDroneStatus: "Automatic mining orders are off.",
      miningDroneIDs: new Set(), mineIncompatibleIDs: new Set(), mineAssignments: new Map(), nextMineScan: 0,
      autoBoost: false, inviteFleet: false, boostStatus: "Automatic mining boosts are off.", fleetStatus: "Fleet invites are off.", boostOwned: new Map(),
      ratDefenseEnabled: false, ratMiningGroupKey: "", ratFighterGroupKey: "", ratStatus: "Rat response is off.", ratManagedFighterIDs: new Set(),
      replan: true, moduleCache: [], nextModuleCheck: 0, nextSearch: 0,
      owned: new Map(), locks: new Set(), assignments: new Map(),
      jobProfiles: {},
      ...featurePreferences(),
      ...(preferences?.get(Number(session.characterID || session.charid)) || {}),
    });
    const s = players.get(session);
    if (s.defenseEnabled && s.defenseStatus === "Defense is off.") s.defenseStatus = "Defense armed.";
    if (s.haulInterrupted && !s.haul) {
      s.enabled = false;
      s.haulStatus = "Interrupted hauling trip. Check your ship and route, then click Start / Resume.";
    }
    if (s.transportInterrupted && !s.transportJob) {
      s.enabled = false;
      s.status = "Interrupted transport trip. Check your ship and route, then click Start / Resume.";
    }
    if (s.pveInterrupted && !s.pveJob) {
      s.enabled = false;
      s.status = "Interrupted PVE trip. Check your ship and route, then click Start / Resume.";
    }
    return s;
  }
  function save(session, s) {
    if (s.deferSave) return "";
    try { preferences?.save(Number(session.characterID || session.charid), s); return ""; }
    catch (error) { logError(`[AutoMining] Preference save failed: ${error.message}`); return " Applied for this session, but saving failed; check server log."; }
  }
  function stop(session, s) {
    const ship = s.scene?.getShipEntityForSession(session);
    pve?.stop(session, s, s.scene, ship);
    boosters?.stop(s, s.scene, session, ship);
    industrial?.stop(session, s, s.scene, ship, industrialTime(s.scene));
    ratDefense?.clear(s);
    if (ship && ship.itemID === s.shipID) {
      stopApproach(s.scene, session, ship, s);
      for (const [id, effect] of s.owned) {
        if (ship.activeModuleEffects?.get(id) === effect) s.scene.deactivateGenericModule(session, id);
      }
      // Preserve targets while a final mining cycle (or any other module) uses them.
      for (const id of s.locks) {
        if (![...(ship.activeModuleEffects?.values() || [])].some(x => x.targetID === id)) {
          release(s.scene, session, ship, id);
          s.locks.delete(id);
        }
      }
    }
    s.assignments.clear();
    s.mineAssignments.clear();
  }
  function resetMiningTargets(session, s, { ownedOnly = false } = {}) {
    const ship = s.scene?.getShipEntityForSession(session);
    if (s.enabled && ship?.itemID === s.shipID) {
      stopApproach(s.scene, session, ship, s);
      const targets = new Set([...s.locks, ...s.assignments.values()]), manualTargets = new Set();
      // Ask for native short-cycle yield first. Unlocking then ends even ice
      // and crystal cycles that defer manual deactivation until completion.
      for (const m of getAPI()?.modules(ship) || []) {
        const effect = ship.activeModuleEffects?.get(m.item.itemID);
        if (effect) {
          if (ownedOnly && s.owned.get(m.item.itemID) !== effect) { manualTargets.add(effect.targetID); continue; }
          targets.add(effect.targetID);
          s.scene.deactivateGenericModule(session, m.item.itemID);
        }
      }
      for (const id of targets) {
        if (manualTargets.has(id)) continue;
        if (ship.lockedTargets?.has(id) || ship.pendingTargetLocks?.has(id)) release(s.scene, session, ship, id);
      }
      s.owned.clear(); s.locks.clear();
    }
    s.assignments.clear();
    s.mineAssignments.clear();
    s.focusTarget = null;
    s.approachStatus = "";
    s.replan = true;
    s.next = 0;
    s.nextSearch = 0;
  }
  function otherPilotsTargets(scene, session, rocks) {
    return claims(scene, session, rocks, { ownDrones: true });
  }
  function command(session, cmd) {
    if (!session || !(Number(session.characterID || session.charid) > 0)) return "AutoMining needs a character session.";
    const s = state(session);
    if (cmd.action === "help" && s.hudReady) {
      session.sendNotification("OnAutoMiningOpen", "clientID", []);
      return "AutoMining settings opened.";
    }
    if (cmd.action === "error") return cmd.message;
    if (cmd.action === "surveyInterval") {
      if (!validSurveySeconds(cmd.seconds)) return "AutoMining: invalid survey interval.";
      s.surveySeconds = cmd.seconds;
      s.nextSurvey = s.lastSurveyRequestAt === null ? 0 : s.lastSurveyRequestAt + cmd.seconds * 1000;
      s.next = 0;
      s.surveyStatus = "";
      return `AutoMining survey interval: ${cmd.seconds} seconds. Survey ${s.survey ? "ON" : "OFF"}; main automation ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    if (cmd.action === "help" || cmd.action === "status") return `AutoMining ${s.enabled ? "ON" : "OFF"}, ${s.order}, filter: ${s.ores.join(", ") || "all compatible resources"}. Approach ${s.approach ? "ON" : "OFF"}, lock ${s.lock ? "ON" : "OFF"}, survey ${s.survey ? "ON" : "OFF"} (${s.surveySeconds}s), compress ${s.compress ? "ON" : "OFF"}. ${s.enabled ? [s.status, s.approachStatus, s.surveyStatus, s.compressionStatus].filter(Boolean).join(" ") : ""} Commands: on | off | ore,ore | clear | nearest | furthest | largest | smallest | approach on/off | lock on/off | survey on/off | survey seconds | compress on/off (prefix / or !).`;
    if (cmd.action === "toggle") {
      s[cmd.setting] = cmd.enabled;
      s.next = 0;
      if (cmd.setting === "compress") { s.nextCompression = 0; s.compressionStatus = ""; }
      if (cmd.setting === "approach" || cmd.setting === "lock") { s.replan = true; s.focusTarget = null; }
      if (cmd.setting === "survey") {
        s.nextSurvey = 0;
        s.surveyStatus = "";
      }
      const ship = s.scene?.getShipEntityForSession(session);
      if (ship && ship.itemID === s.shipID && cmd.setting === "approach" && !cmd.enabled) stopApproach(s.scene, session, ship, s);
      if (ship && ship.itemID === s.shipID && cmd.setting === "lock" && !cmd.enabled) {
        for (const id of s.locks) if (ship.pendingTargetLocks?.has(id)) {
          s.scene.cancelAddTarget(session, id, { notifySelf: true }); s.locks.delete(id);
        }
      }
      return `AutoMining ${cmd.setting.toUpperCase()} ${cmd.enabled ? "ON" : "OFF"}. Main automation ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    if (ORDERS.includes(cmd.action)) {
      const changed = s.order !== cmd.action;
      s.order = cmd.action;
      if (changed) {
        resetMiningTargets(session, s);
        if (s.enabled) s.status = "Priority changed; choosing new targets.";
      }
      return `AutoMining priority: ${s.order}. Search area: ${s.approach ? "whole current belt; travel may be required" : "within effective mining range"}. ${changed && s.enabled ? "Choosing new targets now. " : ""}${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    if (cmd.action === "off") {
      drones.invalidate(s); s.droneArrival = false;
      departureGuard?.cancel(session, "Departure cancelled by Stop.");
      if (s.haul) hauling.cancel(session, s);
      transport?.cancel(session, s, "AutoMining stopped.");
      s.enabled = false;
      const saved = save(session, s);
      stop(session, s);
      cleanupTransportFleet(session, s);
      cleanupPVEFleet(session,s);
      fleetGroups?.release(session, s);
      return "AutoMining OFF. Mining modules it started are stopping under normal cycle rules." + saved;
    }
    if (cmd.action === "clear" || cmd.action === "filter") {
      const next = cmd.action === "clear" ? [] : [...cmd.ores];
      if (next.length > MAX_ORE_FILTERS) return `AutoMining: maximum ${MAX_ORE_FILTERS} ore filters.`;
      const changed = JSON.stringify(s.ores) !== JSON.stringify(next);
      if (changed) { s.replan = true; s.focusTarget = null; s.mineReplan = true; s.nextMineScan = 0; }
      s.ores = next;
      s.next = 0;
      if (s.enabled && changed && s.job === "mining") {
        const ship = s.scene?.getShipEntityForSession(session);
        const api = getAPI();
        if (api && ship?.itemID === s.shipID) {
          const excluded = new Set(api.candidates(s.scene, ship).filter(r => !matchesOre(r.name, s.ores)).map(r => r.id));
          if (excluded.has(s.approachTarget?.id)) stopApproach(s.scene, session, ship, s);
          // Request native partial yield where supported, then unlock. Native
          // target loss immediately ends even cycles which defer manual stops.
          for (const m of api.modules(ship)) {
            const effect = ship.activeModuleEffects?.get(m.item.itemID);
            if (effect && excluded.has(effect.targetID)) s.scene.deactivateGenericModule(session, m.item.itemID);
          }
          for (const id of excluded) {
            if (ship.lockedTargets?.has(id) || ship.pendingTargetLocks?.has(id)) release(s.scene, session, ship, id);
            s.locks.delete(id);
          }
          for (const [id, target] of s.assignments) if (excluded.has(target)) s.assignments.delete(id);
        }
      }
      return `AutoMining filter: ${s.ores.join(", ") || "all compatible resources"}. ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    const api = getAPI();
    if (!api) return "AutoMining unavailable: unsupported mining runtime; check the server log.";
    if (departureGuard?.pending(session)) return "Drones are returning before departure. Use Stop to cancel.";
    if (s.haul) return "AutoMining is already hauling. Use Stop to cancel the trip.";
    const scene = getSpace().getSceneForSession(session);
    const ship = scene?.getShipEntityForSession(session);
    if (s.job === "hauling") {
      if (!s.transportStationID || !destinations || !transport || !transport.eligibility(session, snapshotShip(session, scene)).eligible)
        throw Error("Choose a hauling ship and drop-off destination before starting.");
      destinations.station(s.transportStationID, session);
      destinations.storage(session, s.transportStationID, s.transportStorageKey);
    }
    if (s.job === "pve") {
      if(!s.pveMode||s.pveMode==="belt"){
        if (!s.pveBeltID) throw Error("Choose an asteroid belt before starting PVE.");
        if (!pve?.searchBelts(session, String(s.pveBeltID)).some(belt => Number(belt.beltID) === s.pveBeltID))throw Error("Selected asteroid belt is unavailable.");
      }else pveDeployment?.validateSettings(session,s);
    }
    s.departureStatus = "";
    drones.arm(s);
    s.haulInterrupted = false; s.haulStatus = "";
    s.transportInterrupted = false;
    s.pveInterrupted = false;
    if (!s.haul && !s.transportJob && !s.pveTravel) fleetGroups?.release(session, s);
    if (s.job === "hauling" || s.job === "pve") {
      if (s.shipID && (s.shipID !== ship?.itemID || s.scene !== scene)) stop(session, s);
      s.enabled = true; s.scene = scene; s.shipID = ship?.itemID || Number(session.shipID || session.shipid);
      if (s.job === "hauling") s.transportEnabled = true;
      s.next = 0; s.nextTransportCheck = 0;
      s.status = "Job started.";
      return "AutoMining job started." + save(session, s);
    }
    if (!ship || ship.kind !== "ship") {
      s.enabled = true; s.next = 0;
      s.status = s.autoBoost ? "Waiting to undock in the boosting ship." : "Waiting to undock in a ship with online mining modules.";
      return `AutoMining ON. It will resume when you undock ${s.autoBoost ? "in the boosting ship" : "with online mining modules"}.` + save(session, s);
    }
    const modules = s.job === "mining" ? api.modules(ship) : [];
    if (s.shipID && (s.shipID !== ship.itemID || s.scene !== scene)) stop(session, s);
    const alreadyEnabled = s.enabled && s.shipID === ship.itemID && s.scene === scene;
    if (!alreadyEnabled) s.replan = true;
    s.enabled = true;
    s.scene = scene;
    s.shipID = ship.itemID;
    industrial?.resume(s, ship);
    s.next = 0;
    s.status = modules.length ? "Looking for targets." : s.autoBoost ? "Starting mining boosts." : "Waiting for online mining modules.";
    if (!alreadyEnabled) s.nextSurvey = 0;
    if (!alreadyEnabled) {
      for (const m of modules) {
        const effect = ship.activeModuleEffects?.get(m.item.itemID);
        if (effect) {
          s.owned.set(m.item.itemID, effect);
          scene.deactivateGenericModule(session, m.item.itemID);
        }
      }
    }
    return `AutoMining ON (${s.order}). Filter: ${s.ores.join(", ") || "all compatible resources"}. Separate targets first; sharing when needed.` + save(session, s);
  }

  function tickPlayer(scene, session, now) {
    if (!(Number(session?.characterID || session?.charid) > 0)) return;
    const s = state(session);
    const currentShip = scene.getShipEntityForSession(session);
    cleanupTransportFleet(session, s);
    cleanupPVEFleet(session,s);
    fleetGroups?.tick(session, s, scene, currentShip, now);
    drones.inspect(session, s, scene, currentShip);
    // Health must still be checked while a coordinated trip owns navigation.
    // Otherwise a refuelling/unloading trip would mask Defense until return.
    const tripDanger = s.enabled && (s.haul || s.transportJob || s.job === "pve" || s.shipRole === "transport" && departureGuard?.pending(session)) &&
      currentShip && retreatReason(s, currentShip);
    if (tripDanger && !s.haul?.retreat) {
      s.defenseStatus = tripDanger;
      fleetGroups?.reserve(session, s, { retreated: true });
      pve?.stop(session, s, scene, currentShip);
      const layer = tripDanger === "Defense retreat: low armor." ? "armor" : "shield";
      industrial?.requestDeparture(session, s, scene, currentShip, industrialTime(scene, now));
      departureGuard?.cancel(session, "Departure replaced by Defense retreat.", false);
      const hold = getAPI()?.oreHold?.(scene, currentShip, () => true, now, 100, true) || null;
      transport?.cancel(session, s, tripDanger);
      if (s.haul) hauling.escalateDefense(session, s, scene, currentShip, hold, { layer });
      else hauling?.begin(session, s, scene, currentShip, hold, { retreat: true, layer });
      boosters?.pause(s, scene, session, currentShip);
      ratDefense?.clear(s);
      return;
    }
    if (departureGuard?.pending(session)) return;
    if (!s.enabled) return;
    // Fleet formation is independent of the ship's job and fitted boosters.
    if (s.haul) {
      const handled = hauling.observe(session, s);
      if (!s.haul && s.enabled) drones.arm(s);
      if (handled) return;
    }
    if (s.shipRole === "transport") {
      const ship = currentShip || snapshotShip(session, scene);
      if (!ship || !transport) { s.status = "Transport paused: select an eligible ship."; return; }
      if (currentShip) { s.scene = scene; s.shipID = ship.itemID; }
      const danger = currentShip && retreatReason(s, ship);
      if (danger) {
        fleetGroups?.reserve(session, s, { retreated: true });
        transport.cancel(session, s, danger);
        s.defenseStatus = danger;
        const layer = danger === "Defense retreat: low armor." ? "armor" : "shield";
        if (industrial && !industrial.requestDeparture(session, s, scene, ship, industrialTime(scene, now))) {
          s.status = "Waiting for industrial core cycle before departure."; return;
        }
        const hold = getAPI()?.oreHold?.(scene, ship, () => true, now, 100, true) || null;
        hauling?.begin(session, s, scene, ship, hold, { retreat: true, layer });
        return;
      }
      if (now < (s.nextTransportCheck || 0)) return;
      s.nextTransportCheck = now + 1000;
      if (!prepareTransport(session, s, scene, ship, now)) return;
      const hold = currentShip ? getAPI()?.oreHold?.(scene, ship, () => true, now, s.transportThreshold, true) : null;
      s.holdStatus = hold || null;
      if (currentShip) { oreHandling?.tick(session, s, scene, ship, hold, now); oreActivity(session, s); }
      ratDefense?.tick(session, s, scene, ship, now);
      transport.tick(session, s, currentShip ? scene : null, ship, hold);
      return;
    }
    if (s.job === "pve") {
      const ship=currentShip||snapshotShip(session,scene);
      if(!ship){s.status="PVE waiting to leave station.";return;}
      s.scene=scene;s.shipID=ship.itemID;
      runPVE(session,s,scene,ship,now);
      return;
    }
    const api = getAPI();
    const ship = scene.getShipEntityForSession(session);
    const warping = ship && (ship.mode === "WARP" || ship.pendingWarp);
    // A warp order takes priority over the normal one-second work interval.
    if ((!warping || s.pausedForWarp) && now < s.next) return;
    s.next = now + 1000;
    if (!api || !ship || ship.kind !== "ship") {
      s.mineAssignments.clear();
      s.status = "Paused; waiting for a mining ship in space.";
      return;
    }
    if (ship.itemID !== s.shipID || scene !== s.scene) {
      boosters?.stop(s, s.scene, session, s.scene?.getShipEntityForSession(session));
      ratDefense?.clear(s);
      miningDrones?.reset(s);
      s.owned.clear(); s.locks.clear(); s.assignments.clear();
      s.approachTarget = null; s.focusTarget = null; s.scene = scene; s.shipID = ship.itemID;
      s.nextSurvey = 0; s.nextCompression = 0;
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0;
      s.replan = true; s.moduleCache = []; s.nextModuleCheck = 0;
      industrial?.resume(s, ship);
    }
    if (warping) {
      boosters?.pause(s, scene, session, ship);
      // Drop our movement ownership before cleanup: never issue Stop and
      // accidentally cancel the pilot's new warp while still aligning.
      if (!s.pausedForWarp) {
        s.warpActivitySerial = (s.warpActivitySerial || 0) + 1;
        s.approachTarget = null;
        resetMiningTargets(session, s);
      }
      s.pausedForWarp = true;
      s.resumeGrid = null; s.nextResumeCheck = 0;
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0; s.nextSurvey = 0;
      s.surveyStatus = ""; s.compressionStatus = "";
      s.status = "Paused for warp; resumes at a mining location.";
      return;
    }
    if (ship.pendingDock || ship.dockingTargetID || ship.isCloaked || ship.cloaked) {
      boosters?.pause(s, scene, session, ship);
      stop(session, s);
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0; s.nextSurvey = 0;
      s.surveyStatus = "";
      s.status = "Paused during travel or cloak.";
      return;
    }
    const danger = retreatReason(s, ship);
    if (danger) {
      fleetGroups?.reserve(session, s, { retreated: true });
      s.defenseStatus = danger;
      const layer = danger === "Defense retreat: low armor." ? "armor" : "shield";
      if (industrial && !industrial.requestDeparture(session, s, scene, ship, industrialTime(scene, now))) {
        resetMiningTargets(session, s);
        s.status = "Waiting for industrial core cycle before departure.";
        s.industrialSnapshot = industrial.snapshot(session, s, scene, ship, industrialTime(scene, now));
        return;
      }
      const hold = api.oreHold?.(scene, ship, () => true, now, 100, true) || null;
      if (hauling?.begin(session, s, scene, ship, hold, { retreat: true, layer })) {
        boosters?.pause(s, scene, session, ship);
        ratDefense?.clear(s);
        return;
      }
    }
    // Boosters and rat response do not need an unmined asteroid. A booster
    // should keep helping its fleet when the last rock depletes.
    if (s.job === "boosting") boosters?.tick(session, s, scene, ship, now);
    if (s.job === "boosting" && industrial && (s.coreEnabled || s.compressorEnabled || s.fuelEnabled)) {
      industrial.tick(session, s, scene, ship, industrialTime(scene, now));
      s.industrialSnapshot = industrial.snapshot(session, s, scene, ship, industrialTime(scene, now));
    }
    const defending = ratDefense?.tick(session, s, scene, ship, now) || false;
    if (s.pausedForWarp) {
      const grid = api.surveyGrid(scene, ship);
      if (grid !== s.resumeGrid) { s.resumeGrid = grid; s.nextResumeCheck = 0; }
      s.status = s.autoBoost ? s.boostStatus : "Waiting to resume: no ore, ice or gas in this local grid.";
      if (now < s.nextResumeCheck) return;
      s.nextResumeCheck = now + 5000;
      const resource = grid && api.surveyResource(scene, ship, null);
      const boostingSite = s.job === "boosting" && grid && api.miningSite?.(scene, ship) === true;
      if (!resource && !boostingSite) return;
      s.pausedForWarp = false;
      industrial?.resume(s, ship);
      activity?.emit(session, s, { key: "resumed", id: `${ship.itemID}:warp:${s.warpActivitySerial || 0}` });
      // Reuse the arrival check for survey; no second field search is needed.
      s.surveyGrid = grid; s.surveyResourceID = resource; s.nextSurveyCheck = now + 5000;
      s.replan = true; s.nextSearch = 0;
    }
    if ((s.oreMode !== "leave" || s.stackOreHold || s.fuelEnabled || s.job === "mining" && fleetOre) && now >= (s.nextHaulCheck || 0)) {
      s.holdStatus = api.oreHold?.(scene, ship, name => matchesOre(name, s.ores), now, s.haulThreshold,
        s.mineDrones || s.coreEnabled || !!(s.autoBoost && boosters?.miningModules(session, ship).length)) || null;
      s.nextHaulCheck = now + 5000;
    }
    let haulHold = s.holdStatus;
    const ownCompression = s.compress && !(s.job === "mining" && s.oreMode === "fleetHangar");
    if (ownCompression && compress && (now >= s.nextCompression || haulHold?.full)) {
      s.nextCompression = now + 10_000;
      try { s.compressionStatus = compress(scene, session, ship); }
      catch (error) { s.compressionStatus = "Compression unavailable; mining continues."; logError(`[AutoMining] Compression failed: ${error.message}`); }
    }
    if (haulHold?.full && ownCompression) haulHold = api.oreHold(scene, ship, name => matchesOre(name, s.ores), now, s.haulThreshold,
      s.mineDrones || s.coreEnabled || !!(s.autoBoost && boosters?.miningModules(session, ship).length));
    s.holdStatus = haulHold || null;
    if (s.job === "boosting" && s.fuelEnabled && s.industrialSnapshot?.fuel?.needsRestock) {
      resetMiningTargets(session, s);
      if (!industrial.requestDeparture(session, s, scene, ship, industrialTime(scene, now))) {
        s.status = "Waiting for industrial core cycle before departure.";
        return;
      }
      if (hauling?.begin(session, s, scene, ship, haulHold, { purpose: "fuel", fuel: s.industrialSnapshot.fuel })) {
        boosters?.pause(s, scene, session, ship);
        return;
      }
    }
    fleetOre?.tick(session, s, scene, ship, haulHold, now);
    const compressionWaiting = s.job === "mining" && s.oreMode === "fleetHangar" && haulHold?.full && fleetOre?.waitingForCompression(session, s, scene, ship);
    if (compressionWaiting) {
      if (!s.fleetCompressionPaused) {
        resetMiningTargets(session, s, { ownedOnly: true });
        miningDrones?.pause(session, s, scene, ship);
      }
      s.fleetCompressionPaused = true;
      s.status = "Waiting for fleet compression.";
      s.mineDroneStatus = s.status;
      return;
    }
    if (s.fleetCompressionPaused) {
      s.fleetCompressionPaused = false; s.mineReplan = true; s.nextMineScan = 0; s.replan = true;
    }
    oreHandling?.tick(session, s, scene, ship, haulHold, now);
    oreActivity(session, s);
    if (s.job === "mining" && transport && s.oreMode === "pickup" && haulHold?.full && now >= (s.nextTransportRequest || 0)) {
      s.nextTransportRequest = now + 5000;
      try { transport.request(session, s); }
      catch (error) { s.transportStatus = `Fleet pickup paused: ${error.message}`; }
    }
    transport?.tick(session, s, scene, ship, haulHold);
    if (s.job === "mining" && s.oreMode !== "fleetHangar" && s.haulEnabled) {
      s.holdStatus = haulHold || null;
      if (haulHold?.full && industrial && !industrial.requestDeparture(session, s, scene, ship, industrialTime(scene, now))) {
        resetMiningTargets(session, s);
        s.status = "Waiting for industrial core cycle before departure.";
        return;
      }
      if (hauling?.begin(session, s, scene, ship, haulHold)) {
        boosters?.pause(s, scene, session, ship);
        return;
      }
    }
    if (!defending) drones.arrival(session, s, scene, ship, now);
    // Boosting can use the selected mining drones alongside its industrial
    // work. Keep the laser/survey planner below its job boundary.
    if (miningDrones && (s.job === "mining" || s.job === "boosting" && s.mineDrones)) {
      miningDrones.tick(session, s, scene, ship, now, defending);
    }
    if (s.job === "boosting") { s.status = s.boostStatus; return; }
    if (s.autoBoost && !api.modules(ship, now).length) {
      s.status = s.boostStatus;
      return;
    }
    updateSurvey({ api, scene, session, ship, state: s, now });
    if (["largest", "smallest"].includes(s.order) && api.hasSurveyor?.(ship) !== true) {
      if (!s.surveyorBlocked) stop(session, s);
      s.surveyorBlocked = true;
      s.approachStatus = "";
      s.status = "Waiting: volume priority needs an available Mining Surveyor or built-in equivalent. No scan is required. Choose Nearest/Furthest to mine without one.";
      return;
    }
    if (s.surveyorBlocked) { s.surveyorBlocked = false; s.replan = true; s.nextSearch = 0; }
    const effects = ship.activeModuleEffects || new Map();
    // Capacity checks inspect only already locked resources using native cached
    // inventory capacity; they never enumerate the asteroid field.
    if (api.hasRoom) {
      for (const id of new Set([...(ship.lockedTargets?.keys() || []), ...(ship.pendingTargetLocks?.keys() || [])])) {
        if (api.hasRoom(scene,ship,id) !== false) continue;
        release(scene,session,ship,id);
        s.locks.delete(id);
        for (const [moduleID,targetID] of s.assignments) if (targetID === id) s.assignments.delete(moduleID);
        s.replan = true;
      }
    }
    const allWorking = modules => modules.length && modules.every(m => effects.has(m.item.itemID));
    // Inspect only the fitted miners' effective burst modifiers, not the field.
    // Native timed modifiers disappear here as soon as their boost expires.
    const boostKey = api.boostSignature?.(ship, s.moduleCache, now);
    const boostsChanged = boostKey !== s.boostKey;
    if (boostsChanged) { s.nextModuleCheck = 0; s.nextSearch = 0; }
    // Native mining owns active cycles. No asteroid discovery or dogma rebuild
    // is needed while every known miner is working. Check fitting every 5s.
    if (!s.replan && !s.approachTarget && now < s.nextModuleCheck && allWorking(s.moduleCache)) return;
    if (!s.replan && now < s.nextSearch && !effects.size && !ship.pendingTargetLocks?.size && !s.approachTarget && s.lastLockCount === ship.lockedTargets?.size) return;
    const reuseModules = s.approachTarget && !s.replan && !boostsChanged && now < s.nextModuleCheck;
    const modules = reuseModules ? s.moduleCache : api.modules(ship, now);
    const rangesChanged = boostsChanged || modules.some(m => s.moduleCache.find(old => old.item.itemID === m.item.itemID)?.snapshot.maxRangeMeters !== m.snapshot.maxRangeMeters);
    s.moduleCache = modules;
    if (!reuseModules) s.nextModuleCheck = now + 5000;
    s.boostKey = api.boostSignature?.(ship, modules, now);
    if (!s.replan && !rangesChanged && !s.approachTarget && allWorking(modules)) {
      s.status = `Mining with ${modules.length} module(s).`;
      return;
    }
    let rocks;
    const focus = s.approach && !s.replan && s.focusTarget && api.target?.(scene, ship, s.focusTarget);
    const focusModules = focus ? modules.filter(m => api.compatible(scene, ship, m, focus, now, true)) : [];
    const validFocus = focus && matchesOre(focus.name, s.ores) && focusModules.length;
    if (!validFocus) s.focusTarget = null;
    if (validFocus && focusModules.some(m => !api.compatible(scene, ship, m, focus, now))) {
      // Travelling: direct lookups suffice; no full-belt rescan each second.
      const existing = new Map([[focus.id, focus]]);
      for (const effect of effects.values()) {
        const rock = api.target?.(scene, ship, effect.targetID);
        if (rock && matchesOre(rock.name, s.ores)) existing.set(rock.id, rock);
      }
      rocks = [...existing.values()];
    }
    // Reuse directly looked-up, still-valid assigned asteroids across cycles.
    // A depletion, invalid assignment, changed filter or new module falls back
    // to fresh scene discovery and the full distinct-target planner.
    if (!rocks && !s.replan && api.target && modules.length && (!s.approach || validFocus) && !s.approachTarget) {
      const existing = new Map();
      if (modules.every(m => {
        const id = effects.get(m.item.itemID)?.targetID || s.assignments.get(m.item.itemID);
        const rock = id && (existing.get(id) || api.target(scene, ship, id));
        if (!rock || !matchesOre(rock.name,s.ores) || !api.compatible(scene,ship,m,rock,now)) return false;
        existing.set(id,rock);return true;
      })) {
        if (validFocus) existing.set(focus.id, focus);
        rocks = [...existing.values()];
      }
    }
    if (!rocks) rocks = api.candidates(scene, ship).filter(r => matchesOre(r.name, s.ores));
    const priority = createOrePriority(s.ores, s.order);
    if (crystals && crystals({ api, scene, session, ship, state: s, modules,
      rocks: [...rocks].sort(priority), now })) {
      s.status = s.crystalStatus;
      return;
    }
    s.replan = false;
    const occupied = new Set();
    const current = new Map();
    const moduleIDs = new Set(modules.map(m => m.item.itemID));
    for (const [id, effect] of s.owned) if (effects.get(id) !== effect) s.owned.delete(id);
    for (const [id] of s.assignments) if (!moduleIDs.has(id)) s.assignments.delete(id);
    const rows = modules.map(m => ({ ...m, targets: rocks.filter(r => api.compatible(scene, ship, m, r, now)) }));
    const waitingForApproach = updateApproach({ api, scene, session, ship, state: s, modules, rocks, rows, now, save, priority });
    // Keep working cycles, but stop our own cycles whose target no longer matches
    // a changed filter or whose hold cannot accept even one unit.
    for (const m of rows) {
      const effect = effects.get(m.item.itemID);
      if (!effect) continue;
      occupied.add(effect.targetID);
      current.set(m.item.itemID, effect.targetID);
      if (s.owned.get(m.item.itemID) === effect && !m.targets.some(r => r.id === effect.targetID)) {
        scene.deactivateGenericModule(session, m.item.itemID);
      }
    }
    // Shorter-range/restricted modules get first choice. Within each module,
    // choose by actual surface distance, with stable ID ordering for ties.
    rows.sort((a, b) => a.targets.length - b.targets.length || a.item.itemID - b.item.itemID);
    const selectionPriority = createOrePriority(s.ores, s.order, {
      claimed: otherPilotsTargets(scene, session, rocks), focus: s.focusTarget,
    });
    for (const m of rows) m.targets.sort(selectionPriority);
    const planned = planDistinct(rows.filter(m => !waitingForApproach && !effects.has(m.item.itemID)), occupied);
    for (const rock of planned.values()) occupied.add(rock.id);
    for (const m of rows) {
      if (waitingForApproach || effects.has(m.item.itemID)) continue;
      const preferred = planned.get(m.item.itemID);
      const unique = m.targets.filter(r => !occupied.has(r.id) && r !== preferred);
      const shared = m.targets.filter(r => occupied.has(r.id) && r !== preferred);
      let selected = null;
      for (const r of [...(preferred ? [preferred] : []), ...unique, ...shared]) {
        const hadLock = ship.lockedTargets?.has(r.id) || ship.pendingTargetLocks?.has(r.id);
        const lock = s.lock ? scene.addTarget(session, r.id)
          : { success: ship.lockedTargets?.has(r.id) === true, data: { pending: false } };
        if (!lock?.success) continue;
        if (!hadLock) s.locks.add(r.id);
        selected = r;
        occupied.add(r.id);
        current.set(m.item.itemID, r.id);
        s.assignments.set(m.item.itemID, r.id);
        if (lock.data?.pending || !scene.getTargets(session).includes(r.id)) break;
        // A single normal cycle permits reassignment after depletion/filter
        // changes without repeatedly short-cycling yield or bypassing dogma.
        const result = scene.activateGenericModule(session, m.item, m.effect.name, { targetID: r.id, repeat: 0 });
        if (result?.success) s.owned.set(m.item.itemID, effects.get(m.item.itemID) || ship.activeModuleEffects.get(m.item.itemID));
        break;
      }
      if (!selected) s.assignments.delete(m.item.itemID);
    }
    const used = new Set([...current.values(), ...[...effects.values()].map(e => e.targetID)]);
    for (const id of s.locks) {
      if (!used.has(id)) {
        release(scene, session, ship, id);
        s.locks.delete(id);
      }
    }
    const activeCount = rows.filter(m => ship.activeModuleEffects?.has(m.item.itemID)).length;
    s.lastLockCount = ship.lockedTargets?.size;
    s.nextSearch = !activeCount && !ship.pendingTargetLocks?.size && !s.approachTarget ? now + 5000 : 0;
    s.status = activeCount ? `Mining with ${activeCount} module(s).`
      : !modules.length ? "Waiting for online mining modules."
      : !rocks.length ? "Waiting for matching resources nearby."
      : !rows.some(m => m.targets.length) ? "Waiting for compatible resources in range and room in the mining hold."
      : ship.pendingTargetLocks?.size ? "Waiting for target locks."
      : "Waiting for a free target slot, capacitor or module readiness.";
  }
  function tick(scene, now) {
    for (const session of scene.sessions.values()) {
      try { tickPlayer(scene, session, now); activity?.observe(session, players.get(session)); }
      catch (error) {
        const s = players.get(session);
        if (s) { if (s.haul) hauling.cancel(session, s, `Hauling paused: ${error.message}`); s.enabled = false; try { stop(session, s); } catch {} }
        logError(`[AutoMining] Automation stopped after error: ${error.message}`);
      }
    }
  }
  function clientReady(session, hudReady = false, haulReady = false) {
    if (!(Number(session?.characterID || session?.charid) > 0)) return false;
    const s = state(session);
    s.surveyClientReady = true; s.nextSurvey = 0;
    s.hudReady = hudReady === true || hudReady === 1;
    if (haulReady === true || haulReady === 1) s.haulClientReady = true;
    return true;
  }
  function surveyAck(session, success, reason) {
    const s = players.get(session);
    if (!s?.surveyClientReady) return false;
    const message = clientText(reason, 160) || "client unavailable";
    // Server arrival can precede the client's warp/session transition. A skipped
    // scan must not consume the full user interval; retain the native rate limit.
    if (!success && s.lastSurveyRequestAt !== null &&
        ["ship is warping", "not in space", "a survey is already running"].includes(message)) {
      s.nextSurvey = s.lastSurveyRequestAt + 6000;
    }
    s.surveyStatus = success ? `Mining Surveyor refreshed; repeats every ${s.surveySeconds} seconds.`
      : `Survey waiting: ${message}.`;
    return true;
  }
  function applyProfile(session, raw) {
    const prefs = JSON.parse(String(raw));
    if (!prefs || prefs.apply !== true) return false;
    const oreCommand = require("./commands").parse(`AutoMining ${String(prefs.ores || "").trim() || "clear"}`);
    if (!oreCommand || !["filter", "clear"].includes(oreCommand.action)) throw new Error("Invalid AutoMining profile ore list");
    if (!ORDERS.includes(prefs.order) || ["lock", "survey", "approach"].some(k => typeof prefs[k] !== "boolean")) throw new Error("Invalid AutoMining profile settings");
    if (prefs.compress !== undefined && typeof prefs.compress !== "boolean") throw new Error("Invalid AutoMining compression setting");
    const interval = prefs.surveySeconds === undefined ? DEFAULT_SURVEY_SECONDS : prefs.surveySeconds;
    if (!validSurveySeconds(interval)) throw new Error("Invalid AutoMining survey interval");
    const stampValues = [oreCommand.ores || [], prefs.order, prefs.lock, prefs.survey, prefs.approach, prefs.compress === true];
    // Retain the old preset identity when the new field has its default. An
    // update must not reapply an unchanged preset over later in-game choices.
    if (interval !== DEFAULT_SURVEY_SECONDS) stampValues.push(interval);
    const stamp = JSON.stringify(stampValues);
    const s = state(session);
    if (s.profileStamp === stamp) return false;
    if (prefs.surveyDefaulted === true && prefs.survey === false) {
      const legacy = [...stampValues]; legacy[3] = true;
      if (JSON.stringify(legacy) === s.profileStamp) return false;
    }
    command(session, oreCommand);
    command(session, { action: prefs.order });
    for (const setting of ["lock", "survey", "approach"]) command(session, { action: "toggle", setting, enabled: prefs[setting] });
    command(session, { action: "toggle", setting: "compress", enabled: prefs.compress === true });
    command(session, { action: "surveyInterval", seconds: interval });
    s.profileStamp = stamp;
    save(session, s);
    return true;
  }
  function snapshot(session) {
    if (!(Number(session?.characterID || session?.charid) > 0)) throw new Error("AutoMining needs a character session.");
    const s = state(session);
    const settings = { ores: [...s.ores], order: s.order, approach: s.approach, lock: s.lock, survey: s.survey, compress: s.compress, surveySeconds: s.surveySeconds,
      haulThreshold: s.haulThreshold,
      haulEnabled: s.haulEnabled, stationID: s.stationID, storageKey: s.storageKey, recallDrones: s.recallDrones,
      defenseEnabled: s.defenseEnabled, defenseShieldEnabled: s.defenseShieldEnabled,
      defenseShieldThreshold: s.defenseShieldThreshold, defenseArmorEnabled: s.defenseArmorEnabled,
      defenseArmorThreshold: s.defenseArmorThreshold,
      launchDrones: s.launchDrones, droneGroupKey: s.droneGroupKey,
      mineDrones: s.mineDrones, mineDroneOrder: s.mineDroneOrder, mineDroneMode: s.mineDroneMode,
      autoBoost: s.autoBoost, inviteFleet: s.inviteFleet,
      ...featureSnapshot(s),
      ratDefenseEnabled: s.ratDefenseEnabled, ratMiningGroupKey: s.ratMiningGroupKey, ratFighterGroupKey: s.ratFighterGroupKey };
    let destination = null, storage = null;
    try { if (destinations && s.stationID) { destination = destinations.station(s.stationID, session); storage = destinations.storage(session, s.stationID, s.storageKey); } } catch {}
    let fuelDestination = null, fuelStorage = null, industrialView = null, transportDestination = null, transportStorage = null,pveHomeDestination=null;
    try { if (destinations && s.fuelStationID) { fuelDestination = destinations.station(s.fuelStationID, session); fuelStorage = destinations.storage(session, s.fuelStationID, s.fuelStorageKey); } } catch {}
    try { if (destinations && s.transportStationID) { transportDestination = destinations.station(s.transportStationID, session); transportStorage = destinations.storage(session, s.transportStationID, s.transportStorageKey); } } catch {}
    try {if(destinations&&s.pveHomeStationID)pveHomeDestination=destinations.station(s.pveHomeStationID,session);}catch{}
    if (industrial) {
      const scene = getSpace()?.getSceneForSession(session), ship = snapshotShip(session, scene);
      try { industrialView = industrial.snapshot(session, s, scene, ship, industrialTime(scene)); }
      catch (error) { industrialView = { modules: [], fuel: null, status: "Industrial equipment is unavailable.", travelBlocked: false }; }
    }
    return { settings, revision: JSON.stringify(settings), enabled: s.enabled, canStopFleet: canStopFleet(session),
      destination, storage, hauling: hauling?.view(s) || null, hold: s.holdStatus || null,
      fuelDestination, fuelStorage, transportDestination, transportStorage,pveHomeDestination,
      pveAmmo:s.job==="pve"?pveAmmo?.view(session,s,snapshotShip(session,getSpace()?.getSceneForSession(session)))||null:null,
      transport: transport?.view(session, s, snapshotShip(session, getSpace()?.getSceneForSession(session))) || null,
      fleetOre: fleetOre?.view(s) || null, pve: pve?.view(session, s) || null, fleet: fleetGroups?.view(session, s) || null,
      industrial: industrialView, oreHandling: oreHandling?.view(s) || null,
      droneStatus: s.launchDrones ? s.droneStatus : "Automatic launch is off.",
      mineDroneStatus: s.mineDrones ? s.mineDroneStatus : "Automatic mining orders are off.",
      boostStatus: s.autoBoost ? [s.boostStatus, s.inviteFleet ? s.fleetStatus : ""].filter(Boolean).join(" ") : "Automatic mining boosts are off.",
      ratStatus: s.ratDefenseEnabled ? s.ratStatus : "Rat response is off.",
      defenseStatus: s.defenseEnabled ? s.defenseStatus : "Defense is off.",
      status: s.departureStatus || (s.haul ? hauling.view(s).status : !s.enabled && s.haulStatus ? s.haulStatus :
        s.enabled && s.job === "pve" ? s.haul?.retreat ? s.defenseStatus : s.pveStatus || s.status :
        s.enabled && s.shipRole === "transport" ? s.transportBlocked ? s.status : s.transportStatus || "Transport is off." :
        s.enabled ? (getSpace().getSceneForSession(session)?.getShipEntityForSession(session)
        ? [s.status, s.approachStatus, s.surveyStatus, s.compressionStatus].filter(Boolean).join(" ")
        : "Paused while docked. AutoMining resumes in space.") : "AutoMining is off.") };
  }
  function applySettings(session, raw) {
    if (typeof raw !== "string" || raw.length > 100000) throw new Error("Invalid AutoMining settings request.");
    const request = JSON.parse(raw);
    const current = state(session);
    const p = switchProfile(request.settings, current);
    if (!p || !Array.isArray(p.ores) || p.ores.length > MAX_ORE_FILTERS || p.ores.some(x => typeof x !== "string" || !x.trim() || x.length > 80 || !/^[\p{L}\p{N} '-]+$/u.test(x)) ||
        !ORDERS.includes(p.order) || !validSurveySeconds(p.surveySeconds) ||
        ["approach", "lock", "survey", "compress"].some(k => typeof p[k] !== "boolean")) throw new Error("Invalid AutoMining settings. Check the survey interval and ore list.");
    if (request.revision !== snapshot(session).revision) throw new Error("Settings changed elsewhere. Click Reload before applying your changes.");
    const features = featureRequest(p, current);
    const recallDrones = p.recallDrones === undefined ? current.recallDrones : p.recallDrones;
    if (typeof recallDrones !== "boolean") throw Error("Invalid drone recall setting.");
    const launchDrones = p.launchDrones === undefined ? current.launchDrones : p.launchDrones;
    const droneGroupKey = p.droneGroupKey === undefined ? current.droneGroupKey : p.droneGroupKey;
    const inactiveDroneGroup=key=>typeof key==="string"&&key.length<=512;
    if (typeof launchDrones !== "boolean" || (features.job==="pve"?!inactiveDroneGroup(droneGroupKey):!validGroupKey(droneGroupKey)||launchDrones&&!droneGroupKey)) throw Error("Select a drone group before enabling automatic launch.");
    const mineDrones = p.mineDrones === undefined ? current.mineDrones : p.mineDrones;
    const mineDroneOrder = p.mineDroneOrder === undefined ? current.mineDroneOrder : p.mineDroneOrder;
    const mineDroneMode = p.mineDroneMode === undefined ? current.mineDroneMode : p.mineDroneMode;
    if (typeof mineDrones !== "boolean" || !ORDERS.includes(mineDroneOrder) || !["spread", "focus"].includes(mineDroneMode))
      throw Error("Invalid mining drone settings.");
    const autoBoost = p.autoBoost === undefined ? current.autoBoost : p.autoBoost;
    const inviteFleet = p.inviteFleet === undefined ? current.inviteFleet : p.inviteFleet;
    const ratDefenseEnabled = p.ratDefenseEnabled === undefined ? current.ratDefenseEnabled : p.ratDefenseEnabled;
    const ratMiningGroupKey = p.ratMiningGroupKey === undefined ? current.ratMiningGroupKey : p.ratMiningGroupKey;
    const ratFighterGroupKey = p.ratFighterGroupKey === undefined ? current.ratFighterGroupKey : p.ratFighterGroupKey;
    if ([autoBoost, inviteFleet, ratDefenseEnabled].some(x => typeof x !== "boolean") ||
        (features.job==="pve"?!inactiveDroneGroup(ratMiningGroupKey)||!inactiveDroneGroup(ratFighterGroupKey):
          !validGroupKey(ratMiningGroupKey)||!validGroupKey(ratFighterGroupKey)||ratDefenseEnabled&&(!ratFighterGroupKey||(features.job==="mining"||features.job==="boosting"&&mineDrones)&&(!ratMiningGroupKey||ratMiningGroupKey===ratFighterGroupKey))))
      throw Error("Select separate mining and fighter groups for rat response.");
    // Older companions may save mining settings without the new fields.
    const haulEnabled = features.haulEnabled;
    const haulThreshold = p.haulThreshold === undefined ? current.haulThreshold : p.haulThreshold;
    const targetID = p.stationID === undefined ? current.stationID : p.stationID;
    const storageKey = p.storageKey === undefined ? current.storageKey : p.storageKey;
    const defenseEnabled = p.defenseEnabled === undefined ? current.defenseEnabled : p.defenseEnabled;
    const defenseShieldEnabled = p.defenseShieldEnabled === undefined ? current.defenseShieldEnabled : p.defenseShieldEnabled;
    const defenseShieldThreshold = p.defenseShieldThreshold === undefined ? current.defenseShieldThreshold : p.defenseShieldThreshold;
    const defenseArmorEnabled = p.defenseArmorEnabled === undefined ? current.defenseArmorEnabled : p.defenseArmorEnabled;
    const defenseArmorThreshold = p.defenseArmorThreshold === undefined ? current.defenseArmorThreshold : p.defenseArmorThreshold;
    if (typeof haulEnabled !== "boolean" || !validHaulThreshold(haulThreshold) || !Number.isSafeInteger(targetID) || targetID < 0 ||
        typeof storageKey !== "string" || storageKey.length > 100) throw Error("Invalid return-to-station settings.");
    if ([defenseEnabled, defenseShieldEnabled, defenseArmorEnabled].some(value => typeof value !== "boolean") ||
        !validDefenseThreshold(defenseShieldThreshold) || !validDefenseThreshold(defenseArmorThreshold) ||
        defenseEnabled && !defenseShieldEnabled && !defenseArmorEnabled) throw Error("Select shield or armor and a threshold from 1 to 100 for Defense.");
    if ((features.job === "mining" && haulEnabled || defenseEnabled) && (!destinations || !targetID)) throw Error("Choose a station and unload storage before enabling hauling or Defense.");
    if (targetID && (features.job === "mining" && haulEnabled || defenseEnabled)) { destinations.station(targetID, session); destinations.storage(session, targetID, storageKey); }
    if (features.job === "boosting" && features.fuelEnabled) {
      if (!destinations || !features.fuelStationID) throw Error("Choose a fuel station and source storage before enabling restocking.");
      destinations.station(features.fuelStationID, session);
      destinations.storage(session, features.fuelStationID, features.fuelStorageKey);
    }
    if (features.job === "hauling" && current.job === "hauling" && current.enabled) {
      if (!destinations || !features.transportStationID) throw Error("Choose a transport station and unload storage before enabling Transport.");
      destinations.station(features.transportStationID, session);
      destinations.storage(session, features.transportStationID, features.transportStorageKey);
    }
    if (features.job==="pve"&&features.pveDronesEnabled && (!validGroupKey(features.pveDroneGroupKey) || !features.pveDroneGroupKey)) throw Error("Select a combat drone group before enabling PVE drones.");
    if (features.job === "pve" && features.pveMode === "belt" && features.pveBeltID && !pve?.searchBelts(session, String(features.pveBeltID)).some(belt => Number(belt.beltID) === features.pveBeltID))
      throw Error("Selected asteroid belt is unavailable.");
    if(features.job==="pve"&&features.pveMode==="standby"&&features.pveHomeStationID)destinations.station(features.pveHomeStationID,session);
    if (features.job === "hauling" && current.job === "hauling" && current.enabled) {
      const ship = snapshotShip(session, getSpace()?.getSceneForSession(session));
      if (!transport || !transport.eligibility(session, ship).eligible) throw Error("This ship cannot use the Transport role.");
    }
    if (features.job === "boosting" && industrial) {
      const scene = getSpace()?.getSceneForSession(session), ship = snapshotShip(session, scene);
      const modules = ship ? industrial.snapshot(session, current, scene, ship, industrialTime(scene)).modules : [];
      for (const module of modules) {
        const configured = (module.kind === "core" ? features.coreIntervals : features.compressorIntervals)[module.typeID];
        if (configured !== undefined) validateIntervalSeconds(configured, module.durationSeconds * 1000);
      }
    }
    if (current.haul && (current.haul.purpose === "fuel"
      ? !features.fuelEnabled || features.fuelStationID !== current.fuelStationID || features.fuelStorageKey !== current.fuelStorageKey
        || features.fuelUseCargo !== current.fuelUseCargo || features.fuelReserveCycles !== current.fuelReserveCycles
        || features.fuelTargetCycles !== current.fuelTargetCycles
        || current.haul.flagID && (targetID !== current.stationID || storageKey !== current.storageKey)
      : (!current.haul.retreat && !haulEnabled) || targetID !== current.stationID || storageKey !== current.storageKey))
      hauling.cancel(session, current, "Hauling cancelled after destination settings changed.");
    if (launchDrones !== current.launchDrones || droneGroupKey !== current.droneGroupKey ||
        ratDefenseEnabled !== current.ratDefenseEnabled || ratMiningGroupKey !== current.ratMiningGroupKey || ratFighterGroupKey !== current.ratFighterGroupKey) {
      drones.invalidate(current);
      ratDefense?.clear(current);
      current.droneStatus = "Waiting for arrival at a mining location, or Start / Resume here.";
      if (droneGroupKey !== current.droneGroupKey) miningDrones?.reset(current);
    }
    if (current.autoBoost && !autoBoost) boosters?.stop(current, current.scene, session, current.scene?.getShipEntityForSession(session));
    const previousProfile = captureProfile(current);
    if (features.job !== current.job || features.job === "pve" && ["pveMode","pveBeltID","pveFleetID","pveAnchorID","pveHomeStationID","pveMaxJumps"].some(key=>features[key]!==current[key])) {
      command(session, { action: "off" });
      fleetGroups?.release(session, current);
      current.haulStatus = ""; current.departureStatus = "";
    }
    if (features.shipRole !== current.shipRole || features.transportEnabled !== current.transportEnabled ||
        features.transportStationID !== current.transportStationID || features.transportStorageKey !== current.transportStorageKey ||
        features.oreMode !== current.oreMode) {
      transport?.cancel(session, current, "Transport settings changed.");
      if (features.shipRole !== current.shipRole) {
        stop(session, current);
        drones.invalidate(current); ratDefense?.clear(current);
        current.transportQuietShip = null;
        if (current.haul) hauling.cancel(session, current, "Hauling cancelled after ship role changed.");
      }
    }
    if (!recallDrones) departureGuard?.cancel(session, "Departure cancelled after recall was disabled. Issue travel again to proceed without recall.");
    const s = state(session); s.deferSave = true;
    try {
      command(session, {action:"filter", ores:[...new Set(p.ores.map(x=>x.trim().toLowerCase().replace(/\s+/g," ")))]});
      if (s.order !== p.order) command(session, {action:p.order});
      for (const setting of ["approach", "lock", "survey", "compress"]) if (s[setting] !== p[setting]) command(session, {action:"toggle",setting,enabled:p[setting]});
      if (s.surveySeconds !== p.surveySeconds) command(session, {action:"surveyInterval",seconds:p.surveySeconds});
      s.haulEnabled = haulEnabled; s.haulThreshold = haulThreshold; s.stationID = targetID; s.storageKey = storageKey;
      (s.jobProfiles ||= {})[s.job] = previousProfile;
      Object.assign(s, features);
      s.defenseEnabled = defenseEnabled; s.defenseShieldEnabled = defenseShieldEnabled;
      s.defenseShieldThreshold = defenseShieldThreshold; s.defenseArmorEnabled = defenseArmorEnabled;
      s.defenseArmorThreshold = defenseArmorThreshold;
      s.defenseStatus = defenseEnabled ? "Defense armed." : "Defense is off.";
      s.recallDrones = recallDrones;
      s.launchDrones = launchDrones; s.droneGroupKey = droneGroupKey;
      if (s.mineDroneOrder !== mineDroneOrder || s.mineDroneMode !== mineDroneMode || s.mineDrones !== mineDrones) s.mineReplan = true;
      s.mineDrones = mineDrones; s.mineDroneOrder = mineDroneOrder; s.mineDroneMode = mineDroneMode;
      if (!mineDrones) s.mineAssignments.clear();
      s.nextMineScan = 0;
      s.autoBoost = autoBoost; s.inviteFleet = inviteFleet;
      s.ratDefenseEnabled = ratDefenseEnabled; s.ratMiningGroupKey = ratMiningGroupKey; s.ratFighterGroupKey = ratFighterGroupKey;
      s.nextFleetCheck = 0; s.nextBoostAttempt?.clear();
      s.nextHaulCheck = 0;
      if (industrial) {
        const scene = getSpace()?.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
        if (s.job === "boosting" && !s.haul && !departureGuard?.pending(session)) industrial.resume(s, ship);
        if (!s.coreEnabled && !s.compressorEnabled) industrial.stop(session, s, scene, ship, industrialTime(scene));
      }
    } finally { delete s.deferSave; }
    s.jobProfiles[s.job] = captureProfile(s);
    return "AutoMining settings applied." + save(session, s);
  }
  function feedback(session, message) {
    if (!players.get(session)?.hudReady) return false;
    session.sendNotification("OnAutoMiningFeedback", "clientID", [String(message).slice(0,1000)]);
    return true;
  }
  function haulAction(session, id, action, reason) {
    const s = state(session);
    if (!hauling) throw Error("Hauling is unavailable.");
    try {
      const op = s.haul, wasUnloaded = op?.unloadConfirmed, previousPhase = op?.phase;
      const result = hauling.action(session, s, id, action, reason);
      if (!wasUnloaded && op?.unloadConfirmed) {
        statistics?.recordTrip(session, id);
        activity?.emit(session, s, { key: "oreComplete", id: String(id) });
      }
      if (action === "resupplied" && previousPhase === "resupplying" && s.haul === op && op.phase === "undocking")
        activity?.emit(session, s, { key: "fuelComplete", id: String(id) });
      if (action === "complete" && s.enabled) {
        drones.arm(s);
        const scene = getSpace()?.getSceneForSession(session);
        industrial?.resume(s, scene?.getShipEntityForSession(session));
        activity?.emit(session, s, { key: "resumed", id: String(id) });
      }
      activity?.observe(session, s);
      return result;
    }
    catch (error) {
      if (s.haul?.id === id) hauling.cancel(session, s, `Hauling paused: ${error.message}`);
      throw error;
    }
  }
  function cancelHaul(session, reason) {
    const s = state(session);
    if (s.haul) { departureGuard?.cancel(session, reason); if (s.haul) hauling.cancel(session, s, reason); }
    transport?.cancel(session, s, reason);
    pve?.stop(session, s, s.scene, s.scene?.getShipEntityForSession(session));
    fleetGroups?.release(session, s);
    if ((s.shipRole === "transport" || s.job === "pve") && s.enabled) { s.enabled = false; save(session, s); }
  }
  function departureOptions(session) {
    const s = state(session);
    return { enabled: !!(s.recallDrones || s.haul?.retreat || s.pveJob?.deployment&&s.pveJob.phase==="returning"), hauling: !!s.haul || !!s.transportJob || !!s.pveTravel,
      transport: s.shipRole === "transport", pve: s.job === "pve",
      haulID: s.haul?.id || s.transportJob?.id, retreatLayer: s.haul?.retreatLayer || null,
      stationID: s.haul?.station?.stationID || s.pveJob?.home?.stationID || (s.shipRole === "transport" ? s.transportStationID : s.stationID) };
  }
  function departureStarted(session) {
    const s = state(session);
    drones.invalidate(s); s.droneArrival = false;
    resetMiningTargets(session, s);
    s.departureStatus = "Recalling drones before departure. Stop cancels departure.";
    feedback(session, s.departureStatus);
  }
  function departureEnded(session, message, pause) {
    const s = state(session);
    s.departureStatus = message;
    if (pause) {
      if (s.haul) hauling.cancel(session, s, message);
      transport?.cancel(session, s, message);
      pve?.stop(session, s, s.scene, s.scene?.getShipEntityForSession(session));
      s.enabled = false;
      save(session, s);
    }
  }
  function departureRefused(session) {
    const s = state(session);
    if (!s.enabled || s.haul || s.shipRole === "transport" || departureGuard?.pending(session)) return;
    const scene = getSpace()?.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
    if (!ship || ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock || ship.dockingTargetID ||
        session.stationID || session.stationid || session.structureID || session.structureid || ship.cloaked || ship.isCloaked) return;
    industrial?.resume(s, ship);
    s.departureStatus = "";
  }
  function prepareDeparture(session) {
    if (!industrial) return true;
    const s = state(session), scene = getSpace()?.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
    const ready = industrial.requestDeparture(session, s, scene, ship, industrialTime(scene));
    if (!ready) {
      s.industrialSnapshot = industrial.snapshot(session, s, scene, ship, industrialTime(scene));
      s.departureStatus = s.industrialSnapshot.status || "Waiting for industrial core cycle before departure.";
    }
    return ready;
  }
  function jettison(session) {
    const s = state(session), scene = getSpace()?.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
    if (!oreHandling || !ship || !scene || s.haul || s.shipRole === "transport" || ["pickup", "fleetHangar"].includes(s.oreMode) || departureGuard?.pending(session) || retreatReason(s, ship)) throw Error("Jettison is unavailable during travel or Defense.");
    const hold = getAPI()?.oreHold?.(scene, ship, () => true, Date.now(), 100, true);
    const result = oreHandling.jettison(session, s, scene, ship, hold, Date.now(), { manual: true });
    oreActivity(session, s);
    activity?.observe(session, s);
    return result;
  }
  function stats(session, view, period) {
    if (!statistics || !["pilot", "fleet"].includes(view) || !["session", "today", "week", "tracked", "operation"].includes(period)) throw Error("Invalid statistics request.");
    return statistics.snapshot(session, { view, period });
  }
  return { command, tick, clientReady, surveyAck, applyProfile, snapshot, applySettings, feedback, haulAction, cancelHaul,
    jobProfile:(session,job)=>{
      if(!["mining","boosting","hauling","pve"].includes(job))throw Error("Invalid AutoMining settings request.");
      const s=state(session),current=snapshot(session);
      const settings=switchProfile({...current.settings,job},s),result={job,settings,fields:profileFields(job),revision:current.revision};
      for(const [id,key,stationField,storageField]of [[settings.fuelStationID,settings.fuelStorageKey,"fuelDestination","fuelStorage"],
        [settings.transportStationID,settings.transportStorageKey,"transportDestination","transportStorage"],[settings.pveHomeStationID,null,"pveHomeDestination",null]]){
        result[stationField]=null;if(storageField)result[storageField]=null;
        try{if(destinations&&id){result[stationField]=destinations.station(id,session);if(storageField)result[storageField]=destinations.storage(session,id,key);}}catch{}
      }
      if(job==="pve"){
        result.pve={...current.pve,belt:null};
        try{if(settings.pveBeltID)result.pve.belt=pve?.belt(settings.pveBeltID)||null;}catch{}
        result.pveAmmo=pveAmmo?.view(session,settings,snapshotShip(session,getSpace()?.getSceneForSession(session)))||null;
      }
      return result;
    },
    combatStatisticsEnabled: session => players.get(session)?.enabled === true,
    fleetReady: session => {
      const s = state(session), scene = getSpace()?.getSceneForSession(session);
      cleanupTransportFleet(session, s);
      cleanupPVEFleet(session,s);
      fleetGroups?.tick(session, s, scene, scene?.getShipEntityForSession(session), Date.now());
      return true;
    },
    fleetAction: (session, action, raw) => {
      if (!fleetGroups || typeof raw !== "string" || raw.length > 20000) throw Error("Invalid fleet request.");
      return fleetGroups.action(session, state(session), action, JSON.parse(raw));
    },
    searchBelts: (session, query) => { if (!pve) throw Error("Belt search is unavailable."); return pve.searchBelts(session, query); },
    catalogBelts: (session, offset, limit) => { if (!pve) throw Error("Belt search is unavailable."); return pve.catalogBelts(session, offset, limit); },
    pveReady: session => {
      const s = state(session); pve?.ready(session, s);
      cleanupPVEFleet(session,s);
      if (pve && s.enabled && s.job === "pve" && !s.haul && !departureGuard?.pending(session)) {
        const scene = getSpace()?.getSceneForSession(session), ship = snapshotShip(session, scene);
        runPVE(session,s,scene,ship);
      }
      return true;
    },
    pveHeartbeat:(session,id)=>pve?.heartbeat(session,state(session),id)===true,
    pveFleets:session=>pveDeployment?.fleetRows(session)||[],
    setReinforcementAttackAvailable:value=>pveDeployment?.setAttackAvailable(value),
    pveAmmoGroups:(session,raw)=>{
      if(!pveAmmo||typeof raw!=="string"||raw.length>16384)throw Error("Invalid PVE action.");
      const s=state(session);pveAmmo.selectDrones(session,s,JSON.parse(raw));return snapshot(session);
    },
    reinforcementCall:session=>{if(!pveDeployment)throw Error("PVE deployment is no longer available.");pveDeployment.call(session,state(session));return snapshot(session);},
    reinforcementAttack:(scene,attacker,target,result)=>{
      const victim=extensions.getSession?.(Number(target?.pilotCharacterID||target?.characterID));
      if(!victim||!players.get(victim)?.enabled)return false;
      return pveDeployment?.attack(scene,attacker,target,result)===true;
    },
    pvePlan:(session,raw)=>{
      if(!pveDeployment||typeof raw!=="string"||raw.length>16384)throw Error("Invalid PVE action.");
      const s=state(session),scene=getSpace()?.getSceneForSession(session),ship=snapshotShip(session,scene);
      const payload=JSON.parse(raw);
      pveAmmo?.tick(session,s,scene,ship);
      if(!departureGuard?.pending(session)&&(payload?.offerID==="home"||!pveAmmo||pveAmmo.ready(session,s,ship)))pveDeployment.plan(session,s,payload);
      else if(payload?.offerID!=="home"&&pveAmmo)s.pveStatus=pveAmmo.view(session,s,ship).status;
      return snapshot(session);
    },
    pveAction: (session, id, action, raw) => {
      if (!pve || typeof raw !== "string" || raw.length > 16384) throw Error("Invalid PVE action.");
      const s = state(session), scene = getSpace()?.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (retreatReason(s, ship)) { pve.stop(session, s, scene, ship); return pve.view(session, s); }
      return pve.action(session, s, id, action, JSON.parse(raw));
    },
    pveNavigation: (session, kind, args) => pve?.allowNavigation(session, kind, args) === true,
    pveOrbitNavigation: (session,args) => pve?.orbitNavigation?.(session,args)||{allowed:false,skipped:false},
    pveAutopilotNavigation: (session, method, args) => {
      return pve?.autopilotNavigation(session,method,args)===true;
    },
    transportReady: session => {
      const s = state(session); s.transportClientReady = true;
      cleanupTransportFleet(session, s);
      if (transport && s.enabled && s.shipRole === "transport" && !s.haul && !departureGuard?.pending(session)) {
        const scene = getSpace()?.getSceneForSession(session), ship = snapshotShip(session, scene);
        if (prepareTransport(session, s, scene, ship)) transport.tick(session, s, scene, ship, null);
      }
      return true;
    },
    transportRequest: session => { if (!transport) throw Error("Transport is unavailable."); return transport.request(session, state(session)); },
    transportAction: (session, id, action, payload) => {
      if (!transport) throw Error("Transport is unavailable.");
      if (typeof payload !== "string" || payload.length > 20000) throw Error("Transport request is too large.");
      const s = state(session), scene = getSpace()?.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      const danger = ship && retreatReason(s, ship);
      if (danger) { transport.cancel(session, s, danger); s.defenseStatus = danger; return transport.view(session, s, ship); }
      if (s.shipRole === "transport" && !prepareTransport(session, s, scene, ship || snapshotShip(session, scene)))
        return transport.view(session, s, ship);
      return transport.action(session, s, id, action, JSON.parse(payload));
    },
    transportNavigation: (session, kind, args) => transport?.allowNavigation(session, kind, args) === true,
    transportWarpPermit: (session, args) => transport?.takeWarpArrival(session, args),
    transportWarpPoint: (session, permit, scene, point, options) => transport?.planWarpArrival(session, permit, scene, point, options),
    transportAutopilotNavigation: (session, name, args) => {
      const s = state(session), op = s.transportJob;
      if (!op || !s.enabled || s.shipRole !== "transport" || !["routePickup", "outbound"].includes(op.phase) ||
          !["Handle_CmdFollowBall", "Handle_CmdStargateJump"].includes(name)) return false;
      const scene = getSpace()?.getSceneForSession(session), entity = scene?.getEntityByID?.(Number(args?.[0]));
      return entity?.kind === "stargate" || name === "Handle_CmdFollowBall" && op.phase === "outbound" &&
        Number(entity?.itemID) === Number(op.station?.stationID) && ["station", "structure"].includes(entity?.kind);
    },
    jettison, stopFleet, statistics: stats,
    resetStatistics: session => { if (!statistics) throw Error("Statistics are unavailable."); return statistics.resetRun(session); },
    statisticsSessions: (session, offset = 0, limit = 20) => { if (!statistics || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw Error("Invalid statistics history request."); return statistics.sessions(session, { offset, limit }); },
    prepareDeparture, departureRefused,
    dronesReady: session => { state(session).droneClientReady = true; },
    droneClaim: (session, id) => {
      const s = state(session), grant = s.droneLaunchGrant;
      const scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (grant?.kind === "ratFighters" && !ratDefense?.ratsPresent(scene, ship) ||
          grant?.kind === "ratMiners" && ratDefense?.ratsPresent(scene, ship)) throw Error("Rat situation changed before drone launch.");
      return drones.claim(session, s, id);
    },
    droneSync: (session, id, ids) => {
      const s = state(session), grant = s.droneLaunchGrant;
      const scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (ids?.type === "list") ids = ids.items;
      if (!root || !grant?.claimed || grant.synced || Date.now() > grant.expires || grant.id !== id || grant.scene !== scene ||
          grant.shipID !== ship?.itemID || grant.characterID !== Number(session.characterID || session.charid) ||
          !Array.isArray(ids) || ids.length > 25 || ship?.pendingWarp || ship?.mode === "WARP") {
        throw Error("Drone state refresh is no longer authorized.");
      }
      grant.synced = true;
      const runtime = require(require("node:path").join(root, "server/src/services/drone/droneRuntime.js"));
      let count = 0;
      for (const rawID of new Set(ids)) {
        if (!Number.isSafeInteger(rawID) || rawID <= 0) continue;
        const entity = scene.getEntityByID(rawID);
        if (!runtime.isDroneEntity(entity) || Number(entity.ownerID) !== s.characterID ||
            Number(entity.controllerID) !== ship.itemID) continue;
        session.sendNotification("OnDroneStateChange", "charid", runtime.buildDroneStateNotificationTuple(entity));
        count++;
      }
      return { refreshed: count };
    },
    droneResult: (session, id, message, ids) => {
      const s = state(session), grant = drones.result(s, id, message);
      if (grant && ["arrival", "ratMiners"].includes(grant.kind) && Array.isArray(ids) && ids.length <= 200) {
        for (const value of ids) if (Number.isSafeInteger(value) && value > 0) {
          s.miningDroneIDs.add(value); s.mineIncompatibleIDs.delete(value);
        }
        s.nextMineScan = 0;
      }
      if (grant?.kind === "ratFighters" && Array.isArray(ids) && ids.length <= 200) {
        for (const value of ids) if (Number.isSafeInteger(value) && value > 0) s.ratManagedFighterIDs.add(value);
      }
      if (grant?.kind === "pve" && Array.isArray(ids) && ids.length <= 200) {
        s.pveManagedDroneIDs ||= new Set();
        for (const value of ids) if (Number.isSafeInteger(value) && value > 0) s.pveManagedDroneIDs.add(value);
      }
      if (grant?.kind === "ratMiners") s.ratRestoreSuccess = Array.isArray(ids) && ids.some(value => Number.isSafeInteger(value) && value > 0);
    },
    ratGroups: (session, raw) => {
      if (typeof raw !== "string" || raw.length > 20000) throw Error("Invalid rat drone groups.");
      return ratDefense?.setGroups(session, state(session), JSON.parse(raw));
    },
    setDepartureGuard: guard => { departureGuard = guard; }, departureOptions, departureStarted, departureEnded,
    departureProgress: (session, message) => { state(session).departureStatus = message; } };
}
module.exports = { createController };
