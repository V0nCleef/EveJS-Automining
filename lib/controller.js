"use strict";
const { matchesOre } = require("./commands");
const { planDistinct, ORDERS, compareTargets } = require("./targets");
const { createOrePriority } = require("./orePriority");
const { stopApproach, updateApproach, updateSurvey } = require("./assistance");
const { DEFAULT_SURVEY_SECONDS, DEFAULT_HAUL_THRESHOLD, validSurveySeconds, validHaulThreshold, MAX_ORE_FILTERS } = require("./settings");
const { clientText } = require("./hud");
const { createHauling } = require("./hauling");
const { createDroneLaunch, validGroupKey } = require("./droneLaunch");
const { createBoosters } = require("./boosters");
const { createRatDefense } = require("./ratDefense");
const { createMiningDrones } = require("./miningDrones");
const { targetClaims } = require("./targetClaims");
const { DEFAULT_DEFENSE_THRESHOLD, validDefenseThreshold, retreatReason } = require("./defense");

function createController(getAPI, getSpace, logError = console.error, preferences = null, compress = null, destinations = null, crystals = null, root = null) {
  const players = new WeakMap();
  let departureGuard = null;
  const claims = (scene, session, rocks, options) => targetClaims(scene, session, rocks, players, options);
  const drones = createDroneLaunch({ getAPI, getSpace, pendingDeparture: session => departureGuard?.pending(session) });
  const boosters = root && createBoosters(root, { getAPI, state, logError });
  const ratDefense = root && createRatDefense(root, { drones, getAPI, logError });
  const miningDrones = root && createMiningDrones(root, {
    getAPI, pendingDeparture: session => departureGuard?.pending(session), logError,
    claimedTargets: (scene, session, rocks) => claims(scene, session, rocks, { ownLasers: true }),
  });
  const hauling = destinations && createHauling({ destinations, getSpace, save, resetMining: resetMiningTargets });
  function release(scene, session, ship, id) {
    if (ship.pendingTargetLocks?.has(id)) scene.cancelAddTarget(session, id, { notifySelf: true });
    else scene.removeTarget(session, id);
  }
  function state(session) {
    const characterID = Number(session.characterID || session.charid);
    if (players.get(session)?.characterID !== characterID) players.set(session, {
      characterID, status: "Ready.",
      enabled: false, ores: [], order: "nearest", shipID: 0, scene: null, next: 0,
      approach: false, lock: true, survey: false, nextSurvey: 0, approachTarget: null, focusTarget: null,
      approachStatus: "", surveyStatus: "",
      surveyClientReady: false,
      surveySeconds: DEFAULT_SURVEY_SECONDS, lastSurveyRequestAt: null,
      compress: false, nextCompression: 0, compressionStatus: "",
      haulEnabled: false, haulThreshold: DEFAULT_HAUL_THRESHOLD, stationID: 0, storageKey: "personal", haulInterrupted: false, haul: null, haulClientReady: false, miningAnchor: null,
      defenseEnabled: false, defenseShieldEnabled: true, defenseShieldThreshold: DEFAULT_DEFENSE_THRESHOLD,
      defenseArmorEnabled: false, defenseArmorThreshold: DEFAULT_DEFENSE_THRESHOLD, defenseStatus: "Defense is off.",
      recallDrones: true, departureStatus: "",
      launchDrones: false, droneGroupKey: "", droneStatus: "Waiting for arrival at a mining location, or Start / Resume here.",
      mineDrones: false, mineDroneOrder: "nearest", mineDroneMode: "spread", mineDroneStatus: "Automatic mining orders are off.",
      miningDroneIDs: new Set(), mineIncompatibleIDs: new Set(), mineAssignments: new Map(), nextMineScan: 0,
      autoBoost: false, inviteFleet: false, boostStatus: "Automatic mining boosts are off.", fleetStatus: "Fleet invites are off.", boostOwned: new Map(),
      ratDefenseEnabled: false, ratMiningGroupKey: "", ratFighterGroupKey: "", ratStatus: "Rat response is off.", ratManagedFighterIDs: new Set(),
      replan: true, moduleCache: [], nextModuleCheck: 0, nextSearch: 0,
      owned: new Map(), locks: new Set(), assignments: new Map(),
      ...(preferences?.get(Number(session.characterID || session.charid)) || {}),
    });
    const s = players.get(session);
    if (s.defenseEnabled && s.defenseStatus === "Defense is off.") s.defenseStatus = "Defense armed.";
    if (s.haulInterrupted && !s.haul) {
      s.enabled = false;
      s.haulStatus = "Interrupted hauling trip. Check your ship and route, then click Start / Resume.";
    }
    return s;
  }
  function save(session, s) {
    if (s.deferSave) return "";
    try { preferences?.save(Number(session.characterID || session.charid), s); return ""; }
    catch (error) { logError(`[AutoMining] Preference save failed: ${error.message}`); return " Applied for this session, but saving failed; check server log."; }
  }
  function stop(session, s) {
    const ship = s.scene?.getShipEntityForSession(session);
    boosters?.stop(s, s.scene, session, ship);
    ratDefense?.clear(s);
    if (ship && ship.itemID === s.shipID) {
      stopApproach(s.scene, session, ship, s);
      for (const [id, effect] of s.owned) {
        if (ship.activeModuleEffects?.get(id) === effect) s.scene.deactivateGenericModule(session, id);
      }
      // Preserve targets while a final mining cycle (or any other module) uses them.
      for (const id of s.locks) {
        if (![...(ship.activeModuleEffects?.values() || [])].some(x => x.targetID === id)) {
          release(s.scene, session, ship, id);
          s.locks.delete(id);
        }
      }
    }
    s.assignments.clear();
    s.mineAssignments.clear();
  }
  function resetMiningTargets(session, s) {
    const ship = s.scene?.getShipEntityForSession(session);
    if (s.enabled && ship?.itemID === s.shipID) {
      stopApproach(s.scene, session, ship, s);
      const targets = new Set([...s.locks, ...s.assignments.values()]);
      // Ask for native short-cycle yield first. Unlocking then ends even ice
      // and crystal cycles that defer manual deactivation until completion.
      for (const m of getAPI()?.modules(ship) || []) {
        const effect = ship.activeModuleEffects?.get(m.item.itemID);
        if (effect) {
          targets.add(effect.targetID);
          s.scene.deactivateGenericModule(session, m.item.itemID);
        }
      }
      for (const id of targets) {
        if (ship.lockedTargets?.has(id) || ship.pendingTargetLocks?.has(id)) release(s.scene, session, ship, id);
      }
      s.owned.clear(); s.locks.clear();
    }
    s.assignments.clear();
    s.mineAssignments.clear();
    s.focusTarget = null;
    s.approachStatus = "";
    s.replan = true;
    s.next = 0;
    s.nextSearch = 0;
  }
  function otherPilotsTargets(scene, session, rocks) {
    return claims(scene, session, rocks, { ownDrones: true });
  }
  function command(session, cmd) {
    if (!session || !(Number(session.characterID || session.charid) > 0)) return "AutoMining needs a character session.";
    const s = state(session);
    if (cmd.action === "help" && s.hudReady) {
      session.sendNotification("OnAutoMiningOpen", "clientID", []);
      return "AutoMining settings opened.";
    }
    if (cmd.action === "error") return cmd.message;
    if (cmd.action === "surveyInterval") {
      if (!validSurveySeconds(cmd.seconds)) return "AutoMining: invalid survey interval.";
      s.surveySeconds = cmd.seconds;
      s.nextSurvey = s.lastSurveyRequestAt === null ? 0 : s.lastSurveyRequestAt + cmd.seconds * 1000;
      s.next = 0;
      s.surveyStatus = "";
      return `AutoMining survey interval: ${cmd.seconds} seconds. Survey ${s.survey ? "ON" : "OFF"}; main automation ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    if (cmd.action === "help" || cmd.action === "status") return `AutoMining ${s.enabled ? "ON" : "OFF"}, ${s.order}, filter: ${s.ores.join(", ") || "all compatible resources"}. Approach ${s.approach ? "ON" : "OFF"}, lock ${s.lock ? "ON" : "OFF"}, survey ${s.survey ? "ON" : "OFF"} (${s.surveySeconds}s), compress ${s.compress ? "ON" : "OFF"}. ${s.enabled ? [s.status, s.approachStatus, s.surveyStatus, s.compressionStatus].filter(Boolean).join(" ") : ""} Commands: on | off | ore,ore | clear | nearest | furthest | largest | smallest | approach on/off | lock on/off | survey on/off | survey seconds | compress on/off (prefix / or !).`;
    if (cmd.action === "toggle") {
      s[cmd.setting] = cmd.enabled;
      s.next = 0;
      if (cmd.setting === "compress") { s.nextCompression = 0; s.compressionStatus = ""; }
      if (cmd.setting === "approach" || cmd.setting === "lock") { s.replan = true; s.focusTarget = null; }
      if (cmd.setting === "survey") {
        s.nextSurvey = 0;
        s.surveyStatus = "";
      }
      const ship = s.scene?.getShipEntityForSession(session);
      if (ship && ship.itemID === s.shipID && cmd.setting === "approach" && !cmd.enabled) stopApproach(s.scene, session, ship, s);
      if (ship && ship.itemID === s.shipID && cmd.setting === "lock" && !cmd.enabled) {
        for (const id of s.locks) if (ship.pendingTargetLocks?.has(id)) {
          s.scene.cancelAddTarget(session, id, { notifySelf: true }); s.locks.delete(id);
        }
      }
      return `AutoMining ${cmd.setting.toUpperCase()} ${cmd.enabled ? "ON" : "OFF"}. Main automation ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    if (ORDERS.includes(cmd.action)) {
      const changed = s.order !== cmd.action;
      s.order = cmd.action;
      if (changed) {
        resetMiningTargets(session, s);
        if (s.enabled) s.status = "Priority changed; choosing new targets.";
      }
      return `AutoMining priority: ${s.order}. Search area: ${s.approach ? "whole current belt; travel may be required" : "within effective mining range"}. ${changed && s.enabled ? "Choosing new targets now. " : ""}${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    if (cmd.action === "off") {
      drones.invalidate(s); s.droneArrival = false;
      departureGuard?.cancel(session, "Departure cancelled by Stop.");
      if (s.haul) hauling.cancel(session, s);
      s.enabled = false;
      const saved = save(session, s);
      stop(session, s);
      return "AutoMining OFF. Mining modules it started are stopping under normal cycle rules." + saved;
    }
    if (cmd.action === "clear" || cmd.action === "filter") {
      const next = cmd.action === "clear" ? [] : [...cmd.ores];
      if (next.length > MAX_ORE_FILTERS) return `AutoMining: maximum ${MAX_ORE_FILTERS} ore filters.`;
      const changed = JSON.stringify(s.ores) !== JSON.stringify(next);
      if (changed) { s.replan = true; s.focusTarget = null; s.mineReplan = true; s.nextMineScan = 0; }
      s.ores = next;
      s.next = 0;
      if (s.enabled && changed) {
        const ship = s.scene?.getShipEntityForSession(session);
        const api = getAPI();
        if (api && ship?.itemID === s.shipID) {
          const excluded = new Set(api.candidates(s.scene, ship).filter(r => !matchesOre(r.name, s.ores)).map(r => r.id));
          if (excluded.has(s.approachTarget?.id)) stopApproach(s.scene, session, ship, s);
          // Request native partial yield where supported, then unlock. Native
          // target loss immediately ends even cycles which defer manual stops.
          for (const m of api.modules(ship)) {
            const effect = ship.activeModuleEffects?.get(m.item.itemID);
            if (effect && excluded.has(effect.targetID)) s.scene.deactivateGenericModule(session, m.item.itemID);
          }
          for (const id of excluded) {
            if (ship.lockedTargets?.has(id) || ship.pendingTargetLocks?.has(id)) release(s.scene, session, ship, id);
            s.locks.delete(id);
          }
          for (const [id, target] of s.assignments) if (excluded.has(target)) s.assignments.delete(id);
        }
      }
      return `AutoMining filter: ${s.ores.join(", ") || "all compatible resources"}. ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
    }
    const api = getAPI();
    if (!api) return "AutoMining unavailable: unsupported mining runtime; check the server log.";
    if (departureGuard?.pending(session)) return "Drones are returning before departure. Use Stop to cancel.";
    if (s.haul) return "AutoMining is already hauling. Use Stop to cancel the trip.";
    s.departureStatus = "";
    drones.arm(s);
    s.haulInterrupted = false; s.haulStatus = "";
    const scene = getSpace().getSceneForSession(session);
    const ship = scene?.getShipEntityForSession(session);
    if (!ship || ship.kind !== "ship") {
      s.enabled = true; s.next = 0;
      s.status = s.autoBoost ? "Waiting to undock in the boosting ship." : "Waiting to undock in a ship with online mining modules.";
      return `AutoMining ON. It will resume when you undock ${s.autoBoost ? "in the boosting ship" : "with online mining modules"}.` + save(session, s);
    }
    const modules = api.modules(ship);
    if (s.shipID && (s.shipID !== ship.itemID || s.scene !== scene)) stop(session, s);
    const alreadyEnabled = s.enabled && s.shipID === ship.itemID && s.scene === scene;
    if (!alreadyEnabled) s.replan = true;
    s.enabled = true;
    s.scene = scene;
    s.shipID = ship.itemID;
    s.next = 0;
    s.status = modules.length ? "Looking for targets." : s.autoBoost ? "Starting mining boosts." : "Waiting for online mining modules.";
    if (!alreadyEnabled) s.nextSurvey = 0;
    if (!alreadyEnabled) {
      for (const m of modules) {
        const effect = ship.activeModuleEffects?.get(m.item.itemID);
        if (effect) {
          s.owned.set(m.item.itemID, effect);
          scene.deactivateGenericModule(session, m.item.itemID);
        }
      }
    }
    return `AutoMining ON (${s.order}). Filter: ${s.ores.join(", ") || "all compatible resources"}. Separate targets first; sharing when needed.` + save(session, s);
  }

  function tickPlayer(scene, session, now) {
    if (!(Number(session?.characterID || session?.charid) > 0)) return;
    const s = state(session);
    drones.inspect(session, s, scene, scene.getShipEntityForSession(session));
    if (departureGuard?.pending(session)) return;
    if (!s.enabled) return;
    boosters?.tickFleet(session, s, scene, scene.getShipEntityForSession(session), now);
    if (s.haul) {
      const handled = hauling.observe(session, s);
      if (!s.haul && s.enabled) drones.arm(s);
      if (handled) return;
    }
    const api = getAPI();
    const ship = scene.getShipEntityForSession(session);
    const warping = ship && (ship.mode === "WARP" || ship.pendingWarp);
    // A warp order takes priority over the normal one-second work interval.
    if ((!warping || s.pausedForWarp) && now < s.next) return;
    s.next = now + 1000;
    if (!api || !ship || ship.kind !== "ship") {
      s.mineAssignments.clear();
      s.status = "Paused; waiting for a mining ship in space.";
      return;
    }
    if (ship.itemID !== s.shipID || scene !== s.scene) {
      boosters?.stop(s, s.scene, session, s.scene?.getShipEntityForSession(session));
      ratDefense?.clear(s);
      miningDrones?.reset(s);
      s.owned.clear(); s.locks.clear(); s.assignments.clear();
      s.approachTarget = null; s.focusTarget = null; s.scene = scene; s.shipID = ship.itemID;
      s.nextSurvey = 0; s.nextCompression = 0;
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0;
      s.replan = true; s.moduleCache = []; s.nextModuleCheck = 0;
    }
    if (warping) {
      boosters?.pause(s, scene, session, ship);
      // Drop our movement ownership before cleanup: never issue Stop and
      // accidentally cancel the pilot's new warp while still aligning.
      if (!s.pausedForWarp) {
        s.approachTarget = null;
        resetMiningTargets(session, s);
      }
      s.pausedForWarp = true;
      s.resumeGrid = null; s.nextResumeCheck = 0;
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0; s.nextSurvey = 0;
      s.surveyStatus = ""; s.compressionStatus = "";
      s.status = "Paused for warp; resumes at a mining location.";
      return;
    }
    if (ship.pendingDock || ship.dockingTargetID || ship.isCloaked || ship.cloaked) {
      boosters?.pause(s, scene, session, ship);
      stop(session, s);
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0; s.nextSurvey = 0;
      s.surveyStatus = "";
      s.status = "Paused during travel or cloak.";
      return;
    }
    const danger = retreatReason(s, ship);
    if (danger) {
      s.defenseStatus = danger;
      const layer = danger === "Defense retreat: low armor." ? "armor" : "shield";
      const hold = api.oreHold?.(scene, ship, () => true, now, 100, true) || null;
      if (hauling?.begin(session, s, scene, ship, hold, { retreat: true, layer })) {
        boosters?.pause(s, scene, session, ship);
        ratDefense?.clear(s);
        return;
      }
    }
    // Boosters and rat response do not need an unmined asteroid. A booster
    // should keep helping its fleet when the last rock depletes.
    boosters?.tick(session, s, scene, ship, now);
    const defending = ratDefense?.tick(session, s, scene, ship, now) || false;
    if (s.pausedForWarp) {
      const grid = api.surveyGrid(scene, ship);
      if (grid !== s.resumeGrid) { s.resumeGrid = grid; s.nextResumeCheck = 0; }
      s.status = s.autoBoost ? s.boostStatus : "Waiting to resume: no ore, ice or gas in this local grid.";
      if (now < s.nextResumeCheck) return;
      s.nextResumeCheck = now + 5000;
      const resource = grid && api.surveyResource(scene, ship, null);
      if (!resource) return;
      s.pausedForWarp = false;
      // Reuse the arrival check for survey; no second field search is needed.
      s.surveyGrid = grid; s.surveyResourceID = resource; s.nextSurveyCheck = now + 5000;
      s.replan = true; s.nextSearch = 0;
    }
    if (s.haulEnabled && now >= (s.nextHaulCheck || 0)) {
      s.holdStatus = api.oreHold?.(scene, ship, name => matchesOre(name, s.ores), now, s.haulThreshold,
        !!(s.autoBoost && boosters?.miningModules(session, ship).length)) || null;
      s.nextHaulCheck = now + 5000;
    }
    let haulHold = s.haulEnabled && s.holdStatus;
    if (s.compress && compress && (now >= s.nextCompression || haulHold?.full)) {
      s.nextCompression = now + 10_000;
      try { s.compressionStatus = compress(scene, session, ship); }
      catch (error) { s.compressionStatus = "Compression unavailable; mining continues."; logError(`[AutoMining] Compression failed: ${error.message}`); }
    }
    if (haulHold?.full && s.compress) haulHold = api.oreHold(scene, ship, name => matchesOre(name, s.ores), now, s.haulThreshold,
      !!(s.autoBoost && boosters?.miningModules(session, ship).length));
    if (s.haulEnabled) {
      s.holdStatus = haulHold || null;
      if (hauling?.begin(session, s, scene, ship, haulHold)) {
        boosters?.pause(s, scene, session, ship);
        return;
      }
    }
    if (!defending) drones.arrival(session, s, scene, ship, now);
    if (miningDrones) {
      miningDrones.tick(session, s, scene, ship, now, defending);
    }
    if (s.autoBoost && !api.modules(ship, now).length) {
      s.status = s.boostStatus;
      return;
    }
    updateSurvey({ api, scene, session, ship, state: s, now });
    if (["largest", "smallest"].includes(s.order) && api.hasSurveyor?.(ship) !== true) {
      if (!s.surveyorBlocked) stop(session, s);
      s.surveyorBlocked = true;
      s.approachStatus = "";
      s.status = "Waiting: volume priority needs an available Mining Surveyor or built-in equivalent. No scan is required. Choose Nearest/Furthest to mine without one.";
      return;
    }
    if (s.surveyorBlocked) { s.surveyorBlocked = false; s.replan = true; s.nextSearch = 0; }
    const effects = ship.activeModuleEffects || new Map();
    // Capacity checks inspect only already locked resources using native cached
    // inventory capacity; they never enumerate the asteroid field.
    if (api.hasRoom) {
      for (const id of new Set([...(ship.lockedTargets?.keys() || []), ...(ship.pendingTargetLocks?.keys() || [])])) {
        if (api.hasRoom(scene,ship,id) !== false) continue;
        release(scene,session,ship,id);
        s.locks.delete(id);
        for (const [moduleID,targetID] of s.assignments) if (targetID === id) s.assignments.delete(moduleID);
        s.replan = true;
      }
    }
    const allWorking = modules => modules.length && modules.every(m => effects.has(m.item.itemID));
    // Inspect only the fitted miners' effective burst modifiers, not the field.
    // Native timed modifiers disappear here as soon as their boost expires.
    const boostKey = api.boostSignature?.(ship, s.moduleCache, now);
    const boostsChanged = boostKey !== s.boostKey;
    if (boostsChanged) { s.nextModuleCheck = 0; s.nextSearch = 0; }
    // Native mining owns active cycles. No asteroid discovery or dogma rebuild
    // is needed while every known miner is working. Check fitting every 5s.
    if (!s.replan && !s.approachTarget && now < s.nextModuleCheck && allWorking(s.moduleCache)) return;
    if (!s.replan && now < s.nextSearch && !effects.size && !ship.pendingTargetLocks?.size && !s.approachTarget && s.lastLockCount === ship.lockedTargets?.size) return;
    const reuseModules = s.approachTarget && !s.replan && !boostsChanged && now < s.nextModuleCheck;
    const modules = reuseModules ? s.moduleCache : api.modules(ship, now);
    const rangesChanged = boostsChanged || modules.some(m => s.moduleCache.find(old => old.item.itemID === m.item.itemID)?.snapshot.maxRangeMeters !== m.snapshot.maxRangeMeters);
    s.moduleCache = modules;
    if (!reuseModules) s.nextModuleCheck = now + 5000;
    s.boostKey = api.boostSignature?.(ship, modules, now);
    if (!s.replan && !rangesChanged && !s.approachTarget && allWorking(modules)) {
      s.status = `Mining with ${modules.length} module(s).`;
      return;
    }
    let rocks;
    const focus = s.approach && !s.replan && s.focusTarget && api.target?.(scene, ship, s.focusTarget);
    const focusModules = focus ? modules.filter(m => api.compatible(scene, ship, m, focus, now, true)) : [];
    const validFocus = focus && matchesOre(focus.name, s.ores) && focusModules.length;
    if (!validFocus) s.focusTarget = null;
    if (validFocus && focusModules.some(m => !api.compatible(scene, ship, m, focus, now))) {
      // Travelling: direct lookups suffice; no full-belt rescan each second.
      const existing = new Map([[focus.id, focus]]);
      for (const effect of effects.values()) {
        const rock = api.target?.(scene, ship, effect.targetID);
        if (rock && matchesOre(rock.name, s.ores)) existing.set(rock.id, rock);
      }
      rocks = [...existing.values()];
    }
    // Reuse directly looked-up, still-valid assigned asteroids across cycles.
    // A depletion, invalid assignment, changed filter or new module falls back
    // to fresh scene discovery and the full distinct-target planner.
    if (!rocks && !s.replan && api.target && modules.length && (!s.approach || validFocus) && !s.approachTarget) {
      const existing = new Map();
      if (modules.every(m => {
        const id = effects.get(m.item.itemID)?.targetID || s.assignments.get(m.item.itemID);
        const rock = id && (existing.get(id) || api.target(scene, ship, id));
        if (!rock || !matchesOre(rock.name,s.ores) || !api.compatible(scene,ship,m,rock,now)) return false;
        existing.set(id,rock);return true;
      })) {
        if (validFocus) existing.set(focus.id, focus);
        rocks = [...existing.values()];
      }
    }
    if (!rocks) rocks = api.candidates(scene, ship).filter(r => matchesOre(r.name, s.ores));
    const priority = createOrePriority(s.ores, s.order);
    if (crystals && crystals({ api, scene, session, ship, state: s, modules,
      rocks: [...rocks].sort(priority), now })) {
      s.status = s.crystalStatus;
      return;
    }
    s.replan = false;
    const occupied = new Set();
    const current = new Map();
    const moduleIDs = new Set(modules.map(m => m.item.itemID));
    for (const [id, effect] of s.owned) if (effects.get(id) !== effect) s.owned.delete(id);
    for (const [id] of s.assignments) if (!moduleIDs.has(id)) s.assignments.delete(id);
    const rows = modules.map(m => ({ ...m, targets: rocks.filter(r => api.compatible(scene, ship, m, r, now)) }));
    const waitingForApproach = updateApproach({ api, scene, session, ship, state: s, modules, rocks, rows, now, save, priority });
    // Keep working cycles, but stop our own cycles whose target no longer matches
    // a changed filter or whose hold cannot accept even one unit.
    for (const m of rows) {
      const effect = effects.get(m.item.itemID);
      if (!effect) continue;
      occupied.add(effect.targetID);
      current.set(m.item.itemID, effect.targetID);
      if (s.owned.get(m.item.itemID) === effect && !m.targets.some(r => r.id === effect.targetID)) {
        scene.deactivateGenericModule(session, m.item.itemID);
      }
    }
    // Shorter-range/restricted modules get first choice. Within each module,
    // choose by actual surface distance, with stable ID ordering for ties.
    rows.sort((a, b) => a.targets.length - b.targets.length || a.item.itemID - b.item.itemID);
    const selectionPriority = createOrePriority(s.ores, s.order, {
      claimed: otherPilotsTargets(scene, session, rocks), focus: s.focusTarget,
    });
    for (const m of rows) m.targets.sort(selectionPriority);
    const planned = planDistinct(rows.filter(m => !waitingForApproach && !effects.has(m.item.itemID)), occupied);
    for (const rock of planned.values()) occupied.add(rock.id);
    for (const m of rows) {
      if (waitingForApproach || effects.has(m.item.itemID)) continue;
      const preferred = planned.get(m.item.itemID);
      const unique = m.targets.filter(r => !occupied.has(r.id) && r !== preferred);
      const shared = m.targets.filter(r => occupied.has(r.id) && r !== preferred);
      let selected = null;
      for (const r of [...(preferred ? [preferred] : []), ...unique, ...shared]) {
        const hadLock = ship.lockedTargets?.has(r.id) || ship.pendingTargetLocks?.has(r.id);
        const lock = s.lock ? scene.addTarget(session, r.id)
          : { success: ship.lockedTargets?.has(r.id) === true, data: { pending: false } };
        if (!lock?.success) continue;
        if (!hadLock) s.locks.add(r.id);
        selected = r;
        occupied.add(r.id);
        current.set(m.item.itemID, r.id);
        s.assignments.set(m.item.itemID, r.id);
        if (lock.data?.pending || !scene.getTargets(session).includes(r.id)) break;
        // A single normal cycle permits reassignment after depletion/filter
        // changes without repeatedly short-cycling yield or bypassing dogma.
        const result = scene.activateGenericModule(session, m.item, m.effect.name, { targetID: r.id, repeat: 0 });
        if (result?.success) s.owned.set(m.item.itemID, effects.get(m.item.itemID) || ship.activeModuleEffects.get(m.item.itemID));
        break;
      }
      if (!selected) s.assignments.delete(m.item.itemID);
    }
    const used = new Set([...current.values(), ...[...effects.values()].map(e => e.targetID)]);
    for (const id of s.locks) {
      if (!used.has(id)) {
        release(scene, session, ship, id);
        s.locks.delete(id);
      }
    }
    const activeCount = rows.filter(m => ship.activeModuleEffects?.has(m.item.itemID)).length;
    s.lastLockCount = ship.lockedTargets?.size;
    s.nextSearch = !activeCount && !ship.pendingTargetLocks?.size && !s.approachTarget ? now + 5000 : 0;
    s.status = activeCount ? `Mining with ${activeCount} module(s).`
      : !modules.length ? "Waiting for online mining modules."
      : !rocks.length ? "Waiting for matching resources nearby."
      : !rows.some(m => m.targets.length) ? "Waiting for compatible resources in range and room in the mining hold."
      : ship.pendingTargetLocks?.size ? "Waiting for target locks."
      : "Waiting for a free target slot, capacitor or module readiness.";
  }
  function tick(scene, now) {
    for (const session of scene.sessions.values()) {
      try { tickPlayer(scene, session, now); }
      catch (error) {
        const s = players.get(session);
        if (s) { if (s.haul) hauling.cancel(session, s, `Hauling paused: ${error.message}`); s.enabled = false; try { stop(session, s); } catch {} }
        logError(`[AutoMining] Automation stopped after error: ${error.message}`);
      }
    }
  }
  function clientReady(session, hudReady = false, haulReady = false) {
    if (!(Number(session?.characterID || session?.charid) > 0)) return false;
    const s = state(session);
    s.surveyClientReady = true; s.nextSurvey = 0;
    s.hudReady = hudReady === true || hudReady === 1;
    if (haulReady === true || haulReady === 1) s.haulClientReady = true;
    return true;
  }
  function surveyAck(session, success, reason) {
    const s = players.get(session);
    if (!s?.surveyClientReady) return false;
    const message = clientText(reason, 160) || "client unavailable";
    // Server arrival can precede the client's warp/session transition. A skipped
    // scan must not consume the full user interval; retain the native rate limit.
    if (!success && s.lastSurveyRequestAt !== null &&
        ["ship is warping", "not in space", "a survey is already running"].includes(message)) {
      s.nextSurvey = s.lastSurveyRequestAt + 6000;
    }
    s.surveyStatus = success ? `Mining Surveyor refreshed; repeats every ${s.surveySeconds} seconds.`
      : `Survey waiting: ${message}.`;
    return true;
  }
  function applyProfile(session, raw) {
    const prefs = JSON.parse(String(raw));
    if (!prefs || prefs.apply !== true) return false;
    const oreCommand = require("./commands").parse(`AutoMining ${String(prefs.ores || "").trim() || "clear"}`);
    if (!oreCommand || !["filter", "clear"].includes(oreCommand.action)) throw new Error("Invalid AutoMining profile ore list");
    if (!ORDERS.includes(prefs.order) || ["lock", "survey", "approach"].some(k => typeof prefs[k] !== "boolean")) throw new Error("Invalid AutoMining profile settings");
    if (prefs.compress !== undefined && typeof prefs.compress !== "boolean") throw new Error("Invalid AutoMining compression setting");
    const interval = prefs.surveySeconds === undefined ? DEFAULT_SURVEY_SECONDS : prefs.surveySeconds;
    if (!validSurveySeconds(interval)) throw new Error("Invalid AutoMining survey interval");
    const stampValues = [oreCommand.ores || [], prefs.order, prefs.lock, prefs.survey, prefs.approach, prefs.compress === true];
    // Retain the old preset identity when the new field has its default. An
    // update must not reapply an unchanged preset over later in-game choices.
    if (interval !== DEFAULT_SURVEY_SECONDS) stampValues.push(interval);
    const stamp = JSON.stringify(stampValues);
    const s = state(session);
    if (s.profileStamp === stamp) return false;
    if (prefs.surveyDefaulted === true && prefs.survey === false) {
      const legacy = [...stampValues]; legacy[3] = true;
      if (JSON.stringify(legacy) === s.profileStamp) return false;
    }
    command(session, oreCommand);
    command(session, { action: prefs.order });
    for (const setting of ["lock", "survey", "approach"]) command(session, { action: "toggle", setting, enabled: prefs[setting] });
    command(session, { action: "toggle", setting: "compress", enabled: prefs.compress === true });
    command(session, { action: "surveyInterval", seconds: interval });
    s.profileStamp = stamp;
    save(session, s);
    return true;
  }
  function snapshot(session) {
    if (!(Number(session?.characterID || session?.charid) > 0)) throw new Error("AutoMining needs a character session.");
    const s = state(session);
    const settings = { ores: [...s.ores], order: s.order, approach: s.approach, lock: s.lock, survey: s.survey, compress: s.compress, surveySeconds: s.surveySeconds,
      haulThreshold: s.haulThreshold,
      haulEnabled: s.haulEnabled, stationID: s.stationID, storageKey: s.storageKey, recallDrones: s.recallDrones,
      defenseEnabled: s.defenseEnabled, defenseShieldEnabled: s.defenseShieldEnabled,
      defenseShieldThreshold: s.defenseShieldThreshold, defenseArmorEnabled: s.defenseArmorEnabled,
      defenseArmorThreshold: s.defenseArmorThreshold,
      launchDrones: s.launchDrones, droneGroupKey: s.droneGroupKey,
      mineDrones: s.mineDrones, mineDroneOrder: s.mineDroneOrder, mineDroneMode: s.mineDroneMode,
      autoBoost: s.autoBoost, inviteFleet: s.inviteFleet,
      ratDefenseEnabled: s.ratDefenseEnabled, ratMiningGroupKey: s.ratMiningGroupKey, ratFighterGroupKey: s.ratFighterGroupKey };
    let destination = null, storage = null;
    try { if (destinations && s.stationID) { destination = destinations.station(s.stationID, session); storage = destinations.storage(session, s.stationID, s.storageKey); } } catch {}
    return { settings, revision: JSON.stringify(settings), enabled: s.enabled,
      destination, storage, hauling: hauling?.view(s) || null, hold: s.holdStatus || null,
      droneStatus: s.launchDrones ? s.droneStatus : "Automatic launch is off.",
      mineDroneStatus: s.mineDrones ? s.mineDroneStatus : "Automatic mining orders are off.",
      boostStatus: s.autoBoost ? [s.boostStatus, s.inviteFleet ? s.fleetStatus : ""].filter(Boolean).join(" ") : "Automatic mining boosts are off.",
      ratStatus: s.ratDefenseEnabled ? s.ratStatus : "Rat response is off.",
      defenseStatus: s.defenseEnabled ? s.defenseStatus : "Defense is off.",
      status: s.departureStatus || (s.haul ? hauling.view(s).status : !s.enabled && s.haulStatus ? s.haulStatus : s.enabled ? (getSpace().getSceneForSession(session)?.getShipEntityForSession(session)
        ? [s.status, s.approachStatus, s.surveyStatus, s.compressionStatus].filter(Boolean).join(" ")
        : "Paused while docked. AutoMining resumes in space.") : "AutoMining is off.") };
  }
  function applySettings(session, raw) {
    if (typeof raw !== "string" || raw.length > 100000) throw new Error("Invalid AutoMining settings request.");
    const request = JSON.parse(raw), p = request.settings;
    if (!p || !Array.isArray(p.ores) || p.ores.length > MAX_ORE_FILTERS || p.ores.some(x => typeof x !== "string" || !x.trim() || x.length > 80 || !/^[\p{L}\p{N} '-]+$/u.test(x)) ||
        !ORDERS.includes(p.order) || !validSurveySeconds(p.surveySeconds) ||
        ["approach", "lock", "survey", "compress"].some(k => typeof p[k] !== "boolean")) throw new Error("Invalid AutoMining settings. Check the survey interval and ore list.");
    if (request.revision !== snapshot(session).revision) throw new Error("Settings changed elsewhere. Click Reload before applying your changes.");
    const current = state(session);
    const recallDrones = p.recallDrones === undefined ? current.recallDrones : p.recallDrones;
    if (typeof recallDrones !== "boolean") throw Error("Invalid drone recall setting.");
    const launchDrones = p.launchDrones === undefined ? current.launchDrones : p.launchDrones;
    const droneGroupKey = p.droneGroupKey === undefined ? current.droneGroupKey : p.droneGroupKey;
    if (typeof launchDrones !== "boolean" || !validGroupKey(droneGroupKey) || launchDrones && !droneGroupKey) throw Error("Select a drone group before enabling automatic launch.");
    const mineDrones = p.mineDrones === undefined ? current.mineDrones : p.mineDrones;
    const mineDroneOrder = p.mineDroneOrder === undefined ? current.mineDroneOrder : p.mineDroneOrder;
    const mineDroneMode = p.mineDroneMode === undefined ? current.mineDroneMode : p.mineDroneMode;
    if (typeof mineDrones !== "boolean" || !ORDERS.includes(mineDroneOrder) || !["spread", "focus"].includes(mineDroneMode))
      throw Error("Invalid mining drone settings.");
    const autoBoost = p.autoBoost === undefined ? current.autoBoost : p.autoBoost;
    const inviteFleet = p.inviteFleet === undefined ? current.inviteFleet : p.inviteFleet;
    const ratDefenseEnabled = p.ratDefenseEnabled === undefined ? current.ratDefenseEnabled : p.ratDefenseEnabled;
    const ratMiningGroupKey = p.ratMiningGroupKey === undefined ? current.ratMiningGroupKey : p.ratMiningGroupKey;
    const ratFighterGroupKey = p.ratFighterGroupKey === undefined ? current.ratFighterGroupKey : p.ratFighterGroupKey;
    if ([autoBoost, inviteFleet, ratDefenseEnabled].some(x => typeof x !== "boolean") ||
        !validGroupKey(ratMiningGroupKey) || !validGroupKey(ratFighterGroupKey) ||
        inviteFleet && !autoBoost || ratDefenseEnabled && (!ratMiningGroupKey || !ratFighterGroupKey || ratMiningGroupKey === ratFighterGroupKey))
      throw Error("Select separate mining and fighter groups for rat response; fleet invites require Auto Boost.");
    // Older companions may save mining settings without the new fields.
    const haulEnabled = p.haulEnabled === undefined ? current.haulEnabled : p.haulEnabled;
    const haulThreshold = p.haulThreshold === undefined ? current.haulThreshold : p.haulThreshold;
    const targetID = p.stationID === undefined ? current.stationID : p.stationID;
    const storageKey = p.storageKey === undefined ? current.storageKey : p.storageKey;
    const defenseEnabled = p.defenseEnabled === undefined ? current.defenseEnabled : p.defenseEnabled;
    const defenseShieldEnabled = p.defenseShieldEnabled === undefined ? current.defenseShieldEnabled : p.defenseShieldEnabled;
    const defenseShieldThreshold = p.defenseShieldThreshold === undefined ? current.defenseShieldThreshold : p.defenseShieldThreshold;
    const defenseArmorEnabled = p.defenseArmorEnabled === undefined ? current.defenseArmorEnabled : p.defenseArmorEnabled;
    const defenseArmorThreshold = p.defenseArmorThreshold === undefined ? current.defenseArmorThreshold : p.defenseArmorThreshold;
    if (typeof haulEnabled !== "boolean" || !validHaulThreshold(haulThreshold) || !Number.isSafeInteger(targetID) || targetID < 0 ||
        typeof storageKey !== "string" || storageKey.length > 100) throw Error("Invalid return-to-station settings.");
    if ([defenseEnabled, defenseShieldEnabled, defenseArmorEnabled].some(value => typeof value !== "boolean") ||
        !validDefenseThreshold(defenseShieldThreshold) || !validDefenseThreshold(defenseArmorThreshold) ||
        defenseEnabled && !defenseShieldEnabled && !defenseArmorEnabled) throw Error("Select shield or armor and a threshold from 1 to 100 for Defense.");
    if ((haulEnabled || defenseEnabled) && (!destinations || !targetID)) throw Error("Choose a station and unload storage before enabling hauling or Defense.");
    if (targetID && (haulEnabled || defenseEnabled)) { destinations.station(targetID, session); destinations.storage(session, targetID, storageKey); }
    if (current.haul && ((!current.haul.retreat && !haulEnabled) || targetID !== current.stationID || storageKey !== current.storageKey))
      hauling.cancel(session, current, "Hauling cancelled after destination settings changed.");
    if (launchDrones !== current.launchDrones || droneGroupKey !== current.droneGroupKey ||
        ratDefenseEnabled !== current.ratDefenseEnabled || ratMiningGroupKey !== current.ratMiningGroupKey || ratFighterGroupKey !== current.ratFighterGroupKey) {
      drones.invalidate(current);
      ratDefense?.clear(current);
      current.droneStatus = "Waiting for arrival at a mining location, or Start / Resume here.";
      if (droneGroupKey !== current.droneGroupKey) miningDrones?.reset(current);
    }
    if (current.autoBoost && !autoBoost) boosters?.stop(current, current.scene, session, current.scene?.getShipEntityForSession(session));
    if (!recallDrones) departureGuard?.cancel(session, "Departure cancelled after recall was disabled. Issue travel again to proceed without recall.");
    const s = state(session); s.deferSave = true;
    try {
      command(session, {action:"filter", ores:[...new Set(p.ores.map(x=>x.trim().toLowerCase().replace(/\s+/g," ")))]});
      if (s.order !== p.order) command(session, {action:p.order});
      for (const setting of ["approach", "lock", "survey", "compress"]) if (s[setting] !== p[setting]) command(session, {action:"toggle",setting,enabled:p[setting]});
      if (s.surveySeconds !== p.surveySeconds) command(session, {action:"surveyInterval",seconds:p.surveySeconds});
      s.haulEnabled = haulEnabled; s.haulThreshold = haulThreshold; s.stationID = targetID; s.storageKey = storageKey;
      s.defenseEnabled = defenseEnabled; s.defenseShieldEnabled = defenseShieldEnabled;
      s.defenseShieldThreshold = defenseShieldThreshold; s.defenseArmorEnabled = defenseArmorEnabled;
      s.defenseArmorThreshold = defenseArmorThreshold;
      s.defenseStatus = defenseEnabled ? "Defense armed." : "Defense is off.";
      s.recallDrones = recallDrones;
      s.launchDrones = launchDrones; s.droneGroupKey = droneGroupKey;
      if (s.mineDroneOrder !== mineDroneOrder || s.mineDroneMode !== mineDroneMode || s.mineDrones !== mineDrones) s.mineReplan = true;
      s.mineDrones = mineDrones; s.mineDroneOrder = mineDroneOrder; s.mineDroneMode = mineDroneMode;
      if (!mineDrones) s.mineAssignments.clear();
      s.nextMineScan = 0;
      s.autoBoost = autoBoost; s.inviteFleet = inviteFleet;
      s.ratDefenseEnabled = ratDefenseEnabled; s.ratMiningGroupKey = ratMiningGroupKey; s.ratFighterGroupKey = ratFighterGroupKey;
      s.nextFleetCheck = 0; s.nextBoostAttempt?.clear();
      s.nextHaulCheck = 0;
    } finally { delete s.deferSave; }
    return "AutoMining settings applied." + save(session, s);
  }
  function feedback(session, message) {
    if (!players.get(session)?.hudReady) return false;
    session.sendNotification("OnAutoMiningFeedback", "clientID", [String(message).slice(0,1000)]);
    return true;
  }
  function haulAction(session, id, action, reason) {
    const s = state(session);
    if (!hauling) throw Error("Hauling is unavailable.");
    try {
      const result = hauling.action(session, s, id, action, reason);
      if (action === "complete" && s.enabled) drones.arm(s);
      return result;
    }
    catch (error) {
      if (s.haul?.id === id) hauling.cancel(session, s, `Hauling paused: ${error.message}`);
      throw error;
    }
  }
  function cancelHaul(session, reason) {
    const s = state(session);
    if (s.haul) { departureGuard?.cancel(session, reason); if (s.haul) hauling.cancel(session, s, reason); }
  }
  function departureOptions(session) {
    const s = state(session);
    return { enabled: s.recallDrones || !!s.haul?.retreat, hauling: !!s.haul,
      haulID: s.haul?.id, retreatLayer: s.haul?.retreatLayer || null, stationID: s.stationID };
  }
  function departureStarted(session) {
    const s = state(session);
    drones.invalidate(s); s.droneArrival = false;
    resetMiningTargets(session, s);
    s.departureStatus = "Recalling drones before departure. Stop cancels departure.";
    feedback(session, s.departureStatus);
  }
  function departureEnded(session, message, pause) {
    const s = state(session);
    s.departureStatus = message;
    if (pause) {
      if (s.haul) hauling.cancel(session, s, message);
      s.enabled = false;
      save(session, s);
    }
  }
  return { command, tick, clientReady, surveyAck, applyProfile, snapshot, applySettings, feedback, haulAction, cancelHaul,
    dronesReady: session => { state(session).droneClientReady = true; },
    droneClaim: (session, id) => {
      const s = state(session), grant = s.droneLaunchGrant;
      const scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (grant?.kind === "ratFighters" && !ratDefense?.ratsPresent(scene, ship) ||
          grant?.kind === "ratMiners" && ratDefense?.ratsPresent(scene, ship)) throw Error("Rat situation changed before drone launch.");
      return drones.claim(session, s, id);
    },
    droneSync: (session, id, ids) => {
      const s = state(session), grant = s.droneLaunchGrant;
      const scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
      if (ids?.type === "list") ids = ids.items;
      if (!root || !grant?.claimed || grant.synced || Date.now() > grant.expires || grant.id !== id || grant.scene !== scene ||
          grant.shipID !== ship?.itemID || grant.characterID !== Number(session.characterID || session.charid) ||
          !Array.isArray(ids) || ids.length > 25 || ship?.pendingWarp || ship?.mode === "WARP") {
        throw Error("Drone state refresh is no longer authorized.");
      }
      grant.synced = true;
      const runtime = require(require("node:path").join(root, "server/src/services/drone/droneRuntime.js"));
      let count = 0;
      for (const rawID of new Set(ids)) {
        if (!Number.isSafeInteger(rawID) || rawID <= 0) continue;
        const entity = scene.getEntityByID(rawID);
        if (!runtime.isDroneEntity(entity) || Number(entity.ownerID) !== s.characterID ||
            Number(entity.controllerID) !== ship.itemID) continue;
        session.sendNotification("OnDroneStateChange", "charid", runtime.buildDroneStateNotificationTuple(entity));
        count++;
      }
      return { refreshed: count };
    },
    droneResult: (session, id, message, ids) => {
      const s = state(session), grant = drones.result(s, id, message);
      if (grant && ["arrival", "ratMiners"].includes(grant.kind) && Array.isArray(ids) && ids.length <= 200) {
        for (const value of ids) if (Number.isSafeInteger(value) && value > 0) {
          s.miningDroneIDs.add(value); s.mineIncompatibleIDs.delete(value);
        }
        s.nextMineScan = 0;
      }
      if (grant?.kind === "ratFighters" && Array.isArray(ids) && ids.length <= 200) {
        for (const value of ids) if (Number.isSafeInteger(value) && value > 0) s.ratManagedFighterIDs.add(value);
      }
      if (grant?.kind === "ratMiners") s.ratRestoreSuccess = Array.isArray(ids) && ids.some(value => Number.isSafeInteger(value) && value > 0);
    },
    ratGroups: (session, raw) => {
      if (typeof raw !== "string" || raw.length > 20000) throw Error("Invalid rat drone groups.");
      return ratDefense?.setGroups(session, state(session), JSON.parse(raw));
    },
    setDepartureGuard: guard => { departureGuard = guard; }, departureOptions, departureStarted, departureEnded,
    departureProgress: (session, message) => { state(session).departureStatus = message; } };
}
module.exports = { createController };
