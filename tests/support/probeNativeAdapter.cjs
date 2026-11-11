"use strict";
// Existing native source/codec only, fake socket/account, and blocked writes.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const root = path.resolve(process.argv[2]);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const handshakeFile = path.join(root, "server/src/network/tcp/handshake.js");
const codecFile = path.join(root, "server/src/network/tcp/utils/marshal.js");
const expectedVersion = process.argv[3] || "0.12.8";
const versions = {};
for (const relative of ["server/package.json", "config/version.json", "package.json"]) {
  const file = path.join(root, relative);
  if (fs.existsSync(file)) {
    try { const data = JSON.parse(fs.readFileSync(file, "utf8")); versions[relative] = data.evejsVersion || data.version || null; }
    catch (_) { versions[relative] = "unreadable"; }
  }
}
const result = { root, expectedVersion, versions, status: "UNSUPPORTED", reason: null, sourceHashes: {} };
if (!fs.existsSync(handshakeFile) || !fs.existsSync(codecFile)) {
  console.log(JSON.stringify({ ...result, status: "MISSING", reason: "native handshake or codec file is missing" }));
  process.exit(0);
}
result.sourceHashes = { handshake: hash(handshakeFile), codec: hash(codecFile) };
if (!Object.values(versions).includes(expectedVersion)) {
  console.log(JSON.stringify({ ...result, status: "VERSION_UNCONFIRMED", reason: "source tree does not declare expected EveJS " + expectedVersion }));
  process.exit(0);
}
for (const method of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync", "rmdirSync", "linkSync", "symlinkSync", "copyFileSync", "truncateSync", "createWriteStream"]) {
  fs[method] = () => { throw Error("Read-only native probe blocked " + method); };
}
try {
  const codec = require(codecFile), source = fs.readFileSync(handshakeFile, "utf8");
  const api = require("./runtimeUnderTest.cjs").api;
  const required = ["marshalDecodeExact", "marshalEncode", "encodePacket", "wrapPacket", "dictGet", "strVal"];
  const missing = required.filter(name => typeof codec[name] !== "function");
  if (missing.length) throw Error("native codec lacks " + missing.join(", "));
  const logger = new Proxy({}, { get: (_, name) => name === "isVerboseDebugEnabled" ? () => false : () => {} });
  const context = { Buffer, module: { exports: {} }, __dirname: path.dirname(handshakeFile),
    process: { platform: process.platform }, console: logger,
    require(name) {
      if (["path", "crypto", "fs"].includes(name)) return require(name);
      const normalized = name.replace(/\\/g, "/");
      if (normalized.endsWith("/utils/marshal") || normalized === "./utils/marshal") return codec;
      if (normalized.endsWith("/logger")) return logger;
      if (normalized.endsWith("/accountRoleProfiles")) return { DEFAULT_CHAT_ROLE: 0, roleToString: () => "0" };
      if (normalized.endsWith("/protocolProfile")) return { CLIENT_COMPATIBILITY_PROFILE: {}, PROXY_NODE_ID: 1 };
      if (normalized.endsWith("/config")) return { dev: {}, server: {} };
      if (normalized.endsWith("gameFrame")) return require(path.resolve(path.dirname(handshakeFile), name));
      return {};
    } };
  vm.runInNewContext(source, context, { timeout: 2000 });
  const Service = context.module.exports;
  function FakeModule() {} FakeModule.prototype._compile = function() {};
  const runtime = api.createRuntime(root, { moduleHost: FakeModule, codec, logger });
  runtime.register({ id: "probe", source: "pass\n" });
  if (!runtime.attach(Service)) throw Error("compiled native class does not expose supported packet/reply capabilities");
  const nativeExpression = Buffer.from("77"), signed = Buffer.alloc(nativeExpression.length + 5);
  signed[0] = 0x74; signed.writeUInt32LE(nativeExpression.length, 1); nativeExpression.copy(signed, 5);
  const original = codec.encodePacket(["", [signed, false], { type: "dict", entries: [] },
    { type: "dict", entries: [["challenge_responsehash", "55087"]] }]);
  const frames = [], session = Object.assign(Object.create(Service.prototype), { userId: 42, clientId: 123, encrypted: false,
    socket: { write: packet => frames.push(packet), end() {}, destroy() {} } });
  session._sendPacket(original);
  if (frames.length !== 1 || frames[0].equals(original)) throw Error("native send did not produce one composed frame");
  const decoded = codec.marshalDecodeExact(frames[0].subarray(4));
  if (decoded[1][1] !== false || !decoded[1][0].toString("latin1").includes("evejs-login-delivery-v1")) {
    throw Error("native verification/payload composition mismatch");
  }
  result.status = "PASS"; result.reason = "compiled native send hook + exact codec composed the fake-account payload; no live state accessed";
} catch (error) { result.reason = error.message; }
console.log(JSON.stringify(result));
