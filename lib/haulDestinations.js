"use strict";
const path = require("node:path");
const crypto = require("node:crypto");
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
      if (Number(item.singleton) !== 1 || !d.containers.isCargoContainerType(item)) continue;
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
      const visited = new Set();
      for (let division = 1; division <= 7; division++) {
        const flagID = 114 + division;
        if (!broker._canQueryCorporationHangarFlag(session, flagID)) continue;
        rows.push({ key: `corp:${office.officeID}:${flagID}`, kind: "corporation", label: `Corporation - ${names[division] || "Division " + division} (${division})`,
          ownerID: corporationID, locationID: Number(office.officeID), flagID });
        // Read only the selected corporation's queryable division. Ancestry
        // is part of the key so a moved container cannot silently become a
        // different destination under the pilot's saved selection.
        function discover(locationID, parentContainerIDs = [], directFlag = null) {
          if (parentContainerIDs.length >= 8 || visited.size >= 256) return;
          for (const item of d.items.listContainerItems(corporationID, locationID, directFlag)) {
            const id = Number(item.itemID);
            if (visited.has(id) || visited.size >= 256 || Number(item.ownerID) !== corporationID ||
                Number(item.locationID) !== Number(locationID) || directFlag !== null && Number(item.flagID) !== directFlag ||
                Number(item.singleton) !== 1 || !d.containers.isCargoContainerType(item)) continue;
            visited.add(id);
            const chain = [...parentContainerIDs, id];
            const ancestry = { corporationID, officeID: Number(office.officeID), stationID: target.stationID,
              divisionFlagID: flagID, containerIDs: chain };
            let key = `corpcontainer:${office.officeID}:${flagID}:${chain.join(":")}`;
            if (key.length > 100) key = `corpcontainer:${id}:${crypto.createHash("sha256").update(JSON.stringify(ancestry)).digest("hex").slice(0, 24)}`;
            const type = d.types.resolveItemByTypeID(item.typeID);
            rows.push({ key, kind: "container", scope: "corporation", ancestry,
              label: `Corporation - ${names[division] || "Division " + division} / ${item.itemName || type?.name || id} (${id})`,
              ownerID: corporationID, locationID: id, flagID: 0 });
            discover(id, chain);
          }
        }
        discover(Number(office.officeID), [], flagID);
      }
    }
    return rows;
  }
  function storage(session, stationID, key, expected = null) {
    const row = storages(session, stationID).find(x => x.key === key);
    if (!row) throw Error("Selected storage is no longer available. Choose a storage destination again.");
    if (expected && (expected.key !== row.key || expected.ownerID !== row.ownerID || expected.locationID !== row.locationID ||
        expected.flagID !== row.flagID || JSON.stringify(expected.ancestry || null) !== JSON.stringify(row.ancestry || null)))
      throw Error("Selected storage is no longer available. Choose a storage destination again.");
    return row;
  }
  function cargo(session, shipID, flagID) {
    // Fleet hangar deposits retain depositor custody; native listing counts all owners.
    const ownerID = Number(flagID) === 155 ? null : characterID(session);
    return deps().items.listContainerItems(ownerID, shipID, flagID).filter(x => Number(x.quantity) > 0);
  }
  function totals(destination) {
    // Native generic containers are addressed by location, not item owner.
    // Custody can preserve corporation or depositor ownership inside them.
    const result = {};
    for (const row of deps().items.listContainerItems(destination.kind === "container" ? null : destination.ownerID, destination.locationID, destination.kind === "container" ? null : destination.flagID)) {
      const quantity = Math.max(0, Number(row.quantity) || 0);
      if (quantity > 0) result[row.typeID] = (result[row.typeID] || 0) + quantity;
    }
    return result;
  }

  function fuelQuantity(session, shipID, typeID) {
    const d = deps();
    return [133, 5].reduce((sum, flag) => sum + d.items.listContainerItems(characterID(session), shipID, flag)
      .filter(row => Number(row.typeID) === Number(typeID)).reduce((n, row) => n + Math.max(0, Number(row.quantity) || 0), 0), 0);
  }
  function fuelPlan(session, shipID, fuel) {
    if (!Number.isSafeInteger(fuel.targetUnits) || !Number.isSafeInteger(fuel.reserveUnits) || !Number.isSafeInteger(fuel.perCycle) ||
        fuel.perCycle <= 0 || fuel.reserveUnits < 0 || fuel.targetUnits < fuel.reserveUnits + fuel.perCycle)
      throw Error("Fuel refill target must exceed the reserve by at least one core cycle. Ship will stay docked.");
    const source = storage(session, fuel.stationID, fuel.storageKey);
    const type = deps().types.resolveItemByTypeID(fuel.typeID), volume = Number(type?.volume);
    if (!(volume > 0)) throw Error("Heavy Water volume is unavailable.");
    const before = fuelQuantity(session, shipID, fuel.typeID);
    let needed = Math.max(0, Math.floor(fuel.targetUnits - before));
    const broker = Object.create(deps().InvBroker.prototype); broker._boundContexts = new Map();
    let context = null; broker._getBoundContext = () => context;
    broker._makeBoundSubstruct = value => { context = value; return value; };
    broker.Handle_GetInventoryFromId([shipID], session, {});
    const allocations = [];
    for (const flagID of [133, ...(fuel.useCargo ? [5] : [])]) {
      const info = Object.fromEntries(broker.Handle_GetCapacity([flagID], session, {}).args.entries);
      const quantity = Math.min(needed, Math.max(0, Math.floor((info.capacity - info.used + 1e-8) / volume)));
      if (quantity) allocations.push({ flagID, quantity });
      needed -= quantity;
    }
    const rows = deps().items.listContainerItems(source.kind === "container" ? null : source.ownerID, source.locationID, source.kind === "container" ? null : source.flagID)
      .filter(row => Number(row.typeID) === Number(fuel.typeID) && Number(row.quantity) > 0 && !row.singleton);
    const transfers = []; let rowIndex = 0, usedFromRow = 0;
    for (const allocation of allocations) {
      let remaining = allocation.quantity;
      while (remaining > 0 && rowIndex < rows.length) {
        const row = rows[rowIndex], quantity = Math.min(remaining, Number(row.quantity) - usedFromRow);
        if (quantity > 0) transfers.push({ itemID: row.itemID, sourceLocationID: source.locationID, quantity, flagID: allocation.flagID });
        remaining -= quantity; usedFromRow += quantity;
        if (usedFromRow >= Number(row.quantity)) { rowIndex++; usedFromRow = 0; }
      }
    }
    const requiredUnits = before + transfers.reduce((sum, row) => sum + row.quantity, 0);
    const minimum = fuel.reserveUnits + fuel.perCycle;
    if (requiredUnits < minimum) throw Error("Not enough accessible Heavy Water or ship capacity above the fuel reserve. Ship will stay docked.");
    return { source, transfers, typeID: fuel.typeID, before, requiredUnits, targetUnits: fuel.targetUnits };
  }
  return { station, search, resolveStationIDs, storages, storage, cargo, totals, fuelQuantity, fuelPlan };
}
module.exports = { createHaulDestinations };
