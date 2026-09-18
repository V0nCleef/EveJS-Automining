"use strict";
const { matchesOre } = require("./commands");
const { planDistinct } = require("./targets");
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
      approach: false, lock: true, survey: false, nextSurvey: 0, approachTarget: null,
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
    if (cmd.action === "help" || cmd.action === "status") return `AutoMining ${s.enabled ? "ON" : "OFF"}, ${s.order}, filter: ${s.ores.join(", ") || "all compatible resources"}. Approach ${s.approach ? "ON" : "OFF"}, lock ${s.lock ? "ON" : "OFF"}, survey ${s.survey ? "ON" : "OFF"} (${s.surveySeconds}s), compress ${s.compress ? "ON" : "OFF"}. ${s.enabled ? [s.status, s.approachStatus, s.surveyStatus, s.compressionStatus].filter(Boolean).join(" ") : ""} Commands: on | off | ore,ore | clear | nearest | furthest | approach on/off | lock on/off | survey on/off | survey seconds | compress on/off (prefix / or !).`;
    if (cmd.action === "toggle") {
      s[cmd.setting] = cmd.enabled;
      s.next = 0;
      if (cmd.setting === "compress") { s.nextCompression = 0; s.compressionStatus = ""; }
      if (cmd.setting === "approach" || cmd.setting === "lock") s.replan = true;
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
    if (cmd.action === "nearest" || cmd.action === "furthest") {
      s.order = cmd.action;
      s.replan = true;
      s.next = 0;
      return `AutoMining selects ${s.order} compatible targets in range. Current cycles finish normally. ${s.enabled ? "ON" : "OFF"}.` + save(session, s);
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
      if (changed) s.replan = true;
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
    if (!s.enabled || now < s.next) return;
    s.next = now + 1000;
    const api = getAPI();
    const ship = scene.getShipEntityForSession(session);
    if (!api || !ship || ship.kind !== "ship") {
      s.status = "Paused; waiting for a mining ship in space.";
      return;
    }
    if (ship.itemID !== s.shipID || scene !== s.scene) {
      s.owned.clear(); s.locks.clear(); s.assignments.clear();
      s.approachTarget = null; s.scene = scene; s.shipID = ship.itemID;
      s.nextSurvey = 0; s.nextCompression = 0;
      s.replan = true; s.moduleCache = []; s.nextModuleCheck = 0;
    }
    if (ship.mode === "WARP" || ship.pendingWarp || ship.pendingDock || ship.isCloaked || ship.cloaked) {
      stop(session, s);
      s.status = "Paused during travel or cloak.";
      return;
    }
    if (s.compress && compress && now >= s.nextCompression) {
      s.nextCompression = now + 10_000;
      try { s.compressionStatus = compress(scene, session, ship); }
      catch (error) { s.compressionStatus = "Compression unavailable; mining continues."; logError(`[AutoMining] Compression failed: ${error.message}`); }
    }
    updateSurvey({ api, scene, session, ship, state: s, now });
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
    // Native mining owns active cycles. No asteroid discovery or dogma rebuild
    // is needed while every known miner is working. Check fitting every 5s.
    if (!s.replan && !s.approachTarget && now < s.nextModuleCheck && allWorking(s.moduleCache)) return;
    if (!s.replan && now < s.nextSearch && !effects.size && !ship.pendingTargetLocks?.size && !s.approachTarget && s.lastLockCount === ship.lockedTargets?.size) return;
    const modules = api.modules(ship);
    s.moduleCache = modules; s.nextModuleCheck = now + 5000;
    if (!s.replan && !s.approachTarget && allWorking(modules)) {
      s.status = `Mining with ${modules.length} module(s).`;
      return;
    }
    let rocks;
    // Reuse directly looked-up, still-valid assigned asteroids across cycles.
    // A depletion, invalid assignment, changed filter or new module falls back
    // to fresh scene discovery and the full distinct-target planner.
    if (!s.replan && api.target && modules.length) {
      const existing = new Map();
      if (modules.every(m => {
        const id = effects.get(m.item.itemID)?.targetID || s.assignments.get(m.item.itemID);
        const rock = id && (existing.get(id) || api.target(scene, ship, id));
        if (!rock || !matchesOre(rock.name,s.ores) || !api.compatible(scene,ship,m,rock,now)) return false;
        existing.set(id,rock);return true;
      })) rocks = [...existing.values()];
    }
    if (!rocks) rocks = api.candidates(scene, ship).filter(r => matchesOre(r.name, s.ores));
    s.replan = false;
    const occupied = new Set();
    const current = new Map();
    const moduleIDs = new Set(modules.map(m => m.item.itemID));
    for (const [id, effect] of s.owned) if (effects.get(id) !== effect) s.owned.delete(id);
    for (const [id] of s.assignments) if (!moduleIDs.has(id)) s.assignments.delete(id);
    const rows = modules.map(m => ({ ...m, targets: rocks.filter(r => api.compatible(scene, ship, m, r, now)) }));
    updateApproach({ api, scene, session, ship, state: s, modules, rocks, rows, now, save });
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
    for (const m of rows) m.targets.sort((a, b) => (s.order === "furthest" ? b.distance - a.distance : a.distance - b.distance) || a.id - b.id);
    const planned = planDistinct(rows.filter(m => !effects.has(m.item.itemID)), occupied);
    for (const rock of planned.values()) occupied.add(rock.id);
    for (const m of rows) {
      if (effects.has(m.item.itemID)) continue;
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
    if (!["nearest", "furthest"].includes(prefs.order) || ["lock", "survey", "approach"].some(k => typeof prefs[k] !== "boolean")) throw new Error("Invalid AutoMining profile settings");
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
        !["nearest", "furthest"].includes(p.order) || !validSurveySeconds(p.surveySeconds) ||
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
