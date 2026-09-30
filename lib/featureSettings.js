"use strict";
const MODES = ["leave", "jettison", "unload", "pickup", "fleetHangar"];
const JOBS = ["mining", "hauling", "boosting", "pve"];
const BOOLEAN_DEFAULTS = {
  stackOreHold: true, stackFleetHangar: true, jettisonAbandon: false,
  coreEnabled: false, compressorEnabled: false, fuelEnabled: false, fuelUseCargo: false, actionNotifications: true,
  receiveFleetOre: false, receiveFleetAcceptCompressed: true, receiveFleetAcceptUncompressed: true,
  transportEnabled: false, fleetEnabled: false, pveDronesEnabled: false, reinforcementAutoCall: false, pveAmmoRestock: true,
};
const validID = value => Number.isSafeInteger(value) && value > 0;
const cycleCount = (value, fallback, maximum) => Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : fallback;
function ammoTargets(value, strict=false) {
  if(value===undefined)return {};
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length>512) {
    if(strict)throw Error("Invalid PVE ammunition targets.");return {};
  }
  const result={};
  for(const [key,quantity] of Object.entries(value)) {
    if(!/^[1-9][0-9]{0,9}$/.test(key)||!validID(Number(key))||!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000) {
      if(strict)throw Error("Invalid PVE ammunition targets.");continue;
    }
    result[key]=quantity;
  }
  return result;
}
function intervals(value, strict = false) {
  const result = {};
  if (value === undefined) return result;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 64) {
    if (strict) throw Error("Invalid industrial activation intervals.");
    return result;
  }
  for (const [key, seconds] of Object.entries(value)) {
    if (!/^[1-9][0-9]{0,9}$/.test(key) || !validID(Number(key)) || typeof seconds !== "number" ||
        !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
      if (strict) throw Error("Invalid industrial activation intervals.");
      continue;
    }
    result[key] = seconds;
  }
  return result;
}
function trackedCan(value) {
  if (!value || typeof value !== "object" || !validID(value.containerID) || !validID(value.shipID) || !validID(value.systemID)) return null;
  return { containerID: value.containerID, shipID: value.shipID, systemID: value.systemID, abandoned: value.abandoned === true };
}
function fleetOreAcceptance(record = {}) {
  return {
    compressed: typeof record?.receiveFleetAcceptCompressed === "boolean" ? record.receiveFleetAcceptCompressed : true,
    // Missing settings retain the old compressor-dependent admission policy.
    // Once saved, the two explicit choices stay independent of that module.
    uncompressed: typeof record?.receiveFleetAcceptUncompressed === "boolean" ? record.receiveFleetAcceptUncompressed : record?.compressorEnabled !== true,
  };
}
function featurePreferences(record = {}) {
  record ||= {};
  const oreMode = MODES.includes(record.oreMode) ? record.oreMode : record.haulEnabled === true ? "unload" : "leave";
  const result = { oreMode, haulEnabled: oreMode === "unload" };
  for (const [key, fallback] of Object.entries(BOOLEAN_DEFAULTS)) result[key] = typeof record[key] === "boolean" ? record[key] : fallback;
  const admission = fleetOreAcceptance(record);
  result.receiveFleetAcceptCompressed = admission.compressed;
  result.receiveFleetAcceptUncompressed = admission.uncompressed;
  result.coreIntervals = intervals(record.coreIntervals);
  result.compressorIntervals = intervals(record.compressorIntervals);
  result.fuelStationID = validID(record.fuelStationID) ? record.fuelStationID : 0;
  result.fuelStorageKey = typeof record.fuelStorageKey === "string" && record.fuelStorageKey.length <= 100 ? record.fuelStorageKey : "personal";
  result.fuelReserveCycles = cycleCount(record.fuelReserveCycles, 2, 1000);
  result.fuelTargetCycles = Math.max(result.fuelReserveCycles + 1, cycleCount(record.fuelTargetCycles, 20, 10000));
  result.jettisonCan = trackedCan(record.jettisonCan);
  result.shipRole = record.shipRole === "transport" ? "transport" : "boosting";
  result.job = JOBS.includes(record.job) ? record.job : result.shipRole === "transport" ? "hauling" :
    [record.autoBoost, record.coreEnabled, record.compressorEnabled, record.fuelEnabled].includes(true) ? "boosting" : "mining";
  result.shipRole = result.job === "hauling" ? "transport" : "boosting";
  result.pickupStyle = record.pickupStyle === "onArrival" ? "onArrival" : "binFirst";
  if (typeof record.fleetEnabled !== "boolean") result.fleetEnabled = record.inviteFleet === true;
  result.fleetMode = record.fleetMode === "automatic" || record.fleetMode === undefined && record.inviteFleet === true ? "automatic" : "manual";
  result.fleetGroupID = typeof record.fleetGroupID === "string" && record.fleetGroupID.length <= 64 ? record.fleetGroupID : "";
  result.pveBeltID = validID(record.pveBeltID) ? record.pveBeltID : 0;
  result.pveMode = ["belt", "escort", "standby"].includes(record.pveMode) ? record.pveMode : "belt";
  result.pveFleetID = validID(record.pveFleetID) ? record.pveFleetID : 0;
  result.pveAnchorID = validID(record.pveAnchorID) ? record.pveAnchorID : 0;
  result.pveHomeStationID = validID(record.pveHomeStationID) ? record.pveHomeStationID : 0;
  result.pveMaxJumps = Number.isSafeInteger(record.pveMaxJumps) && record.pveMaxJumps >= 0 && record.pveMaxJumps <= 50 ? record.pveMaxJumps : 2;
  result.reinforcementResponderLimit = cycleCount(record.reinforcementResponderLimit, 1, 8);
  result.pveAmmoTargets = ammoTargets(record.pveAmmoTargets);
  result.pveAmmoSourceKey = typeof record.pveAmmoSourceKey === "string" && record.pveAmmoSourceKey.length <= 100 ? record.pveAmmoSourceKey : "personal";
  result.pveFireMode = record.pveFireMode === "spread" ? "spread" : "focus";
  result.pvePriority = record.pvePriority === "weakest" ? "weakest" : "strongest";
  result.pveOrbitOverride = Number.isFinite(record.pveOrbitOverride) && record.pveOrbitOverride >= 0 && record.pveOrbitOverride <= 1000000 ? record.pveOrbitOverride : 0;
  result.pveDroneGroupKey = typeof record.pveDroneGroupKey === "string" && record.pveDroneGroupKey.length <= 1024 ? record.pveDroneGroupKey : "";
  result.pveInterrupted = record.pveInterrupted === true;
  result.transportStationID = validID(record.transportStationID) ? record.transportStationID : 0;
  result.transportStorageKey = typeof record.transportStorageKey === "string" && record.transportStorageKey.length <= 100 ? record.transportStorageKey : "personal";
  result.transportThreshold = cycleCount(record.transportThreshold, 95, 100);
  result.transportIdleSeconds = cycleCount(record.transportIdleSeconds, 60, 3600);
  result.transportInterrupted = record.transportInterrupted === true;
  return result;
}
function featureSnapshot(s) {
  const { jettisonCan, haulEnabled, transportInterrupted, pveInterrupted, ...settings } = featurePreferences(s);
  return settings;
}
function featureRequest(p, current) {
  const supplied = { ...featureSnapshot(current) };
  for (const key of Object.keys(supplied)) if (p[key] !== undefined) supplied[key] = p[key];
  if (p.shipRole !== undefined && !["boosting", "transport"].includes(p.shipRole)) throw Error("Invalid transport settings.");
  // Old companions still send the two-role setting. New clients use job as
  // the sole scheduler selector; retained feature switches are configuration.
  if (p.job === undefined && p.shipRole !== undefined && p.shipRole !== current.shipRole)
    supplied.job = p.shipRole === "transport" ? "hauling" : "boosting";
  if (!JOBS.includes(supplied.job) || !["binFirst", "onArrival"].includes(supplied.pickupStyle) ||
      !["manual", "automatic"].includes(supplied.fleetMode) || typeof supplied.fleetGroupID !== "string" || supplied.fleetGroupID.length > 64 ||
      !Number.isSafeInteger(supplied.pveBeltID) || supplied.pveBeltID < 0 || !["focus", "spread"].includes(supplied.pveFireMode) ||
      !["strongest", "weakest"].includes(supplied.pvePriority) || !Number.isFinite(supplied.pveOrbitOverride) ||
      supplied.pveOrbitOverride < 0 || supplied.pveOrbitOverride > 1000000 || typeof supplied.pveDroneGroupKey !== "string" || supplied.pveDroneGroupKey.length > 1024)
    throw Error("Invalid job settings.");
  supplied.pveAmmoTargets = ammoTargets(supplied.pveAmmoTargets,true);
  if(typeof supplied.pveAmmoSourceKey!=="string"||supplied.pveAmmoSourceKey.length>100)throw Error("Invalid PVE ammunition targets.");
  if (!["belt", "escort", "standby"].includes(supplied.pveMode) ||
      [supplied.pveFleetID, supplied.pveAnchorID, supplied.pveHomeStationID].some(id => !Number.isSafeInteger(id) || id < 0) ||
      !Number.isSafeInteger(supplied.pveMaxJumps) || supplied.pveMaxJumps < 0 || supplied.pveMaxJumps > 50 ||
      cycleCount(supplied.reinforcementResponderLimit, null, 8) === null)
    throw Error("Invalid job settings.");
  supplied.shipRole = supplied.job === "hauling" ? "transport" : "boosting";
  // Preserve the old companion's haul toggle, unless the new mode itself changed.
  if ((p.oreMode === undefined || p.oreMode === current.oreMode) && p.haulEnabled !== undefined && p.haulEnabled !== current.haulEnabled)
    supplied.oreMode = p.haulEnabled ? "unload" : current.oreMode === "unload" ? "leave" : current.oreMode;
  if (!MODES.includes(supplied.oreMode)) throw Error("Invalid ore handling mode.");
  if (!["boosting", "transport"].includes(supplied.shipRole) ||
      !Number.isSafeInteger(supplied.transportStationID) || supplied.transportStationID < 0 ||
      typeof supplied.transportStorageKey !== "string" || supplied.transportStorageKey.length > 100 ||
      cycleCount(supplied.transportThreshold, null, 100) === null ||
      cycleCount(supplied.transportIdleSeconds, null, 3600) === null)
    throw Error("Invalid transport settings.");
  for (const key of Object.keys(BOOLEAN_DEFAULTS)) if (typeof supplied[key] !== "boolean") throw Error("Invalid ore or industrial automation setting.");
  supplied.coreIntervals = intervals(supplied.coreIntervals, true);
  supplied.compressorIntervals = intervals(supplied.compressorIntervals, true);
  if (!Number.isSafeInteger(supplied.fuelStationID) || supplied.fuelStationID < 0 ||
      typeof supplied.fuelStorageKey !== "string" || supplied.fuelStorageKey.length > 100 ||
      cycleCount(supplied.fuelReserveCycles, null, 1000) === null || cycleCount(supplied.fuelTargetCycles, null, 10000) === null ||
      supplied.fuelTargetCycles <= supplied.fuelReserveCycles) throw Error("Invalid fuel restocking settings.");
  return { ...supplied, haulEnabled: supplied.oreMode === "unload" };
}
module.exports = { featurePreferences, featureSnapshot, featureRequest, intervals, ammoTargets, trackedCan, fleetOreAcceptance, JOBS };
