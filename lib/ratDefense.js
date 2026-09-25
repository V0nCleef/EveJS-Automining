"use strict";
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createRatDefense(root, { drones, getAPI = null, logError = console.error, native = null }) {
  const runtime = () => native || require(path.join(root, "server/src/services/drone/droneRuntime.js"));
  const ratFields = new WeakMap();
  const gridFor = (scene, entity) => scene.getLivePublicGridClusterKeyForEntity?.(entity) ||
    scene.getPublicGridClusterKeyForEntity(entity);
  function controlled(scene, ship, owner) {
    const native = runtime();
    const entities = scene.droneEntityIDs instanceof Set
      ? [...scene.droneEntityIDs].map(id => scene.getEntityByID(id))
      : [...(scene.dynamicEntities?.values() || [])];
    return entities.filter(d => native.isDroneEntity(d) && Number(d.controllerID) === ship.itemID && Number(d.ownerID) === owner);
  }
  function nearbyRats(scene, ship) {
    if (!scene || !ship) return [];
    const grid = gridFor(scene, ship);
    if (!grid) return [];
    let grids = ratFields.get(scene);
    if (!grids) { grids = new Map(); ratFields.set(scene, grids); }
    const now = Date.now(), source = scene.dynamicEntities;
    if (grids.size > 32) for (const [key, cached] of grids) if (now >= cached.expires) grids.delete(key);
    let entry = grids.get(grid);
    if (!entry || entry.source !== source || entry.size !== source?.size || now >= entry.expires) {
      const keys = [...(source?.entries() || [])].filter(([, entity]) =>
        entity?.kind === "ship" && entity.nativeNpc === true &&
        (entity.operatorKind === "asteroidBeltRat" || Number(entity.bounty) > 0) &&
        gridFor(scene, entity) === grid).map(([key]) => key);
      entry = { source, size: source?.size, keys, expires: now + 1000 };
      grids.set(grid, entry);
    }
    return entry.keys.map(key => source?.get(key)).filter(entity =>
      entity?.kind === "ship" && entity.nativeNpc === true &&
      (entity.operatorKind === "asteroidBeltRat" || Number(entity.bounty) > 0) &&
      gridFor(scene, entity) === grid);
  }
  const ratsPresent = (scene, ship) => nearbyRats(scene, ship).length > 0;
  function engage(session, s, fighters, rats, now) {
    if (now < (s.nextRatAttack || 0)) return;
    const native = runtime();
    if (typeof native.commandEngage !== "function") return;
    const live = new Set(rats.map(rat => Number(rat.itemID)));
    const idle = fighters.filter(drone => drone.droneCommand !== native.DRONE_COMMAND_RETURN_BAY &&
      (drone.droneCommand !== native.DRONE_COMMAND_ENGAGE || !live.has(Number(drone.targetID))));
    if (!idle.length) return;
    s.nextRatAttack = now + 5000;
    const target = rats[0];
    if (!(Number(target.itemID) > 0)) return;
    try {
      const result = native.commandEngage(session, idle.map(drone => drone.itemID), target.itemID);
      if (result?.type !== "dict" || !Array.isArray(result.entries) || result.entries.length)
        s.ratStatus = "Fighter drones could not engage the detected rat; retrying shortly.";
    } catch (error) {
      s.ratStatus = "Fighter attack order failed; retrying shortly.";
      logError(`[AutoMining] Fighter drone order failed: ${error.message}`);
    }
  }
  function recall(session, s, entities) {
    const native = runtime();
    const ids = entities.filter(drone => drone.droneCommand !== native.DRONE_COMMAND_RETURN_BAY).map(drone => drone.itemID);
    if (!ids.length) return true;
    const result = native.commandReturnBay(session, ids);
    if (result?.type === "dict" && Array.isArray(result.entries) && !result.entries.length) return true;
    s.ratStatus = "Drone recall was refused; check the drone bay and controls.";
    return false;
  }
  function requestGroups(session, s, ship, now) {
    if (now < (s.nextRatGroupRequest || 0)) return;
    s.nextRatGroupRequest = now + 10_000;
    s.ratGroupNonce = randomUUID();
    try { session.sendNotification("OnAutoMiningRatGroups", "clientID", [JSON.stringify({
      nonce: s.ratGroupNonce, characterID: s.characterID, shipID: ship.itemID,
      miningKey: s.ratMiningGroupKey, fighterKey: s.ratFighterGroupKey,
    })]); }
    catch (error) { s.ratStatus = "Could not read drone groups from the client."; logError(`[AutoMining] Rat group request failed: ${error.message}`); }
  }
  function setGroups(session, s, request) {
    if (!s.enabled || !s.ratDefenseEnabled || !request || request.nonce !== s.ratGroupNonce ||
        request.characterID !== s.characterID || request.shipID !== s.shipID ||
        request.miningKey !== s.ratMiningGroupKey || request.fighterKey !== s.ratFighterGroupKey) throw Error("Rat drone group request expired.");
    const valid = ids => Array.isArray(ids) && ids.length <= 200 && ids.every(id => Number.isSafeInteger(id) && id > 0);
    if (!valid(request.miningIDs) || !valid(request.fighterIDs)) throw Error("Invalid drone group membership.");
    s.ratMiningIDs = new Set(request.miningIDs);
    s.ratFighterIDs = new Set(request.fighterIDs);
    s.ratGroupNonce = null;
    return true;
  }
  function clear(s) {
    s.ratActive = false; s.ratGoneSince = 0; s.ratMiningIDs = null; s.ratFighterIDs = null;
    s.ratGroupNonce = null; s.ratManagedFighterIDs = new Set();
    s.ratRestoreRequested = false; s.ratFighterRequested = false; s.nextRatLaunch = 0;
  }
  function tick(session, s, scene, ship, now) {
    if (!s.ratDefenseEnabled || !s.enabled || !s.droneClientReady || !ship ||
        ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock || ship.dockingTargetID ||
        s.haul || !gridFor(scene, ship) || getAPI?.()?.miningSite?.(scene, ship) === false) {
      if (s.ratActive) clear(s);
      return false;
    }
    const rats = nearbyRats(scene, ship);
    if (rats.length) {
      if (!s.ratActive) {
        s.ratActive = true; s.ratMiningIDs = null; s.ratFighterIDs = null;
        s.ratManagedFighterIDs = new Set(); s.ratRestoreRequested = false;
        s.ratFighterRequested = false;
        s.droneArrival = false;
      }
      s.ratGoneSince = 0;
      if (!s.ratMiningIDs || !s.ratFighterIDs) {
        requestGroups(session, s, ship, now);
        s.ratStatus = "Rats detected; checking named drone groups.";
        return true;
      }
      const outside = controlled(scene, ship, s.characterID);
      const miners = outside.filter(d => s.ratMiningIDs.has(d.itemID));
      if (miners.length) {
        recall(session, s, miners);
        s.ratStatus = `Rats detected; waiting for ${miners.length} mining drone(s) to return.`;
        return true;
      }
      const fighters = outside.filter(d => s.ratFighterIDs.has(d.itemID));
      if (fighters.length) {
        s.ratFighterRequested = true;
        if (!(s.launchDrones && s.droneGroupKey === s.ratFighterGroupKey))
          for (const fighter of fighters) s.ratManagedFighterIDs.add(fighter.itemID);
        s.ratStatus = s.launchDrones && s.droneGroupKey === s.ratFighterGroupKey
          ? "Rats detected; standard fighter group remains out."
          : "Rats detected; fighter group is out.";
        engage(session, s, fighters, rats, now);
        return true;
      }
      if (!s.ratFighterRequested && now >= (s.nextRatLaunch || 0) && !s.droneLaunchGrant) {
        s.nextRatLaunch = now + 15_000;
        if (drones.requestGroup(session, s, scene, ship, s.ratFighterGroupKey, "ratFighters"))
          s.ratFighterRequested = true;
      }
      s.ratStatus = s.ratFighterRequested ? "Rats detected; fighter launch requested once for this encounter." :
        "Rats detected; waiting to launch the fighter group.";
      return true;
    }
    if (!s.ratActive) { s.ratStatus = "No rats on this mining grid."; return false; }
    if (!s.ratGoneSince) s.ratGoneSince = now;
    if (now - s.ratGoneSince < 5000) { s.ratStatus = "Rats gone; waiting briefly before switching drones."; return true; }
    // Standard fighters are the pilot's default; leave them alone.
    if (s.launchDrones && s.droneGroupKey === s.ratFighterGroupKey) {
      clear(s); s.ratStatus = "Rats gone; standard fighter group stays out.";
      return false;
    }
    const outside = controlled(scene, ship, s.characterID);
    const ownedFighters = outside.filter(d => s.ratManagedFighterIDs.has(d.itemID));
    if (ownedFighters.length) {
      recall(session, s, ownedFighters);
      s.ratStatus = `Rats gone; recalling ${ownedFighters.length} AutoMining fighter(s).`;
      return true;
    }
    if (!s.ratRestoreRequested && !s.droneLaunchGrant) {
      if (now < (s.nextRatRestore || 0)) return true;
      if (drones.requestGroup(session, s, scene, ship, s.ratMiningGroupKey, "ratMiners")) {
        s.ratRestoreRequested = true;
        s.ratRestoreSuccess = false;
        s.nextRatRestore = now + 15_000;
        s.ratStatus = "Rats gone; relaunching the mining group.";
      }
      return true;
    }
    if (s.ratRestoreRequested && !s.droneLaunchGrant) {
      if (s.ratRestoreSuccess) { clear(s); s.ratStatus = "Mining drone group restored."; }
      else s.ratRestoreRequested = false;
    }
    return true;
  }
  return { tick, setGroups, clear, ratsPresent };
}
module.exports = { createRatDefense };
