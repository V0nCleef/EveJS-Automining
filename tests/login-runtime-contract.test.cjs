"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path"), fs = require("node:fs");
const { Worker } = require("node:worker_threads");
const api = require("./support/runtimeUnderTest.cjs").api;
const { fixture, frame, expression, execute, codec, nativeRoot } = require("./support/loginFixture.cjs");

for (const verification of [false, 0]) test("native verification " + verification + " and unrelated dictionary data remain byte-exact", () => {
  const { Handshake } = fixture([{ id: "utf8", source: "# coding: utf-8\nprint(u'Pr\u00fcfung \u03ba\u00f3\u03c3\u03bc\u03bf\u03c2')\n" }]);
  const session = new Handshake(), original = frame("(__import__('sys').stdout.write('native-\u00e9\\n'),77)[1]", verification);
  const value = codec.marshalDecodeExact(original.subarray(4));
  session._sendPacket(original);
  const actual = codec.marshalDecodeExact(session.frames[0].subarray(4));
  assert.equal(actual[1][1], verification);
  assert.deepEqual(actual[0], value[0]); assert.deepEqual(actual[2], value[2]); assert.deepEqual(actual[3], value[3]);
  assert.ok(actual[1][0].includes(value[1][0].subarray(5)), "preserve every original UTF-8 byte");
  assert.match(execute(session), /Pr\u00fcfung \u03ba\u00f3\u03c3\u03bc\u03bf\u03c2/);
});

test("ambiguous signed-function encoding preserves the entire optional native frame and reports failure", () => {
  const status = [];
  const { Handshake } = fixture([{ id: "a", source: "pass\n", onFailure: (_, s) => status.push(s) }]);
  const session = new Handshake(), original = frame("77", 0, [["duplicate", expression("77")]]);
  session._sendPacket(original);
  assert.equal(session.frames[0], original);
  assert.equal(status[0].ok, false);
});

for (const required of [false, true]) test("malformed signed function, required=" + required + ", never replaces native data", () => {
  const { Handshake } = fixture([{ id: "a", source: "pass\n", required }]);
  const session = new Handshake();
  const original = codec.encodePacket(["", [Buffer.from([0x4e]), 0], { type: "dict", entries: [] },
    { type: "dict", entries: [["challenge_responsehash", "55087"]] }]);
  session._sendPacket(original);
  assert.equal(session.frames.length, required ? 0 : 1);
  if (required) {
    assert.equal(session._handleFuncResult(["challenge", Buffer.from("fake"), 77]).loginDeliveryFailed, true);
    assert.equal(session.replies, 0);
  } else assert.equal(session.frames[0], original);
});

test("unknown verification encoding is refused without normalization to false or zero", () => {
  const { Handshake } = fixture([{ id: "a", source: "pass\n" }]);
  const session = new Handshake(), original = frame("77", true);
  session._sendPacket(original);
  assert.equal(session.frames[0], original);
  assert.equal(codec.marshalDecodeExact(original.subarray(4))[1][1], true);
});

test("unrelated and malformed frames pass unchanged without consuming the login contribution", () => {
  const { Handshake } = fixture([{ id: "a", source: "print('CONTRIBUTED')\n" }]);
  const session = new Handshake(), unrelated = codec.encodePacket(2), malformed = Buffer.from([1, 0, 0, 0, 0]);
  session._sendPacket(unrelated); session._sendPacket(malformed);
  assert.equal(session.frames[0], unrelated); assert.equal(session.frames[1], malformed);
  session._sendPacket(frame()); assert.match(execute(session), /CONTRIBUTED/);
});

test("missing and cyclic optional dependencies are isolated from independent providers", () => {
  const failed = [];
  const { Handshake } = fixture([
    { id: "a", source: "print('BAD_A')\n", after: ["b"], onFailure: (_, s) => failed.push(s.id) },
    { id: "b", source: "print('BAD_B')\n", after: ["a"], onFailure: (_, s) => failed.push(s.id) },
    { id: "dependent", source: "print('BAD_DEPENDENT')\n", requires: ["a"], onFailure: (_, s) => failed.push(s.id) },
    { id: "healthy", source: "print('HEALTHY')\n" },
  ]);
  const session = new Handshake(); session._sendPacket(frame());
  const output = execute(session);
  assert.match(output, /HEALTHY/); assert.doesNotMatch(output, /BAD_/);
  assert.deepEqual(failed.sort(), ["a", "b", "dependent"]);
});

test("dependency order is deterministic and duplicate registration remains idempotent", () => {
  const f = fixture(), spec = { id: "a", source: "print('ORDER_A')\n", after: ["z"] };
  const handle = f.runtime.register(spec);
  assert.equal(f.runtime.register({ ...spec, after: ["z", "z"] }), handle);
  f.runtime.register({ id: "z", source: "print('ORDER_Z')\n" });
  assert.throws(() => f.runtime.register({ id: "a", source: "print('DIFFERENT')\n" }), /Conflicting/);
  const session = new f.Handshake(); session._sendPacket(frame());
  const output = execute(session);
  assert.ok(output.indexOf("ORDER_Z") < output.indexOf("ORDER_A"));
  assert.equal(f.runtime.register(spec), handle);
  assert.throws(() => f.runtime.register({ id: "new", source: "pass\n" }), /frozen/);
});

test("wrong nonce and duplicate receipts cannot establish successful initialization", () => {
  const ready = [];
  const { Handshake } = fixture([{ id: "a", source: "pass\n", onReceipt: () => ready.push(true) }]);
  const first = new Handshake(); first._sendPacket(frame());
  const output = execute(first);
  first._handleFuncResult(["challenge", Buffer.from(output.replace(/EVEJS_LOGIN:v1:[a-f0-9]{32}/, "EVEJS_LOGIN:v1:" + "0".repeat(32))), 77]);
  const second = new Handshake(); second._sendPacket(frame());
  const duplicate = execute(second);
  second._handleFuncResult(["challenge", Buffer.from(duplicate + duplicate), 77]);
  assert.deepEqual(ready, []);
});

test("provider callbacks are once per handshake and native reply failures keep their original exception", () => {
  let ready = 0;
  const f = fixture([{ id: "a", source: "pass\n", onReceipt: () => ready++ }]);
  const session = new f.Handshake(); session._sendPacket(frame());
  const output = execute(session), reply = ["challenge", Buffer.from(output), 77];
  session._handleFuncResult(reply); session._handleFuncResult(reply);
  assert.equal(ready, 1);
  const nativeError = Error("native authentication refused");
  class NativeFailure { _sendPacket() {} _handleFuncResult() { throw nativeError; } }
  f.runtime.attach(NativeFailure);
  assert.throws(() => new NativeFailure()._handleFuncResult([]), error => error === nativeError);
});

test("late native preload is refused before changing the existing compile chain", () => {
  function FakeModule() {}
  const previous = FakeModule.prototype._compile = function() {};
  FakeModule._cache = { native: { filename: path.join(nativeRoot, "server/src/network/tcp/handshake.js") } };
  assert.throws(() => api.createRuntime(nativeRoot, { moduleHost: FakeModule, codec, logger: { error() {} } }), /preload before/);
  assert.equal(FakeModule.prototype._compile, previous);
});

for (const version of ["EveJS-v0.12.9", "EveJS-261018.1", "EveJS-261028.1", "EveJS-261108.1"]) {
  test("native codec compatibility: " + version, () => {
    const selected = require(path.resolve(nativeRoot, "..", version, "server/src/network/tcp/utils/marshal.js"));
    const f = fixture([{ id: "a", source: "print('VERSION_OK')\n" }], selected);
    const session = new f.Handshake(); session._sendPacket(frame("77", version.includes("261108") ? 0 : false));
    assert.match(execute(session), /VERSION_OK/);
  });
}

test("source size limit rejects before adding a partial provider", () => {
  const f = fixture();
  assert.throws(() => f.runtime.register({ id: "oversized", source: "x".repeat(api.MAX_SOURCE + 1) }), /bounded/);
  f.runtime.register({ id: "healthy", source: "print('SIZE_OK')\n" });
  const session = new f.Handshake(); session._sendPacket(frame()); assert.match(execute(session), /SIZE_OK/);
});

test("failed client prerequisite skips its dependent initializer and refuses a required dependent", () => {
  const status = [];
  const { Handshake } = fixture([
    { id: "a", source: "raise RuntimeError('failed prerequisite')\n" },
    { id: "dependent", source: "print('MUST_NOT_EXECUTE')\n", requires: ["a"], required: true, onFailure: (_, s) => status.push(s) },
    { id: "independent", source: "print('STILL_HEALTHY')\n" },
  ]);
  const session = new Handshake(); session._sendPacket(frame());
  const output = execute(session);
  assert.doesNotMatch(output, /MUST_NOT_EXECUTE/); assert.match(output, /STILL_HEALTHY/);
  assert.equal(session._handleFuncResult(["challenge", Buffer.from(output), 77]).loginDeliveryFailed, true);
  assert.equal(status[0].ok, false); assert.equal(session.replies, 0);
});

test("failed prerequisite callback never claims its dependent's successful initialization", () => {
  const status = [];
  const { Handshake } = fixture([
    { id: "a", source: "pass\n", onReceipt() { throw Error("prerequisite callback failed"); } },
    { id: "dependent", source: "pass\n", requires: ["a"], onReceipt: () => assert.fail("dependent not ready"), onFailure: (_, s) => status.push(s) },
  ]);
  const session = new Handshake(); session._sendPacket(frame());
  session._handleFuncResult(["challenge", Buffer.from(execute(session)), 77]);
  assert.equal(status.length, 1); assert.equal(status[0].ok, false); assert.equal(session.replies, 1);
});

test("required activation fails explicitly when native methods cannot be attached, without partial mutation", () => {
  function FakeModule() {} FakeModule.prototype._compile = function() {};
  const runtime = api.createRuntime(nativeRoot, { moduleHost: FakeModule, codec, logger: { error() {} } });
  runtime.register({ id: "required", source: "pass\n", required: true });
  class Locked { _sendPacket() {} _handleFuncResult() {} }
  const previous = Locked.prototype._sendPacket; Object.freeze(Locked.prototype);
  assert.throws(() => runtime.attach(Locked), error => error.code === "EVEJS_LOGIN_ADAPTER_UNAVAILABLE");
  assert.equal(Locked.prototype._sendPacket, previous);
});

test("required registration after a known adapter failure is refused before a partial provider is stored", () => {
  function FakeModule() {} FakeModule.prototype._compile = function() {};
  const runtime = api.createRuntime(nativeRoot, { moduleHost: FakeModule, codec, logger: { error() {} } });
  assert.equal(runtime.attach(function MissingMethods() {}), false);
  assert.throws(() => runtime.register({ id: "required", source: "pass\n", required: true }), error => error.code === "EVEJS_LOGIN_ADAPTER_UNAVAILABLE");
});

test("registration caps provider count while identical repeated registration stays harmless at the cap", () => {
  const f = fixture();
  const first = { id: "p0", source: "pass\n" }, handle = f.runtime.register(first);
  for (let i = 1; i < 64; i++) f.runtime.register({ id: "p" + i, source: "pass\n" });
  assert.throws(() => f.runtime.register({ id: "p64", source: "pass\n" }), /64 providers/);
  assert.equal(f.runtime.register(first), handle);
});

test("registration caps aggregate raw source independently of compression", () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) f.runtime.register({ id: "p" + i, source: "#" + "x".repeat(api.MAX_SOURCE - 1) });
  assert.throws(() => f.runtime.register({ id: "too.much", source: "pass\n" }), /aggregate.*1 MiB/);
});

for (const required of [false, true]) test("combined expression limit, required=" + required + ", preserves the caller's original buffer", () => {
  const f = fixture([{ id: "a", source: "pass\n", required }]);
  const session = new f.Handshake(), original = frame("(" + " ".repeat(api.MAX_EXPRESSION - 12) + "77)");
  const saved = Buffer.from(original);
  session._sendPacket(original);
  assert.deepEqual(original, saved);
  assert.equal(session.frames.length, required ? 0 : 1);
  if (!required) assert.equal(session.frames[0], original);
});

test("a rejected handshake cannot send another login packet; native transport close still works", () => {
  const f = fixture([{ id: "a", source: "pass\n", required: true }]);
  const session = new f.Handshake(); session._sendPacket(frame());
  session._handleFuncResult(["challenge", Buffer.from("missing"), 77]);
  session._sendPacket(frame());
  assert.equal(session.frames.length, 1);
  assert.equal(session.closes, 1);
});

test("global v1 ownership reuses one root and rejects an incompatible root or ABI", () => {
  function FakeModule() {} FakeModule.prototype._compile = function() {};
  const host = {}, options = { host, moduleHost: FakeModule, codec, logger: { error() {} } };
  const first = api.getRuntime(nativeRoot, options), hook = FakeModule.prototype._compile;
  assert.equal(api.getRuntime(path.join(nativeRoot, "."), options), first);
  assert.equal(FakeModule.prototype._compile, hook);
  assert.throws(() => api.getRuntime(path.join(nativeRoot, "other"), options), /runtime owner/);
  assert.throws(() => api.getRuntime(nativeRoot, { ...options, host: { [api.KEY]: { abi: 2, root: first.root } } }), /runtime owner/);
});

test("worker getRuntime is a no-op rather than a second delivery owner", async () => {
  const file = require("./support/runtimeUnderTest.cjs").file;
  const worker = new Worker("const {parentPort}=require('node:worker_threads');const api=require(" + JSON.stringify(file) +
    ");const Module=require('node:module'),previous=Module.prototype._compile;parentPort.postMessage([api.getRuntime('not-a-real-root')===null,Module.prototype._compile===previous]);", { eval: true });
  const result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  await new Promise((resolve, reject) => { worker.once("exit", code => code ? reject(Error("worker exit " + code)) : resolve()); worker.once("error", reject); });
  assert.deepEqual(result, [true, true]);
});
