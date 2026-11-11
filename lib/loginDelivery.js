"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { clientText } = require("./hud");
const { buildClientSource, emittedBootstrap } = require("./clientSource");
const VERSION = "1.0.8";
// VERSION identifies our client protocol, not an EveJS release gate. Native
// Login support is selected by compiled capabilities and the marshaled envelope.
const LOADER_KEY = Symbol.for("evejs.automining.loader.v1");
// Probe file availability without treating another mod's edits as incompatible.
// The shared runtime validates the actual compiled class and wire capabilities.
const runtime = require("./loginDeliveryRuntime");
function supportsRoot(root, backend = "native") {
  return ["native", "docker"].includes(backend) && runtime.supportsRoot(root);
}
function install(root, delivery) {
  return runtime.getRuntime(root)?.register({ id: "automining", source: delivery.source });
}
function createDelivery(modRoot, { token = crypto.randomUUID() } = {}) {
  const companion = buildClientSource(modRoot);
  const bootstrap = emittedBootstrap(fs.readFileSync(path.join(modRoot, "client/login.py"), "utf8"));
  const compressed = zlib.deflateSync(Buffer.from(companion, "utf8"), { level: 9 }).toString("base64");
  const source = `# coding: utf-8\n_am_token = ${JSON.stringify(token)}\n_am_version = ${JSON.stringify(VERSION)}\n_am_source64 = ${JSON.stringify(compressed)}\n` + bootstrap;
  // Compress the exact outer source as well: leaving its inner base64 and
  // bootstrap uncompressed wastes wire space without adding any behavior.
  // The decoded UTF-8 source, token/version and authored bootstrap stay exact.
  const sourceBytes = Buffer.from(source, "utf8");
  if (sourceBytes.length > 240 * 1024) throw Error("Login companion exceeds the bounded payload size");
  const encoded = zlib.deflateSync(sourceBytes, { level: 9 }).toString("base64");
  if (encoded.length > 240 * 1024) throw Error("Login companion exceeds the bounded payload size");
  const initialize = `eval(compile(__import__('zlib').decompress(__import__('base64').b64decode('${encoded}')), '<automining-login>', 'exec'), globals())`;
  const execute = `try:\n ${initialize}\nexcept Exception:\n print('AUTOMINING_LOGIN:FAILED')\n`;
  const expression = `eval(compile(${JSON.stringify(execute)}, '<automining-delivery>', 'exec'), {'__builtins__': __builtins__, '_am_context': globals()})`;
  function compose(original) {
    if (!Buffer.isBuffer(original) || original.length < 5 || original[0] !== 0x74 || original.readUInt32LE(1) !== original.length - 5) {
      throw Error("Unsupported login expression envelope");
    }
    const previous = original.subarray(5).toString("latin1");
    // Preserve the original result and run it first, including other built-in patches.
    const wrapped = `(lambda _am_result: (${expression}, _am_result)[1])(${previous})`;
    const data = Buffer.from(wrapped, "latin1");
    if (data.length > 256 * 1024) throw Error("Login companion exceeds the bounded payload size");
    const header = Buffer.alloc(5); header[0] = 0x74; header.writeUInt32LE(data.length, 1);
    return Buffer.concat([header, data]);
  }
  function ready(args, session, controller) {
    // Python RPC strings may arrive as bytes or tagged text, just like HUD input.
    if (clientText(args?.[0], 128) !== token || clientText(args?.[1], 32) !== VERSION || !(Number(session?.characterID || session?.charid) > 0)) {
      return JSON.stringify({ success: false });
    }
    if (args?.[2] === 1) controller.clientReady(session, 1);
    return JSON.stringify({ success: true, version: VERSION, token });
  }
  return { compose, ready, token, version: VERSION, source: "_am_context = _evejs_context\n" + initialize + "\n" };
}
module.exports = { VERSION, LOADER_KEY, supportsRoot, install, createDelivery };
