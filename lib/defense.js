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

module.exports = { DEFAULT_DEFENSE_THRESHOLD, validDefenseThreshold, defenseThreshold, shipHealth, retreatReason };
