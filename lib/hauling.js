"use strict";
const crypto = require("node:crypto");
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const RETURN_RADIUS = 10;
const SETTLED_SPEED = 0.5;
const SETTLE_MS = 2000;
const ANCHOR_REUSE_RADIUS = 25;
const speed = ship => Math.hypot(ship.velocity?.x || 0, ship.velocity?.y || 0, ship.velocity?.z || 0);
const stationID = s => Number(s.structureID || s.structureid || s.stationID || s.stationid || 0);
const shipID = s => Number(s.shipID || s.shipid || 0);
// A saved public-space coordinate is not a route through an acceleration gate.
const instanced = (session, scene, ship) => Boolean(ship?.dungeonCurrentInstanceID ||
  session.spaceInstanceID || session._space?.instanceID || scene?.instanceID);
const ownsApproach = (op, ship) => op.moving === "approach" && ship?.itemID === op.shipID &&
  ship.mode === "GOTO" && ship.targetPoint && distance(ship.targetPoint, op.origin) < 1;
const LABELS = { outbound: "Autopilot to unload station.", unloading: "Docked; unloading ore hold.",
  undocking: "Unload confirmed; undocking.", inbound: "Autopilot back to mining system.", returning: "Returning to saved mining position." };

function createHauling({ destinations, getSpace, save, resetMining, clock = Date.now }) {
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
      items: op.phase === "unloading" ? op.items.map(i => ({ itemID: i.itemID, typeID: i.typeID, quantity: i.quantity })) : [] }
      : { phase: "idle", status: s.haulStatus || (s.haulEnabled ? `Armed - waiting for ore hold to reach ${s.haulThreshold || 95}%.` : "Automatic hauling is off.") };
  }
  function begin(session, s, scene, ship, hold, options = {}) {
    const retreat = options.retreat === true;
    if (s.haul || !s.enabled || (!retreat && (!s.haulEnabled || !hold?.full))) return false;
    if (!s.haulClientReady) { cancel(session, s, "Hauling paused: reconnect with the updated AutoMining client companion."); return true; }
    try {
      const target = destinations.station(s.stationID, session);
      const storage = destinations.storage(session, s.stationID, s.storageKey);
      if (instanced(session, scene, ship)) throw Error("Automatic return from an instanced or gated site is not supported. Hauling has not started.");
      const point = { x: Number(ship.position?.x), y: Number(ship.position?.y), z: Number(ship.position?.z) };
      if (!Object.values(point).every(Number.isFinite) || !(scene.systemID > 0)) throw Error("Cannot save the current mining position.");
      // Reuse the exact belt coordinate after a completed trip. A small
      // landing error must never become the next trip's starting point.
      const previous = s.miningAnchor;
      const origin = previous?.systemID === scene.systemID && distance(previous, point) <= ANCHOR_REUSE_RADIUS
        ? previous : { systemID: scene.systemID, ...point };
      const op = { id: crypto.randomUUID(), phase: "outbound", shipID: ship.itemID, station: target, storage,
        retreat, retreatLayer: retreat ? options.layer : null,
        flagID: hold?.flagID || null, holdUsed: Number(hold?.used || 0),
        origin: { ...origin }, started: clock(), changed: clock(), heartbeat: clock() };
      // Persist an interruption marker BEFORE allowing client navigation.
      s.haulInterrupted = true;
      s.miningAnchor = { ...origin };
      if (save(session, s)) throw Error("Could not save return-trip safety state.");
      resetMining(session, s);
      s.haul = op; s.haulStatus = "";
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
      op.storage = destinations.storage(session, op.station.stationID, s.storageKey);
      op.items = op.flagID ? destinations.cargo(session, op.shipID, op.flagID) : [];
      if (!op.items.length && op.retreat) {
        cancel(session, s, op.holdUsed > 0
          ? "Defense retreat reached station; ore transfer could not be confirmed. AutoMining is off."
          : "Defense retreat complete. Docked; AutoMining is off.");
        return true;
      }
      if (!op.items.length) throw Error("Ore hold was emptied before arrival; unload cannot be confirmed.");
      op.before = destinations.totals(op.storage);
      phase(op, "unloading");
    } else if (op.phase === "undocking" && !docked && ship?.itemID === op.shipID) {
      // Wait at least 3 seconds after undock completes before transitioning to inbound/warp.
      // This prevents the ship from being launched immediately upon docking/undocking completion.
      if (!op.undockedAt) op.undockedAt = clock();
      if (clock() - op.undockedAt >= 3000) phase(op, "inbound");
    } else if (op.phase === "inbound" && scene?.systemID === op.origin.systemID && ship?.itemID === op.shipID && !ship.pendingWarp && ship.mode !== "WARP") phase(op, "returning");
    if (["unloading", "undocking", "returning"].includes(op.phase) && clock() - op.changed > 300_000) {
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
      const selected = destinations.storage(session, op.station.stationID, s.storageKey);
      if (selected.key !== op.storage.key || destinations.cargo(session, op.shipID, op.flagID).length) throw Error("Ore remains in the hold. The ship will stay docked.");
      const expected = { ...op.before }, actual = destinations.totals(selected);
      for (const item of op.items) expected[item.typeID] = (expected[item.typeID] || 0) + Number(item.quantity);
      for (const typeID of new Set(op.items.map(i => i.typeID))) if ((actual[typeID] || 0) < expected[typeID]) throw Error("Could not confirm ore in the selected storage. The ship will stay docked.");
      op.unloadConfirmed = true;
      if (op.retreat) {
        cancel(session, s, "Defense retreat complete. Ore unloaded; AutoMining is off.");
        return view(s);
      }
      phase(op, "undocking");
    } else if (action === "position") {
      if (op.phase !== "returning") throw Error("Not ready to return to the saved position.");
      const space = getSpace(), scene = space.getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (scene?.systemID !== op.origin.systemID || ship?.itemID !== op.shipID) throw Error("Ship is not in the saved mining system.");
      if (instanced(session, scene, ship)) throw Error("Ship is in a different mining instance. Return cancelled.");
      if (ship.pendingWarp || ship.mode === "WARP") return view(s);
      const remaining = distance(ship.position, op.origin);
      const currentSpeed = speed(ship);
      if (remaining <= RETURN_RADIUS && ownsApproach(op, ship)) {
        if (scene.stop(session)) { op.moving = "settling"; op.settledAt = null; }
        return view(s);
      }
      if (remaining <= RETURN_RADIUS && currentSpeed <= SETTLED_SPEED) {
        if (op.settledAt == null) op.settledAt = clock();
        return clock() - op.settledAt >= SETTLE_MS ? { ...view(s), atOrigin: true } : view(s);
      }
      op.settledAt = null;
      // Let a ship slow down before correcting any overshoot from Stop.
      if (op.moving === "settling" && currentSpeed > SETTLED_SPEED) return view(s);
      if (!op.moving || op.moving === "settling" || (op.moving === "approach" && ship.mode === "STOP") ||
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
          instanced(session, scene, ship) || ship.pendingWarp || ship.mode === "WARP" ||
          distance(ship.position, op.origin) > RETURN_RADIUS || speed(ship) > SETTLED_SPEED ||
          op.settledAt == null || clock() - op.settledAt < SETTLE_MS) throw Error("Mining position has not been reached.");
      s.haul = null; s.haulInterrupted = false; s.haulStatus = "Returned to mining position; mining resumed.";
      s.scene = scene; s.shipID = ship.itemID; s.pausedForWarp = false; s.replan = true; s.next = 0; s.nextSearch = 0;
      s.nextSurvey = 0; s.nextCompression = 0; s.nextModuleCheck = 0;
      if (save(session, s)) { s.enabled = false; throw Error("Could not save trip completion. Mining paused."); }
    } else if (action !== "poll") throw Error("Unknown return-trip action.");
    return view(s);
  }
  return { begin, observe, cancel, view, action };
}
module.exports = { createHauling };
