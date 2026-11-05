"use strict";
const path = require("node:path");
const DRONE_BAY_FLAG = 87;
const DRONE_CATEGORY_ID = 18;

// The native client can only read the drone bay while in space. The server
// inventory is authoritative in both states, so the settings screen asks here
// for the item IDs of the active ship's bay instead of guessing from saved
// group names.
function createDroneBay(root, { native = null } = {}) {
  const projection = () => native || require(path.join(root, "server/src/services/inventory/simulationInventoryProjection.js"));
  return function droneBay(session) {
    const shipID = Number(session?.shipID || session?.shipid || 0);
    if (!(shipID > 0)) return { shipID: 0, itemIDs: [] };
    let rows = [];
    try { rows = projection().listContainerItems(null, shipID, DRONE_BAY_FLAG) || []; }
    catch (error) { return { shipID, itemIDs: [], error: String(error && error.message || error).slice(0, 200) }; }
    const itemIDs = rows
      // Native assembled drones have singleton=1, quantity=-1, stacksize=1.
      // A negative encoded quantity does not mean the bay is empty.
      .filter(row => Number(row.singleton) === 1 || Number(row.quantity) > 0)
      .filter(row => !row.categoryID || Number(row.categoryID) === DRONE_CATEGORY_ID)
      .map(row => Number(row.itemID))
      .filter(id => id > 0);
    const quantities = {};
    for (const row of rows) {
      const id = Number(row.itemID);
      if (!itemIDs.includes(id)) continue;
      quantities[id] = Number(row.singleton) === 1 ? 1 : Math.max(1, Number(row.quantity) || 1);
    }
    return { shipID, itemIDs, ...(Object.values(quantities).some(n => n > 1) ? { quantities } : {}) };
  };
}

module.exports = { createDroneBay, DRONE_BAY_FLAG, DRONE_CATEGORY_ID };
