"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHarness } = require("./support/nativeLoginHarness.cjs");
const delivery = require("../lib/loginDelivery");
const python = process.env.EVEJS_PYTHON || "python";
const companion = delivery.createDelivery(path.resolve(__dirname, ".."), { token: "server-A" });

function permutations(items) {
  return items.length ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest])) : [[]];
}
function runExpression(expression, withAutoMining = false) {
  const setup = withAutoMining ? [
    "import types, builtins",
    "sys.modules['__builtin__']=builtins",
    "queue=[]",
    "sys.modules['uthread']=types.SimpleNamespace(new=lambda *args: queue.append(args))",
    "sys.modules['blue']=types.SimpleNamespace()",
  ].join("\n") + "\n" : "";
  const checks = withAutoMining ? [
    "owner=getattr(builtins,'_evejs_automining_login_v1',None)",
    "assert owner is not None and owner.active and not owner.ready",
    "assert len(queue)==1",
  ].join("\n") : "";
  const result = spawnSync(python, ["-c", "import sys\n" + setup + "result=eval(getattr(sys.stdin,'buffer',sys.stdin).read())\nassert result==77\n" + checks],
    { input: expression, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function verifyPacket(original, sent, codec, decoded) {
  assert.equal(sent.readUInt32LE(0), sent.length - 4);
  const before = codec.marshalDecodeExact(original.subarray(4));
  assert.equal(decoded[1][1], before[1][1], "verification sentinel is native-owned");
  assert.deepEqual(decoded[0], before[0]);
  assert.deepEqual(decoded[2], before[2]); assert.deepEqual(decoded[3], before[3]);
  const oldField = codec.marshalEncode(before[1][0]).subarray(5), newField = codec.marshalEncode(decoded[1][0]).subarray(5);
  const at = original.indexOf(oldField, 9);
  assert.deepEqual(sent.subarray(4, at), original.subarray(4, at));
  assert.deepEqual(sent.subarray(at + newField.length), original.subarray(at + oldField.length));
}

for (const order of permutations(["runtime", "dcb", "haulers"])) test("pinned DCB 0.2.6 + Haulers 0.5.4 hooks coexist with AutoMining: " + order.join(" -> "), () => {
  const receipts = [];
  const h = createHarness({ order, specs: [
    { id: "automining", source: companion.source, onReceipt: (_, status) => receipts.push(status.id) },
    { id: "menu.fixture", source: "print('MENU_EXEC')\n", onReceipt: (_, status) => receipts.push(status.id) },
  ] });
  const session = h.session(), { original, sent } = h.login(session), value = h.decodeFrame(sent);
  verifyPacket(original, sent, h.codec, value);
  const output = runExpression(value[1][0].subarray(5).toString("utf8"), true);
  for (const marker of ["NATIVE_ONCE", "HAULER_EXEC", "DCB_EXEC", "MENU_EXEC"]) assert.equal(output.split(marker).length - 1, 1, marker);
  assert.equal(session._handleFuncResult(["challenge", Buffer.from(output), 77]).done, true);
  assert.deepEqual(receipts, ["automining", "menu.fixture"]);
  assert.match(h.haulerLogs.join("\n"), /CLIENT_REPORT.*CATALOG_READY/);
  assert.equal(session.state, "DONE", "real native reply handler still completes");
  assert.equal(session.frames.length, 2, "one native login packet and native acknowledgement");
});

const unknown = [
  ["prefix and unrelated interior insertion", source => "const unknownPrefix = 31;\n" + source.replace("class EVEHandshake {", "class EVEHandshake {\n  futureMetadata() { return unknownPrefix; }"), "buildTidiSignedFunc"],
  ["renamed private login builder", source => source.replaceAll("buildTidiSignedFunc", "futurePrivateBuilder"), "futurePrivateBuilder"],
  ["append-only private builder wrapper", source => source + "\nconst futurePrevious=buildTidiSignedFunc;\nbuildTidiSignedFunc=function(){const p=futurePrevious.apply(this,arguments);return buildMarshaledString('(lambda r: (__import__(\\\"sys\\\").stdout.write(\\\"FUTURE_EXEC\\\\n\\\"), r)[1])('+p.toString('latin1',5)+')');};\n", "buildTidiSignedFunc"],
];
for (const [name, transform, builderName] of unknown) for (const order of [["runtime", "unknown"], ["unknown", "runtime"]]) {
  test("unfamiliar additive source: " + name + " / " + order.join(" -> "), () => {
    const h = createHarness({ order, unknownSource: transform, builderName,
      specs: [{ id: "future.api", source: "print('FUTURE_API_EXEC')\n" }] });
    const session = h.session(), { original, sent } = h.login(session), value = h.decodeFrame(sent);
    verifyPacket(original, sent, h.codec, value);
    const output = runExpression(value[1][0].subarray(5).toString("utf8"));
    assert.equal(output.split("NATIVE_ONCE").length - 1, 1);
    assert.equal(output.split("FUTURE_API_EXEC").length - 1, 1);
    if (name.startsWith("append")) assert.equal(output.split("FUTURE_EXEC").length - 1, 1);
    assert.equal(session._handleFuncResult(["challenge", Buffer.from(output), 77]).done, true);
  });
}

test("unfamiliar send/reply observers chain before and after registration without replacing native encryption", () => {
  const h = createHarness({ order: ["runtime", "dcb", "haulers"], sendWrapper: true, replyWrapper: true,
    specs: [{ id: "future.api", source: "print('FUTURE_API_EXEC')\n" }] });
  const oldSend = h.Service.prototype._sendPacket, oldReply = h.Service.prototype._handleFuncResult;
  h.Service.prototype._sendPacket = function() { h.events.push("outer-send"); return oldSend.apply(this, arguments); };
  h.Service.prototype._handleFuncResult = function() { h.events.push("outer-reply"); return oldReply.apply(this, arguments); };
  const session = h.session({ encrypted: true }), { original, sent } = h.login(session);
  assert.notDeepEqual(sent, original);
  assert.deepEqual(session.sessionIV, sent.subarray(-16), "native encryption advances CBC IV");
  const value = h.decodeFrame(sent, true), output = runExpression(value[1][0].subarray(5).toString("utf8"));
  assert.equal(output.split("FUTURE_API_EXEC").length - 1, 1);
  assert.equal(session._handleFuncResult(["challenge", Buffer.from(output), 77]).done, true);
  assert.equal(h.events.filter(e => e === "future-reply").length, 1);
  assert.equal(h.events.filter(e => e === "outer-reply").length, 1);
});

