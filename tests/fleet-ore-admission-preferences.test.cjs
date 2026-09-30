"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { featurePreferences, featureRequest } = require("../lib/featureSettings");
const { createPreferences } = require("../lib/preferences");
const { captureProfile, cleanProfiles, switchProfile } = require("../lib/jobProfiles");
const choices = value => [value.receiveFleetAcceptCompressed, value.receiveFleetAcceptUncompressed];

test("fresh admission accepts both while legacy saved settings preserve compressor-based admission", () => {
  assert.deepEqual(choices(featurePreferences()), [true, true]);
  assert.deepEqual(choices(featurePreferences({ compressorEnabled: true })), [true, false]);
  assert.deepEqual(choices(featurePreferences({ compressorEnabled: false })), [true, true]);
  for (const compressed of [true, false]) for (const raw of [true, false]) {
    const saved = featurePreferences({ compressorEnabled: true,
      receiveFleetAcceptCompressed: compressed, receiveFleetAcceptUncompressed: raw });
    assert.deepEqual(choices(saved), [compressed, raw], "explicit choices are never overwritten by migration");
  }
});

test("admission requests require booleans and toggling compressor automation cannot rewrite admission", () => {
  const initial = featurePreferences({ compressorEnabled: true,
    receiveFleetAcceptCompressed: true, receiveFleetAcceptUncompressed: true });
  assert.deepEqual(choices(featureRequest({ compressorEnabled: false }, initial)), [true, true]);
  const rawOnly = featureRequest({ receiveFleetAcceptCompressed: false }, initial);
  assert.deepEqual(choices(rawOnly), [false, true]);
  assert.deepEqual(choices(featureRequest({ compressorEnabled: false }, rawOnly)), [false, true]);
  for (const key of ["receiveFleetAcceptCompressed", "receiveFleetAcceptUncompressed"])
    for (const value of ["true", 1, null, []]) assert.throws(() => featureRequest({ [key]: value }, initial), /Invalid/);
});

test("native preference save/reload preserves each explicit admission combination", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "automining-admission-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "characters.json"), preferences = createPreferences(filename);
  assert.deepEqual(choices(preferences.get(1)), [true, true], "fresh pilot defaults do not depend on a previous pilot");
  let id = 1;
  for (const compressed of [true, false]) for (const raw of [true, false]) {
    const state = { ...preferences.get(id), job: "boosting", compressorEnabled: true,
      receiveFleetAcceptCompressed: compressed, receiveFleetAcceptUncompressed: raw };
    preferences.save(id, state);
    assert.deepEqual(choices(createPreferences(filename).get(id)), [compressed, raw]); id++;
  }
});

test("old saved Boosting settings and archives migrate without changing original records", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "automining-admission-legacy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "characters.json");
  const original = { schemaVersion: 1, characters: { 1: { job: "boosting", compressorEnabled: true,
    jobProfiles: { boosting: { receiveFleetOre: true, compressorEnabled: true }, mining: { oreMode: "fleetHangar" } } } } };
  fs.writeFileSync(filename, JSON.stringify(original));
  const saved = createPreferences(filename).get(1);
  assert.deepEqual(choices(saved), [true, false]);
  assert.deepEqual(choices(saved.jobProfiles.boosting), [true, false]);
  assert.equal(saved.jobProfiles.mining.oreMode, "fleetHangar");
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, "utf8")), original, "read-only migration never writes config");
});

test("Boosting profile round trip keeps admission independent from compressor and Mining routing", () => {
  const mining = { job: "mining", oreMode: "fleetHangar", receiveFleetAcceptCompressed: true, receiveFleetAcceptUncompressed: false };
  const boosting = { job: "boosting", compressorEnabled: true, receiveFleetOre: true,
    receiveFleetAcceptCompressed: false, receiveFleetAcceptUncompressed: true };
  const profiles = cleanProfiles({ mining: captureProfile(mining), boosting: captureProfile(boosting) });
  assert.equal(Object.hasOwn(profiles.mining, "receiveFleetAcceptCompressed"), false);
  assert.deepEqual(choices(profiles.boosting), [false, true]);
  const restoredMining = switchProfile({ ...boosting, job: "mining" }, { ...boosting, jobProfiles: profiles });
  assert.equal(restoredMining.oreMode, "fleetHangar");
  const restoredBoosting = switchProfile({ ...restoredMining, job: "boosting" }, { ...restoredMining, jobProfiles: profiles });
  assert.deepEqual(choices(restoredBoosting), [false, true]); assert.equal(restoredBoosting.compressorEnabled, true);
  const oldProfiles = cleanProfiles({ boosting: { compressorEnabled: true } });
  assert.deepEqual(choices(oldProfiles.boosting), [true, false]);
});
