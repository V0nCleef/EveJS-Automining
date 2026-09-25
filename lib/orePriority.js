"use strict";
const { matchesOre } = require("./commands");
const { compareTargets } = require("./targets");

const GRADES = Object.freeze({ I: 1, II: 2, III: 3, IV: 4 });
function grade(name) {
  const suffix = String(name).match(/(?:^|\s)(I|II|III|IV)-Grade$/i);
  return suffix ? GRADES[suffix[1].toUpperCase()] : 0;
}

// The first matching filter entry wins. Within that entry, higher grades win;
// the pilot's target priority decides between rocks of the same grade.
function createOrePriority(ores, order, { claimed, focus } = {}) {
  const fallback = compareTargets(order);
  if (!ores.length && !claimed && !focus) return fallback;
  const cache = new Map();
  function rank(name) {
    if (!cache.has(name)) {
      const index = ores.findIndex(ore => matchesOre(name, [ore]));
      cache.set(name, { index: index < 0 ? ores.length : index, grade: ores.length ? grade(name) : 0 });
    }
    return cache.get(name);
  }
  return (a, b) => {
    const x = rank(a.name), y = rank(b.name);
    return x.index - y.index || y.grade - x.grade ||
      (claimed ? Number(claimed.has(a.id)) - Number(claimed.has(b.id)) : 0) ||
      Number(b.id === focus) - Number(a.id === focus) || fallback(a, b);
  };
}

module.exports = { createOrePriority, grade };
