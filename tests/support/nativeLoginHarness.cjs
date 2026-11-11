"use strict";
// The released native class/codec run against fake sockets and no account store.
// Only its private Python builder is replaced by an authored executable marker.
const assert = require("node:assert/strict"), fs = require("node:fs");
const path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const runtimeApi = require("./runtimeUnderTest.cjs").api;
const { nativeRoot, codec, expression } = require("./loginFixture.cjs");
const target = path.resolve(nativeRoot, "server/src/network/tcp/handshake.js");
const baseline = fs.readFileSync(target, "utf8");
const vendorRoot = process.env.EVEJS_LOGIN_VENDOR_ROOT || path.resolve(__dirname, "../../../integration/vendor");
const dcb = require(path.join(vendorRoot, "dcb/droneClassBalance/simulation/delivery.js"));
const haulers = require(path.join(vendorRoot, "haulers/login-envelope.js"));

function createHarness({ order = ["runtime"], specs = [], unknownSource = source => source,
                         sendWrapper = false, replyWrapper = false, builderName = "buildTidiSignedFunc",
                         setupLayer = () => false } = {}) {
  const logs = [], compiled = [], nativeFrames = [], events = [];
  const haulerLogs = [];
  const fleetSize = require(path.join(vendorRoot, "haulers/fleet.json")).ships.length;
  const haulerProgram = "def run_family(context, nonce):\n print('HAULER_EXEC')\n print('EMPIRE_HAULERS:' + nonce + ':CATALOG_READY ships=" + fleetSize + " blueprintTypes=" + fleetSize + "')\n";
  const haulerDelivery = haulers.createDelivery(haulerProgram, { log: text => haulerLogs.push(text) });
  const fitting = dcb.createDelivery({ adapter: "# isolated adapter fixture", fingerprints: {},
    bootstrap: "print('DCB_EXEC')\n" }, () => null);
  const context = vm.createContext({ module: { exports: {} }, Buffer, process: { platform: process.platform },
    __dirname: path.dirname(target), console: { log() {}, warn() {}, error() {} } });
  context[Symbol.for(dcb.KEY)] = { compose: fitting };
  context[Symbol.for(haulers.SYMBOL)] = haulerDelivery;
  const logger = { debug() {}, info() {}, warn() {}, err() {}, success() {}, isVerboseDebugEnabled: () => false };
  context.require = name => {
    if (["path", "crypto"].includes(name)) return require(name);
    if (name.replace(/\\/g, "/").endsWith("/utils/marshal")) return codec;
    if (name === "../gameFrame") return require(path.resolve(nativeRoot, "server/src/network/gameFrame.js"));
    if (name.replace(/\\/g, "/").endsWith("/utils/logger")) return logger;
    if (name.replace(/\\/g, "/").endsWith("/accountRoleProfiles")) return { DEFAULT_CHAT_ROLE: 0, roleToString: () => "0" };
    if (name.replace(/\\/g, "/").endsWith("/protocolProfile")) return { CLIENT_COMPATIBILITY_PROFILE: {}, PROXY_NODE_ID: 1, SEED_SKILL_EXTRACTOR_ACCESS_TOKEN: false };
    if (name.replace(/\\/g, "/").endsWith("/config")) return { dev: {} };
    // None of these dependencies may be used for real account/storage access.
    return new Proxy({}, { get: (_, property) => property === "resolveDataRootPath" ? () => { throw Error("No fixture data-root writes"); } : undefined });
  };
  function FakeModule() {}
  FakeModule.prototype._compile = function(source, filename) {
    assert.equal(path.resolve(filename), target);
    compiled.push(source);
    const tuple = source.match(new RegExp("^[ \\t]*(\\[.*" + builderName + "\\(this\\.clientId\\).*, (?:false|0)\\]),", "m"))?.[1];
    assert.ok(tuple, "actual transformed native signed-function tuple must exist");
    const builder = new RegExp("function " + builderName + "\\(clientId\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}", "g");
    assert.equal([...source.matchAll(builder)].length, 1);
    const marker = "(__import__('sys').stdout.write('NATIVE_ONCE\\n'),77)[1]";
    const authored = source.replace(builder, "function " + builderName + "(clientId) { return buildMarshaledString(" + JSON.stringify(marker) + "); }");
    vm.runInContext(authored + "\nmodule.exports.fixturePacket = function() { return encodePacket(['', " + tuple +
      ", {type:'dict',entries:[['context','preserve']]}, {type:'dict',entries:[['challenge_responsehash','55087'],['other','preserve']]}]); };", context);
    this.exports = context.module.exports;
    if (sendWrapper) {
      const previous = this.exports.prototype._sendPacket;
      this.exports.prototype._sendPacket = function() { events.push("future-send"); return previous.apply(this, arguments); };
    }
    if (replyWrapper) {
      const previous = this.exports.prototype._handleFuncResult;
      this.exports.prototype._handleFuncResult = function() { events.push("future-reply"); return previous.apply(this, arguments); };
    }
    return "native-compile-result";
  };
  let runtime;
  for (const layer of order) {
    if (setupLayer(layer, { FakeModule, context, host: vm.runInContext("globalThis", context),
                          codec, baseline, nativeRoot, logs })) continue;
    if (layer === "runtime") {
      runtime = runtimeApi.createRuntime(nativeRoot, { moduleHost: FakeModule, codec, logger: { error: text => logs.push(text) } });
      for (const spec of specs) runtime.register(spec);
    } else {
      const previous = FakeModule.prototype._compile;
      FakeModule.prototype._compile = function(source, filename) {
        if (layer === "dcb") source = dcb.extendSource(source);
        else if (layer === "haulers") source = haulers.transformHandshake(baseline, source, {});
        else if (layer === "unknown") source = unknownSource(source);
        return previous.call(this, source, filename);
      };
    }
  }
  const compiledModule = new FakeModule();
  assert.equal(compiledModule._compile(baseline, target), "native-compile-result");
  const Service = compiledModule.exports;
  function session({ encrypted = false } = {}) {
    const s = Object.create(Service.prototype), frames = [];
    Object.assign(s, { userId: 42, clientId: 123, userName: "fixture-user", state: "WAIT_AUTH",
      sessionId: 123n, role: 0, languageId: "EN", countryCode: "ZZ", address: "127.0.0.1", encrypted,
      sessionKey: encrypted ? Buffer.alloc(32, 7) : null, sessionIV: encrypted ? Buffer.alloc(16, 9) : null,
      socket: { write(packet) { frames.push(packet); nativeFrames.push(packet); }, end() { events.push("socket-end"); },
        destroy() { events.push("socket-destroy"); } } });
    s.frames = frames;
    return s;
  }
  function login(s) {
    const original = Service.fixturePacket.call(s);
    s._sendPacket(original);
    return { original, sent: s.frames.at(-1) };
  }
  function decodeFrame(packet, encrypted = false) {
    if (!encrypted) return codec.marshalDecodeExact(packet.subarray(4));
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.alloc(32, 7), Buffer.alloc(16, 9));
    return codec.marshalDecodeExact(Buffer.concat([decipher.update(packet.subarray(4)), decipher.final()]));
  }
  return { session, login, Service, decodeFrame, codec, logs, compiled, events, haulerLogs, runtime };
}

module.exports = { createHarness, baseline, nativeRoot, codec, expression };
