"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { surveySeconds, MAX_ORE_FILTERS } = require("./settings");
const { ORDERS } = require("./targets");
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
        lock: record?.lock !== false,
        survey: record?.survey === true,
        surveySeconds: surveySeconds(record?.surveySeconds),
        ores: Array.isArray(record?.ores) ? record.ores.filter(x => typeof x === "string" && x.length <= 80).slice(0, MAX_ORE_FILTERS) : [],
      };
    },
    save(id, value) {
      const next = { ...records, [id]: { enabled: value.enabled === true, order: value.order, ores: [...value.ores], approach: value.approach === true, compress: value.compress === true, lock: value.lock !== false, survey: value.survey === true, surveySeconds: surveySeconds(value.surveySeconds), ...(value.profileStamp ? { profileStamp: value.profileStamp } : {}) } };
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, characters: next }, null, 2) + "\n", "utf8");
      fs.renameSync(temporary, filename);
      records = next;
    },
  };
}
module.exports = { createPreferences };
