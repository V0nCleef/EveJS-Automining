"use strict";
const path = require("node:path");

// Coordinate idle miners only. Inventory moves, client notifications and reload
// timers are owned by the same native service used by manual crystal changes.
function createCrystalManager(getOperations) {
  return function update({ api, scene, session, ship, state: s, modules, rocks, now }) {
    if (!api.crystalPlan || !s.ores.length) return false;
    s.crystalRetry ||= new Map();
    let waiting = false;
    const messages = [];
    for (const m of modules) {
      const id = m.item.itemID;
      if (ship.activeModuleEffects?.has(id)) continue;
      const ops = getOperations();
      if (ops.pending(id)) { waiting = true; messages.push("Waiting for native crystal reload."); continue; }
      const plan = api.crystalPlan(scene, ship, m, rocks, now, s.approach);
      if (!plan) continue;
      const key = `${ship.itemID}:${JSON.stringify(s.ores)}:${plan.loadedID}:${plan.chargeID || 0}`;
      const retry = s.crystalRetry.get(id);
      if (retry?.key === key && now < retry.at) { waiting = true; messages.push(retry.message); continue; }
      let message;
      try {
        if (plan.chargeID) {
          ops.load(session, ship.itemID, id, plan.chargeID);
          const loaded = api.loadedCrystal(ship, m);
          if (!ops.pending(id) && Number(loaded?.typeID) !== plan.chargeTypeID) throw Error("Native crystal loading was refused; check cargo and module state.");
          message = "Loading a compatible mining crystal.";
        } else {
          ops.unload(session, ship.itemID, id);
          if (api.loadedCrystal(ship, m)) throw Error("Cannot unload the incompatible crystal; check free cargo space.");
          message = "No compatible crystal in cargo; incompatible crystal unloaded. Mining without a crystal.";
        }
        // Refresh native snapshots next tick before choosing targets/activating.
        s.replan = true; s.nextModuleCheck = 0; s.nextSearch = 0;
      } catch (error) {
        message = `Crystal change: ${error.message}`;
      }
      s.crystalRetry.set(id, { key, at: now + 5000, message });
      messages.push(message); waiting = true;
    }
    s.crystalStatus = [...new Set(messages)].join(" ");
    return waiting;
  };
}

function nativeCrystalOperations(root) {
  let ops;
  return () => {
    if (ops) return ops;
    const Service = require(path.join(root, "server/src/services/dogma/dogmaService.js"));
    const service = new Service();
    // Read without calling _getPendingModuleReload: that helper may delete an
    // expired entry before the native timer has applied its inventory change.
    if (typeof Service._testing?.getPendingModuleReloads !== "function") throw Error("Native crystal reload tracking is unavailable.");
    ops = {
      pending: id => Service._testing.getPendingModuleReloads().has(id),
      load: (session, ship, module, charge) => service.Handle_LoadAmmo([ship, [module], [charge], ship], session),
      unload: (session, ship, module) => service.Handle_UnloadAmmo([ship, [module], ship], session),
    };
    return ops;
  };
}
module.exports = { createCrystalManager, nativeCrystalOperations };
