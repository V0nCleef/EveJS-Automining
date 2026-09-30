"use strict";
const path = require("node:path");
const CORE_EFFECTS = new Set([4575, 8119]);
const ORE_COMPRESSOR_TYPES = new Set([62622, 62625, 62632]);
const TYPE_NAMES = { 62590: "Medium Industrial Core I", 62591: "Medium Industrial Core II", 58945: "Large Industrial Core I", 58950: "Large Industrial Core II", 28583: "Capital Industrial Core I", 42890: "Capital Industrial Core II", 62622: "Medium Asteroid Ore Compressor I", 62625: "Large Asteroid Ore Compressor I", 62632: "Capital Asteroid Ore Compressor I" };
const characterID = session => Number(session?.characterID || session?.charid || 0);
function defaultIntervalSeconds(durationMs) {
  const value = Number(durationMs) / 1000;
  return Number.isFinite(value) && value > 0 ? value : null;
}
function validateIntervalSeconds(value, durationMs) {
  const number = Number(value), minimum = defaultIntervalSeconds(durationMs);
  if (!minimum || !Number.isFinite(number) || number < minimum || number > 86400)
    throw Error(`Activation interval must be between ${minimum || 1} and 86400 seconds.`);
  return number;
}
function createIndustrialAutomation(root, { native = null, getAPI = null, logError = console.error } = {}) {
  const loaded = {};
  const dep = (name, file) => native?.[name] || (loaded[name] ||= require(path.join(root, "server/src", file)));
  const fitting = () => dep("fitting", "services/fitting/liveFittingState.js");
  const attributes = () => dep("attributes", "space/runtime/moduleAttributes.js");
  const dogma = () => dep("dogma", "space/runtime/entityDogmaView.js");
  const fuels = () => dep("fuels", "space/modules/genericModuleFuelRuntime.js");
  const records = new WeakMap();
  function record(s, ship) {
    let r = records.get(s);
    if (!r || r.ship !== ship) {
      r = { ship, owned: new Map(), lastStart: new Map(), retry: new Map(), departing: false, status: "", readAt: -Infinity, fuelReadAt: -Infinity, fuelQuantity: 0, modules: [] };
      records.set(s, r);
    }
    return r;
  }
  function modules(session, s, ship, now) {
    if (!ship || ship.kind !== "ship" || !characterID(session)) return [];
    const r = record(s, ship);
    if (now - r.readAt < 1000) return r.modules;
    const fit = fitting(), view = dogma();
    const fitted = fit.getFittedModuleItems(characterID(session), ship.itemID);
    const shipItem = view.getEntityRuntimeShipItem(ship);
    r.modules = fitted.flatMap(item => {
      const effect = fit.getTypeEffectRecords(item.typeID).find(e => CORE_EFFECTS.has(Number(e.effectID)) ||
        ORE_COMPRESSOR_TYPES.has(Number(item.typeID)) && Number(e.effectID) === 8364);
      if (!effect) return [];
      const attrs = attributes().getGenericModuleRuntimeAttributes(characterID(session), shipItem, item, null, null,
        { skillMap: view.getEntityRuntimeSkillMap(ship), fittedItems: fitted });
      if (!attrs || !(attrs.durationMs > 0)) return [];
      const kind = CORE_EFFECTS.has(Number(effect.effectID)) ? "core" : "compressor";
      const durationSeconds = defaultIntervalSeconds(attrs.durationMs);
      const configured = (kind === "core" ? s.coreIntervals : s.compressorIntervals)?.[item.typeID];
      let intervalSeconds = durationSeconds;
      if (configured !== undefined) {
        // Fitting bonuses can change since the preference was saved. Preserve
        // the setting, but never permit a schedule shorter than the live cycle.
        try { intervalSeconds = validateIntervalSeconds(configured, attrs.durationMs); }
        catch { intervalSeconds = durationSeconds; }
      }
      return [{ item, effect, attrs, kind, durationSeconds, intervalSeconds, online: fit.isModuleOnline(item) }];
    });
    r.readAt = now;
    return r.modules;
  }
  function active(ship, id) { return ship?.activeModuleEffects?.get(id); }
  function owns(r, ship, id) { return r.owned.has(id) && r.owned.get(id) === active(ship, id); }
  function deferOwned(session, r, scene, ship, kind = null) {
    for (const [id, owned] of r.owned) {
      if (active(ship, id) !== owned) { r.owned.delete(id); continue; }
      const isCore = CORE_EFFECTS.has(Number(owned.effectID));
      if (kind && (isCore ? "core" : "compressor") !== kind) continue;
      if (owned.deactivateAtMs > 0) continue;
      try { scene.deactivateGenericModule(session, id, { reason: "autominingIndustrialTravel", deferUntilCycle: true }); }
      catch (error) { r.status = `Industrial shutdown waiting: ${error.message}`; logError(`[AutoMining] ${r.status}`); }
    }
  }
  function travelBlocked(ship) {
    return [...(ship?.activeModuleEffects?.values() || [])].some(e => CORE_EFFECTS.has(Number(e.effectID)));
  }
  function requestDeparture(session, s, scene, ship, now) {
    if (!ship || !scene) return true;
    const r = record(s, ship); r.departing = true;
    deferOwned(session, r, scene, ship);
    if (travelBlocked(ship)) {
      r.status = [...ship.activeModuleEffects.entries()].some(([id, e]) => CORE_EFFECTS.has(Number(e.effectID)) && !owns(r, ship, id))
        ? "Manual industrial core active; stop it before departure."
        : "Waiting for industrial core cycle before departure.";
      return false;
    }
    return true;
  }
  function stop(session, s, scene, ship, now) { return requestDeparture(session, s, scene, ship, now); }
  function resume(s, ship) { if (ship) { const r = record(s, ship); r.departing = false; r.readAt = -Infinity; r.fuelReadAt = -Infinity; } }
  function snapshot(session, s, scene, ship, now) {
    const r = ship ? record(s, ship) : null;
    const list = modules(session, s, ship, now);
    const core = list.find(m => m.kind === "core");
    let fuel = { typeID: 16272, quantity: 0, perCycle: 0, cycles: 0, reserveUnits: 0, targetUnits: 0, needsRestock: false,
      stationID: Number(s.fuelStationID || 0), storageKey: s.fuelStorageKey || "personal", useCargo: s.fuelUseCargo === true };
    if (core) {
      const typeID = Number(core.attrs.fuelTypeID || 16272);
      const perCycle = Math.max(0, Math.round(Number(core.attrs.fuelPerActivation) || 0));
      if (now - r.fuelReadAt >= 1000) {
        const stacks = fuels().getFuelStacksForShipStorage(ship, typeID, { resolveCharacterID: () => characterID(session) });
        r.fuelQuantity = fuels().getFuelQuantityFromStacks(stacks); r.fuelReadAt = now;
      }
      const quantity = r.fuelQuantity;
      const reserveUnits = perCycle * Math.max(1, Number(s.fuelReserveCycles) || 2);
      const targetUnits = perCycle * Math.max(Number(s.fuelReserveCycles) || 2, Number(s.fuelTargetCycles) || 20);
      fuel = { ...fuel, typeID, quantity, perCycle, cycles: perCycle ? Math.floor(quantity / perCycle) : 0,
        reserveUnits, targetUnits, needsRestock: s.fuelEnabled === true && perCycle > 0 && quantity <= reserveUnits };
    }
    return { modules: list.map(m => {
      const effect = active(ship, m.item.itemID);
      return { itemID: m.item.itemID, typeID: m.item.typeID, name: String(m.item.itemName || m.item.typeName || m.item.name || TYPE_NAMES[m.item.typeID] || m.item.typeID),
        kind: m.kind, online: m.online, defaultSeconds: m.durationSeconds, durationSeconds: m.durationSeconds,
        intervalSeconds: m.intervalSeconds, active: !!effect,
        remainingSeconds: effect ? Math.max(0, (Number(effect.nextCycleAtMs) - now) / 1000) : 0 };
    }), fuel, status: r?.status || "", travelBlocked: travelBlocked(ship) };
  }
  function tick(session, s, scene, ship, now) {
    if (!scene || !ship || ship.kind !== "ship") return;
    const r = record(s, ship), list = modules(session, s, ship, now);
    if (!s.enabled || session.stationID || session.stationid || ship.pendingWarp || ship.mode === "WARP" || ship.pendingDock ||
        ship.dockingTargetID || ship.cloaked || ship.isCloaked) { requestDeparture(session, s, scene, ship, now); return; }
    for (const m of list) {
      const live = active(ship, m.item.itemID);
      if (owns(r, ship, m.item.itemID) && live && live.remainingCycles !== 1 && live.nextCycleAtMs > 0)
        r.lastStart.set(m.item.itemID, live.nextCycleAtMs - m.attrs.durationMs);
      if (owns(r, ship, m.item.itemID) && m.intervalSeconds > m.durationSeconds && live?.remainingCycles !== 1)
        deferOwned(session, r, scene, ship, m.kind);
      if (!(m.kind === "core" ? s.coreEnabled : s.compressorEnabled) && owns(r, ship, m.item.itemID))
        deferOwned(session, r, scene, ship, m.kind);
    }
    if (r.departing) return;
    const api = getAPI?.();
    if (!api || api.miningSite?.(scene, ship) === false || !api.miningSite && !api.surveyResource?.(scene, ship, null)) {
      deferOwned(session, r, scene, ship); r.status = "Waiting for a mining site before industrial activation."; return;
    }
    if (snapshot(session, s, scene, ship, now).fuel.needsRestock) {
      requestDeparture(session, s, scene, ship, now); r.status = "Fuel reserve reached; waiting to restock."; return;
    }
    for (const m of list.sort((a, b) => (a.kind === "core" ? 0 : 1) - (b.kind === "core" ? 0 : 1))) {
      const id = m.item.itemID;
      if (!(m.kind === "core" ? s.coreEnabled : s.compressorEnabled) || !m.online || active(ship, id)) continue;
      if (now < (r.lastStart.get(id) ?? -Infinity) + m.intervalSeconds * 1000 || now < (r.retry.get(id) || 0)) continue;
      let limitedByCore = false;
      if (m.kind === "compressor") {
        const liveCore = [...(ship.activeModuleEffects?.values() || [])].find(e => CORE_EFFECTS.has(Number(e.effectID)));
        if (!liveCore) { r.status = "Compressor waiting for an active industrial core."; continue; }
        const definition = list.find(c => c.item.itemID === liveCore.moduleID);
        const singleCore = liveCore.remainingCycles === 1 || liveCore.deactivateAtMs > 0 ||
          definition && definition.intervalSeconds > definition.durationSeconds;
        limitedByCore = !!singleCore;
        const available = Number(liveCore.deactivateAtMs || liveCore.nextCycleAtMs) - now;
        if (singleCore && available < m.attrs.durationMs) { r.status = "Compressor waiting for the next full core cycle window."; continue; }
      }
      r.retry.set(id, now + 10000);
      try {
        const repeat = limitedByCore || m.intervalSeconds > m.durationSeconds ? 0 : undefined;
        const result = scene.activateGenericModule(session, m.item, m.effect.name, { repeat });
        if (result?.success && active(ship, id)) {
          r.owned.set(id, active(ship, id)); r.lastStart.set(id, now); r.retry.delete(id);
          r.status = "Industrial automation active.";
        } else r.status = `Industrial activation waiting: ${result?.errorMsg || "activation refused"}.`;
      } catch (error) { r.status = `Industrial activation waiting: ${error.message}`; logError(`[AutoMining] ${r.status}`); }
    }
  }
  return { tick, snapshot, requestDeparture, stop, resume };
}
module.exports = { createIndustrialAutomation, defaultIntervalSeconds, validateIntervalSeconds };



