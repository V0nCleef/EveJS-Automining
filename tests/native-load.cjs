"use strict";
// Passive compatibility check: load the real server handlers without a world
// tick or filesystem writes, and verify the recall wrappers are attached.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = fs.realpathSync(process.argv[2]);
const loaderPath = path.resolve(process.argv[3] || path.join(__dirname, "../loader.js"));
const autopilotPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
const autopilotFirst = process.argv[5] === "autopilot-first";
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "reader";

const blockedWrites = [];
const deny = name => () => { blockedWrites.push(name); throw Error(`Read-only native load attempted ${name}`); };
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

// Keep the native service graph, but prevent its logger from opening files.
const target = path.join(root, "server/src/services/ship/beyonceService.js");
const loggerPath = path.resolve(require.resolve(path.join(root, "server/src/utils/logger"))).toLowerCase();
const logger = new Proxy({}, { get: (_, key) => key === "isVerboseDebugEnabled" ? () => false : () => {} });
const nativeLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (!Module.isBuiltin(request) &&
      path.resolve(Module._resolveFilename(request, parent, isMain)).toLowerCase() === loggerPath) return logger;
  return nativeLoad.apply(this, arguments);
};

try {
  let autopilot;
  function loadAutopilot() {
    assert.ok(autopilotPath, "autopilot-first requires an autopilot loader path");
    autopilot = require(autopilotPath);
    assert.equal(autopilot.installResult.active, true, "Autopilot loader must be active");
  }
  if (autopilotFirst) loadAutopilot();
  const automining = require(loaderPath).install(root);
  assert.equal(automining.active, true, "AutoMining loader must be active");
  if (autopilotPath && !autopilotFirst) loadAutopilot();

  const Service = require(target);
  for (const name of ["Handle_CmdWarpToStuff", "Handle_CmdDock", "Handle_CmdWarpToStuffAutopilot"]) {
    assert.match(Service.prototype[name].toString(), /departure\.run\(session, proceed\)/,
      `Drone recall guard missing from ${name}`);
  }
  if (autopilot) {
    assert.equal(autopilot.installResult.hookState.transformed.size, 1,
      "The other loader must actually compile its movement transform");
  }
  assert.deepEqual(blockedWrites, [], "Passive load must not write server files");
  console.log(`PASS: recall guards attached to all travel handlers (${autopilotPath ? (autopilotFirst ? "autopilot first" : "AutoMining first") : "AutoMining only"}); no writes.`);
} catch (error) {
  console.error(error.stack);
  console.error("Blocked writes:", blockedWrites);
  process.exitCode = 1;
}
