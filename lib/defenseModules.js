"use strict";
const path = require("node:path");
const {
  HARDENER_KINDS, REPAIR_KINDS, MODE_MANUAL, MODE_OFF, MODE_MINING, MODE_NPC, MODE_THRESHOLD,
  healthForKind, moduleDefaultSettings, sanitizeModuleSettings, wantsActive,
} = require("./defense");

// Native effect IDs, verified against SDE build 3396210 (typeDogma):
//   4    shieldBoosting                          (Shield Booster)
//   4936 fueledShieldBoosting                    (Ancillary Shield Booster)
//   27   armorRepair                             (Armor Repair Unit)
//   5275 fueledArmorRepair                       (Ancillary Armor Repairer)
//   5230 modifyActiveShieldResonancePostPercent  (Shield Hardener)
//   5231 modifyActiveArmorResonancePostPercent   (Armor Hardener)
//   4928 adaptiveArmorHardener                   (Reactive Armor Hardener)
// The effect name is what scene.activateGenericModule() expects, so the table
// carries both the classification and the native activation effect.
const EFFECT_KINDS = Object.freeze({
  4: { kind: "shieldRepair", effect: "shieldBoosting" },
  4936: { kind: "shieldRepair", effect: "fueledShieldBoosting" },
  27: { kind: "armorRepair", effect: "armorRepair" },
  5275: { kind: "armorRepair", effect: "fueledArmorRepair" },
  5230: { kind: "shieldHardener", effect: "modifyActiveShieldResonancePostPercent" },
  5231: { kind: "armorHardener", effect: "modifyActiveArmorResonancePostPercent" },
  4928: { kind: "armorHardener", effect: "adaptiveArmorHardener" },
});
const RETRY_MS = 5000;
const READ_CACHE_MS = 1000;
const characterID = session => Number(session?.characterID || session?.charid || 0);
const unsafeShip = session => session?.stationID || session?.stationid || session?.structureID || session?.structureid;

function createDefenseModules(root, { native = null, logError = console.error } = {}) {
  const loaded = {};
  const dep = (name, file) => native?.[name] || (loaded[name] ||= require(path.join(root, "server/src", file)));
  const fitting = () => dep("fitting", "services/fitting/liveFittingState.js");
  const attributes = () => dep("attributes", "space/runtime/moduleAttributes.js");
  const dogma = () => dep("dogma", "space/runtime/entityDogmaView.js");
  const types = () => dep("types", "services/inventory/itemTypeRegistry.js");
  const pendingReloads = () => native?.pendingReloads?.() ||
    dep("dogmaService", "services/dogma/dogmaService.js")._testing?.getPendingModuleReloads?.();
  const records = new WeakMap();

  function record(s, ship) {
    let r = records.get(s);
    if (!r || r.ship !== ship) {
      r = { ship, readAt: -Infinity, modules: [], owned: new Map(), retry: new Map(), status: "" };
      records.set(s, r);
    }
    return r;
  }

  function settingsFor(s, itemID) {
    const entry = s.defenseModules?.[String(itemID)] || s.defenseModules?.[itemID];
    const kind = entry?.kind;
    if (!entry || !kind) return null;
    return sanitizeModuleSettings(kind, entry);
  }

  // Fitted, online modules whose native effect is an active local defense
  // effect. Passive resistance modules carry no duration and no activation
  // effect, so they never appear in the list.
  function modules(session, s, ship, now) {
    if (!ship || ship.kind !== "ship" || !characterID(session)) return [];
    const r = record(s, ship);
    if (now - r.readAt < READ_CACHE_MS) return r.modules;
    const fit = fitting(), view = dogma();
    // Fitting data is available while docked; the runtime ship/dogma view is
    // not, so it is optional here and only used for the cycle duration.
    let fitted = [];
    try { fitted = fit.getFittedModuleItems(characterID(session), ship.itemID); }
    catch { r.modules = []; r.readAt = now; return r.modules; }
    let shipItem = null, skillMap = null;
    try {
      shipItem = view.getEntityRuntimeShipItem(ship);
      skillMap = view.getEntityRuntimeSkillMap(ship);
    } catch { /* docked or not yet materialised */ }
    r.modules = fitted.flatMap(item => {
      try {
        const found = fit.getTypeEffectRecords(item.typeID)
          .map(entry => ({ entry, definition: EFFECT_KINDS[Number(entry.effectID)] }))
          .find(row => row.definition);
        if (!found) return [];
        let attrs = null;
        if (shipItem) {
          try {
            attrs = attributes().getGenericModuleRuntimeAttributes(characterID(session), shipItem, item, null, null,
              { skillMap, fittedItems: fitted });
          } catch { attrs = null; }
        }
        if (attrs && !(attrs.durationMs > 0)) return [];
        const { kind } = found.definition;
        const type = (() => { try { return types().resolveItemByTypeID(item.typeID); } catch { return null; } })();
        return [{
          item, effect: found.entry, attrs, kind,
          name: String(item.itemName || item.typeName || type?.name || item.typeID),
          groupName: String(type?.groupName || ""),
          durationSeconds: attrs ? Number(attrs.durationMs) / 1000 : 0,
          online: fit.isModuleOnline(item),
        }];
      } catch { return []; }
    });
    r.readAt = now;
    return r.modules;
  }

  function active(ship, id) { return ship?.activeModuleEffects?.get(id); }
  function owns(r, ship, id) { return r.owned.has(id) && r.owned.get(id) === active(ship, id); }

  function deactivateOwned(session, s, scene, ship, keep = null, reason = "travel") {
    const r = record(s, ship);
    for (const [id, effect] of r.owned) {
      if (keep && keep.has(id)) continue;
      if (active(ship, id) !== effect) { r.owned.delete(id); continue; }
      try { scene.deactivateGenericModule(session, id, { reason: "autominingDefense", deferUntilCycle: false }); }
      catch (error) { logError(`[AutoMining] Defense module release failed: ${error.message}`); }
      if (active(ship, id) !== effect) {
        r.owned.delete(id);
        console.log("[AutoMining] defense module off char=" + characterID(session) + " item=" + id + " reason=" + reason);
      }
    }
  }

  function tick(session, s, scene, ship, now, context = {}) {
    try { tickInner(session, s, scene, ship, now, context); }
    catch (error) { logError(`[AutoMining] Defense module tick failed: ${error.message}`); }
  }

  function tickInner(session, s, scene, ship, now, context = {}) {
    if (!s.enabled || !scene || !ship || ship.kind !== "ship") return;
    if (unsafeShip(session) || ship.pendingDock || ship.dockingTargetID || ship.cloaked || ship.isCloaked) {
      deactivateOwned(session, s, scene, ship, null, "dock");
      s.defenseModuleStatus = "Defense modules paused during travel.";
      return;
    }
    if (ship.pendingWarp || ship.mode === "WARP") {
      // Do not start new modules mid-warp, but never switch off the ones that
      // are already cycling: repairers and hardeners keep working in warp.
      s.defenseModuleStatus = "Defense modules held during warp.";
      return;
    }
    const r = record(s, ship);
    const list = modules(session, s, ship, now);
    if (!list.length) {
      s.defenseModuleStatus = "No active defense modules fitted.";
      deactivateOwned(session, s, scene, ship);
      return;
    }
    const health = context.health || {};
    const keep = new Set();
    let activeCount = 0;
    for (const m of list) {
      const settings = settingsFor(s, m.item.itemID) || moduleDefaultSettings(m.kind);
      const percent = healthForKind(m.kind, health);
      let desired = wantsActive(m.kind, settings, percent, { mining: context.mining === true, npcs: context.npcs === true });
      // Inactive modules cannot be started; never queue their state.
      if (!m.online) desired = false;
      const id = m.item.itemID;
      const live = active(ship, id);
      if (desired === true || desired === null && live && owns(r, ship, id)) keep.add(id);
      if (desired === true && !live) {
        if (s.manualModuleStops?.get(id) === ship.itemID) continue;
        if (pendingReloads()?.has(id)) continue;
        if (now < (r.retry.get(id) || 0)) continue;
        r.retry.set(id, now + RETRY_MS);
        try {
          const result = scene.activateGenericModule(session, m.item, m.effect.name, {});
          if (result?.success && active(ship, id)) {
            r.owned.set(id, active(ship, id));
            r.retry.delete(id);
            console.log("[AutoMining] defense module on char=" + characterID(session) + " item=" + id +
              " type=" + m.item.typeID + " kind=" + m.kind);
          } else if (result?.errorMsg) s.defenseModuleStatus = `Defense module waiting: ${result.errorMsg}.`;
        } catch (error) {
          s.defenseModuleStatus = `Defense module waiting: ${error.message}.`;
          logError(`[AutoMining] Defense module activation failed: ${error.message}`);
        }
      } else if (desired === false && live && owns(r, ship, id)) {
        try { scene.deactivateGenericModule(session, id, { reason: "autominingDefense", deferUntilCycle: false }); }
        catch (error) { logError(`[AutoMining] Defense module release failed: ${error.message}`); }
        if (!active(ship, id)) {
          r.owned.delete(id);
          console.log("[AutoMining] defense module off char=" + characterID(session) + " item=" + id + " reason=mode-or-threshold");
        }
      }
      if (active(ship, id)) activeCount += 1;
    }
    deactivateOwned(session, s, scene, ship, keep);
    const automatic = list.filter(m => (settingsFor(s, m.item.itemID) || {}).mode !== MODE_MANUAL).length;
    s.defenseModuleStatus = automatic === 0 ? "Defense modules are manual."
      : activeCount ? `${activeCount}/${list.length} defense module(s) active.`
      : `${list.length} defense module(s) fitted; waiting.`;
  }

  function snapshot(session, s, scene, ship, now) {
    // The settings page lists fitted modules even when AutoMining or the
    // retreat toggle is off, so the pilot can configure them up front.
    if (!ship) return { modules: [], status: s.defenseModuleStatus || "Defense modules are manual." };
    const list = modules(session, s, ship, now);
    return {
      status: s.defenseModuleStatus || "Defense modules are manual.",
      modules: list.map(m => {
        const settings = settingsFor(s, m.item.itemID) || moduleDefaultSettings(m.kind);
        const live = active(ship, m.item.itemID);
        return {
          itemID: m.item.itemID, typeID: m.item.typeID, name: m.name, kind: m.kind,
          groupName: m.groupName, online: m.online, active: !!live,
          hardener: HARDENER_KINDS.has(m.kind), repair: REPAIR_KINDS.has(m.kind),
          mode: settings.mode, onPct: settings.onPct, offPct: settings.offPct,
          manualPaused: s.manualModuleStops?.get(m.item.itemID) === ship?.itemID,
          remainingSeconds: live ? Math.max(0, (Number(live.nextCycleAtMs) - now) / 1000) : 0,
        };
      }),
    };
  }

  function stop(session, s, scene, ship) {
    if (!scene || !ship) return;
    deactivateOwned(session, s, scene, ship);
  }

  return { modules, snapshot, tick, stop, EFFECT_KINDS, MODE_MANUAL, MODE_OFF, MODE_MINING, MODE_NPC, MODE_THRESHOLD };
}

module.exports = { createDefenseModules, EFFECT_KINDS };
