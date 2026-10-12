"use strict";
const { MAX_ORE_FILTERS, validSurveySeconds } = require("./settings");
const { ORDERS } = require("./targets");
const MINING_FIELDS = ["lock", "approach", "order", "survey", "compress", "surveySeconds"];
const DRONE_FIELDS = ["mineDroneOrder", "mineDroneMode"];

// Orders are deliberately ephemeral. Saved ore lists and job profiles remain
// personal, even if a pilot changes another setting while receiving an order.
function createFleetCommand({ getFleet, getSession, isFleetBoss, characterName, state, command, stopFleet, reset, catalog, now = Date.now }) {
  const overrides = new WeakMap(), histories = new WeakMap(), throttles = new WeakMap();
  let serial = 0;
  const idOf = session => Number(session?.characterID || session?.charid);
  const nameOf = (id, session, record) => String(characterName?.(id) || session?.characterName ||
    record?.name || record?.characterName || "").slice(0, 100);
  function authorized(session) {
    const id = idOf(session), fleet = getFleet?.(id);
    if (!fleet || !(fleet.members instanceof Map) || !fleet.members.has(id) || isFleetBoss?.(fleet, id) !== true)
      throw Error("Fleet Command is available only to the current fleet leader.");
    return { id, fleet };
  }
  function member(fleet, id) {
    const session = getSession?.(id);
    return session && !session.socket?.destroyed && idOf(session) === id &&
      fleet.members.has(id) && getFleet(id) === fleet ? session : null;
  }
  function active(session, s) {
    const order = overrides.get(session);
    if (!order) return null;
    if (s.job !== order.job || idOf(session) !== order.recipient || member(order.fleet, order.recipient) !== session ||
        member(order.fleet, order.leader) !== order.sender || isFleetBoss(order.fleet, order.leader) !== true) {
      overrides.delete(session);
      reset(session, s, Object.keys(order.values));
      return null;
    }
    return order;
  }
  function effective(session, s) { return active(session, s)?.values.ores || s.ores; }
  function mining(session, s) {
    const values = active(session, s)?.values;
    return Object.fromEntries(MINING_FIELDS.map(key => [key, values && Object.hasOwn(values, key) ? values[key] : s[key]]));
  }
  function drones(session, s) {
    const values = active(session, s)?.values;
    return Object.fromEntries(DRONE_FIELDS.map(key => [key, values && Object.hasOwn(values, key) ? values[key] : s[key]]));
  }
  function notice(session, s = state(session)) {
    const order = active(session, s);
    return order ? { leader: nameOf(order.leader, order.sender), values: { ...order.values,
      ...(order.values.ores ? { ores: [...order.values.ores] } : {}) } } : null;
  }
  function clear(session, s = state(session), leaderStopped = false) {
    const own = overrides.get(session);
    if (overrides.delete(session)) reset(session, s, Object.keys(own.values));
    if (leaderStopped) {
      const fleet = getFleet?.(idOf(session));
      for (const id of fleet?.members?.keys() || []) {
        const target = member(fleet, id), order = target && overrides.get(target);
        if (order?.sender === session) { overrides.delete(target); reset(target, state(target), Object.keys(order.values)); }
      }
    }
  }
  function sourceAuthorized(session) {
    if (!notice(session)) authorized(session);
  }
  function view(session, includeCatalog = false) {
    const { id, fleet } = authorized(session);
    const pilots = [...fleet.members.keys()].map(characterID => {
      const current = member(fleet, characterID), s = current && state(current);
      const ores = s && effective(current, s), override = current && overrides.get(current);
      const record = fleet.members.get(characterID);
      return { characterID, name: nameOf(characterID, current, record),
        online: !!current, job: s?.job || null, enabled: !!s?.enabled,
        status: s?.status || "", ores: ores ? [...ores] : [], personalOres: s ? [...s.ores] : [],
        override: !!override, overridden: Object.keys(override?.values || {}), mining: s ? mining(current, s) : null,
        drones: s ? drones(current, s) : null,
        orderID: override?.orderID || null, leader: characterID === id };
    });
    return { leaderID: id, fleetID: fleet.fleetID, pilots, orders: histories.get(fleet) || [],
      ...(includeCatalog ? { catalog: catalog() } : {}) };
  }
  function action(session, request) {
    const { id, fleet } = authorized(session);
    if (!request || !["filter", "mining", "drones", "restore", "restoreMining", "restoreDrones", "start", "stop", "recall"].includes(request.action) ||
        !Array.isArray(request.pilots) || !request.pilots.length || request.pilots.length > 256 ||
        request.pilots.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(request.pilots).size !== request.pilots.length)
      throw Error("Invalid fleet order.");
    let ores, miningSettings, droneSettings;
    if (request.action === "drones") {
      const p = request.settings;
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== DRONE_FIELDS.length ||
          Object.keys(p).some(key => !DRONE_FIELDS.includes(key)) ||
          !ORDERS.includes(p.mineDroneOrder) || !["focus", "spread"].includes(p.mineDroneMode))
        throw Error("Choose valid fleet drone targeting settings.");
      droneSettings = Object.fromEntries(DRONE_FIELDS.map(key => [key, p[key]]));
    }
    if (request.action === "mining") {
      const p = request.settings;
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== MINING_FIELDS.length ||
          Object.keys(p).some(key => !MINING_FIELDS.includes(key)) ||
          ["lock", "approach", "survey", "compress"].some(key => typeof p[key] !== "boolean") ||
          !ORDERS.includes(p.order) || !validSurveySeconds(p.surveySeconds)) throw Error("Choose valid fleet mining settings.");
      miningSettings = Object.fromEntries(MINING_FIELDS.map(key => [key, p[key]]));
    }
    if (request.action === "filter") {
      const known = new Set(catalog().map(row => row.name.toLowerCase()));
      if (!Array.isArray(request.ores) || !request.ores.length || request.ores.length > MAX_ORE_FILTERS ||
          request.ores.some(ore => typeof ore !== "string" || !known.has(ore))) throw Error("Choose a valid fleet ore filter.");
      ores = [...new Set(request.ores)];
    }
    const time = now();
    if (time - (throttles.get(session) ?? -Infinity) < 1000) throw Error("Wait a moment before sending another fleet order.");
    throttles.set(session, time);
    const orderID = ++serial, results = [];
    for (const recipient of request.pilots) {
      // Recheck on each recipient: Stop can itself change fleet membership.
      const still = authorized(session);
      if (still.fleet !== fleet) throw Error("The fleet changed; refresh Fleet Command.");
      const target = member(fleet, recipient), s = target && state(target);
      let result = "offline", detail = "";
      if (!fleet.members.has(recipient)) result = "notMember";
      else if (target) {
        try {
          if (["filter", "mining", "restore", "restoreMining"].includes(request.action) && s.job !== "mining") result = "notMiner";
          else if (["drones", "restoreDrones"].includes(request.action) && !["mining", "boosting"].includes(s.job)) result = "notDroneMiner";
          else if (["filter", "mining", "drones"].includes(request.action)) {
            const previous = active(target, s);
            const changes = ores ? { ores: [...ores] } : miningSettings || droneSettings;
            const values = { ...(previous?.values || {}), ...changes };
            overrides.set(target, { fleet, sender: session, leader: id, recipient, job: s.job, values, orderID });
            reset(target, s, Object.keys(changes));
            result = request.action === "filter" ? "applied" : request.action === "drones" ? "dronesApplied" : "miningApplied";
          } else if (["restore", "restoreMining", "restoreDrones"].includes(request.action)) {
            const previous = active(target, s), values = { ...(previous?.values || {}) };
            const fields = request.action === "restore" ? ["ores"] : request.action === "restoreDrones" ? DRONE_FIELDS : MINING_FIELDS;
            for (const key of fields) delete values[key];
            if (Object.keys(values).length) overrides.set(target, { ...previous, values, orderID });
            else overrides.delete(target);
            reset(target, s, fields); result = "restored";
          } else if (request.action === "start") {
            detail = command(target, { action: "on" }); result = s.enabled ? "started" : "refused";
          } else {
            const recalled = stopFleet(session, [recipient], request.action === "recall");
            if (request.action === "stop") clear(target, s);
            result = recalled.recallFailed ? "recallFailed" : request.action === "stop" ? (s.enabled ? "refused" : "stopped") : "recalled";
            detail = String(recalled.recallOrdered);
          }
        } catch (error) { result = "failed"; detail = String(error.message).slice(0, 200); }
      }
      results.push({ characterID: recipient, name: nameOf(recipient, target, fleet.members.get(recipient)), result, detail });
    }
    const order = { orderID, at: time, action: request.action, leaderID: id, ores, settings: miningSettings || droneSettings, results };
    histories.set(fleet, [order, ...(histories.get(fleet) || [])].slice(0, 25));
    return { ...view(session), order };
  }
  return { authorized, sourceAuthorized, view, action, effective, mining, drones, notice, clear };
}
module.exports = { createFleetCommand };
