"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installHUD } = require("../lib/hud");
test("fresh action authorization survives the passive HUD transport snapshot", () => {
  let changed = false;
  const job = { id: "lease", grant: "warp", nonce: "new" };
  class Service {}
  const controller = {
    transportAction(session, id, action, payload) {
      assert.equal(id, "lease"); assert.equal(action, "authorizeWarp"); assert.equal(payload, '{}');
      changed = true; return { job, authorized: true };
    },
    snapshot() { assert.equal(changed, true); return { transport: { job, authorized: false }, revision: "after" }; },
  };
  installHUD(Service, controller, () => []);
  const reply = JSON.parse(new Service().Handle_AutoMiningTransportAction(["lease", "authorizeWarp", '{}'], {}));
  assert.equal(reply.success, true); assert.equal(reply.transport.authorized, true);
  assert.equal(reply.transport.job.grant, "warp"); assert.equal(reply.revision, "after");
});
