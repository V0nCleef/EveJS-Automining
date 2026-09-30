"use strict";
const MESSAGES = Object.freeze({
  mining: "Mining started.", warp: "Mining paused for warp.", outbound: "Returning to station.",
  unloading: "Docked; unloading ore.", resupplying: "Docked; restocking Heavy Water.",
  undocking: "Transfer complete; undocking.", inbound: "Returning to the mining site.",
  resumed: "Mining resumed at the saved position.", fuelComplete: "Fuel restocking complete.",
  oreComplete: "Ore unloading complete.", stackComplete: "Inventory stacks merged.", jettisonComplete: "Ore jettison complete.",
  fuelReserve: "Heavy Water reserve reached.", defenseShield: "Defense retreat: low shield.",
  defenseArmor: "Defense retreat: low armor.", coreWaiting: "Waiting for industrial core cycle before departure.",
  manualCore: "Manual industrial core active; stop it before departure.",
  coreActive: "Industrial core activated.", compressorActive: "Asteroid ore compressor activated.",
  boostsActive: "Mining boosts activated.", dronesReturned: "Drones recalled before departure.",
  failure: "AutoMining action failed: %s"
});
function normalizeEvent(raw, urgent = false) {
  if (typeof raw === "string") raw = { key: Object.hasOwn(MESSAGES, raw) ? raw : Object.keys(MESSAGES).find(k => MESSAGES[k] === raw), urgent };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(MESSAGES, raw.key)) return null;
  const args = raw.args ?? [];
  if (!Array.isArray(args) || args.length > 1 || args.some(a => typeof a !== "string" || a.length > 300 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(a))) return null;
  if (raw.key === "failure" ? args.length !== 1 : args.length !== 0) return null;
  if (raw.id !== undefined && (typeof raw.id !== "string" || raw.id.length > 96)) return null;
  return { key: raw.key, message: MESSAGES[raw.key], args, urgent: raw.urgent === true || urgent === true, id: raw.id || "" };
}
function createActivity({ clock = Date.now, routineInterval = 10000 } = {}) {
  const records = new WeakMap();
  function record(s) {
    let r = records.get(s);
    if (!r) { r = { seen: new Map(), pending: new Map(), next: 0, phase: "", mining: false, core: false, compressor: false, boost: false }; records.set(s, r); }
    return r;
  }
  function enabled(s) { return s.enabled === true && s.hudReady === true && s.actionNotifications !== false; }
  const pendingKey = event => ["outbound", "unloading", "resupplying", "undocking", "inbound"].includes(event.key) ? "tripPhase" : event.key;
  function deliver(session, r, event, now) {
    const signature = JSON.stringify([event.args, event.id]);
    if (r.seen.get(event.key) === signature) return false;
    try {
      session.sendNotification("OnAutoMiningActivity", "clientID", [JSON.stringify({ version: 1, key: event.key, message: event.message,
        args: event.args, urgent: event.urgent, enabled: true, characterID: Number(session.characterID || session.charid || 0) })]);
    } catch { return false; }
    r.seen.set(event.key, signature); r.pending.delete(pendingKey(event));
    if (!event.urgent) r.next = now + routineInterval;
    return true;
  }
  function emit(session, s, raw, urgent = false) {
    if (!enabled(s)) { records.delete(s); return false; }
    const event = normalizeEvent(raw, urgent); if (!event) return false;
    const r = record(s), now = clock();
    if (r.seen.get(event.key) === JSON.stringify([event.args, event.id])) return false;
    if (!event.urgent && now < r.next) {
      if (r.pending.size >= 12 && !r.pending.has(pendingKey(event))) r.pending.delete(r.pending.keys().next().value);
      r.pending.set(pendingKey(event), event); return false;
    }
    return deliver(session, r, event, now);
  }
  function observe(session, s, snapshot = s) {
    if (!enabled(s)) { records.delete(s); return; }
    const r = record(s), now = clock();
    const defense = String(snapshot.defenseStatus || s.defenseStatus || "");
    if (/^Defense retreat: low armor\./.test(defense)) emit(session, s, "defenseArmor", true);
    else if (/^Defense retreat: low shield\./.test(defense)) emit(session, s, "defenseShield", true);
    const industrial = snapshot.industrial || s.industrialSnapshot || {};
    const coreStatus = industrial.status || s.departureStatus || snapshot.status || s.status;
    if (coreStatus === MESSAGES.manualCore) emit(session, s, "manualCore", true);
    else if ([industrial.status, s.departureStatus, snapshot.status, s.status].includes(MESSAGES.coreWaiting)) emit(session, s, "coreWaiting", true);
    if (industrial.fuel?.needsRestock) emit(session, s, "fuelReserve", true);
    const trip = snapshot.trip || s.haul || {};
    if (trip.phase && trip.phase !== r.phase && Object.hasOwn(MESSAGES, trip.phase))
      emit(session, s, { key: trip.phase, id: String(trip.id || "") });
    r.phase = trip.phase || "";
    const status = String(snapshot.status || s.status || "");
    if (/^Paused for warp/.test(status)) { emit(session, s, "warp"); r.mining = false; r.seen.delete("mining"); }
    else if (/^Mining with \d+ module/.test(status) && !r.mining) { emit(session, s, "mining"); r.mining = true; }
    for (const kind of ["core", "compressor"]) {
      if (!r[kind] && industrial.modules?.some(m => m.kind === kind && m.active)) { emit(session, s, `${kind}Active`); r[kind] = true; }
    }
    if (!r.boost && /\d+ mining boost module\(s\) active\./.test(String(snapshot.boostStatus || s.boostStatus || ""))) {
      emit(session, s, "boostsActive"); r.boost = true;
    }
    if (r.pending.size && now >= r.next) deliver(session, r, r.pending.values().next().value, now);
  }
  return { observe, emit };
}
module.exports = { createActivity, normalizeEvent, MESSAGES };



