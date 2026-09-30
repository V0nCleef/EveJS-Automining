"use strict";
const { fleetOreAcceptance,featurePreferences } = require("./featureSettings");
const {DEFAULT_SURVEY_SECONDS,DEFAULT_HAUL_THRESHOLD}=require("./settings");
const DRONES=Object.freeze(["launchDrones","droneGroupKey","ratDefenseEnabled","ratMiningGroupKey","ratFighterGroupKey","recallDrones"]);
const FIELDS = Object.freeze({
  mining: Object.freeze(["ores","order","approach","lock","survey","surveySeconds","compress","haulThreshold","oreMode","pickupStyle",
    "stackOreHold","stackFleetHangar","launchDrones","droneGroupKey","mineDrones","mineDroneOrder","mineDroneMode",
    "ratDefenseEnabled","ratMiningGroupKey","ratFighterGroupKey","recallDrones"]),
  boosting: Object.freeze(["receiveFleetOre","receiveFleetAcceptCompressed","receiveFleetAcceptUncompressed","autoBoost","coreEnabled","compressorEnabled","coreIntervals","compressorIntervals","fuelEnabled",
    "fuelStationID","fuelStorageKey","fuelReserveCycles","fuelTargetCycles","fuelUseCargo","compress","stackOreHold","stackFleetHangar",
    "launchDrones","droneGroupKey","ores","mineDrones","mineDroneOrder","mineDroneMode","ratDefenseEnabled","ratMiningGroupKey","ratFighterGroupKey","recallDrones"]),
  hauling: Object.freeze(["transportEnabled","transportStationID","transportStorageKey","transportThreshold","transportIdleSeconds",
    "stackOreHold","stackFleetHangar",...DRONES]),
  pve: Object.freeze(["pveMode","pveFleetID","pveAnchorID","pveHomeStationID","pveMaxJumps","pveBeltID","pveFireMode","pvePriority","pveOrbitOverride","pveDronesEnabled","pveDroneGroupKey","pveAmmoRestock","pveAmmoTargets","pveAmmoSourceKey",...DRONES]),
});
const DENIED = new Set(["__proto__","prototype","constructor"]);
const INVALID = Symbol("invalid-profile-value");
const MAX_PROFILE_BYTES = 30 * 1024;
const plain = value => value && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const own = (value,key) => {
  const descriptor = value && Object.getOwnPropertyDescriptor(value,key);
  return descriptor && Object.hasOwn(descriptor,"value") ? descriptor.value : INVALID;
};
function clone(value,depth=0,maxKeys=128) {
  if(value===null||typeof value==="boolean")return value;
  if(typeof value==="string")return value.length<=8192?value:INVALID;
  if(typeof value==="number")return Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER?value:INVALID;
  if(depth>=4)return INVALID;
  if(Array.isArray(value)) {
    if(value.length>1024)return INVALID;
    const result=[];
    for(let i=0;i<value.length;i++){const child=clone(own(value,String(i)),depth+1);if(child===INVALID)return INVALID;result.push(child);}
    return result;
  }
  if(!plain(value))return INVALID;
  const keys=Object.keys(value);if(keys.length>maxKeys||keys.some(key=>DENIED.has(key)))return INVALID;
  const result={};
  for(const key of keys){if(key.length>100)return INVALID;const child=clone(own(value,key),depth+1);if(child===INVALID)return INVALID;result[key]=child;}
  return result;
}
function profile(value,job,migrate=false) {
  if(!plain(value)||!Object.hasOwn(FIELDS,job))return {};
  const result={};
  for(const key of FIELDS[job]) {
    const data=clone(own(value,key),0,key==="pveAmmoTargets"?512:128);if(data!==INVALID)result[key]=data;
  }
  if(migrate&&job==="boosting"&&Object.keys(result).length) {
    const admission=fleetOreAcceptance(result);
    if(!Object.hasOwn(result,"receiveFleetAcceptCompressed"))result.receiveFleetAcceptCompressed=admission.compressed;
    if(!Object.hasOwn(result,"receiveFleetAcceptUncompressed"))result.receiveFleetAcceptUncompressed=admission.uncompressed;
  }
  if(migrate&&job==="pve"&&Object.keys(result).length&&!Object.hasOwn(result,"pveMode"))result.pveMode="belt";
  return Buffer.byteLength(JSON.stringify(result),"utf8")<=MAX_PROFILE_BYTES?result:{};
}
function cleanProfiles(value) {
  if(!plain(value))return {};
  const result={};
  for(const job of Object.keys(FIELDS)) {
    const saved=own(value,job);if(plain(saved))result[job]=profile(saved,job,true);
  }
  return result;
}
function captureProfile(s,job=s?.job) { return profile(s,job); }
function defaultProfile(job){return profile({
  ores:[],order:"nearest",approach:false,lock:true,survey:false,surveySeconds:DEFAULT_SURVEY_SECONDS,compress:false,haulThreshold:DEFAULT_HAUL_THRESHOLD,
  launchDrones:false,droneGroupKey:"",mineDrones:false,mineDroneOrder:"nearest",mineDroneMode:"spread",autoBoost:false,
  ratDefenseEnabled:false,ratMiningGroupKey:"",ratFighterGroupKey:"",recallDrones:true,...featurePreferences({job})
},job);}
function equal(a,b,key) {
  const left=clone(a,0,key==="pveAmmoTargets"?512:128),right=clone(b,0,key==="pveAmmoTargets"?512:128);
  return left!==INVALID&&right!==INVALID&&JSON.stringify(left)===JSON.stringify(right);
}
function switchProfile(p,current) {
  // The archive is server owned. A companion draft may never replace it.
  const result={};
  if(plain(p))for(const key of Object.keys(p)) {
    if(DENIED.has(key)||key==="jobProfiles")continue;
    const value=own(p,key);if(value!==INVALID)result[key]=value;
  }
  const job=result.job;
  if(!Object.hasOwn(FIELDS,job)||job===current?.job)return result;
  const target={...defaultProfile(job),...(cleanProfiles(current?.jobProfiles)[job]||{})};
  for(const key of FIELDS[job])if(Object.hasOwn(target,key)&&
      (!Object.hasOwn(result,key)||equal(result[key],own(current,key),key)))result[key]=clone(target[key],0,key==="pveAmmoTargets"?512:128);
  return result;
}
module.exports={cleanProfiles,captureProfile,switchProfile,profileFields:job=>Object.hasOwn(FIELDS,job)?[...FIELDS[job]]:[]};
