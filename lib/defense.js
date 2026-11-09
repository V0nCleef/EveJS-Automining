"use strict";

const DEFAULT_DEFENSE_THRESHOLD = 30;
const validDefenseThreshold = value => Number.isInteger(value) && value >= 1 && value <= 100;
const defenseThreshold = value => validDefenseThreshold(value) ? value : DEFAULT_DEFENSE_THRESHOLD;
const percent = value => Math.max(0, Math.min(100, value * 100));

// EveJS stores current shield as a charge ratio and current armor as damage.
// An absent condition state means an undamaged ship, as in native damage.js.
function shipHealth(ship) {
  const condition = ship?.conditionState || {};
  const shieldCharge = condition.shieldCharge == null ? 1 : Number(condition.shieldCharge);
  const armorDamage = condition.armorDamage == null ? 0 : Number(condition.armorDamage);
  return {
    shield: Number(ship?.shieldCapacity) > 0 && Number.isFinite(shieldCharge) ? percent(shieldCharge) : null,
    armor: Number(ship?.armorHP) > 0 && Number.isFinite(armorDamage) ? percent(1 - armorDamage) : null,
  };
}

function retreatReason(settings, ship) {
  if (!settings.defenseEnabled) return null;
  const health = shipHealth(ship);
  if (settings.defenseArmorEnabled && health.armor !== null && health.armor <= settings.defenseArmorThreshold)
    return "Defense retreat: low armor.";
  if (settings.defenseShieldEnabled && health.shield !== null && health.shield <= settings.defenseShieldThreshold)
    return "Defense retreat: low shield.";
  return null;
}

// A triggered retreat is latched. Local repairers can lift armor back above
// the threshold on the next cycle, but the ship must still leave: the latch is
// cleared only by Stop, a ship/scene change or the completed retreat.
function effectiveRetreatReason(settings, ship, latchedReason = null, threat = null) {
  if (latchedReason) return latchedReason;
  return retreatReason(settings, ship) || threat || null;
}

// Hostile-class watch. The class ranking matches the PVE target sorter, so the
// same native `groupName` vocabulary drives both. Classes are ordered from the
// most dangerous to the least; a configured class only counts when a ship of
// that class is on the local grid.
const THREAT_CLASSES = Object.freeze([
  "titan", "supercarrier", "carrier", "dreadnought", "battleship",
  "battlecruiser", "cruiser", "destroyer", "frigate",
]);
const THREAT_LABELS = Object.freeze({
  titan: "Titan", supercarrier: "Supercarrier", carrier: "Carrier", dreadnought: "Dreadnought",
  battleship: "Battleship", battlecruiser: "Battlecruiser", cruiser: "Cruiser",
  destroyer: "Destroyer", frigate: "Frigate",
});

function validThreatClasses(value, strict = false) {
  if (value === undefined) return ["titan", "dreadnought"];
  if (!Array.isArray(value) || value.length > THREAT_CLASSES.length ||
      value.some(entry => !THREAT_CLASSES.includes(entry))) {
    if (strict) throw Error("Invalid hostile ship classes.");
    return [...THREAT_CLASSES];
  }
  return THREAT_CLASSES.filter(kind => value.includes(kind));
}

// Native NPC group name -> threat class, using the PVE sorter's vocabulary.
function threatClassOf(groupName) {
  const name = String(groupName || "").toLowerCase();
  for (const kind of THREAT_CLASSES) if (name.includes(kind)) return kind;
  return null;
}

function threatReason(settings, groupNames) {
  if (!settings?.defenseEnabled || settings.defenseThreatEnabled !== true) return null;
  const classes = validThreatClasses(settings.defenseThreatClasses);
  if (!classes.length) return null;
  let found = null;
  for (const name of groupNames || []) {
    const kind = threatClassOf(name);
    if (kind && classes.includes(kind) && (!found || THREAT_CLASSES.indexOf(kind) < THREAT_CLASSES.indexOf(found)))
      found = kind;
  }
  return found ? `Defense retreat: hostile ${THREAT_LABELS[found]} detected.` : null;
}

// Fitted defense equipment automation (hardeners and local repairers).
// Settings are per fitted item, not per type: two identical repairers can run
// staged thresholds (for example the first at 50%, the second at 20%).
const DEFENSE_MODULE_KINDS = Object.freeze(["shieldHardener", "armorHardener", "shieldRepair", "armorRepair"]);
const HARDENER_KINDS = new Set(["shieldHardener", "armorHardener"]);
const REPAIR_KINDS = new Set(["shieldRepair", "armorRepair"]);
const DEFAULT_MODULE_ON_PERCENT = 50;
const DEFAULT_MODULE_OFF_PERCENT = 90;
// "manual" means the mod never starts or stops the module; the pilot controls
// it. The legacy stored value "off" is accepted as the same state.
const MODE_MANUAL = "manual";
const MODE_OFF = MODE_MANUAL;
const MODE_MINING = "mining";
const MODE_NPC = "npc";
const MODE_THRESHOLD = "threshold";

function normalizeMode(mode) {
  return mode === "off" ? MODE_MANUAL : mode;
}

function moduleDefaultSettings(kind) {
  return { mode: MODE_MANUAL, onPct: DEFAULT_MODULE_ON_PERCENT, offPct: DEFAULT_MODULE_OFF_PERCENT };
}

function validModuleMode(kind, mode) {
  const value = normalizeMode(mode);
  // Repairers are health driven only: being shot is the trigger, so "mining"
  // or "NPC" starts make no sense for them. "manual" always means the pilot.
  if (REPAIR_KINDS.has(kind)) return value === MODE_MANUAL || value === MODE_THRESHOLD;
  return value === MODE_MANUAL || value === MODE_MINING || value === MODE_NPC;
}

function sanitizeModuleSettings(kind, value, strict = false) {
  const fallback = moduleDefaultSettings(kind);
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw Error("Invalid defense module settings.");
    return fallback;
  }
  const requested = normalizeMode(value.mode);
  if (strict && requested !== undefined && !validModuleMode(kind, requested))
    throw Error(REPAIR_KINDS.has(kind)
      ? "Repair modules use a health threshold or manual control only."
      : "Invalid defense module mode.");
  const mode = validModuleMode(kind, requested) ? requested : fallback.mode;
  const readPercent = (candidate, fallbackValue) =>
    Number.isInteger(candidate) && candidate >= 1 && candidate <= 100 ? candidate : fallbackValue;
  let onPct = readPercent(value.onPct, fallback.onPct);
  let offPct = readPercent(value.offPct, fallback.offPct);
  if (mode === MODE_THRESHOLD && offPct <= onPct) {
    if (strict) throw Error("Repair shutdown percent must be above its activation percent.");
    // Non-strict repair: keep the values usable instead of silently inverting
    // them. The last whole percent stays achievable at 99 -> 100.
    if (onPct >= 100) onPct = 99;
    offPct = Math.min(100, onPct + 1);
  }
  return { mode, onPct, offPct };
}

// Whole-map sanitizer used by preferences and the settings RPC. Keys are
// fitted item IDs so two copies of the same module keep separate policies.
function sanitizeModuleMap(value, strict = false) {
  const result = {};
  if (value === undefined) return result;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length > 64) {
    if (strict) throw Error("Invalid defense module settings.");
    return result;
  }
  for (const [key, entry] of Object.entries(value)) {
    // Fitted item IDs are runtime 64-bit ids (13+ digits), not type ids.
    if (!/^[1-9][0-9]{0,17}$/.test(key) || !Number.isSafeInteger(Number(key))) {
      if (strict) throw Error("Invalid defense module item ID.");
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !DEFENSE_MODULE_KINDS.includes(entry.kind)) {
      if (strict) throw Error("Invalid defense module entry.");
      continue;
    }
    result[key] = { kind: entry.kind, ...sanitizeModuleSettings(entry.kind, entry, strict) };
  }
  return result;
}

// Pure decision used by the tick and by tests:
//   hardener: mining => active while AutoMining is running;
//             npc     => active while a hostile NPC shares the grid;
//   repair:   threshold => activate at or below onPct, release at or above offPct,
//             hold the current state in between.
// Returns true (activate), false (release) or null (leave as-is).
function wantsActive(kind, settings, healthPercent, context = {}) {
  const value = healthPercent === null || healthPercent === undefined ? NaN : Number(healthPercent);
  const fallback = moduleDefaultSettings(kind);
  const requested = normalizeMode(settings?.mode);
  const mode = validModuleMode(kind, requested) ? requested : fallback.mode;
  // Manual: the mod never starts or stops this module.
  if (mode === MODE_MANUAL || mode === undefined) return false;
  if (mode === MODE_MINING) return context.mining === true ? true : false;
  if (mode === MODE_NPC) return context.npcs === true ? true : false;
  if (!Number.isFinite(value)) return false;
  const onPct = Number.isInteger(settings?.onPct) ? settings.onPct : fallback.onPct;
  const offPct = Number.isInteger(settings?.offPct) ? settings.offPct : fallback.offPct;
  if (value <= onPct) return true;
  if (value >= offPct) return false;
  return null;
}

function healthForKind(kind, health) {
  if (kind === "shieldHardener" || kind === "shieldRepair") return health?.shield ?? null;
  if (kind === "armorHardener" || kind === "armorRepair") return health?.armor ?? null;
  return null;
}

module.exports = {
  DEFAULT_DEFENSE_THRESHOLD, validDefenseThreshold, defenseThreshold, shipHealth, retreatReason, effectiveRetreatReason,
  THREAT_CLASSES, THREAT_LABELS, validThreatClasses, threatClassOf, threatReason,
  DEFENSE_MODULE_KINDS, HARDENER_KINDS, REPAIR_KINDS, MODE_MANUAL, MODE_OFF, MODE_MINING, MODE_NPC, MODE_THRESHOLD,
  DEFAULT_MODULE_ON_PERCENT, DEFAULT_MODULE_OFF_PERCENT,
  moduleDefaultSettings, validModuleMode, sanitizeModuleSettings, sanitizeModuleMap,
  wantsActive, healthForKind,
};
