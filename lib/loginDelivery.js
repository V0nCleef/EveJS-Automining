"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { clientText } = require("./hud");
const VERSION = "1.0.7";
const LOADER_KEY = Symbol.for("evejs.automining.loader.v1");
// Reviewed EveJS-authored login payload builder. Unknown builds keep archive delivery.
const BASELINES = new Set(["24a36b919dffb439d0030f25601655fa0402f196c6379064390870268e6b046f", "6305a9abe3e555ae845b0c9a27ed6d5bd08bba0e903eaf3789c3756b935fbbfd"]);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function supportsSource(source) {
  return BASELINES.has(digest(source)) || BASELINES.has(digest(String(source).replace(/\r\n/g, "\n")));
}
function supportsRoot(root, backend = "native") {
  if (backend !== "native") return false; // Keep the established Docker path until live coverage exists.
  try { return supportsSource(fs.readFileSync(path.join(root, "server/src/network/tcp/handshake.js"))); }
  catch { return false; }
}
function extendSource(source) {
  if (!supportsSource(source)) return source;
  return source + `
// AutoMining: compose with the existing login function; do not replace its handlers.
const __amPreviousLogin = buildTidiSignedFunc;
buildTidiSignedFunc = function() {
  const original = __amPreviousLogin.apply(this, arguments);
  try {
    const delivery = globalThis[Symbol.for("evejs.automining.loader.v1")]?.delivery;
    return delivery ? delivery.compose(original) : original;
  } catch (error) {
    console.error("[AutoMining] Login companion delivery failed; existing handshake preserved.");
    return original;
  }
};
`;
}
function createDelivery(modRoot, { token = crypto.randomUUID() } = {}) {
  const companion = "# coding: utf-8\n" + ["companion.py", "hud.py"].map(name => fs.readFileSync(path.join(modRoot, "client", name), "utf8")).join("\n");
  const bootstrap = fs.readFileSync(path.join(modRoot, "client/login.py"), "utf8");
  const source = `# coding: utf-8\n_am_token = ${JSON.stringify(token)}\n_am_version = ${JSON.stringify(VERSION)}\n_am_source64 = ${JSON.stringify(Buffer.from(companion, "utf8").toString("base64"))}\n` + bootstrap;
  // Only base64 ASCII is interpolated into the existing Python expression.
  const encoded = Buffer.from(source, "utf8").toString("base64");
  if (encoded.length > 240 * 1024) throw Error("Login companion exceeds the bounded payload size");
  const expression = `eval(compile(__import__('base64').b64decode('${encoded}'), '<automining-login>', 'exec'), {'__builtins__': __builtins__, '_am_context': globals()})`;
  function compose(original) {
    if (!Buffer.isBuffer(original) || original.length < 5 || original[0] !== 0x74 || original.readUInt32LE(1) !== original.length - 5) {
      throw Error("Unsupported login expression envelope");
    }
    const previous = original.subarray(5).toString("ascii");
    // Preserve the original result and run it first, including other built-in patches.
    const wrapped = `(lambda _am_result: (${expression}, _am_result)[1])(${previous})`;
    const data = Buffer.from(wrapped, "ascii");
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
  return { compose, ready, token, version: VERSION };
}
module.exports = { VERSION, LOADER_KEY, supportsSource, supportsRoot, extendSource, createDelivery };
