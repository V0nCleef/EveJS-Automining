"use strict";
// Passive native contract check. No connected client, world tick or persisted
// ship is used. Real native movement handles the pending-landing rejection;
// accepted movement after landing is represented by an in-memory fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createHauling } = require("../lib/hauling");
const root = fs.realpathSync(process.argv[2]);
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "reader";
const blockedWrites = [];
const deny = name => () => { blockedWrites.push(name); throw Error(`Read-only native check attempted ${name}`); };
for (const name of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "rmdir",
  "copyFile", "truncate", "chmod", "chown", "symlink", "link", "utimes", "write", "writev"]) {
  if (fs[name]) fs[name] = deny(name);
  if (fs[name + "Sync"]) fs[name + "Sync"] = deny(name + "Sync");
  if (fs.promises[name]) fs.promises[name] = deny("promises." + name);
}
fs.createWriteStream = deny("createWriteStream");
const readFlag = flags => typeof flags === "number"
  ? !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
  : ["r", "rs", "sr"].includes(flags || "r");
for (const name of ["open", "openSync"]) {
  const original = fs[name];
  fs[name] = function(file, flags, ...args) {
    if (!readFlag(flags)) return deny(name)(file);
    return original.call(this, file, flags, ...args);
  };
}
const openPromise = fs.promises.open;
fs.promises.open = function(file, flags, ...args) {
  if (!readFlag(flags)) return deny("promises.open")(file);
  return openPromise.call(this, file, flags, ...args);
};
const loggerPath = path.resolve(require.resolve(path.join(root, "server/src/utils/logger"))).toLowerCase();
const nativeLoad = Module._load;
const logger = new Proxy({}, { get: (_, key) => key === "isVerboseDebugEnabled" ? () => false : () => {} });
Module._load = function(request, parent, isMain) {
  if (!Module.isBuiltin(request) &&
      path.resolve(Module._resolveFilename(request, parent, isMain)).toLowerCase() === loggerPath) return logger;
  return nativeLoad.apply(this, arguments);
};

try {
  const native = require(path.join(root, "server/src/space/runtime/scene/pilotCommands.js"));
  const eligibility = require(path.join(root, "server/src/space/runtime/destinyDeliveryEligibility.js"));
  const legacyHandoff = typeof eligibility.hasPendingPilotWarpLanding === "function";
  const hasPendingPilotWarpLanding = legacyHandoff ? eligibility.hasPendingPilotWarpLanding
    : (_, ship) => ship.mode === "WARP" || Boolean(ship.pendingWarp);
  let now = 10000;
  const session = { characterID: 42, shipID: 10,
    _space: { pilotWarpVisibilityHandoff: { shipID: "10", landingPending: true } } };
  const ship = { itemID: 10, mode: "STOP", position: { x: 5000, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
  // 261028.1 removed the separate session landing handoff; its Ball remains in
  // WARP until native landing completes. Exercise that native rejection too.
  if (!legacyHandoff) { delete session._space.pilotWarpVisibilityHandoff; ship.mode = "WARP"; }
  const scene = { systemID: 30, getShipEntityForSession: () => ship,
    stop: () => { ship.mode = "STOP"; return true; } };
  const origin = { systemID: 30, x: 0, y: 0, z: 0 };
  assert.equal(hasPendingPilotWarpLanding(session, ship), true);
  assert.equal(native.gotoPoint.call(scene, session, origin), false,
    "Native subwarp refuses a ship in STOP while its landing handoff is pending");
  let movementCalls = 0;
  const space = { getSceneForSession: () => scene, gotoPoint: (s, point) => {
    movementCalls++;
    if (hasPendingPilotWarpLanding(s, ship)) return native.gotoPoint.call(scene, s, point);
    ship.targetPoint = point; ship.mode = "GOTO";
    return true;
  } };
  const returningState = () => ({ enabled: true, haulInterrupted: true,
    haul: { id: "native-return", phase: "returning", moving: "warp", origin,
      shipID: 10, heartbeat: now, started: now, changed: now } });

  if (process.argv[3]) {
    const baselineFile = path.resolve(process.argv[3]);
    const baseline = new Module(baselineFile, module);
    baseline.filename = baselineFile;
    baseline.paths = module.paths;
    baseline._compile(fs.readFileSync(baselineFile, "utf8"), baselineFile);
    const before = baseline.exports.createHauling({ getSpace: () => space, save: () => "", clock: () => now });
    const state = returningState();
    assert.throws(() => before.action(session, state, state.haul.id, "position"), /Return movement was rejected/);
    assert.equal(movementCalls, 1);
    console.log("BASELINE: exact reported error reproduced with real native gotoPoint rejection.");
  }

  movementCalls = 0;
  const hauling = createHauling({ getSpace: () => space, save: () => "", clock: () => now });
  const s = returningState(), token = s.haul.id;
  hauling.action(session, s, token, "position");
  now += 3000;
  hauling.action(session, s, token, "position");
  assert.equal(movementCalls, 0);
  assert.equal(s.enabled, true);
  assert.equal(s.haul.id, token);
  if (legacyHandoff) session._space.pilotWarpVisibilityHandoff.landingPending = false;
  else ship.mode = "STOP";
  assert.equal(hasPendingPilotWarpLanding(session, ship), false);
  hauling.action(session, s, token, "position");
  assert.equal(movementCalls, 1);
  assert.equal(s.haul.moving, "approach");
  ship.position = { x: 0, y: 0, z: 0 };
  hauling.action(session, s, token, "position");
  hauling.action(session, s, token, "position");
  now += 2100;
  assert.equal(hauling.action(session, s, token, "position").atOrigin, true);
  hauling.action(session, s, token, "complete");
  assert.equal(s.enabled, true);
  assert.equal(s.haul, null);
  assert.equal(s.haulInterrupted, false);
  assert.equal(s.replan, true);
  assert.deepEqual(blockedWrites, []);
  console.log("PASS: native pending landing is waited out; approach, arrival-area braking and automatic resume succeed. No writes.");
} catch (error) {
  console.error(error.stack);
  console.error("Blocked writes:", blockedWrites);
  process.exitCode = 1;
}
