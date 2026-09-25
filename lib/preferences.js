"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { surveySeconds, haulThreshold, MAX_ORE_FILTERS } = require("./settings");
const { ORDERS } = require("./targets");
const { validGroupKey } = require("./droneLaunch");
const { defenseThreshold } = require("./defense");
function miningAnchor(value) {
  return Number.isSafeInteger(value?.systemID) && value.systemID > 0 &&
    [value.x, value.y, value.z].every(Number.isFinite)
    ? { systemID: value.systemID, x: value.x, y: value.y, z: value.z } : null;
}
function createPreferences(filename) {
  let records = {};
  if (fs.existsSync(filename)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (parsed.schemaVersion === 1 && parsed.characters && typeof parsed.characters === "object") records = parsed.characters;
    } catch (error) { console.error(`[AutoMining] Could not read preferences; using defaults: ${error.message}`); }
  }
  return {
    get(id) {
      const record = records[id];
      return {
        enabled: record?.enabled === true,
        order: ORDERS.includes(record?.order) ? record.order : "nearest",
        ...(typeof record?.profileStamp === "string" ? { profileStamp: record.profileStamp } : {}),
        approach: record?.approach === true,
        compress: record?.compress === true,
        haulEnabled: record?.haulEnabled === true,
        haulThreshold: haulThreshold(record?.haulThreshold),
        defenseEnabled: record?.defenseEnabled === true,
        defenseShieldEnabled: record?.defenseShieldEnabled !== false,
        defenseShieldThreshold: defenseThreshold(record?.defenseShieldThreshold),
        defenseArmorEnabled: record?.defenseArmorEnabled === true,
        defenseArmorThreshold: defenseThreshold(record?.defenseArmorThreshold),
        recallDrones: record?.recallDrones !== false,
        launchDrones: record?.launchDrones === true,
        droneGroupKey: validGroupKey(record?.droneGroupKey) ? record.droneGroupKey : "",
        mineDrones: record?.mineDrones === true,
        mineDroneOrder: ORDERS.includes(record?.mineDroneOrder) ? record.mineDroneOrder : "nearest",
        mineDroneMode: ["spread", "focus"].includes(record?.mineDroneMode) ? record.mineDroneMode : "spread",
        autoBoost: record?.autoBoost === true,
        inviteFleet: record?.inviteFleet === true,
        ratDefenseEnabled: record?.ratDefenseEnabled === true,
        ratMiningGroupKey: validGroupKey(record?.ratMiningGroupKey) ? record.ratMiningGroupKey : "",
        ratFighterGroupKey: validGroupKey(record?.ratFighterGroupKey) ? record.ratFighterGroupKey : "",
        stationID: Number.isSafeInteger(record?.stationID) && record.stationID > 0 ? record.stationID : 0,
        storageKey: typeof record?.storageKey === "string" && record.storageKey.length <= 100 ? record.storageKey : "personal",
        haulInterrupted: record?.haulInterrupted === true,
        miningAnchor: miningAnchor(record?.miningAnchor),
        lock: record?.lock !== false,
        survey: record?.survey === true,
        surveySeconds: surveySeconds(record?.surveySeconds),
        ores: Array.isArray(record?.ores) ? record.ores.filter(x => typeof x === "string" && x.length <= 80).slice(0, MAX_ORE_FILTERS) : [],
      };
    },
    save(id, value) {
      const next = { ...records, [id]: { enabled: value.enabled === true, order: value.order, ores: [...value.ores], approach: value.approach === true, compress: value.compress === true, lock: value.lock !== false, survey: value.survey === true, surveySeconds: surveySeconds(value.surveySeconds),
        haulEnabled: value.haulEnabled === true, haulThreshold: haulThreshold(value.haulThreshold), stationID: value.stationID || 0, storageKey: value.storageKey || "personal", haulInterrupted: value.haulInterrupted === true,
        miningAnchor: miningAnchor(value.miningAnchor),
        defenseEnabled: value.defenseEnabled === true, defenseShieldEnabled: value.defenseShieldEnabled !== false,
        defenseShieldThreshold: defenseThreshold(value.defenseShieldThreshold),
        defenseArmorEnabled: value.defenseArmorEnabled === true,
        defenseArmorThreshold: defenseThreshold(value.defenseArmorThreshold),
        recallDrones: value.recallDrones !== false,
        launchDrones: value.launchDrones === true, droneGroupKey: value.droneGroupKey || "",
        mineDrones: value.mineDrones === true, mineDroneOrder: value.mineDroneOrder || "nearest", mineDroneMode: value.mineDroneMode || "spread",
        autoBoost: value.autoBoost === true, inviteFleet: value.inviteFleet === true,
        ratDefenseEnabled: value.ratDefenseEnabled === true,
        ratMiningGroupKey: value.ratMiningGroupKey || "", ratFighterGroupKey: value.ratFighterGroupKey || "",
        ...(value.profileStamp ? { profileStamp: value.profileStamp } : {}) } };
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, characters: next }, null, 2) + "\n", "utf8");
      fs.renameSync(temporary, filename);
      records = next;
    },
  };
}
module.exports = { createPreferences };
