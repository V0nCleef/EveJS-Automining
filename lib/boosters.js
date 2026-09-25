"use strict";
const path = require("node:path");

// Native fitting and fleet runtimes remain the authority for both operations.
function createBoosters(root, { getAPI = null, state, logError = console.error, native = null }) {
  const load = name => require(path.join(root, "server/src", name));
  const fitting = () => native?.fitting || load("services/fitting/liveFittingState.js");
  const bursts = () => native?.bursts || load("space/modules/commandBurstRuntime.js");
  const fleets = () => native?.fleets || load("services/fleets/fleetRuntime.js");
  const characterID = session => Number(session.characterID || session.charid || 0);
  const safeShip = (session, scene, ship) => scene && ship?.kind === "ship" &&
    !session.stationID && !session.stationid && !ship.pendingWarp && ship.mode !== "WARP" &&
    !ship.pendingDock && !ship.dockingTargetID && !ship.cloaked && !ship.isCloaked;
  const gridFor = (scene, ship) => scene.getLivePublicGridClusterKeyForEntity?.(ship) ||
    scene.getPublicGridClusterKeyForEntity(ship);

  function miningModules(session, ship) {
    if (!ship || !characterID(session)) return [];
    const fit = fitting();
    return fit.getFittedModuleItems(characterID(session), ship.itemID)
      .filter(fit.isModuleOnline).map(item => {
        const effect = fit.getTypeEffectRecords(item.typeID)
          .find(record => bursts().resolveCommandBurstDefinition(record)?.family === "mining");
        return effect ? { item, effect } : null;
      }).filter(Boolean);
  }

  function tick(session, s, scene, ship, now) {
    if (!s.autoBoost || !safeShip(session, scene, ship)) return;
    const modules = miningModules(session, ship);
    if (!modules.length) {
      s.boostStatus = "No online mining command burst modules fitted.";
      return;
    }
    const grid = gridFor(scene, ship);
    const api = getAPI?.();
    if (!grid || api && (api.miningSite?.(scene, ship) === false ||
        !api.miningSite && !api.surveyResource?.(scene, ship, null))) {
      pause(s, scene, session, ship);
      s.boostStatus = "Waiting for a mining site before activating boosts.";
      return;
    }
    if (s.boostGrid !== grid) {
      s.boostGrid = grid;
      s.boostReadyAt = now + 5000;
    }
    if (now < s.boostReadyAt) {
      s.boostStatus = `Waiting ${Math.ceil((s.boostReadyAt - now) / 1000)}s after arrival before boosting.`;
      return;
    }
    const effects = ship.activeModuleEffects || new Map();
    let active = 0;
    for (const { item, effect } of modules) {
      if (effects.has(item.itemID)) { active++; continue; }
      if (now < (s.nextBoostAttempt?.get(item.itemID) || 0)) continue;
      if (!s.nextBoostAttempt) s.nextBoostAttempt = new Map();
      s.nextBoostAttempt.set(item.itemID, now + 10_000);
      try {
        const result = scene.activateGenericModule(session, item, effect.name);
        if (result?.success) {
          s.boostOwned.set(item.itemID, ship.activeModuleEffects?.get(item.itemID));
          active++;
        } else s.boostStatus = `Mining boost waiting: ${result?.errorMsg || "activation refused"}.`;
      } catch (error) { s.boostStatus = `Mining boost waiting: ${error.message}.`; logError(`[AutoMining] Boost activation failed: ${error.message}`); }
    }
    if (active === modules.length) s.boostStatus = `${active} mining boost module(s) active.`;
    else if (active && !s.boostStatus) s.boostStatus = `${active}/${modules.length} mining boost module(s) active.`;
  }

  function tickFleet(session, s, scene, ship, now) {
    if (!s.autoBoost || !s.inviteFleet || !s.hudReady || !safeShip(session, scene, ship) ||
        now < (s.nextFleetCheck || 0)) return;
    if (!miningModules(session, ship).length) return;
    // Run during the station undock and the hauling return, before site checks.
    s.nextFleetCheck = now + 1000;
    inviteNearby(session, s, scene, ship);
  }

  function inviteNearby(session, s, scene, ship) {
    const fleet = fleets();
    const selfID = characterID(session);
    const grid = gridFor(scene, ship);
    if (!grid || !selfID) { s.fleetStatus = "Waiting for a nearby grid before inviting pilots."; return; }
    const peers = [...scene.sessions.values()].filter(peer => {
      const peerState = state(peer);
      if (peer === session || !characterID(peer) || !peerState?.enabled || !peerState.hudReady) return false;
      const other = scene.getShipEntityForSession(peer);
      return safeShip(peer, scene, other) && gridFor(scene, other) === grid;
    });
    if (!peers.length) { s.fleetStatus = "Waiting for other AutoMining pilots on this grid."; return; }
    let current = fleet.getFleetForCharacter(selfID);
    if (!current) {
      current = fleet.createFleetRecord(session);
      fleet.initFleet(session, current.fleetID);
    }
    if (s.fleetReadySent !== current.fleetID) {
      notifyFleetReady(session, current.fleetID);
      s.fleetReadySent = current.fleetID;
    }
    let joined = 0;
    for (const peer of peers) {
      const id = characterID(peer);
      const existing = fleet.getFleetForCharacter(id);
      if (existing) { if (existing.fleetID === current.fleetID) joined++; continue; }
      // Never overwrite an unrelated pending invite. The invite and acceptance
      // happen in one server turn after the same-grid, enabled checks above.
      if (fleet.runtimeState.invitesByCharacter.has(id)) continue;
      try {
        // The native invite handler accepts and initializes FleetSvc on the
        // client. Direct server acceptance leaves its Fleet window empty.
        fleet.inviteCharacter(session, current.fleetID, id, null, null, undefined, { autoAccept: true });
      } catch (error) { logError(`[AutoMining] Fleet invite failed: ${error.message}`); }
    }
    s.fleetStatus = `${joined}/${peers.length} nearby AutoMining pilot(s) in this fleet.`;
  }

  function notifyFleetReady(session, fleetID) {
    session.sendNotification("OnAutoMiningFleetReady", "clientID", [fleetID]);
  }

  function stop(s, scene, session, ship) {
    pause(s, scene, session, ship);
    s.boostOwned.clear();
    s.nextBoostAttempt?.clear();
  }
  function pause(s, scene, session, ship) {
    if (ship && scene) for (const [id, effect] of s.boostOwned) {
      if (effect && ship.activeModuleEffects?.get(id) === effect) {
        try { scene.deactivateGenericModule(session, id, { reason: "autominingTravel", deferUntilCycle: false }); }
        catch (error) { logError(`[AutoMining] Boost deactivation failed: ${error.message}`); }
      }
      if (ship.activeModuleEffects?.get(id) !== effect) s.boostOwned.delete(id);
    }
    s.boostGrid = null; s.boostReadyAt = 0;
  }
  return { miningModules, tick, tickFleet, stop, pause };
}
module.exports = { createBoosters };
