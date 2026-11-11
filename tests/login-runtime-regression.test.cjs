"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const runtimeApi = require("./support/runtimeUnderTest.cjs").api;
const { fixture, expression, frame, execute, nativeRoot, codec } = require("./support/loginFixture.cjs");

test("real codec: additive delivery preserves original bytes, result and native send/reply arguments", () => {
  const { Handshake } = fixture([{ id: "a", source: "print('ADDON_OK')\n" }]);
  const session = new Handshake(), original = frame("(__import__('sys').stdout.write('NATIVE_ONCE\\n'),77)[1]");
  const saved = Buffer.from(original);
  assert.equal(session._sendPacket(original, "native-send-result"), "native-send-result");
  assert.deepEqual(original, saved);
  const output = execute(session);
  assert.equal(output.match(/NATIVE_ONCE/g).length, 1);
  assert.equal(output.match(/ADDON_OK/g).length, 1);
  const reply = ["challenge", Buffer.from(output), 77];
  assert.deepEqual(session._handleFuncResult(reply), { done: true });
  assert.equal(session.lastReply, reply);
  assert.equal(session.replies, 1);
  assert.equal(session.closes, 0);
});

test("optional client exception leaves a healthy initializer and native login working", () => {
  const status = [];
  const { Handshake } = fixture([
    { id: "a", source: "raise RuntimeError('optional failed')\n", onFailure: (_, s) => status.push(s) },
    { id: "b", source: "print('HEALTHY_OK')\n", onReceipt: (_, s) => status.push(s) },
  ]);
  const session = new Handshake(); session._sendPacket(frame());
  const output = execute(session);
  assert.match(output, /HEALTHY_OK/);
  session._handleFuncResult(["challenge", Buffer.from(output), 77]);
  assert.deepEqual(status.map(s => [s.id, s.ok]), [["a", false], ["b", true]]);
  assert.equal(session.replies, 1);
});

test("required-provider refusal is terminal for duplicate native result replies", () => {
  const { Handshake } = fixture([{ id: "required", source: "pass\n", required: true }]);
  const session = new Handshake(); session._sendPacket(frame());
  const bad = ["challenge", Buffer.from("missing receipt"), 77];
  assert.equal(session._handleFuncResult(bad).loginDeliveryFailed, true);
  assert.equal(session._handleFuncResult(bad).loginDeliveryFailed, true);
  assert.equal(session.replies, 0, "a second reply must never reach native success after refusal");
});

test("one optional provider with a missing prerequisite does not suppress an independent provider", () => {
  const status = [];
  const { Handshake } = fixture([
    { id: "a", source: "print('UNUSABLE')\n", requires: ["missing"], onFailure: (_, s) => status.push(s) },
    { id: "b", source: "print('INDEPENDENT_OK')\n", onReceipt: (_, s) => status.push(s) },
  ]);
  const session = new Handshake(); session._sendPacket(frame());
  const output = execute(session);
  assert.match(output, /INDEPENDENT_OK/);
  assert.doesNotMatch(output, /UNUSABLE/);
  session._handleFuncResult(["challenge", Buffer.from(output), 77]);
  assert.equal(status.find(s => s.id === "a")?.ok, false);
  assert.equal(status.find(s => s.id === "b")?.ok, true);
});

test("an optional adapter cannot crash startup when another mod freezes the exported prototype", () => {
  function FakeModule() {}
  FakeModule.prototype._compile = function() {};
  const runtime = runtimeApi.createRuntime(nativeRoot, { moduleHost: FakeModule, codec, logger: { error() {} } });
  class Locked { _sendPacket() {} _handleFuncResult() {} }
  const original = Locked.prototype._sendPacket;
  Object.freeze(Locked.prototype);
  assert.doesNotThrow(() => assert.equal(runtime.attach(Locked), false));
  assert.equal(Locked.prototype._sendPacket, original);
});

test("fresh reconnects get distinct receipts and stale receipts do not mark the new connection ready", () => {
  const status = [];
  const { Handshake } = fixture([{ id: "a", source: "pass\n", onReceipt: (_, s) => status.push(s) }]);
  const first = new Handshake(); first._sendPacket(frame());
  const output = execute(first);
  first._handleFuncResult(["challenge", Buffer.from(output), 77]);
  const second = new Handshake(); second._sendPacket(frame());
  second._handleFuncResult(["challenge", Buffer.from(output), 77]);
  assert.equal(status.length, 1);
  second._handleFuncResult(["challenge", Buffer.from(execute(second)), 77]);
  assert.equal(status.length, 1, "late receipts cannot replay a consumed response");
});


