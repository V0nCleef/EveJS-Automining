"use strict";
const path = require("node:path");
const characterID = s => Number(s?.characterID || s?.charid);

// All discovery is read-only. The client performs transfers through invCache,
// so native inventory permissions, capacity, custody and notifications apply.
function createHaulDestinations(root, load = require) {
  let runtime, stationIndex;
  function deps() {
    if (!runtime) {
      const dir = path.join(root, "server/src/services");
      runtime = {
        world: load(path.join(root, "server/src/space/worldData.js")),
        items: load(path.join(dir, "inventory/itemStore.js")),
        corps: load(path.join(dir, "corporation/corporationRuntimeState.js")),
        InvBroker: load(path.join(dir, "inventory/invBrokerService.js")),
        types: load(path.join(dir, "inventory/itemTypeRegistry.js")),
        containers: load(path.join(dir, "ship/cargoContainerRuntime.js")),
        structures: load(path.join(dir, "structure/structureState.js")),
      };
    }
    return runtime;
  }
  function station(id, session) {
    const d = deps(), world = d.world.ensureLoaded();
    const row = world.stationsById.get(Number(id));
    if (row) {
      const system = world.solarSystemsById.get(Number(row.solarSystemID)) || {};
      return { stationID: Number(row.stationID), kind: "station", name: String(row.stationName || row.itemName),
        systemID: Number(row.solarSystemID), systemName: String(row.solarSystemName || system.solarSystemName || system.name || row.solarSystemID),
        regionID: Number(row.regionID || system.regionID), regionName: String(row.regionName || system.regionName || row.regionID || system.regionID) };
    }
    // Structure names and docking rights are dynamic. Resolve them for this
    // character on demand; never put another pilot's structures in the cache.
    const structure = session && d.structures.getStructureByID(Number(id), { refresh: false });
    if (!structure || structure.destroyedAt ||
        !d.structures.canCharacterDockAtStructure(session, structure, { shipTypeID: session.shipTypeID }).success)
      throw Error("Select an existing station.");
    const system = world.solarSystemsById.get(Number(structure.solarSystemID)) || {};
    const regionID = Number(system.regionID || structure.regionID || 0);
    return { stationID: Number(structure.structureID), kind: "structure", name: String(structure.itemName || structure.name || `Structure ${id}`),
      systemID: Number(structure.solarSystemID), systemName: String(system.solarSystemName || system.name || structure.solarSystemID),
      regionID, regionName: String(system.regionName || structure.regionName || regionID || "") };
  }
  function search(query, session) {
    if (typeof query !== "string" || query.length < 2 || query.length > 200) throw Error("Enter at least two characters of the station name.");
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    if (key.length < 2) throw Error("Enter at least two characters of the station name.");
    if (!stationIndex) stationIndex = deps().world.ensureLoaded().stations.map(row => station(row.stationID));
    const structures = session ? deps().structures.listDockableStructuresForCharacter(session)
      .map(row => station(row.structureID, session)) : [];
    const choices = [...stationIndex, ...structures];
    const exact = choices.filter(row => row.name.toLowerCase() === key);
    const matches = exact.length ? exact : choices.filter(row => row.name.toLowerCase().includes(key));
    return { stations: matches.slice(0, 30), moreStations: matches.length > 30 };
  }
  function resolveStationIDs(ids, session) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 30 ||
        ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw Error("Select up to 30 valid station IDs.");
    }
    const unique = [...new Set(ids)];
    return { stations: unique.map(id => station(id, session)) };
  }
  function storages(session, stationID) {
    const target = station(stationID, session), d = deps(), ownerID = characterID(session);
    if (!(ownerID > 0)) throw Error("A character session is required.");
    const rows = [{ key: "personal", kind: "personal", label: "Personal item hangar", ownerID, locationID: target.stationID, flagID: 4 }];
    // Only assembled containers directly in the character's station hangar.
    // Cargo-container groups from the native type catalog; locked containers
    // still undergo native password/access checks when a transfer is attempted.
    for (const item of d.items.listContainerItems(ownerID, target.stationID, 4)) {
      const type = d.types.resolveItemByTypeID(item.typeID);
      if (!item.singleton || !d.containers.isCargoContainerType(item)) continue;
      rows.push({ key: `container:${item.itemID}`, kind: "container", label: `Container: ${item.itemName || type.name} (${item.itemID})`,
        ownerID, locationID: Number(item.itemID), flagID: 0 });
    }
    const corporationID = Number(session.corporationID || session.corpid);
    const office = corporationID > 0 && d.corps.getCorporationOffices(corporationID).find(o => Number(o.stationID) === target.stationID && !o.impounded);
    if (office) {
      // Match the native inventory listing rule. No Factory Manager shortcut.
      // These prototype helpers only read their argument. Avoid constructing
      // another service (its constructor registers an inventory observer).
      const broker = d.queryBroker ||= Object.create(d.InvBroker.prototype);
      const names = d.corps.getCorporationDivisionNames(corporationID);
      for (let division = 1; division <= 7; division++) {
        const flagID = 114 + division;
        if (!broker._canQueryCorporationHangarFlag(session, flagID)) continue;
        rows.push({ key: `corp:${office.officeID}:${flagID}`, kind: "corporation", label: `Corporation - ${names[division] || "Division " + division} (${division})`,
          ownerID: corporationID, locationID: Number(office.officeID), flagID });
      }
    }
    return rows;
  }
  function storage(session, stationID, key) {
    const row = storages(session, stationID).find(x => x.key === key);
    if (!row) throw Error("Selected storage is no longer available. Choose a storage destination again.");
    return row;
  }
  function cargo(session, shipID, flagID) {
    return deps().items.listContainerItems(characterID(session), shipID, flagID).filter(x => Number(x.quantity) > 0);
  }
  function totals(destination) {
    const result = {};
    for (const row of deps().items.listContainerItems(destination.ownerID, destination.locationID, destination.kind === "container" ? null : destination.flagID)) {
      result[row.typeID] = (result[row.typeID] || 0) + Math.max(0, Number(row.quantity) || 0);
    }
    return result;
  }
  return { station, search, resolveStationIDs, storages, storage, cargo, totals };
}
module.exports = { createHaulDestinations };
