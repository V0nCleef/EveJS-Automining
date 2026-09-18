"use strict";
const path = require("node:path");

function createCompression(root, load = require) {
  let runtime;
  return function compress(scene, session, ship) {
    if (!runtime) {
      const dir = path.join(root, "server/src/services");
      const Service = load(path.join(dir, "mining/inSpaceCompressionMgrService.js"));
      runtime = {
        service: new Service(),
        industry: load(path.join(dir, "mining/miningIndustry.js")),
        inventory: load(path.join(dir, "inventory/itemStore.js")),
      };
    }
    const { service, industry, inventory } = runtime;
    const items = inventory.listContainerItems(Number(session.characterID || session.charid), ship.itemID)
      .filter(item => Number(item.quantity) > 0 && industry.isCompressibleType(item.typeID) && !industry.isCompressedType(item.typeID));
    if (!items.length) return "Compression: no uncompressed resources aboard.";
    const facilities = [...(scene.dynamicEntities?.values() || [])].filter(entity => entity.kind === "ship");
    let completed = 0;
    // Bound work per tick when a hold contains many separate stacks. Native
    // service rechecks ownership, current fleet access, range and resource type.
    for (const item of items) {
      if (completed >= 16) break;
      const facility = facilities.find(entity => industry.resolveInSpaceCompressionContext(session, entity.itemID, item).success);
      if (facility && service.Handle_CompressItemInSpace([item.itemID, facility.itemID], session)) completed++;
    }
    return completed ? `Compressed ${completed} resource stack(s).` : "Compression waiting for an accessible, active compressor in range.";
  };
}
module.exports = { createCompression };
