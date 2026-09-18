"use strict";
const { matchesOre } = require("./commands");
const { planDistinct, ORDERS, compareTargets } = require("./targets");
const { stopApproach, updateApproach, updateSurvey } = require("./assistance");
const { DEFAULT_SURVEY_SECONDS, validSurveySeconds, MAX_ORE_FILTERS } = require("./settings");

function createController(getAPI, getSpace, logError = console.error, preferences = null, compress = null) {
  const players = new WeakMap();
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
      replan: true, moduleCache: [], nextModuleCheck: 0, nextSearch: 0,
      owned: new Map(), locks: new Set(), assignments: new Map(),
      ...(preferences?.get(Number(session.characterID || session.charid)) || {}),
    });
    return players.get(session);
  }
  function save(session, s) {
    if (s.deferSave) return "";
    try { preferences?.save(Number(session.characterID || session.charid), s); return ""; }
    catch (error) { logError(`[AutoMining] Preference save failed: ${error.message}`); return " Applied for this session, but saving failed; check server log."; }
  }
  function stop(session, s) {
    const ship = s.scene?.getShipEntityForSession(session);
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
    s.focusTarget = null;
    s.approachStatus = "";
    s.replan = true;
    s.next = 0;
    s.nextSearch = 0;
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
      s.enabled = false;
      const saved = save(session, s);
      stop(session, s);
      return "AutoMining OFF. Mining modules it started are stopping under normal cycle rules." + saved;
    }
    if (cmd.action === "clear" || cmd.action === "filter") {
      const next = cmd.action === "clear" ? [] : [...cmd.ores];
      if (next.length > MAX_ORE_FILTERS) return `AutoMining: maximum ${MAX_ORE_FILTERS} ore filters.`;
      const changed = JSON.stringify(s.ores) !== JSON.stringify(next);
      if (changed) { s.replan = true; s.focusTarget = null; }
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
    const scene = getSpace().getSceneForSession(session);
    const ship = scene?.getShipEntityForSession(session);
    if (!ship || ship.kind !== "ship") {
      s.enabled = true; s.next = 0;
      s.status = "Waiting to undock in a ship with online mining modules.";
      return "AutoMining ON. It will resume when you undock with online mining modules." + save(session, s);
    }
    const modules = api.modules(ship);
    if (s.shipID && (s.shipID !== ship.itemID || s.scene !== scene)) stop(session, s);
    const alreadyEnabled = s.enabled && s.shipID === ship.itemID && s.scene === scene;
    if (!alreadyEnabled) s.replan = true;
    s.enabled = true;
    s.scene = scene;
    s.shipID = ship.itemID;
    s.next = 0;
    s.status = modules.length ? "Looking for targets." : "Waiting for online mining modules.";
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
    if (!s.enabled) return;
    const api = getAPI();
    const ship = scene.getShipEntityForSession(session);
    const warping = ship && (ship.mode === "WARP" || ship.pendingWarp);
    // A warp order takes priority over the normal one-second work interval.
    if ((!warping || s.pausedForWarp) && now < s.next) return;
    s.next = now + 1000;
    if (!api || !ship || ship.kind !== "ship") {
      s.status = "Paused; waiting for a mining ship in space.";
      return;
    }
    if (ship.itemID !== s.shipID || scene !== s.scene) {
      s.owned.clear(); s.locks.clear(); s.assignments.clear();
      s.approachTarget = null; s.focusTarget = null; s.scene = scene; s.shipID = ship.itemID;
      s.nextSurvey = 0; s.nextCompression = 0;
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0;
      s.replan = true; s.moduleCache = []; s.nextModuleCheck = 0;
    }
    if (warping) {
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
    if (ship.pendingDock || ship.isCloaked || ship.cloaked) {
      stop(session, s);
      s.surveyGrid = null; s.surveyResourceID = null; s.nextSurveyCheck = 0; s.nextSurvey = 0;
      s.surveyStatus = "";
      s.status = "Paused during travel or cloak.";
      return;
    }
    if (s.pausedForWarp) {
      const grid = api.surveyGrid(scene, ship);
      if (grid !== s.resumeGrid) { s.resumeGrid = grid; s.nextResumeCheck = 0; }
      s.status = "Waiting to resume: no ore, ice or gas in this local grid.";
      if (now < s.nextResumeCheck) return;
      s.nextResumeCheck = now + 5000;
      const resource = grid && api.surveyResource(scene, ship, null);
      if (!resource) return;
      s.pausedForWarp = false;
      // Reuse the arrival check for survey; no second field search is needed.
      s.surveyGrid = grid; s.surveyResourceID = resource; s.nextSurveyCheck = now + 5000;
      s.replan = true; s.nextSearch = 0;
    }
    if (s.compress && compress && now >= s.nextCompression) {
      s.nextCompression = now + 10_000;
      try { s.compressionStatus = compress(scene, session, ship); }
      catch (error) { s.compressionStatus = "Compression unavailable; mining continues."; logError(`[AutoMining] Compression failed: ${error.message}`); }
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
    s.replan = false;
    const occupied = new Set();
    const current = new Map();
    const moduleIDs = new Set(modules.map(m => m.item.itemID));
    for (const [id, effect] of s.owned) if (effects.get(id) !== effect) s.owned.delete(id);
    for (const [id] of s.assignments) if (!moduleIDs.has(id)) s.assignments.delete(id);
    const rows = modules.map(m => ({ ...m, targets: rocks.filter(r => api.compatible(scene, ship, m, r, now)) }));
    const waitingForApproach = updateApproach({ api, scene, session, ship, state: s, modules, rocks, rows, now, save });
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
    const priority = compareTargets(s.order);
    for (const m of rows) m.targets.sort((a, b) =>
      Number(b.id === s.focusTarget) - Number(a.id === s.focusTarget) || priority(a, b));
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
        if (s) { s.enabled = false; try { stop(session, s); } catch {} }
        logError(`[AutoMining] Automation stopped after error: ${error.message}`);
      }
    }
  }
  function clientReady(session, hudReady = false) {
    if (!(Number(session?.characterID || session?.charid) > 0)) return false;
    const s = state(session);
    s.surveyClientReady = true; s.nextSurvey = 0;
    s.hudReady = hudReady === true || hudReady === 1;
    return true;
  }
  function surveyAck(session, success, reason) {
    const s = players.get(session);
    if (!s?.surveyClientReady) return false;
    s.surveyStatus = success ? `Mining Surveyor refreshed; repeats every ${s.surveySeconds} seconds.`
      : `Survey waiting: ${String(reason || "client unavailable").slice(0, 160)}.`;
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
    const settings = { ores: [...s.ores], order: s.order, approach: s.approach, lock: s.lock, survey: s.survey, compress: s.compress, surveySeconds: s.surveySeconds };
    return { settings, revision: JSON.stringify(settings), enabled: s.enabled,
      status: s.enabled ? (getSpace().getSceneForSession(session)?.getShipEntityForSession(session)
        ? [s.status, s.approachStatus, s.surveyStatus, s.compressionStatus].filter(Boolean).join(" ")
        : "Paused while docked. AutoMining resumes in space.") : "AutoMining is off." };
  }
  function applySettings(session, raw) {
    if (typeof raw !== "string" || raw.length > 100000) throw new Error("Invalid AutoMining settings request.");
    const request = JSON.parse(raw), p = request.settings;
    if (!p || !Array.isArray(p.ores) || p.ores.length > MAX_ORE_FILTERS || p.ores.some(x => typeof x !== "string" || !x.trim() || x.length > 80 || !/^[\p{L}\p{N} '-]+$/u.test(x)) ||
        !ORDERS.includes(p.order) || !validSurveySeconds(p.surveySeconds) ||
        ["approach", "lock", "survey", "compress"].some(k => typeof p[k] !== "boolean")) throw new Error("Invalid AutoMining settings. Check the survey interval and ore list.");
    if (request.revision !== snapshot(session).revision) throw new Error("Settings changed elsewhere. Click Reload before applying your changes.");
    const s = state(session); s.deferSave = true;
    try {
      command(session, {action:"filter", ores:[...new Set(p.ores.map(x=>x.trim().toLowerCase().replace(/\s+/g," ")))]});
      if (s.order !== p.order) command(session, {action:p.order});
      for (const setting of ["approach", "lock", "survey", "compress"]) if (s[setting] !== p[setting]) command(session, {action:"toggle",setting,enabled:p[setting]});
      if (s.surveySeconds !== p.surveySeconds) command(session, {action:"surveyInterval",seconds:p.surveySeconds});
    } finally { delete s.deferSave; }
    return "AutoMining settings applied." + save(session, s);
  }
  function feedback(session, message) {
    if (!players.get(session)?.hudReady) return false;
    session.sendNotification("OnAutoMiningFeedback", "clientID", [String(message).slice(0,1000)]);
    return true;
  }
  return { command, tick, clientReady, surveyAck, applyProfile, snapshot, applySettings, feedback };
}
module.exports = { createController };
