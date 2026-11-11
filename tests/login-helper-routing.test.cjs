"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const stage = path.resolve(__dirname, "..");
const helper = fs.readFileSync(path.join(stage, "helper.js"), "utf8");

function fixture({ backend = "native", receipt = null, mining = true, pending = false,
                   loginCapable = true, preparationFailure = false, cleanupFailure = false } = {}) {
  const root = path.resolve("fixture-root"), clientRoot = path.resolve("fixture-client");
  const calls = [], module = { exports: {} };
  let savedReceipt = receipt, capable = loginCapable;
  function fakeRequire(name) {
    if (name === "node:path") return path;
    if (name === "node:fs") return {
      realpathSync: file => file,
      existsSync: file => file.endsWith("receipt.json") ? savedReceipt !== null : file.endsWith("pending.json") ? pending : false,
      readFileSync: file => file.endsWith("receipt.json") ? JSON.stringify(savedReceipt) : "fixture mining source",
      writeFileSync() { assert.fail("profile routing may not write client archives or state"); },
    };
    if (name === "./helper-legacy") return {
      execute: request => {
        calls.push(["legacy", request.action]);
        if (request.action === "prepare_disable") {
          if (cleanupFailure) throw Error("fixture owned cleanup refused");
          savedReceipt = { ...savedReceipt, clientRoot, status: "restored" };
        }
        if (request.action === "install") savedReceipt = { clientRoot, status: "active" };
        return { success: true, environment: {} };
      },
      recoverSwap: () => calls.push(["recover"]),
    };
    if (name === "./lib/loginDelivery") return {
      supportsRoot: () => capable,
      createDelivery: () => { calls.push(["prepare-source"]); if (preparationFailure) throw Error("fixture payload refused"); return {}; },
    };
    if (name === "./lib/settings") return { surveySeconds: value => value || 30 };
    if (name === "./lib/statePaths") return { migrateState: () => calls.push(["migrate"]) };
    if (name === "./lib/miningCompatibility") return { supportsMiningSource: () => mining };
    throw Error("Unexpected helper dependency " + name);
  }
  fakeRequire.main = null;
  vm.runInNewContext(helper, { module, require: fakeRequire, process: { env: {
    EVEJS_LAUNCHER_HELPER_FEATURES: "client-script-delivery-v1,client-preparation-v1" } } });
  function execute(action = "prepare_profile", selectedBackend = backend) {
    return module.exports.execute({ protocol: 1, requestId: "fixture", action,
      runtime: { evejsRoot: root, backend: selectedBackend, clientRoot }, mod: { root, path: stage }, settings: { profile: {} } });
  }
  return { execute, calls, clientRoot, receipt: () => savedReceipt, setLoginCapable: value => { capable = value; } };
}

test("native helper reports configured delivery without claiming HUD readiness or installing a runtime", () => {
  const f = fixture(), result = f.execute();
  assert.equal(result.clientScriptDelivery, "login-handshake");
  assert.equal(result.environment.AUTOMINING_CLIENT_DELIVERY, "login-v1");
  assert.match(result.message, /readiness is checked after character login/);
  assert.deepEqual(f.calls, [["prepare-source"]]);
});
test("capable clean Docker profile uses login-v1 without touching an archive", () => {
  const f = fixture({ backend: "docker" }), result = f.execute();
  assert.equal(result.environment.AUTOMINING_CLIENT_DELIVERY, "login-v1");
  assert.equal(result.clientScriptDelivery, "login-handshake");
  assert.deepEqual(f.calls, [["prepare-source"]]);
});

test("unavailable login capability retains qualified Docker legacy delivery", () => {
  const f = fixture({ backend: "docker", loginCapable: false }), result = f.execute();
  assert.equal(result.environment.AUTOMINING_CLIENT_DELIVERY, "legacy");
  assert.equal(result.clientScriptDelivery, "client-script-patch");
  assert.deepEqual(f.calls, [["legacy", "prepare_profile"]]);
});
for (const backend of ["native", "docker"]) test("ordinary " + backend + " preparation preserves active shared-client archive", () => {
  const clientRoot = path.resolve("fixture-client");
  const f = fixture({ backend, receipt: { clientRoot, status: "active" } }), result = f.execute();
  assert.equal(result.environment.AUTOMINING_CLIENT_DELIVERY, "legacy");
  assert.deepEqual(f.calls, [["prepare-source"], ["legacy", "prepare_profile"]]);
});

for (const backend of ["native", "docker"]) for (const action of ["install", "recover"]) test(backend + " " + action + " prepares payload before explicit owned legacy cleanup", () => {
  const f = fixture({ backend, receipt: { clientRoot: path.resolve("fixture-client"), status: "active" } });
  const result = f.execute(action);
  assert.equal(result.success, true); assert.equal(result.clientScriptDelivery, "login-handshake");
  assert.deepEqual(f.calls, [["migrate"], ["prepare-source"], ["legacy", "prepare_disable"]]);
  assert.equal(f.receipt().status, "restored");
});

test("failed payload preparation never starts owned archive cleanup", () => {
  const f = fixture({ backend: "docker", preparationFailure: true, receipt: { clientRoot: path.resolve("fixture-client"), status: "active" } });
  assert.throws(() => f.execute("install"), /payload refused/);
  assert.deepEqual(f.calls, [["migrate"], ["prepare-source"]]); assert.equal(f.receipt().status, "active");
});

test("refused cleanup preserves active receipt and cannot report configured login", () => {
  const f = fixture({ backend: "docker", cleanupFailure: true, receipt: { clientRoot: path.resolve("fixture-client"), status: "active" } });
  assert.throws(() => f.execute("recover"), /cleanup refused/); assert.equal(f.receipt().status, "active");
});

test("one physical client keeps legacy across Native and Docker until explicit migration, and can return to fallback", () => {
  const f = fixture({ receipt: { clientRoot: path.resolve("fixture-client"), status: "active" } });
  for (const backend of ["native", "docker"]) {
    assert.equal(f.execute("prepare_profile", backend).environment.AUTOMINING_CLIENT_DELIVERY, "legacy");
  }
  assert.equal(f.calls.some(call => call[1] === "prepare_disable"), false);
  f.execute("install", "docker");
  assert.equal(f.execute("prepare_profile", "docker").environment.AUTOMINING_CLIENT_DELIVERY, "login-v1");
  f.setLoginCapable(false); f.execute("install", "native");
  assert.equal(f.receipt().status, "active");
  f.setLoginCapable(true);
  assert.equal(f.execute("prepare_profile", "docker").environment.AUTOMINING_CLIENT_DELIVERY, "legacy");
});
test("unsupported mining source cannot prepare a new installation; cleanup remains callable", () => {
  const f = fixture({ mining: false });
  assert.throws(() => f.execute("install"), /cannot activate/);
  assert.deepEqual(f.calls, []);
  const result = f.execute("prepare_disable");
  assert.equal(result.success, true); assert.equal(result.clientScriptDelivery, "none");
});
test("pending client swap refuses ordinary preparation before legacy or archive mutation", () => {
  const f = fixture({ pending: true });
  assert.throws(() => f.execute(), /needs recovery/);
  assert.deepEqual(f.calls, [["prepare-source"]]);
});
test("foreign client receipt is refused without attempting cleanup or rewriting it", () => {
  const f = fixture({ receipt: { clientRoot: "unrelated-client", status: "active" } });
  assert.throws(() => f.execute(), /Unrecognized/);
  assert.deepEqual(f.calls, [["prepare-source"]]);
});
