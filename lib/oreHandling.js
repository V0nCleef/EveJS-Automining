"use strict";
const path = require("node:path");
const RANGE = 2500;
function createOreHandling(root, { save = () => "", native = null, logError = console.error } = {}) {
  let runtime;
  function deps() {
    if (native) return native;
    if (runtime) return runtime;
    const load = name => require(path.join(root, "server/src", name));
    const items = load("services/inventory/itemStore.js"), types = load("services/inventory/itemTypeRegistry.js");
    const InvBroker = load("services/inventory/invBrokerService.js"), jet = load("services/ship/jettisonRuntime.js"), space = load("space/runtime.js");
    function broker(session, id) {
      // Native inventory binding validates access. Only allocation of a network
      // bound-object token is omitted for this synchronous internal operation.
      const b = Object.create(InvBroker.prototype); b._boundContexts = new Map();
      let context = null;
      b._getBoundContext = () => context;
      b._makeBoundSubstruct = value => { context = value; return value; };
      b.Handle_GetInventoryFromId([id], session, {});
      return b;
    }
    runtime = { list: (session, id, flag) => items.listContainerItems(Number(session.characterID || session.charid), id, flag),
      classify: row => load("services/mining/miningInventory.js").classifyMiningMaterialType(row),
      type: id => types.resolveItemByTypeID(id), can: id => items.findItemById(id),
      simTime: session => space.getSimulationTimeMsForSession(session, Date.now()),
      jettison: (session, ids) => jet.jettisonItemsForSession(session, ids),
      move: (session, can, ship, ids, quantity) => quantity == null ? broker(session, can).Handle_MultiAdd([ids, ship], session, { flag: 0 }) : broker(session, can).Handle_Add([ids[0], ship], session, { flag: 0, qty: quantity }),
      seed: (session, ship, row, flag, quantity) => {
        if (quantity >= qty(row)) return row.itemID;
        const before = new Set(items.listContainerItems(Number(session.characterID || session.charid), ship, flag).map(item => item.itemID));
        broker(session, ship).Handle_Add([row.itemID, ship], session, { flag, qty: quantity });
        const split = items.listContainerItems(Number(session.characterID || session.charid), ship, flag).find(item => !before.has(item.itemID) && item.typeID === row.typeID && Number(item.quantity) === quantity);
        if (!split) throw Error("Native ore stack split could not be confirmed.");
        return split.itemID;
      },
      stack: (session, ship, flag) => broker(session, ship).Handle_StackAll([flag], session, {}),
      capacity: (session, id, flag) => Object.fromEntries(broker(session, id).Handle_GetCapacity([flag], session, {}).args.entries),
      abandon: (session, id) => {
        const result = space.abandonInventoryLootForSession(session, [id]);
        if (!result?.data?.abandoned?.includes(id) && !space.getSceneForSession(session)?.getEntityByID(id)?.lootAbandoned) throw Error("Native jetcan abandonment was refused.");
        return result;
      } };
    return runtime;
  }
  const qty = row => Math.max(0, Number(row.quantity || row.stacksize) || 0);
  function resource(row) {
    const type = deps().type(row.typeID);
    // Native classification includes compressed ore and excludes ice, gas,
    // crystals, charges and ice products.
    return deps().classify ? deps().classify(type)?.kind === "ore" : Number(type?.categoryID) === 25 && ![465, 903, 2022, 519, 4094, 4714].includes(Number(type?.groupID));
  }
  function view(s) { return { status: s.oreStatus || "", can: s.jettisonCan || null, info: s.jettisonInfo || "", jettisonEvent: s.jettisonEvent || null, stackEvent: s.stackEvent || null }; }
  function quantityOf(session, locationID, flagID, typeID) {
    return deps().list(session, locationID, flagID).filter(row => Number(row.typeID) === Number(typeID)).reduce((sum, row) => sum + qty(row), 0);
  }
  function completed(s, kind, now, details) {
    s.oreEventSerial = (s.oreEventSerial || 0) + 1;
    s[kind + "Event"] = { id: now + ":" + s.oreEventSerial, at: now, ...details };
  }
  function duplicates(rows) {
    const seen = new Set(); let count = 0;
    for (const row of rows) if (!row.singleton && qty(row) > 0) { if (seen.has(row.typeID)) count++; else seen.add(row.typeID); }
    return count;
  }
  function usable(session, s, scene, ship) {
    const id = Number(s.jettisonCan?.containerID || s.jettisonCan);
    if (!id || s.jettisonCan?.shipID && s.jettisonCan.shipID !== ship.itemID || s.jettisonCan?.systemID && s.jettisonCan.systemID !== scene.systemID) return null;
    const can = deps().can(id), entity = scene.getEntityByID?.(id);
    if (!can || !entity || Number(can.typeID) !== 23 || Number(can.locationID) !== Number(scene.systemID)) return null;
    const now = deps().simTime?.(session) ?? Date.now();
    if (Number(can.expiresAtMs || entity.expiresAtMs) > 0 && Number(can.expiresAtMs || entity.expiresAtMs) <= now) return null;
    if (!entity.position || Math.hypot(entity.position.x - ship.position.x, entity.position.y - ship.position.y, entity.position.z - ship.position.z) > RANGE) return null;
    const cap = deps().capacity(session, id, 0);
    return cap.capacity > cap.used ? { id, free: cap.capacity - cap.used } : null;
  }
  function jettison(session, s, scene, ship, hold, now, { manual = false } = {}) {
    if (!hold?.flagID || !ship || ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock || ship.dockingTargetID || ship.cloaked || ship.isCloaked || s.haul) return view(s);
    if (now < (s.nextJettison || 0) && !s.jettisonCooldownWaiting) { s.oreStatus = "Waiting for the native jettison cooldown."; return view(s); }
    let transferred = 0;
    const waiting = () => transferred > 0 ? "Ore transferred to the existing jetcan. Waiting for the native jettison cooldown." : "Waiting for the native jettison cooldown.";
    try {
      const n = deps(), rows = n.list(session, ship.itemID, hold.flagID).filter(row => qty(row) > 0 && resource(row));
      if (!rows.length) { s.oreStatus = "No ore to jettison."; return view(s); }
      function fillExisting(can, rows) {
        // Native Add enforces range, permissions and capacity for each
        // bounded whole or partial stack transfer.
        for (const row of rows) {
          const unit = Number(n.type(row.typeID)?.volume);
          if (!(unit > 0)) continue;
          const quantity = Math.min(qty(row), Math.floor((can.free + 1e-8) / unit));
          if (!quantity) { can = null; break; }
          const beforeShip = quantityOf(session, ship.itemID, hold.flagID, row.typeID);
          const beforeCan = quantityOf(session, can.id, 0, row.typeID);
          n.move(session, can.id, ship.itemID, [row.itemID], quantity);
          const verified = Math.min(beforeShip - quantityOf(session, ship.itemID, hold.flagID, row.typeID), quantityOf(session, can.id, 0, row.typeID) - beforeCan);
          if (!(verified > 0)) throw Error("Native ore transfer could not be confirmed.");
          transferred += verified;
          completed(s, "jettison", now, { containerID: can.id, quantity: transferred });
          can = usable(session, s, scene, ship);
          if (!can) break;
        }
        return can;
      }
      let can = usable(session, s, scene, ship);
      if (can) {
        if (s.jettisonAbandon && !s.jettisonCan.abandoned) { n.abandon(session, can.id); s.jettisonCan.abandoned = true; if (save(session, s)) throw Error("Could not save jetcan abandonment."); }
        can = fillExisting(can, rows);
        const remaining = n.list(session, ship.itemID, hold.flagID).filter(row => qty(row) > 0 && resource(row));
        if (!remaining.length) { s.oreStatus = "Ore transferred to the existing jetcan."; return view(s); }
        // Do not replace a usable can just because a large stack needs splitting.
        if (can) { s.oreStatus = "Jetcan has insufficient room for the remaining ore stack."; return view(s); }
      }
      if (s.jettisonCooldownWaiting && now < (s.nextJettison || 0)) { s.oreStatus = waiting(); return view(s); }
      const current = n.list(session, ship.itemID, hold.flagID).filter(row => qty(row) > 0 && resource(row));
      const until = Number(session._jettisonCooldownUntilMs) || 0;
      const simNow = n.simTime?.(session) ?? now;
      if (until > simNow) { s.jettisonCooldownWaiting = true; s.nextJettison = now + until - simNow; s.oreStatus = waiting(); return view(s); }
      const canCapacity = Number(n.type(23)?.capacity);
      if (!(canCapacity > 0)) throw Error("Native jetcan capacity is unavailable.");
      const seed = current.find(row => Number(n.type(row.typeID)?.volume) > 0 && Number(n.type(row.typeID).volume) <= canCapacity);
      if (!seed) throw Error("No ore unit fits in a native jetcan.");
      const seedQuantity = Math.min(qty(seed), Math.floor(canCapacity / Number(n.type(seed.typeID).volume)));
      const seedID = seedQuantity < qty(seed) ? n.seed(session, ship.itemID, seed, hold.flagID, seedQuantity) : seed.itemID;
      const beforeShip = quantityOf(session, ship.itemID, hold.flagID, seed.typeID);
      const result = n.jettison(session, [seedID]);
      if (result?.errorMsg === "JETTISON_COOLDOWN") {
        s.jettisonCooldownWaiting = true;
        s.nextJettison = now + Math.max(1000, Number(result.retryAfterMs) || 180000);
        s.oreStatus = waiting(); return view(s);
      }
      if (!result?.containerID || !result.jettisonedToCanIDs?.length) throw Error(result?.errorMsg || "Native jettison failed.");
      const verified = Math.min(beforeShip - quantityOf(session, ship.itemID, hold.flagID, seed.typeID), quantityOf(session, Number(result.containerID), 0, seed.typeID));
      if (!(verified > 0)) throw Error("Native jettison inventory transfer could not be confirmed.");
      transferred += verified;
      completed(s, "jettison", now, { containerID: Number(result.containerID), quantity: transferred });
      s.jettisonCooldownWaiting = false;
      s.jettisonCan = { containerID: Number(result.containerID), shipID: ship.itemID, systemID: scene.systemID, abandoned: false };
      if (save(session, s)) throw Error("Could not save the tracked jetcan.");
      if (s.jettisonAbandon) { n.abandon(session, s.jettisonCan.containerID); s.jettisonCan.abandoned = true; if (save(session, s)) throw Error("Could not save jetcan abandonment."); }
      // Creation merely seeds one bounded stack. Fill the same new can now,
      // even if the seed lowered the hold below its automatic threshold.
      const remaining = n.list(session, ship.itemID, hold.flagID).filter(row => qty(row) > 0 && resource(row));
      const newCan = usable(session, s, scene, ship);
      if (newCan && remaining.length) fillExisting(newCan, remaining);
      const left = n.list(session, ship.itemID, hold.flagID).some(row => qty(row) > 0 && resource(row));
      s.oreStatus = left || result.notJettisonedIDs?.length ? "Some ore could not be jettisoned." : "Ore jettisoned; this can will be reused.";
      s.jettisonInfo = s.jettisonAbandon ? "Jetcan is public. Other pilots can take its contents." : "Jetcan expires two hours after creation.";
    } catch (error) { s.jettisonCooldownWaiting = false; s.nextJettison = now + 10000; s.oreStatus = `Jettison paused: ${error.message}`; logError(`[AutoMining] ${s.oreStatus}`); }
    return view(s);
  }
  function tick(session, s, scene, ship, hold, now) {
    if (now >= (s.nextStackCheck || 0)) {
      s.nextStackCheck = now + 5000;
      for (const flag of [...new Set([...(s.stackOreHold !== false && hold?.flagID ? [hold.flagID] : []), ...(s.stackFleetHangar !== false ? [155] : [])])]) {
        try {
          const rows = deps().list(session, ship.itemID, flag).filter(row => !row.singleton && qty(row) > 0);
          const before = duplicates(rows);
          if (before > 0 && (flag !== 155 || deps().capacity(session, ship.itemID, flag).capacity > 0)) {
            deps().stack(session, ship.itemID, flag);
            const reduced = before - duplicates(deps().list(session, ship.itemID, flag));
            if (reduced > 0) completed(s, "stack", now, { flagID: flag, merged: reduced });
          }
        } catch (error) { logError(`[AutoMining] Automatic stacking paused: ${error.message}`); }
      }
    }
    if ((!s.job || s.job === "mining") && s.oreMode === "jettison" && hold?.full && now >= (s.nextOreJettisonCheck || 0)) {
      s.nextOreJettisonCheck = now + 5000;
      jettison(session, s, scene, ship, hold, now);
    }
    return view(s);
  }
  return { tick, jettison, view };
}
module.exports = { createOreHandling };
