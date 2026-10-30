"use strict";
const crypto = require("node:crypto");
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// Return to the working area, not a centimetre-perfect parking spot. Stop once
// inside this radius and let native braking finish without another correction.
const RETURN_RADIUS = 1000;
const STOPPED_SPEED = 0.5;
const speed = ship => Math.hypot(ship.velocity?.x || 0, ship.velocity?.y || 0, ship.velocity?.z || 0);
const movementPending = (scene, ship) => scene?.hasQueuedMovementChange?.(ship) === true;
const stationID = s => Number(s.structureID || s.structureid || s.stationID || s.stationid || 0);
const shipID = s => Number(s.shipID || s.shipid || 0);
// A saved public-space coordinate is not a route through an acceleration gate.
const instanced = (session, scene, ship) => Boolean(ship?.dungeonCurrentInstanceID ||
  session.spaceInstanceID || session._space?.instanceID || scene?.instanceID);
const ownsApproach = (op, ship) => op.moving === "approach" && ship?.itemID === op.shipID &&
  ship.mode === "GOTO" && ship.targetPoint && distance(ship.targetPoint, op.origin) < 1;
const landingPending = (session, ship) => {
  const handoff = session._space?.pilotWarpVisibilityHandoff;
  return handoff?.landingPending === true && String(handoff.shipID) === String(ship.itemID);
};
const LABELS = { outbound: "Autopilot to unload station.", unloading: "Docked; unloading ore hold.",
  resupplying: "Docked; restocking Heavy Water.", undocking: "Transfer confirmed; undocking.", inbound: "Autopilot back to mining system.", returning: "Returning to saved mining position." };

function createHauling({ destinations, getSpace, save, resetMining, clock = Date.now, onBegin = () => {} }) {
  function rememberOrigin(session, s, scene, ship, { force = false, persist = true } = {}) {
    if (!s.enabled || s.haul || !scene || !ship || stationID(session) ||
        ship.pendingWarp || ship.mode === "WARP" || landingPending(session, ship) || instanced(session, scene, ship)) return;
    force ||= s.miningAnchorAfterWarp === true;
    const same = s.miningAnchor?.systemID === scene.systemID && s.miningAnchorShipID === ship.itemID && s.miningAnchorScene === scene;
    if (!force && same && !s.miningAnchorNeedsUpdate) return;
    // A manual order marks the origin dirty, but never anchors the first metre
    // of that move. Remember the final location once the pilot has stopped.
    if (!force && s.miningAnchorNeedsUpdate && (ship.mode !== "STOP" || speed(ship) > STOPPED_SPEED)) return;
    const point = { x: Number(ship.position?.x), y: Number(ship.position?.y), z: Number(ship.position?.z) };
    if (!(scene.systemID > 0) || !Object.values(point).every(Number.isFinite)) return;
    s.miningAnchor = { systemID: scene.systemID, ...point };
    s.miningAnchorShipID = ship.itemID; s.miningAnchorScene = scene; s.miningAnchorNeedsUpdate = false; s.miningAnchorAfterWarp = false;
    if (persist) save(session, s);
  }
  function canMine(session, s, scene, ship) {
    const op = s.haul;
    return Boolean(s.enabled && s.job === "mining" && op?.phase === "returning" &&
      scene?.systemID === op.origin.systemID && ship?.itemID === op.shipID &&
      !instanced(session, scene, ship) && !ship.pendingWarp && ship.mode !== "WARP" && !landingPending(session, ship) && !movementPending(scene, ship) &&
      (ownsApproach(op, ship) || op.arrived && ship.mode === "STOP"));
  }
  function cancel(session, s, reason = "Return trip cancelled.") {
    const op = s.haul;
    s.haul = null; s.haulInterrupted = false; s.enabled = false;
    s.haulStatus = reason; s.status = reason;
    if (op?.retreat) s.defenseStatus = reason;
    save(session, s);
    if (op) {
      // Stop only our own final subwarp approach; never cancel an unrelated order.
      const space = getSpace(), scene = space.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (ownsApproach(op, ship)) scene.stop(session);
      try { session.sendNotification("OnAutoMiningHaul", "clientID", [JSON.stringify({ cancel: op.id })]); } catch {}
    }
  }
  function view(s) {
    const op = s.haul;
    return op ? { id: op.id, phase: op.phase, status: LABELS[op.phase], shipID: op.shipID,
      station: op.station, storage: op.storage, origin: op.origin, flagID: op.flagID,
      purpose: op.purpose || "ore", fuel: op.phase === "resupplying" ? op.fuelPlan : null, items: op.phase === "unloading" ? op.items.map(i => ({ itemID: i.itemID, typeID: i.typeID, quantity: i.quantity })) : [] }
      : { phase: "idle", status: s.haulStatus || (s.haulEnabled ? `Armed - waiting for ore hold to reach ${s.haulThreshold || 95}%.` : "Automatic hauling is off.") };
  }
  function begin(session, s, scene, ship, hold, options = {}) {
    const retreat = options.retreat === true;
    const fuel = options.purpose === "fuel" && options.fuel;
    if (s.haul || !s.enabled || (!retreat && !fuel && (!s.haulEnabled || !hold?.full))) return false;
    if (!s.haulClientReady) { cancel(session, s, "Hauling paused: reconnect with the updated AutoMining client companion."); return true; }
    try {
      const target = destinations.station(fuel ? fuel.stationID : s.stationID, session);
      const storage = destinations.storage(session, target.stationID, fuel ? fuel.storageKey : s.storageKey);
      if (instanced(session, scene, ship)) throw Error("Automatic return from an instanced or gated site is not supported. Hauling has not started.");
      const point = { x: Number(ship.position?.x), y: Number(ship.position?.y), z: Number(ship.position?.z) };
      if (!Object.values(point).every(Number.isFinite) || !(scene.systemID > 0)) throw Error("Cannot save the current mining position.");
      // Only explicit pilot movement changes an established origin. Neither a
      // return's braking drift nor automatic ore approaches move this anchor.
      const previous = s.miningAnchor;
      const origin = previous?.systemID === scene.systemID && !s.miningAnchorNeedsUpdate
        ? previous : { systemID: scene.systemID, ...point };
      const op = { id: crypto.randomUUID(), phase: "outbound", shipID: ship.itemID, station: target, storage,
        purpose: fuel ? "fuel" : retreat ? "defense" : "ore", fuel: fuel ? { ...fuel } : null,
        storageKey: fuel ? fuel.storageKey : s.storageKey, unloadKey: s.storageKey,
        retreat, retreatLayer: retreat ? options.layer : null,
        flagID: fuel && (!s.haulEnabled || target.stationID !== s.stationID) ? null : hold?.flagID || null, holdUsed: Number(hold?.used || 0),
        origin: { ...origin }, started: clock(), changed: clock(), heartbeat: clock() };
      // Persist an interruption marker BEFORE allowing client navigation.
      s.haulInterrupted = true;
      s.miningAnchor = { ...origin };
      s.miningAnchorShipID = ship.itemID; s.miningAnchorScene = scene; s.miningAnchorNeedsUpdate = false; s.miningAnchorAfterWarp = false;
      if (save(session, s)) throw Error("Could not save return-trip safety state.");
      resetMining(session, s);
      s.haul = op; s.haulStatus = "";
      onBegin(session, s, options);
      s.surveyStatus = ""; s.compressionStatus = "";
      session.sendNotification("OnAutoMiningHaul", "clientID", [JSON.stringify(view(s))]);
    } catch (error) { cancel(session, s, `Hauling paused: ${error.message}`); }
    return true;
  }
  function phase(op, value) { op.phase = value; op.changed = clock(); op.moving = null; }
  function observe(session, s) {
    const op = s.haul;
    if (!op) return false;
    if (clock() - op.heartbeat > 45_000 || clock() - op.started > 7_200_000) {
      cancel(session, s, "Hauling paused: client or trip timeout. Click Start / Resume to retry."); return true;
    }
    if (shipID(session) && shipID(session) !== op.shipID) { cancel(session, s, "Hauling cancelled after ship change."); return true; }
    const docked = stationID(session), scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
    if (docked && docked !== op.station.stationID) { cancel(session, s, "Hauling paused: docked at a different station."); return true; }
    if (op.phase === "outbound" && docked === op.station.stationID) {
      op.storage = destinations.storage(session, op.station.stationID, op.fuel && op.flagID ? op.unloadKey : op.storageKey);
      op.items = op.flagID ? destinations.cargo(session, op.shipID, op.flagID) : [];
      if (!op.items.length && op.retreat) {
        cancel(session, s, op.holdUsed > 0
          ? "Defense retreat reached station; ore transfer could not be confirmed. AutoMining is off."
          : "Defense retreat complete. Docked; AutoMining is off.");
        return true;
      }
      if (!op.items.length && op.fuel) {
        op.fuelPlan = destinations.fuelPlan(session, op.shipID, op.fuel);
        op.storage = op.fuelPlan.source || op.storage;
        phase(op, "resupplying");
      } else {
        if (!op.items.length) throw Error("Ore hold was emptied before arrival; unload cannot be confirmed.");
        op.before = destinations.totals(op.storage);
        phase(op, "unloading");
      }
    } else if (op.phase === "undocking" && !docked && ship?.itemID === op.shipID) {
      // Wait at least 3 seconds after undock completes before transitioning to inbound/warp.
      // This prevents the ship from being launched immediately upon docking/undocking completion.
      if (!op.undockedAt) op.undockedAt = clock();
      if (clock() - op.undockedAt >= 3000) phase(op, "inbound");
    } else if (op.phase === "inbound" && scene?.systemID === op.origin.systemID && ship?.itemID === op.shipID && !ship.pendingWarp && ship.mode !== "WARP") phase(op, "returning");
    if (["unloading", "resupplying", "undocking", "returning"].includes(op.phase) && clock() - op.changed > 300_000) {
      cancel(session, s, "Hauling paused: unload, undock or return-position timeout."); return true;
    }
    s.status = LABELS[op.phase];
    return true;
  }
  function action(session, s, id, action, reason) {
    const op = s.haul;
    if (!op || op.id !== id) throw Error("Return trip is no longer active.");
    op.heartbeat = clock();
    if (action === "cancel") { cancel(session, s, reason || "Return trip cancelled."); return view(s); }
    observe(session, s);
    if (!s.haul) return view(s);
    if (action === "unloaded") {
      if (op.unloadConfirmed) return view(s);
      if (op.phase !== "unloading" || stationID(session) !== op.station.stationID) throw Error("Not ready to confirm unloading.");
      const selected = destinations.storage(session, op.station.stationID, op.fuel ? op.unloadKey : s.storageKey, op.storage);
      if (selected.key !== op.storage.key || destinations.cargo(session, op.shipID, op.flagID).length) throw Error("Ore remains in the hold. The ship will stay docked.");
      const expected = { ...op.before }, actual = destinations.totals(selected);
      for (const item of op.items) expected[item.typeID] = (expected[item.typeID] || 0) + Number(item.quantity);
      for (const typeID of new Set(op.items.map(i => i.typeID))) if ((actual[typeID] || 0) < expected[typeID]) throw Error("Could not confirm ore in the selected storage. The ship will stay docked.");
      op.unloadConfirmed = true;
      if (op.retreat) {
        cancel(session, s, "Defense retreat complete. Ore unloaded; AutoMining is off.");
        return view(s);
      }
      if (op.fuel) { op.fuelPlan = destinations.fuelPlan(session, op.shipID, op.fuel); op.storage = op.fuelPlan.source || op.storage; phase(op, "resupplying"); }
      else phase(op, "undocking");
    } else if (action === "resupplied") {
      if (op.phase !== "resupplying" || stationID(session) !== op.station.stationID) throw Error("Not ready to confirm Heavy Water restocking.");
      destinations.storage(session, op.station.stationID, op.fuel.storageKey);
      if (destinations.fuelQuantity(session, op.shipID, op.fuel.typeID) < op.fuelPlan.requiredUnits) throw Error("Heavy Water transfer could not be confirmed. The ship will stay docked.");
      phase(op, "undocking");
    } else if (action === "position") {
      if (op.phase !== "returning") throw Error("Not ready to return to the saved position.");
      const space = getSpace(), scene = space.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (scene?.systemID !== op.origin.systemID || ship?.itemID !== op.shipID) throw Error("Ship is not in the saved mining system.");
      if (instanced(session, scene, ship)) throw Error("Ship is in a different mining instance. Return cancelled.");
      // Native subwarp still refuses movement after WARP ends while the
      // pilot's landing visibility handoff is pending. Keep the trip alive.
      if (ship.pendingWarp || ship.mode === "WARP" || landingPending(session, ship)) {
        return view(s);
      }
      // 261028.1 accepts movement now and applies it at the next Destiny tick.
      // A successful Stop reply is a queued order, not proof of arrival. Keep
      // navigation owned until it has applied; repeated polls must not queue
      // another Stop or overwrite a later manual order.
      if (movementPending(scene, ship)) return view(s);
      if (op.arrived || op.moving === "stopping") {
        if (ship.mode !== "STOP") throw Error("Return movement changed manually.");
        op.arrived = true; op.moving = "arrived";
        return { ...view(s), atOrigin: true };
      }
      const remaining = distance(ship.position, op.origin);
      if (remaining <= RETURN_RADIUS) {
        if (!ownsApproach(op, ship) && ship.mode !== "STOP") throw Error("Return movement changed manually.");
        if (!scene.stop(session)) return view(s);
        op.moving = "stopping";
        if (movementPending(scene, ship) || ship.mode !== "STOP") return view(s);
        op.arrived = true; op.moving = "arrived";
        return { ...view(s), atOrigin: true };
      }
      if (!op.moving || (op.moving === "approach" && ship.mode === "STOP") ||
          (op.moving === "warp" && remaining < 150000)) {
        const warp = remaining >= 150000;
        // Native warp cancels jump cloak itself and enforces fitted cloak rules.
        const result = warp ? space.warpToPoint(session, op.origin, { minimumRange: 0 }) : space.gotoPoint(session, op.origin);
        if (result?.errorMsg === "WARP_LANDING_PENDING") return view(s);
        if (!result || result.success === false) throw Error(result?.errorMsg || "Return movement was rejected.");
        op.moving = warp ? "warp" : "approach";
      }
    } else if (action === "complete") {
      const scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (op.phase !== "returning" || scene?.systemID !== op.origin.systemID || ship?.itemID !== op.shipID ||
          instanced(session, scene, ship) || ship.pendingWarp || ship.mode === "WARP" || landingPending(session, ship) ||
          !op.arrived || ship.mode !== "STOP" || movementPending(scene, ship)) throw Error("Mining position has not been reached.");
      s.haul = null; s.haulInterrupted = false; s.haulStatus = "Returned to mining position; mining resumed.";
      s.scene = scene; s.shipID = ship.itemID; s.pausedForWarp = false; s.replan = true; s.next = 0; s.nextSearch = 0;
      s.nextSurvey = 0; s.nextCompression = 0; s.nextModuleCheck = 0;
      s.miningAnchorShipID = ship.itemID; s.miningAnchorScene = scene; s.miningAnchorNeedsUpdate = false; s.miningAnchorAfterWarp = false;
      if (save(session, s)) { s.enabled = false; throw Error("Could not save trip completion. Mining paused."); }
    } else if (action !== "poll") throw Error("Unknown return-trip action.");
    return view(s);
  }
  function escalateDefense(session, s, scene, ship, hold, options = {}) {
    const old = s.haul;
    if (!old || old.retreat) return false;
    // Invalidate the old token before notifying the client. Its stale transfer,
    // undock and completion acknowledgements can no longer advance this trip.
    s.haul = null;
    try { session.sendNotification("OnAutoMiningHaul", "clientID", [JSON.stringify({ cancel: old.id })]); } catch {}
    return begin(session, s, scene, ship, hold, { retreat: true, layer: options.layer });
  }
  return { begin, observe, cancel, view, action, escalateDefense, rememberOrigin, canMine };
}
module.exports = { createHauling };
