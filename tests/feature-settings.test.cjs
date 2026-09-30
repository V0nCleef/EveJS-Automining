"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { featurePreferences, featureRequest } = require("../lib/featureSettings");

test("legacy hauling choices migrate while stacking defaults on", () => {
  const s = featurePreferences({ haulEnabled: true });
  assert.equal(s.oreMode, "unload");
  assert.equal(s.stackOreHold, true); assert.equal(s.stackFleetHangar, true);
  assert.equal(featureRequest({ haulEnabled: false }, s).oreMode, "leave");
  assert.equal(featureRequest({ oreMode: "jettison", haulEnabled: true }, s).oreMode, "jettison");
});

test("explicit fleet hangar mode persists without enabling competing unloading or replacing older choices", () => {
  const current=featurePreferences({oreMode:"pickup",haulEnabled:true});
  assert.equal(current.oreMode,"pickup");
  const requested=featureRequest({oreMode:"fleetHangar",haulEnabled:true},current);
  assert.equal(requested.oreMode,"fleetHangar");assert.equal(requested.haulEnabled,false);
  assert.equal(featurePreferences(requested).oreMode,"fleetHangar");
  for(const oreMode of ["leave","jettison","unload","pickup"])assert.equal(featurePreferences({oreMode}).oreMode,oreMode);
  assert.throws(()=>featureRequest({oreMode:"fleetHangarAnything"},current),/Invalid ore handling/);
});

test("fuel target must exceed reserve and unsafe saved values normalize", () => {
  const s = featurePreferences();
  assert.throws(() => featureRequest({ fuelReserveCycles: 20, fuelTargetCycles: 20 }, s), /fuel restocking/);
  assert.equal(featurePreferences({ fuelReserveCycles: 20, fuelTargetCycles: 20 }).fuelTargetCycles, 21);
  assert.throws(() => featureRequest({ coreIntervals: { 62590: -1 } }, s), /activation intervals/);
  assert.equal(featurePreferences({ jettisonCan: { containerID: 1, shipID: 0, systemID: 3 } }).jettisonCan, null);
});

test("legacy boosters remain boosters and transport fields persist independently", () => {
  const legacy = featurePreferences({ autoBoost: true, coreEnabled: true });
  assert.equal(legacy.shipRole, "boosting"); assert.equal(legacy.transportEnabled, false);
  const transport = featureRequest({ shipRole: "transport", transportEnabled: true,
    transportStationID: 600, transportStorageKey: "corp:700:116", oreMode: "pickup" }, legacy);
  assert.equal(transport.coreEnabled, true, "role changes preserve booster drafts");
  assert.equal(transport.haulEnabled, false); assert.equal(transport.transportThreshold, 95);
  assert.equal(featurePreferences(transport).transportStationID, 600);
  assert.throws(() => featureRequest({ shipRole: "both" }, legacy), /transport settings/);
  assert.throws(() => featureRequest({ transportThreshold: 101 }, legacy), /transport settings/);
  assert.throws(() => featureRequest({ transportIdleSeconds: 0 }, legacy), /transport settings/);
});
