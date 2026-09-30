"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Only committed native ledger deliveries count as mining. Inventory changes
// intentionally never enter this module (compression/stacking/unloading).
function createStatistics(filename, options = {}) {
  const clock = options.clock || Date.now;
  const sessionStarted = clock();
  const blank = () => ({ units: 0, volume: 0, moduleVolume: 0, droneVolume: 0,
    wastedUnits: 0, deliveries: 0, docks: 0, trips: 0,
    collectedVolume: 0, deliveredVolume: 0, pickups: 0, transportDeliveries: 0,
    ratsDestroyed: 0, damageDealt: 0, ores: {} });
  let loaded = false, dirty = false, timer = null, ledger = null, revision = 0, combatAvailable = false;
  let data = { schemaVersion: 1, trackedSince: sessionStarted, characters: {} };
  const fleets = new Map(), seenDocks = new Map();
  const normalizedCharacters=new WeakSet();
  const idOf = session => Number(session?.characterID || session?.charid || 0);
  function load() {
    if (loaded) return;
    loaded = true;
    if (!filename || !fs.existsSync(filename)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (parsed.schemaVersion !== 1 || !parsed.characters || !Number.isFinite(parsed.trackedSince)) throw Error("Invalid statistics file");
      data = parsed;
    } catch (error) {
      // Never overwrite a corrupt file with empty counters.
      loaded = false;
      throw error;
    }
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty || !filename) return;
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(data) + "\n", "utf8");
    fs.renameSync(temporary, filename);
    dirty = false;
  }
  function changed() {
    revision++; dirty = true;
    if (!timer && filename) {
      timer = setTimeout(() => {
        timer = null;
        try { flush(); } catch (error) { console.error(`[AutoMining] Statistics save failed: ${error.message}`); }
      }, 5000);
      timer.unref?.();
    }
  }
  function character(id) {
    load();
    if (!data.characters[id]) data.characters[id] = { watermark: 0, total: blank(), days: {}, recent: [], tripIDs: [], runs: [], run: { started: clock(), total: blank(), recent: [] } };
    const c = data.characters[id];
    if (!c.run) c.run = { started: clock(), total: blank(), recent: [] };
    if (!c.runs) c.runs = [];
    // Additive schema migration: old counters and archived runs remain intact.
    // Reading a file never schedules persistence or rewrites it.
    if (!normalizedCharacters.has(c)) {
      function normalize(total) {
        total ||= blank();
        for (const [key, value] of Object.entries(blank())) {
          if (key !== "ores" && !Number.isFinite(total[key])) total[key] = value;
        }
        total.ores ||= {}; return total;
      }
      c.total = normalize(c.total); c.run.total = normalize(c.run.total);
      c.run.recent ||= []; c.recent ||= []; c.tripIDs ||= []; c.days ||= {};
      for (const day of Object.keys(c.days)) c.days[day] = normalize(c.days[day]);
      for (const run of c.runs) run.total = normalize(run.total);
      normalizedCharacters.add(c);
    }
    return data.characters[id];
  }
  function eventTime(entry) {
    if (Number.isFinite(entry.eventDateMs)) return entry.eventDateMs;
    try { return Number((BigInt(entry.eventDate) - 116444736000000000n) / 10000n); }
    catch { return clock(); }
  }
  function fleetOf(id) {
    const fleet = options.getFleet?.(id);
    return fleet && fleet.members?.has(id) ? fleet : null;
  }
  function operation(fleet) {
    const key = Number(fleet.fleetID);
    let op = fleets.get(key);
    if (!op || op.fleet !== fleet) {
      op = { fleet, started: clock(), members: new Map(), total: blank(), contributorsTrimmed: 0 }; fleets.set(key, op);
    }
    return op;
  }
  function operationMember(op, id) {
    const existing = op.members.get(id);
    if (existing) return existing;
    // Only adding a new contributor can require eviction. Keep current fleet
    // pilots (native maximum 256); bounded former rows may age out, totals never do.
    if (op.members.size >= 512) {
      const formerID = [...op.members.keys()].find(memberID => !op.fleet.members.has(memberID));
      if (formerID === undefined) return blank();
      op.members.delete(formerID); op.contributorsTrimmed++;
    }
    const member = blank(); op.members.set(id, member); return member;
  }
  function add(target, entry, volume, drone) {
    const units = Number(entry.quantity) || 0;
    target.units += units; target.volume += volume;
    target[drone ? "droneVolume" : "moduleVolume"] += volume;
    target.wastedUnits += Number(entry.quantityWasted) || 0;
    target.deliveries++;
    const key = String(entry.typeID);
    const ore = target.ores[key] || (target.ores[key] = { typeID: Number(entry.typeID), units: 0, volume: 0 });
    ore.units += units; ore.volume += volume;
  }
  function ingest(entry, reconcile = false) {
    const id = Number(entry?.characterID), eventID = Number(entry?.entryID);
    if (!(id > 0 && Number.isSafeInteger(eventID) && eventID > 0)) return false;
    const c = character(id), at = eventTime(entry);
    if (eventID <= c.watermark) return false;
    // A new installation starts tracking now; historical ledger is not lifetime.
    c.watermark = eventID;
    if (at < data.trackedSince) { changed(); return false; }
    const units = Math.max(0, Number(entry.quantity) || 0);
    const volume = units * Math.max(0, Number(options.typeVolume?.(Number(entry.typeID))) || 0);
    const drone = options.isDroneType?.(Number(entry.moduleTypeID)) === true;
    add(c.total, entry, volume, drone);
    const day = new Date(at).toISOString().slice(0, 10);
    add(c.days[day] || (c.days[day] = blank()), entry, volume, drone);
    const cutoff = new Date(clock() - 8 * 86400000).toISOString().slice(0, 10);
    for (const key of Object.keys(c.days)) if (key < cutoff) delete c.days[key];
    if (at >= c.run.started) add(c.run.total, entry, volume, drone);
    c.recent.push({ kind: "mining", at, typeID: Number(entry.typeID), units, volume, source: drone ? "drone" : "module" });
    c.recent = c.recent.slice(-24);
    if (at >= c.run.started) { c.run.recent.push(c.recent[c.recent.length - 1]); c.run.recent = c.run.recent.slice(-24); }
    // Replay has no trustworthy past fleet-membership context.
    const fleet = reconcile ? null : fleetOf(id);
    if (fleet) {
      const op = operation(fleet);
      add(operationMember(op, id), entry, volume, drone);
      add(op.total, entry, volume, drone);
    }
    changed(); return true;
  }
  const reconciled = new Set();
  function reconcile(id, beforeEntryID = Infinity) {
    if (!ledger || reconciled.has(id)) return;
    const c = character(id);
    // Once per pilot per process, never per HUD refresh. Native retention bounds
    // this recovery; live ingestion keeps cached summaries current afterward.
    const entries = ledger.getCharacterMiningLogs(id, { includeHidden: true });
    for (const entry of entries.slice().sort((a, b) => a.entryID - b.entryID)) if (entry.entryID > c.watermark && entry.entryID < beforeEntryID) ingest(entry, true);
    reconciled.add(id);
  }
  function attachLedger(nativeLedger) {
    if (!nativeLedger || typeof nativeLedger.recordMiningLedgerEvent !== "function") return false;
    ledger = nativeLedger;
    if (nativeLedger.recordMiningLedgerEvent._autoMiningStatistics === api) return true;
    const original = nativeLedger.recordMiningLedgerEvent;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (result?.success && result.data) {
        try { const id = Number(result.data.characterID); reconcile(id, result.data.entryID); ingest(result.data); }
        catch (error) { console.error(`[AutoMining] Statistics recording failed: ${error.message}`); }
      }
      return result;
    };
    wrapped._autoMiningStatistics = api;
    nativeLedger.recordMiningLedgerEvent = wrapped;
    return true;
  }
  const combatReceipts=new WeakSet(),destroyedRats=new WeakSet();
  function committedDamage(result) {
    const data=result?.damageResult?.success===true&&result.damageResult.data;
    if(!data)return 0;
    if(Array.isArray(data.perLayer))return data.perLayer.reduce((sum,layer)=>{
      const before=Number(layer.beforeHP),after=Number(layer.afterHP),applied=Number(layer.appliedEffective);
      return sum+([before,after,applied].every(Number.isFinite)?Math.max(0,Math.min(applied,before-Math.max(0,after))):0);
    },0);
    return ["shield","armor","structure"].reduce((sum,key)=>{
      const before=Number(data.beforeLayers?.[key]),after=Number(data.afterLayers?.[key]);
      return sum+([before,after].every(Number.isFinite)?Math.max(0,before-Math.max(0,after)):0);
    },0);
  }
  function combatContext(scene,attacker,target,adapters) {
    if(!scene||!attacker||target?.kind!=="ship"||target.nativeNpc!==true||attacker.nativeNpc===true||
        scene.instanceID||scene.dynamicEntities?.get(Number(target.itemID))!==target)return null;
    const group=String(adapters.typeInfo(Number(target.typeID))?.groupName||"");
    if(target.operatorKind!=="asteroidBeltRat"&&!/^Asteroid (Angel Cartel|Blood Raiders|Guristas|Sansha.s Nation|Serpentis) /i.test(group))return null;
    const isDrone=["drone","fighter"].includes(attacker.kind);
    const controller=isDrone?scene.getEntityByID?.(Number(attacker.controllerID)):attacker;
    if(controller?.kind!=="ship"||controller.nativeNpc===true)return null;
    const id=Number(controller.pilotCharacterID||controller.characterID||controller.session?.characterID||0);
    if(!(id>0))return null;
    const session=options.getSession(id);
    if(!session||idOf(session)!==id||scene.sessions?.get(session.clientID)!==session||
        Number(session.shipID||session.shipid)!==Number(controller.itemID)||!adapters.isActive(session)||
        session.spaceInstanceID||session._space?.instanceID)return null;
    const scopes=[adapters.scope(controller),adapters.scope(target)];
    if(scopes.some(scope=>!scope?.valid||scope.scoped))return null;
    const grid=e=>scene.getLivePublicGridClusterKeyForEntity?.(e)||scene.getPublicGridClusterKeyForEntity?.(e);
    // A native missile may commit after its pilot crosses to another public
    // grid. Native combat validates the hit; both identities must remain public.
    if(!grid(controller)||!grid(target))return null;
    return {session,id,target,targetID:Number(target.itemID),typeID:Number(target.typeID),source:isDrone?"drone":"weapon"};
  }
  function recordCombat(context,result) {
    const receipt=result?.damageResult;
    if(!context||!receipt||typeof receipt!=="object"||combatReceipts.has(receipt))return false;
    const damage=committedDamage(result);
    const data=receipt.success===true&&receipt.data;
    if(!(damage>0)||!data)return false;
    combatReceipts.add(receipt);
    const killed=data.destroyed===true&&result.destroyResult?.success===true&&!destroyedRats.has(context.target)&&
      Number(data.beforeLayers?.structure)>0&&Number(data.afterLayers?.structure)<=1e-9;
    if(killed)destroyedRats.add(context.target);
    const c=character(context.id),at=clock(),day=new Date(at).toISOString().slice(0,10);
    const targets=[c.total,c.run.total,c.days[day]||(c.days[day]=blank())],fleet=fleetOf(context.id);
    if(fleet){const op=operation(fleet);targets.push(operationMember(op,context.id),op.total);}
    for(const target of targets){target.damageDealt=(Number(target.damageDealt)||0)+damage;if(killed)target.ratsDestroyed=(Number(target.ratsDestroyed)||0)+1;}
    const event={kind:"combat",at,targetID:context.targetID,typeID:context.typeID,damage,killed,source:context.source};
    c.recent=[...c.recent,event].slice(-24);c.run.recent=[...c.run.recent,event].slice(-24);changed();return true;
  }
  function attachCombat(nativeDamage,adapters={}) {
    if(typeof nativeDamage?.applyWeaponDamageToTarget!=="function"||typeof options.getSession!=="function"||
        ![adapters.isActive,adapters.typeInfo,adapters.scope].every(fn=>typeof fn==="function"))return false;
    if(nativeDamage.applyWeaponDamageToTarget._autoMiningCombatStatistics===api){combatAvailable=true;return true;}
    const original=nativeDamage.applyWeaponDamageToTarget;
    const wrapped=function(scene,attacker,target,...args){
      let context=null;try{context=combatContext(scene,attacker,target,adapters);}catch{}
      // Preserve native values and exceptions. Instrument only its successful,
      // synchronous committed result; attempted shots and despawns have none.
      const result=original.call(this,scene,attacker,target,...args);
      if(context)try{recordCombat(context,result);}catch(error){console.error(`[AutoMining] Combat statistics recording failed: ${error.message}`);}
      return result;
    };
    wrapped._autoMiningCombatStatistics=api;nativeDamage.applyWeaponDamageToTarget=wrapped;combatAvailable=true;return true;
  }
  function counter(session, field, kind) {
    const id = idOf(session); if (!(id > 0)) return false;
    const c = character(id), at = clock(), day = new Date(at).toISOString().slice(0, 10);
    c.total[field]++; c.run.total[field]++;
    (c.days[day] || (c.days[day] = blank()))[field]++;
    c.recent.push({ kind, at }); c.recent = c.recent.slice(-24);
    c.run.recent.push({ kind, at }); c.run.recent = c.run.recent.slice(-24);
    const fleet = fleetOf(id);
    if (fleet) {
      const op = operation(fleet);
      operationMember(op, id)[field]++; op.total[field]++;
    }
    changed(); return true;
  }
  function observeDock(session, previousStationID, newStationID) {
    const id = idOf(session), next = Number(newStationID) || 0;
    const previous = Number(previousStationID) || 0;
    // A login already docked is not a completed docking transition.
    if (!id || previous || !next || seenDocks.get(id) === next) {
      if (!next) seenDocks.delete(id);
      return false;
    }
    seenDocks.set(id, next); return counter(session, "docks", "dock");
  }
  function recordTrip(session, tripID) {
    const id = idOf(session); if (!id || !tripID) return false;
    const c = character(id), key = String(tripID);
    if (c.tripIDs.includes(key)) return false;
    c.tripIDs.push(key); c.tripIDs = c.tripIDs.slice(-64);
    return counter(session, "trips", "unload");
  }
  function recordTransport(session, eventID, kind, volume, completed = true) {
    const id = idOf(session);
    if (!id || typeof eventID !== "string" || eventID.length > 160 || !eventID ||
        !["pickup", "delivery"].includes(kind) || !Number.isFinite(volume) || volume < 0 ||
        volume === 0 && !(kind === "pickup" && completed)) return false;
    const c = character(id), key = kind + ":" + eventID;
    c.transportIDs ||= [];
    if (c.transportIDs.includes(key)) return false;
    c.transportIDs = [...c.transportIDs, key].slice(-256);
    const at = clock(), day = new Date(at).toISOString().slice(0, 10);
    const targets = [c.total, c.run.total, c.days[day] || (c.days[day] = blank())];
    const fleet = fleetOf(id);
    if (fleet) {
      const op = operation(fleet);
      targets.push(operationMember(op, id), op.total);
    }
    for (const target of targets) {
      const field = kind === "pickup" ? "collectedVolume" : "deliveredVolume";
      target[field] = (Number(target[field]) || 0) + volume;
      if (completed) {
        const count = kind === "pickup" ? "pickups" : "transportDeliveries";
        target[count] = (Number(target[count]) || 0) + 1;
      }
    }
    const event = { kind, at, volume };
    c.recent = [...c.recent, event].slice(-24); c.run.recent = [...c.run.recent, event].slice(-24);
    changed(); return true;
  }
  function sum(values) {
    const total = blank();
    for (const value of values) {
      for (const key of ["units", "volume", "moduleVolume", "droneVolume", "wastedUnits", "deliveries", "docks", "trips", "collectedVolume", "deliveredVolume", "pickups", "transportDeliveries", "ratsDestroyed", "damageDealt"]) total[key] += Number(value[key]) || 0;
      for (const ore of Object.values(value.ores || {})) {
        const row = total.ores[ore.typeID] || (total.ores[ore.typeID] = { typeID: ore.typeID, units: 0, volume: 0 });
        row.units += ore.units; row.volume += ore.volume;
      }
    }
    return total;
  }
  function present(total, since, recent = []) {
    const elapsedSeconds = Math.max(0, (clock() - since) / 1000);
    return { ...blank(), ...total, ores: Object.values(total.ores).sort((a, b) => b.volume - a.volume),
      elapsedSeconds, averageVolumePerHour: elapsedSeconds > 0 ? total.volume * 3600 / elapsedSeconds : 0,
      recent: recent.slice().reverse(), mostMinedTypeID: Object.values(total.ores).sort((a, b) => b.volume - a.volume)[0]?.typeID || 0 };
  }
  function snapshot(session, request = {}) {
    const id = idOf(session); if (!(id > 0)) throw Error("AutoMining needs a character session.");
    const view = request.view || "pilot", period = request.period || "session";
    if (!["pilot", "fleet"].includes(view) || !["session", "today", "week", "tracked", ...(view === "fleet" ? ["operation"] : [])].includes(period)) throw Error("Invalid statistics view.");
    const c = character(id); reconcile(id);
    if (view === "fleet") {
      const fleet = fleetOf(id);
      if (!fleet) return { revision, view, period: "operation", combatAvailable, inFleet: false, members: [] };
      const op = operation(fleet);
      const former = [...op.members.keys()].filter(memberID => !fleet.members.has(memberID)).sort((a, b) => a - b);
      const members = [...fleet.members.keys(), ...former].map(memberID => {
        const memberSession = options.getSession?.(memberID);
        return { characterID: memberID, name: options.characterName?.(memberID) || String(memberID), online: !!memberSession,
          inFleet: fleet.members.has(memberID), participated: op.members.has(memberID),
          totals: present(op.members.get(memberID) || blank(), op.started) };
      });
      return { revision, view, period: "operation", combatAvailable, inFleet: true, operationSince: op.started, members,
        contributorsTrimmed: op.contributorsTrimmed, totals: present(op.total, op.started) };
    }
    const today = new Date(clock()).toISOString().slice(0, 10);
    const since = period === "session" ? c.run.started : period === "today" ? Date.parse(today) : period === "week" ? Math.max(data.trackedSince, Date.parse(today) - 6 * 86400000) : data.trackedSince;
    const total = period === "session" ? c.run.total : period === "tracked" ? c.total : sum(Object.entries(c.days).filter(([day]) => period === "today" ? day === today : Date.parse(day) >= Date.parse(today) - 6 * 86400000).map(([, value]) => value));
    return { revision, view, period, combatAvailable, trackedSince: data.trackedSince, sessionSince: c.run.started, since,
      dayBoundary: "UTC", historyRetentionDays: 90, recoveredHistory: false,
      totals: present(total, Math.max(data.trackedSince, since), (period === "session" ? c.run.recent : c.recent).filter(row => row.at >= since)) };
  }
  function resetRun(session) {
    const id = idOf(session); if (!(id > 0)) throw Error("AutoMining needs a character session.");
    const c = character(id); reconcile(id);
    const ended = clock();
    const previousRun = c.run, previousRuns = c.runs;
    c.runs = [...c.runs, { started: c.run.started, ended, total: c.run.total }].slice(-50);
    c.run = { started: ended, total: blank(), recent: [] };
    changed();
    try { flush(); }
    catch (error) { c.run = previousRun; c.runs = previousRuns; throw error; }
    return snapshot(session, { view: "pilot", period: "session" });
  }
  function runSessions(session, request = {}) {
    const id = idOf(session); if (!(id > 0)) throw Error("AutoMining needs a character session.");
    const c = character(id);
    const offset = Math.max(0, Math.trunc(Number(request.offset) || 0));
    const limit = Math.max(1, Math.min(20, Math.trunc(Number(request.limit) || 10)));
    return { total: c.runs.length, offset, limit, rows: c.runs.slice().reverse().slice(offset, offset + limit).map(run => ({
      started: run.started, ended: run.ended, durationSeconds: Math.max(0, (run.ended - run.started) / 1000),
      totals: { ...present(run.total, run.started), elapsedSeconds: Math.max(0, (run.ended - run.started) / 1000),
        averageVolumePerHour: run.ended > run.started ? run.total.volume * 3600000 / (run.ended - run.started) : 0 }
    })) };
  }
  const api = { attachLedger, attachCombat, ingest, observeDock, recordTrip, recordTransport, snapshot, resetRun, sessions: runSessions, flush };
  return api;
}
module.exports = { createStatistics };
