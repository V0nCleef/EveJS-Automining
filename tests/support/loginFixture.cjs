"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const runtimeApi = require("./runtimeUnderTest.cjs").api;
const nativeRoot = process.env.EVEJS_LOGIN_NATIVE_ROOT || path.resolve(__dirname, "../../../integration/native/EveJS-261108.1");
const codec = require(path.join(nativeRoot, "server/src/network/tcp/utils/marshal.js"));
const python = process.env.EVEJS_PYTHON || "python";

function expression(source) {
  const bytes = Buffer.from(source, "utf8"), header = Buffer.alloc(5);
  header[0] = 0x74; header.writeUInt32LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}
function frame(source = "77", verification = 0, extra = []) {
  return codec.encodePacket(["", [expression(source), verification], { type: "dict", entries: extra },
    { type: "dict", entries: [["challenge_responsehash", "55087"], ["unrelated", "keep-me"]] }]);
}
function fixture(specs = [], selectedCodec = codec, selectedApi = runtimeApi) {
  function FakeModule() {}
  FakeModule.prototype._compile = function() {};
  const logs = [];
  const runtime = selectedApi.createRuntime(nativeRoot, { moduleHost: FakeModule, codec: selectedCodec,
    logger: { error: text => logs.push(text) } });
  class Handshake {
    constructor() { this.userId = 42; this.frames = []; this.replies = 0; this.closes = 0; }
    _sendPacket(packet, marker) { this.frames.push(packet); return marker; }
    _handleFuncResult(decoded) { this.replies++; this.lastReply = decoded; return { done: true }; }
    _sendTransportClose() { this.closes++; }
  }
  for (const spec of specs) runtime.register(spec);
  assert.equal(runtime.attach(Handshake), true);
  return { runtime, Handshake, logs };
}
function execute(session) {
  const packet = session.frames.at(-1);
  const signed = codec.marshalDecodeExact(packet.subarray(4))[1][0];
  const source = signed.subarray(5).toString("utf8");
  const result = spawnSync(python, ["-c", "import sys; result=eval(getattr(sys.stdin,'buffer',sys.stdin).read()); assert result==77"],
    { input: source, encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}


module.exports = { fixture, expression, frame, execute, nativeRoot, codec };
