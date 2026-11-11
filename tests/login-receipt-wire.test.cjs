"use strict";
// Execute the exact emitted bootstrap. Receipt substrings alone do not prove framing.
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), { createRequire } = require("node:module");
const selected = require("./support/runtimeUnderTest.cjs");
const { fixture, frame, execute, codec } = require("./support/loginFixture.cjs");

function probe(api = selected.api) {
  const accepted = [], failed = [];
  const f = fixture([
    { id: "a", source: "pass\n", onReceipt: (_, s) => accepted.push(s.id), onFailure: (_, s) => failed.push(s.id) },
    { id: "b", source: "raise RuntimeError('fixture optional failure')\n", onFailure: (_, s) => failed.push(s.id) },
    { id: "c", source: "pass\n", onReceipt: (_, s) => accepted.push(s.id), onFailure: (_, s) => failed.push(s.id) },
  ], codec, api);
  const session = new f.Handshake(); session._sendPacket(frame());
  const output = execute(session);
  session._handleFuncResult(["challenge", Buffer.from(output), 77]);
  return { output, accepted, failed, session };
}

test("Python execution emits three complete newline-delimited receipts without provider prints", () => {
  const result = probe();
  const lines = result.output.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 3);
  const receipts = lines.map(line => line.match(/^EVEJS_LOGIN:v1:([0-9a-f]{32}):([a-z]):(OK|FAILED)$/));
  assert.ok(receipts.every(Boolean), "every receipt must occupy a complete output line");
  assert.deepEqual(receipts.map(match => [match[2], match[3]]), [["a", "OK"], ["b", "FAILED"], ["c", "OK"]]);
  assert.equal(new Set(receipts.map(match => match[1])).size, 1);
  assert.equal(result.output.includes(String.fromCharCode(92) + "n"), false, "literal backslash+n is not a delimiter");
  assert.deepEqual(result.accepted, ["a", "c"]);
  assert.deepEqual(result.failed, ["b"]);
  assert.equal(result.session.replies, 1);
});

test("deliberately double-escaped in-memory mutant fails standalone receipt validation", () => {
  const source = fs.readFileSync(selected.file, "utf8"), slash = String.fromCharCode(92);
  const good = ["OK", "FAILED"].map(status => status + slash.repeat(2) + "n");
  let mutant = source;
  for (const token of good) {
    assert.equal(mutant.split(token).length, 2, "one reviewed receipt serialization literal");
    mutant = mutant.replace(token, token.replace(slash.repeat(2), slash.repeat(4)));
  }
  const module = { exports: {} };
  vm.runInNewContext(mutant, { module, require: createRequire(selected.file), Buffer, process, console });
  const result = probe(module.exports);
  assert.equal(result.output.split(/\r?\n/).filter(line => /^EVEJS_LOGIN:v1:[0-9a-f]{32}:[a-z]:(OK|FAILED)$/.test(line)).length, 0);
  assert.ok(result.output.includes(slash + "n"));
  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.failed, ["a", "b", "c"]);
});

function shapeProbe(transform, api = selected.api, wire = true) {
  const accepted = [], failed = [];
  const f = fixture([{ id: "receipt", source: "pass\n", onReceipt: (_, s) => accepted.push(s), onFailure: (_, s) => failed.push(s) }], codec, api);
  const session = new f.Handshake(); session._sendPacket(frame());
  const output = execute(session), raw = ["fixture-challenge", transform(output), null];
  const reply = wire ? codec.marshalDecodeExact(codec.marshalEncode(raw)) : raw;
  session._handleFuncResult(reply);
  return { accepted, failed, session, reply };
}

for (const type of ["buffer", "wstring", "token", "rawstr"]) test("actual native codec accepts complete receipts carried as " + type, () => {
  const result = shapeProbe(output => type === "buffer" ? Buffer.from(output) : { type, value: output });
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(result.failed, []);
  assert.equal(result.session.replies, 1);
});

test("native plain-string receipt shape remains accepted", () => {
  assert.equal(shapeProbe(output => output, selected.api, false).accepted.length, 1);
});

test("preserved 9e7d runtime is a negative control for actual native Unicode capture", () => {
  const old = require("./fixtures/loginDeliveryRuntime-9e7d.cjs");
  const result = shapeProbe(output => ({ type: "wstring", value: output }), old);
  assert.equal(result.reply[1].type, "wstring");
  assert.deepEqual(result.accepted, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.session.replies, 1);
});

for (const [name, transform] of [
  ["arbitrary object", output => ({ toString() { assert.fail("arbitrary object was coerced"); } })],
  ["wrong native tag", output => ({ type: "object", value: output })],
  ["non-text tag value", output => ({ type: "wstring", value: { toString() { assert.fail("tag value was coerced"); } } })],
  ["oversize Unicode bytes", output => ({ type: "wstring", value: "\u20ac".repeat(Math.floor(selected.api.MAX_EXPRESSION / 3) + 1) + output })],
]) test("receipt normalization refuses " + name, () => {
  const result = shapeProbe(transform, selected.api, false);
  assert.deepEqual(result.accepted, []); assert.equal(result.failed.length, 1);
  assert.equal(result.session.replies, 1);
});

test("receipt starts on a fresh line after unterminated native and provider stdout", () => {
  const accepted = [];
  const f = fixture([{ id: "receipt", source: "import sys\nsys.stdout.write('PROVIDER_UNTERMINATED')\n", onReceipt: (_, s) => accepted.push(s) }]);
  const session = new f.Handshake();
  session._sendPacket(frame("(__import__('sys').stdout.write('NATIVE_UNTERMINATED'),77)[1]"));
  const output = execute(session);
  assert.ok(output.startsWith("NATIVE_UNTERMINATEDPROVIDER_UNTERMINATED"));
  assert.equal(output.split(/\r?\n/).filter(line => /^EVEJS_LOGIN:v1:[0-9a-f]{32}:receipt:OK$/.test(line)).length, 1);
  session._handleFuncResult(["fixture-challenge", { type: "wstring", value: output }, null]);
  assert.equal(accepted.length, 1); assert.equal(session.replies, 1);
});
