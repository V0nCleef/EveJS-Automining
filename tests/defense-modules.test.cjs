"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  shipHealth, retreatReason, effectiveRetreatReason, threatReason, validThreatClasses,
  sanitizeModuleMap, sanitizeModuleSettings, wantsActive, healthForKind,
  MODE_MANUAL, MODE_OFF, MODE_MINING, MODE_NPC, MODE_THRESHOLD,
} = require("../lib/defense");
const { EFFECT_KINDS } = require("../lib/defenseModules");

const settings = {
  defenseEnabled: true, defenseShieldEnabled: true, defenseShieldThreshold: 30,
  defenseArmorEnabled: true, defenseArmorThreshold: 30,
  defenseThreatEnabled: true, defenseThreatClasses: ["titan", "dreadnought"],
};
const ship = (shield, armorDamage) => ({
  shieldCapacity: 100, armorHP: 100,
  conditionState: { shieldCharge: shield, armorDamage },
});

test("hostile capital watch matches the native group names and respects the enabled classes", () => {
  assert.equal(threatReason(settings, ["Titan"]), "Defense retreat: hostile Titan detected.");
  assert.equal(threatReason(settings, ["Dreadnought"]), "Defense retreat: hostile Dreadnought detected.");
  assert.equal(threatReason(settings, ["Cruiser", "Frigate"]), null);
  assert.equal(threatReason({ ...settings, defenseThreatEnabled: false }, ["Titan"]), null);
  assert.equal(threatReason({ ...settings, defenseThreatClasses: ["dreadnought"] }, ["Titan"]), null);
  assert.equal(threatReason({ ...settings, defenseThreatClasses: ["dreadnought"] }, ["Capital Dreadnought"]),
    "Defense retreat: hostile Dreadnought detected.");
});

test("threat class validation keeps only the supported classes", () => {
  assert.deepEqual(validThreatClasses(["titan"]), ["titan"]);
  assert.deepEqual(validThreatClasses(undefined), ["titan", "dreadnought"]);
  assert.throws(() => validThreatClasses(["titan", "orca"], true), /Invalid hostile ship classes/);
});

test("every ship class is selectable and the most dangerous configured class wins", () => {
  const all = { ...settings, defenseThreatClasses: ["frigate", "cruiser", "battleship", "carrier"] };
  // Highest configured class on the grid decides the status line.
  assert.equal(threatReason(all, ["Frigate", "Battleship"]), "Defense retreat: hostile Battleship detected.");
  assert.equal(threatReason(all, ["Frigate", "Carrier"]), "Defense retreat: hostile Carrier detected.");
  assert.equal(threatReason(all, ["Frigate"]), "Defense retreat: hostile Frigate detected.");
  // Classes outside the configured set are ignored.
  assert.equal(threatReason({ ...all, defenseThreatClasses: ["frigate"] }, ["Battleship"]), null);
  assert.equal(threatReason(all, ["Rogue Drone Battleship"]), "Defense retreat: hostile Battleship detected.");
});

test("a health threshold breach outranks a hostile-class watch", () => {
  const damaged = ship(0.9, 0.75); // armor 25 -> low armor retreat
  const threat = "Defense retreat: hostile Battleship detected.";
  assert.equal(effectiveRetreatReason(settings, damaged, null, threat), "Defense retreat: low armor.");
  const healthy = ship(0.9, 0.1);
  assert.equal(effectiveRetreatReason(settings, healthy, null, threat), threat);
});

test("a triggered retreat stays latched after a repair raises armor back above the threshold", () => {
  const damaged = ship(0.9, 0.75);              // armor 25 -> retreat
  const repaired = ship(0.9, 0.35);             // armor 65 -> repairer raised it
  const reason = retreatReason(settings, damaged);
  assert.equal(reason, "Defense retreat: low armor.");
  assert.equal(retreatReason(settings, repaired), null);
  // The latch keeps the original reason, so the module tick can repair while
  // the departure continues.
  assert.equal(effectiveRetreatReason(settings, repaired, reason, null), reason);
  assert.equal(effectiveRetreatReason(settings, repaired, null, null), null);
  // A hostile-capital watch cannot cancel a latched health retreat either.
  assert.equal(effectiveRetreatReason(settings, repaired, reason, null), reason);
});

test("defense module settings are validated and thresholds ordered", () => {
  const map = sanitizeModuleMap({
    399: { kind: "shieldRepair", mode: MODE_THRESHOLD, onPct: 50, offPct: 90 },
    523: { kind: "armorRepair", mode: MODE_THRESHOLD, onPct: 60, offPct: 40 },
    578: { kind: "shieldHardener", mode: MODE_NPC, onPct: 10, offPct: 20 },
    bad: { kind: "shieldRepair" },
    999: { kind: "not-a-kind", mode: MODE_OFF },
  });
  assert.deepEqual(Object.keys(map).sort(), ["399", "523", "578"]);
  assert.equal(map["523"].offPct, 61);          // clamped above onPct
  assert.equal(map["578"].mode, MODE_NPC);
  assert.throws(() => sanitizeModuleMap({ 523: { kind: "armorRepair", mode: MODE_THRESHOLD, onPct: 60, offPct: 40 } }, true),
    /Repair shutdown percent/);
  assert.throws(() => sanitizeModuleMap({ bad: { kind: "shieldRepair" } }, true), /Invalid defense module item ID/);
});

test("two copies of the same repairer keep independent per-item policies", () => {
  const map = sanitizeModuleMap({
    140000901: { kind: "armorRepair", mode: MODE_THRESHOLD, onPct: 50, offPct: 90 },
    140000902: { kind: "armorRepair", mode: MODE_THRESHOLD, onPct: 20, offPct: 80 },
  });
  assert.deepEqual(Object.keys(map).sort(), ["140000901", "140000902"]);
  assert.equal(map["140000901"].onPct, 50);
  assert.equal(map["140000902"].onPct, 20);
  const first = sanitizeModuleSettings("armorRepair", map["140000901"]);
  const second = sanitizeModuleSettings("armorRepair", map["140000902"]);
  assert.equal(wantsActive("armorRepair", first, 40), true);    // first repairer only
  assert.equal(wantsActive("armorRepair", second, 40), null);   // second holds
  assert.equal(wantsActive("armorRepair", second, 15), true);   // both staged
});

test("manual means the mod never touches the module", () => {
  for (const kind of ["armorRepair", "shieldRepair", "shieldHardener", "armorHardener"]) {
    assert.equal(wantsActive(kind, { mode: MODE_MANUAL }, 5, { mining: true, npcs: true }), false);
  }
  // Legacy "off" reads back as manual.
  assert.equal(wantsActive("armorHardener", { mode: "off" }, 100, { npcs: true }), false);
  assert.equal(sanitizeModuleSettings("armorHardener", { mode: "off" }, true).mode, MODE_MANUAL);
  assert.equal(sanitizeModuleSettings("armorRepair", undefined).mode, MODE_MANUAL);
});

test("fitted runtime item IDs (13+ digits) are valid defense module keys", () => {
  const map = sanitizeModuleMap({
    9988400041484: { kind: "shieldHardener", mode: "mining" },
    140000000123456: { kind: "armorRepair", mode: "threshold", onPct: 50, offPct: 90 },
  }, true);
  assert.deepEqual(Object.keys(map).sort(), ["140000000123456", "9988400041484"]);
  assert.equal(map["9988400041484"].mode, "mining");
  assert.throws(() => sanitizeModuleMap({ notAnID: { kind: "shieldHardener" } }, true),
    /Invalid defense module item ID/);
});

test("repair modules activate at the low threshold and release at the high one", () => {
  const repair = { mode: MODE_THRESHOLD, onPct: 50, offPct: 90 };
  assert.equal(wantsActive("armorRepair", repair, 50), true);
  assert.equal(wantsActive("armorRepair", repair, 51), null);   // hold
  assert.equal(wantsActive("armorRepair", repair, 89), null);   // hold
  assert.equal(wantsActive("armorRepair", repair, 90), false);
  assert.equal(wantsActive("armorRepair", repair, null), false);
  // Manual release stays off.
  assert.equal(wantsActive("armorRepair", { mode: MODE_OFF }, 10), false);
  // Repairers are health driven only: mining/NPC modes are not valid for them.
  assert.equal(wantsActive("armorRepair", { mode: MODE_MINING }, 10, { mining: true }), false);
  assert.equal(wantsActive("shieldRepair", { mode: MODE_NPC }, 10, { npcs: true }), false);
  assert.throws(() => sanitizeModuleSettings("armorRepair", { mode: MODE_MINING }, true),
    /health threshold or manual/);
  assert.equal(sanitizeModuleSettings("armorRepair", { mode: MODE_MINING }, false).mode, MODE_OFF);
});

test("hardeners follow mining state or hostile NPCs", () => {
  assert.equal(wantsActive("shieldHardener", { mode: MODE_MINING }, 100, { mining: true }), true);
  assert.equal(wantsActive("shieldHardener", { mode: MODE_MINING }, 100, { mining: false }), false);
  assert.equal(wantsActive("shieldHardener", { mode: MODE_NPC }, 100, { npcs: false }), false);
  assert.equal(wantsActive("shieldHardener", { mode: MODE_NPC }, 100, { npcs: true }), true);
  assert.equal(wantsActive("armorHardener", { mode: MODE_OFF }, 100, { npcs: true }), false);
});

test("health selection follows the hardener or repairer layer", () => {
  const health = { shield: 10, armor: 80 };
  assert.equal(healthForKind("shieldHardener", health), 10);
  assert.equal(healthForKind("shieldRepair", health), 10);
  assert.equal(healthForKind("armorHardener", health), 80);
  assert.equal(healthForKind("armorRepair", health), 80);
  assert.equal(healthForKind("unknown", health), null);
});

test("module defaults are inert until the pilot chooses a mode", () => {
  const defaults = sanitizeModuleSettings("shieldRepair", undefined);
  assert.equal(defaults.mode, MODE_OFF);
  assert.equal(defaults.onPct, 50);
  assert.equal(defaults.offPct, 90);
});

test("native effect table maps only active local defense equipment", () => {
  assert.equal(EFFECT_KINDS[4].kind, "shieldRepair");
  assert.equal(EFFECT_KINDS[4936].kind, "shieldRepair");
  assert.equal(EFFECT_KINDS[27].kind, "armorRepair");
  assert.equal(EFFECT_KINDS[5275].kind, "armorRepair");
  assert.equal(EFFECT_KINDS[5230].kind, "shieldHardener");
  assert.equal(EFFECT_KINDS[5231].kind, "armorHardener");
  assert.equal(EFFECT_KINDS[4928].kind, "armorHardener");
  // Passive resistance/plate effects (for example 2041 armorHPMultiply) never map.
  assert.equal(EFFECT_KINDS[2041], undefined);
  assert.equal(EFFECT_KINDS[63], undefined);
});
