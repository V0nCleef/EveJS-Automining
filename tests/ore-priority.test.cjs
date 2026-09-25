"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createOrePriority, grade } = require("../lib/orePriority");

const rock = (id, name, distance) => ({id, name, distance});

test("grade order is IV, III, II, then ungraded/base", () => {
  const rocks = [rock(1, "Veldspar", 1), rock(2, "Veldspar 0-Grade", 2),
    rock(3, "Veldspar II-Grade", 3), rock(4, "Veldspar III-Grade", 4),
    rock(5, "Veldspar IV-Grade", 5)];
  rocks.sort(createOrePriority(["veldspar"], "nearest"));
  assert.deepEqual(rocks.map(x => x.id), [5, 4, 3, 1, 2]);
  assert.equal(grade("Veldspar IV-Grade"), 4);
});

test("first matching filter entry wins even when a later group has a higher grade", () => {
  const rocks = [rock(1, "Veldspar IV-Grade", 1), rock(2, "Scordite", 100),
    rock(3, "Scordite IV-Grade", 200)];
  rocks.sort(createOrePriority(["scordite", "veldspar"], "nearest"));
  assert.deepEqual(rocks.map(x => x.id), [3, 2, 1]);
});

test("explicit base ore before a group keeps its own saved priority", () => {
  const rocks = [rock(1, "Veldspar IV-Grade", 1), rock(2, "Veldspar 0-Grade", 100)];
  rocks.sort(createOrePriority(["veldspar 0-grade", "veldspar"], "nearest"));
  assert.deepEqual(rocks.map(x => x.id), [2, 1]);
});

test("other-pilot claims split same-priority rocks but never outrank an earlier ore", () => {
  const rocks = [rock(1, "Veldspar IV-Grade", 1), rock(2, "Veldspar IV-Grade", 20),
    rock(3, "Scordite", 3)];
  rocks.sort(createOrePriority(["veldspar", "scordite"], "nearest", {claimed: new Set([1])}));
  assert.deepEqual(rocks.map(x => x.id), [2, 1, 3]);
});
