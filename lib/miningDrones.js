"use strict";
const path = require("node:path");
const { matchesOre } = require("./commands");
const { createOrePriority } = require("./orePriority");

function createMiningDrones(root, { getAPI, pendingDeparture, claimedTargets = () => new Set(), native = null, logError = console.error }) {
  const runtime = () => native || require(path.join(root, "server/src/services/drone/droneRuntime.js"));
  function tick(session, s, scene, ship, now, defending = false) {
    if (!s.enabled || !s.mineDrones || defending || s.haul || pendingDeparture(session) ||
        !ship || ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock || ship.dockingTargetID ||
        session.stationID || session.stationid) { s.mineAssignments?.clear(); return; }
    const api = getAPI();
    if (!api?.surveyGrid?.(scene, ship)) { s.mineAssignments?.clear(); return; }
    const native = runtime();
    const owned = s.miningDroneIDs || new Set();
    if (!owned.size) { s.mineAssignments?.clear(); s.mineDroneStatus = "Waiting for the selected mining group to launch."; return; }
    const active = [...owned].map(id => scene.getEntityByID(id)).filter(drone =>
      native.isDroneEntity(drone) && Number(drone.controllerID) === ship.itemID &&
      Number(drone.ownerID) === s.characterID && drone.droneCommand !== native.DRONE_COMMAND_RETURN_BAY &&
      !s.mineIncompatibleIDs?.has(drone.itemID));
    if (!active.length) { s.mineAssignments?.clear(); s.mineDroneStatus = "No AutoMining mining drones available in space."; return; }

    // Keep valid orders without rescanning the belt or repeating native RPCs.
    const occupied = new Set(), idle = [];
    const assignments = s.mineAssignments ||= new Map();
    assignments.clear();
    for (const drone of active) {
      const rock = !s.mineReplan && drone.droneCommand === native.DRONE_COMMAND_MINE &&
        api.target(scene, ship, Number(drone.targetID));
      if (rock && rock.state?.yieldKind === "ore" && matchesOre(rock.name, s.ores)) {
        occupied.add(rock.id);
        assignments.set(drone.itemID, rock.id);
      }
      else if (drone.droneCommand === native.DRONE_COMMAND_RETURN_HOME) continue;
      else idle.push(drone);
    }
    if (!idle.length) {
      s.mineDroneStatus = `${active.length} mining drone(s) have orders.`;
      return;
    }
    if (now < (s.nextMineScan || 0)) return;
    s.mineReplan = false;
    // One full field scan per pilot per ten seconds at most; one sorted list
    // serves every drone. Character-based offset spreads multi-client scans.
    s.nextMineScan = now + 10_000 + s.characterID % 1500;
    const rocks = api.candidates(scene, ship).filter(rock =>
      rock.state?.yieldKind === "ore" && matchesOre(rock.name, s.ores));
    const claimed = claimedTargets(scene, session, rocks);
    rocks.sort(createOrePriority(s.ores, s.mineDroneOrder, { claimed }));
    if (!rocks.length) { s.mineDroneStatus = "No filtered ore on this mining grid."; return; }
    let ordered = 0;
    for (const drone of idle) {
      const rock = s.mineDroneMode === "focus" ? rocks[0]
        : rocks.find(candidate => !occupied.has(candidate.id)) || rocks[0];
      try {
        const result = native.commandMineRepeatedly(session, [drone.itemID], rock.id);
        if (result?.type === "dict" && Array.isArray(result.entries) && !result.entries.length) {
          ordered++;
          occupied.add(rock.id);
          assignments.set(drone.itemID, rock.id);
        } else if (JSON.stringify(result?.entries || []).match(/no supported mining profile|cannot mine the selected resource/i)) {
          (s.mineIncompatibleIDs ||= new Set()).add(drone.itemID);
        }
      } catch (error) { logError(`[AutoMining] Mining drone order failed: ${error.message}`); }
    }
    s.mineDroneStatus = ordered ? `Mining orders sent to ${ordered} drone(s) (${s.mineDroneMode}).`
      : "Mining drones could not accept an ore target; checking again shortly.";
  }
  function reset(s) {
    s.miningDroneIDs = new Set();
    s.mineIncompatibleIDs = new Set();
    s.mineAssignments?.clear();
    s.nextMineScan = 0;
  }
  return { tick, reset };
}
module.exports = { createMiningDrones };
