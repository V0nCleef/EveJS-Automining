"use strict";

// Claims contain only rock IDs. Every ship still builds its own candidate list
// with its own position, range, filter and target priority.
function targetClaims(scene, session, rocks, players, { ownLasers = false, ownDrones = false } = {}) {
  const available = new Set(rocks.map(rock => rock.id));
  const claimed = new Set();
  for (const pilot of scene.sessions?.values?.() || []) {
    const self = pilot === session;
    if (self && !ownLasers && !ownDrones) continue;
    const state = players.get(pilot);
    if (!state?.enabled || state.haul || state.pausedForWarp || state.scene !== scene) continue;
    const ship = scene.getShipEntityForSession(pilot);
    if (!ship || ship.itemID !== state.shipID || ship.mode === "WARP" || ship.pendingWarp ||
        ship.pendingDock || ship.dockingTargetID) continue;
    if (!self || ownLasers) {
      for (const id of state.assignments.values()) if (available.has(id)) claimed.add(id);
    }
    if (!self || ownDrones) {
      for (const id of state.mineAssignments.values()) if (available.has(id)) claimed.add(id);
    }
  }
  return claimed;
}

module.exports = { targetClaims };
