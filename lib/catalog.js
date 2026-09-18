"use strict";
const path = require("node:path");
function createCatalog(root, load = require) {
  let cached;
  return () => {
    if (cached) return cached;
    const dir = path.join(root, "server/src/services");
    const { TABLE, readStaticRows } = load(path.join(dir, "_shared/referenceData.js"));
    const { classifyMiningMaterialType } = load(path.join(dir, "mining/miningInventory.js"));
    const { isCompressedType } = load(path.join(dir, "mining/miningStaticData.js"));
    const names = new Map();
    for (const type of readStaticRows(TABLE.ITEM_TYPES)) {
      if (type.published === false || isCompressedType(type.typeID)) continue;
      const material = classifyMiningMaterialType(type);
      const name = String(type.name || "").trim();
      // Legacy Batch Compressed and some newer SDE products have no reverse
      // compression mapping. Match the word anywhere, not just the prefix.
      if (material && name && !/\bcompressed\b/i.test(name) && Number(type.groupID) !== 4168)
        names.set(name.toLowerCase(), { name, kind: material.kind });
    }
    cached = [...names.values()].sort((a,b) => a.name.localeCompare(b.name));
    return cached;
  };
}
module.exports = { createCatalog };
