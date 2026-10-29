"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const candidate = path.resolve(__dirname, "..");
const { migrateState, statePaths } = require(path.join(candidate, "lib/statePaths"));
const { execute } = require(path.join(candidate, "helper"));
const { createPreferences } = require(path.join(candidate, "lib/preferences"));
const { createStatistics } = require(path.join(candidate, "lib/statistics"));
const { createFleetGroups } = require(path.join(candidate, "lib/fleetGroups"));
const nativeRoots = process.env.AUTOMINING_NATIVE_ROOT ? [
  [process.env.AUTOMINING_NATIVE_VERSION || "reviewed native", process.env.AUTOMINING_NATIVE_ROOT],
] : [
  ["0.12.9", process.env.AUTOMINING_NATIVE_ROOT_0129],
  ["261018.1", process.env.AUTOMINING_NATIVE_ROOT_261018],
];
delete process.env.EVEJS_DATA_ROOT;
if (nativeRoots.some(([, root]) => !root)) throw Error("Set AUTOMINING_NATIVE_ROOT_0129 and AUTOMINING_NATIVE_ROOT_261018 to the reviewed server trees.");
const workspace = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "am-state-"));
process.on("exit", () => fs.rmSync(workspace, { recursive: true, force: true }));
let serial = 0;
function fixture(nativeRoot) {
  const root = path.join(workspace, String(++serial));
  for (const relative of ["server/src/config/dataRoot.js", "server/src/services/mining/miningRuntime.js", "server/src/network/tcp/handshake.js"]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(nativeRoot, relative), target);
  }
  fs.mkdirSync(path.join(root, "client"));
  return root;
}
const documents = {
  players: { schemaVersion: 1, characters: { 42: { enabled: true, order: "furthest", ores: ["Gneiss"], survey: true, surveySeconds: 123, job: "mining", fleetGroupID: "saved" } } },
  statistics: { schemaVersion: 1, trackedSince: 1000, characters: { 42: { watermark: 71, total: { units: 987, volume: 456, ores: {} }, days: {}, recent: [], tripIDs: [], runs: [{ started: 1000, ended: 2000, total: { units: 123, volume: 12, ores: {} } }], run: { started: 2000, total: { units: 864, volume: 444, ores: {} }, recent: [] } } } },
  fleetGroups: { schemaVersion: 1, revision: 7, presets: [{ id: "saved", name: "Remember these pilots", characterIDs: [42, 43] }], roster: [{ characterID: 42, name: "Remember me" }] },
};
const filename = kind => `autoMining.${kind}.json`;
function seed(root) {
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  const bytes = {};
  for (const [kind, data] of Object.entries(documents)) {
    // Non-default whitespace and CRLF prove migration copies bytes verbatim.
    bytes[kind] = Buffer.from("  " + JSON.stringify(data, null, 2).replace(/\n/g, "\r\n") + "\r\n");
    fs.writeFileSync(path.join(root, "config", filename(kind)), bytes[kind]);
  }
  return bytes;
}
function request(root, action = "install") {
  return { protocol: 1, requestId: "state-preservation", action,
    runtime: { evejsRoot: root, backend: "native", clientRoot: path.join(root, "client") },
    mod: { root, path: candidate }, settings: { profile: {} } };
}
function childLoader(root, expected) {
  const child = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),path=require('node:path');
    const [candidate,root,expected]=process.argv.slice(1);
    assert.equal(require(path.join(candidate,'loader.js')).install(root).active,expected==='true');
  `, candidate, root, String(expected)], { encoding: "utf8", timeout: 15000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return child.stdout + child.stderr;
}
function assertPreserved(root, bytes) {
  const paths = statePaths(root);
  for (const kind of Object.keys(bytes)) {
    assert.deepEqual(fs.readFileSync(path.join(root, "config", filename(kind))), bytes[kind], `${kind} legacy bytes`);
    assert.deepEqual(fs.readFileSync(paths[kind]), bytes[kind], `${kind} canonical bytes`);
  }
}
const fleetNative = () => ({ fleets: { getFleetForCharacter: () => null }, characters: {}, scope: {} });
for (const [version, nativeRoot] of nativeRoots) {
  test(`${version}: helper install/recover retains all state byte-for-byte and reads it after config sweep`, () => {
    const root = fixture(nativeRoot), bytes = seed(root);
    assert.equal(execute(request(root)).success, true);
    assertPreserved(root, bytes);
    const paths = statePaths(root);
    assert.equal(paths.players, path.join(root, "_local/automining/autoMining.players.json"));
    assert.equal(execute(request(root, "recover")).success, true);
    assert.equal(migrateState(root).files.every(file => file.status === "unchanged"), true);
    assertPreserved(root, bytes);
    // Model the official updater removing legacy config, after helper migration.
    for (const kind of Object.keys(bytes)) fs.unlinkSync(path.join(root, "config", filename(kind)));
    const preferences = createPreferences(paths.players).get(42);
    assert.equal(preferences.order, "furthest"); assert.equal(preferences.surveySeconds, 123); assert.deepEqual(preferences.ores, ["Gneiss"]);
    const statistics = createStatistics(paths.statistics, { clock: () => 5000 });
    assert.equal(statistics.snapshot({ characterID: 42 }, { period: "tracked" }).totals.units, 987);
    assert.equal(statistics.sessions({ characterID: 42 }).rows[0].totals.units, 123);
    const group = createFleetGroups({ root, native: fleetNative() });
    assert.equal(group.view({ characterID: 42 }, {}).presets[0].name, "Remember these pilots");
    assert.equal(group.view({ characterID: 42 }, {}).roster[0].name, "Remember me");
    childLoader(root, true);
    for (const kind of Object.keys(bytes)) assert.deepEqual(fs.readFileSync(paths[kind]), bytes[kind]);
  });
  test(`${version}: loader independently migrates legacy state before installing hooks`, () => {
    const root = fixture(nativeRoot), bytes = seed(root);
    childLoader(root, true);
    assertPreserved(root, bytes);
  });
  test(`${version}: existing canonical files win over differing legacy bytes and stay unchanged on repeats`, () => {
    const root = fixture(nativeRoot), bytes = seed(root), paths = statePaths(root);
    fs.mkdirSync(path.dirname(paths.players), { recursive: true });
    const preferred = {};
    for (const [kind, data] of Object.entries(documents)) {
      preferred[kind] = Buffer.from(JSON.stringify(data) + "\n");
      fs.writeFileSync(paths[kind], preferred[kind]);
    }
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.equal(execute(request(root, repeat ? "recover" : "install")).success, true);
      assert.equal(migrateState(root).files.every(file => file.status === "canonical-kept"), true);
      for (const kind of Object.keys(bytes)) {
        assert.deepEqual(fs.readFileSync(paths[kind]), preferred[kind]);
        assert.deepEqual(fs.readFileSync(path.join(root, "config", filename(kind))), bytes[kind]);
      }
    }
  });
  test(`${version}: helper and loader fail closed if migration cannot write; sources and client stay intact`, () => {
    const root = fixture(nativeRoot), bytes = seed(root);
    fs.mkdirSync(path.join(root, "_local"));
    fs.writeFileSync(path.join(root, "_local/automining"), "blocked");
    assert.throws(() => execute(request(root)), /ENOTDIR|EEXIST/);
    assert.match(childLoader(root, false), /Saved state could not be prepared/);
    for (const kind of Object.keys(bytes)) assert.deepEqual(fs.readFileSync(path.join(root, "config", filename(kind))), bytes[kind]);
    assert.deepEqual(fs.readdirSync(path.join(root, "client")), []);
    assert.equal(fs.readFileSync(path.join(root, "_local/automining"), "utf8"), "blocked");
  });
  test(`${version}: invalid saved state never reaches default-writing stores`, () => {
    for (const canonical of [false, true]) {
      const root = fixture(nativeRoot), bytes = seed(root), paths = statePaths(root);
      const bad = canonical ? paths.players : path.join(root, "config", filename("players"));
      fs.mkdirSync(path.dirname(bad), { recursive: true }); fs.writeFileSync(bad, "broken saved data");
      assert.throws(() => execute(request(root)), /Invalid AutoMining players state/);
      assert.match(childLoader(root, false), /Saved state could not be prepared/);
      assert.equal(fs.readFileSync(bad, "utf8"), "broken saved data");
      for (const kind of ["statistics", "fleetGroups"]) assert.deepEqual(fs.readFileSync(path.join(root, "config", filename(kind))), bytes[kind]);
      assert.deepEqual(fs.readdirSync(path.join(root, "client")), []);
    }
  });
  test(`${version}: native data-root override governs helper migration and runtime file paths`, () => {
    const root = fixture(nativeRoot), bytes = seed(root), override = path.join(root, "custom-runtime-data");
    process.env.EVEJS_DATA_ROOT = override;
    try {
      assert.equal(execute(request(root)).success, true);
      assertPreserved(root, bytes);
      assert.equal(statePaths(root).players, path.join(override, "automining", filename("players")));
      assert.equal(fs.existsSync(path.join(root, "_local")), false);
      childLoader(root, true);
    } finally { delete process.env.EVEJS_DATA_ROOT; }
  });
}
test("failed atomic publication leaves no partial destination or temporary files and can be retried", () => {
  const root = fixture(nativeRoots[0][1]), bytes = seed(root), paths = statePaths(root), link = fs.linkSync;
  fs.linkSync = () => { const error = Error("simulated disk publication failure"); error.code = "EIO"; throw error; };
  try { assert.throws(() => migrateState(root), /simulated disk publication failure/); }
  finally { fs.linkSync = link; }
  assert.equal(fs.existsSync(paths.players), false);
  assert.deepEqual(fs.readdirSync(path.dirname(paths.players)), []);
  for (const kind of Object.keys(bytes)) assert.deepEqual(fs.readFileSync(path.join(root, "config", filename(kind))), bytes[kind]);
  migrateState(root); assertPreserved(root, bytes);
});
test("a canonical file appearing during publication is never overwritten", () => {
  const root = fixture(nativeRoots[0][1]), bytes = seed(root), paths = statePaths(root), link = fs.linkSync;
  const preferred = Buffer.from(JSON.stringify(documents.players) + "\n");
  fs.linkSync = (source, destination) => {
    if (destination === paths.players) fs.writeFileSync(destination, preferred);
    return link(source, destination);
  };
  let result;
  try { result = migrateState(root); }
  finally { fs.linkSync = link; }
  assert.equal(result.files[0].status, "canonical-kept");
  assert.deepEqual(fs.readFileSync(paths.players), preferred);
  assert.deepEqual(fs.readFileSync(path.join(root, "config", filename("players"))), bytes.players);
  assert.equal(fs.readdirSync(path.dirname(paths.players)).some(name => name.endsWith(".tmp")), false);
});
test("native filename override stays authoritative and multiple fleet stores share it", () => {
  const root = fixture(nativeRoots[0][1]), external = path.join(root, "explicit-native-fleet.json");
  seed(root);
  // If constructor tried migrating despite native.filename, this would fail.
  fs.writeFileSync(path.join(root, "config", filename("players")), "invalid legacy prefs");
  fs.writeFileSync(external, JSON.stringify(documents.fleetGroups));
  const make = () => createFleetGroups({ root, native: { ...fleetNative(), filename: external } });
  const first = make(), second = make(), session = { characterID: 42 };
  first.action(session, {}, "savePreset", { revision: 7, name: "Shared change", characterIDs: [42] });
  assert.equal(second.view(session, {}).revision, 8);
  assert.equal(second.view(session, {}).presets.some(preset => preset.name === "Shared change"), true);
  assert.equal(fs.existsSync(path.join(root, "_local")), false);
  assert.equal(JSON.parse(fs.readFileSync(external)).revision, 8);
});
test("fresh state resolution performs no writes and fallback supports pre-dataRoot servers", () => {
  const root = path.join(workspace, String(++serial)); fs.mkdirSync(root);
  assert.deepEqual(migrateState(root).files, []);
  assert.equal(statePaths(root).players, path.join(root, "_local/automining/autoMining.players.json"));
  assert.deepEqual(fs.readdirSync(root), []);
  process.env.EVEJS_DATA_ROOT = path.join(root, "override");
  try { assert.equal(statePaths(root).statistics, path.join(root, "override/automining/autoMining.statistics.json")); }
  finally { delete process.env.EVEJS_DATA_ROOT; }
});
