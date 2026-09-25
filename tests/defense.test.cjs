"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shipHealth, retreatReason } = require("../lib/defense");

const settings = { defenseEnabled: true, defenseShieldEnabled: true, defenseShieldThreshold: 30,
  defenseArmorEnabled: true, defenseArmorThreshold: 30 };
const ship = (shield, armorDamage) => ({ shieldCapacity: 100, armorHP: 100,
  conditionState: { shieldCharge: shield, armorDamage } });

test("native shield charge and armor damage map to remaining health", () => {
  assert.equal(shipHealth(ship(0.25, 0.8)).shield, 25);
  assert.ok(Math.abs(shipHealth(ship(0.25, 0.8)).armor - 20) < 0.00001);
  assert.deepEqual(shipHealth({ shieldCapacity: 100, armorHP: 100 }), { shield: 100, armor: 100 });
  assert.deepEqual(shipHealth({}), { shield: null, armor: null });
});

test("armor wins when both retreat thresholds fire", () => {
  assert.equal(retreatReason(settings, ship(0.2, 0.8)), "Defense retreat: low armor.");
  assert.equal(retreatReason(settings, ship(0.2, 0)), "Defense retreat: low shield.");
  assert.equal(retreatReason(settings, ship(0.8, 0)), null);
  assert.equal(retreatReason({ ...settings, defenseEnabled: false }, ship(0, 1)), null);
});
