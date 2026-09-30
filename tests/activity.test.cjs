"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createActivity, normalizeEvent } = require("../lib/activity");
function fixture() {
  let time = 0; const calls = [], s = { enabled: true, hudReady: true, actionNotifications: true };
  const session = { characterID: 42, sendNotification: (name, kind, args) => calls.push(JSON.parse(args[0])) };
  const api = createActivity({ clock: () => time });
  return { api, s, session, calls, time: value => { time = value; } };
}
test("activity is gated by ON, companion ready and optional notifications", () => {
  const f = fixture();
  for (const key of ["enabled", "hudReady", "actionNotifications"]) {
    f.s[key] = false; assert.equal(f.api.emit(f.session, f.s, "mining"), false); f.s[key] = true;
  }
  assert.equal(f.calls.length, 0); assert.equal(f.api.emit(f.session, f.s, "mining"), true);
});
test("routine transitions coalesce, deduplicate and urgent defense bypasses wait", () => {
  const f = fixture(); f.s.status = "Mining with 2 module(s)."; f.api.observe(f.session, f.s);
  f.s.status = "Mining with 3 module(s)."; f.api.observe(f.session, f.s); assert.equal(f.calls.length, 1);
  f.s.haul = { id: "trip-1", phase: "outbound" }; f.api.observe(f.session, f.s); assert.equal(f.calls.length, 1);
  f.s.defenseStatus = "Defense retreat: low shield."; f.api.observe(f.session, f.s); assert.equal(f.calls.at(-1).key, "defenseShield");
  f.s.defenseStatus = "Defense retreat: low armor."; f.api.observe(f.session, f.s); assert.equal(f.calls.at(-1).key, "defenseArmor");
  f.api.observe(f.session, f.s); assert.equal(f.calls.length, 3);
  f.time(10000); f.api.observe(f.session, f.s); assert.equal(f.calls.at(-1).key, "outbound");
});
test("completed actions deduplicate by bounded operation id", () => {
  const f = fixture(); f.api.emit(f.session, f.s, { key: "fuelComplete", id: "a" });
  f.time(10000); f.api.emit(f.session, f.s, { key: "fuelComplete", id: "a" }); assert.equal(f.calls.length, 1);
  f.api.emit(f.session, f.s, { key: "fuelComplete", id: "b" }); assert.equal(f.calls.length, 2);
});
test("event shape rejects unknown commands, arbitrary message and oversized args", () => {
  assert.equal(normalizeEvent({ key: "execute", args: ["code"] }), null);
  assert.equal(normalizeEvent({ key: "failure", args: ["x".repeat(301)] }), null);
  assert.equal(normalizeEvent({ key: "failure", args: [{}] }), null);
  assert.equal(normalizeEvent({ key: "mining", args: ["x"] }), null);
  assert.equal(normalizeEvent({ key: "mining", id: "x".repeat(97) }), null);
});
