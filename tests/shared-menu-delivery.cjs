"use strict";
// AutoMining's common-ABI reuse/parity check. Actual Launcher bootstrap testing
// belongs to the Launcher suite; this does not claim retail client coverage.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const delivery = require("../lib/loginDelivery");
const runtimeApi = require("./support/runtimeUnderTest.cjs").api;
const { fixture, frame, codec, nativeRoot } = require("./support/loginFixture.cjs");
if (process.argv[2]) {
  const canonical = path.join(process.argv[2], "login_delivery.cjs");
  assert.deepEqual(fs.readFileSync(canonical), fs.readFileSync(path.resolve(__dirname, "../lib/loginDeliveryRuntime.js")),
    "Launcher and mod runtime must be byte-identical after canonical adoption");
}
const f = fixture(), previous = globalThis[runtimeApi.KEY];
globalThis[runtimeApi.KEY] = f.runtime;
try {
  const companion = delivery.createDelivery(path.resolve(__dirname, ".."), { token: "fixture-server" });
  const registration = delivery.install(nativeRoot, companion);
  assert.equal(registration.id, "automining");
  assert.equal(delivery.install(nativeRoot, companion), registration);
  f.runtime.register({ id: "shared-menu.fixture", source: "print('MENU_EXEC')\n" });
  const session = new f.Handshake(); session._sendPacket(frame());
  const value = codec.marshalDecodeExact(session.frames[0].subarray(4));
  assert.equal(value[1][1], 0);
  assert.ok(value[1][0].length <= runtimeApi.MAX_EXPRESSION + 5);
  const expression = value[1][0].toString("latin1", 5);
  assert.match(expression, /evejs-login-delivery-v1/);
  console.log(JSON.stringify({ result: "PASS", registration: registration.id, expressionBytes: value[1][0].length - 5,
    actualHudReadiness: "separate RPC lifecycle tests; initializer receipt is not HUD ready" }));
} finally {
  if (previous === undefined) delete globalThis[runtimeApi.KEY]; else globalThis[runtimeApi.KEY] = previous;
}
