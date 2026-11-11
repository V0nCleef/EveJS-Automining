"use strict";
// Test-process preload only. Product code never accepts a runtime-path override.
const path = require("node:path"), Module = require("node:module");
if (process.env.LOGIN_DELIVERY_RUNTIME) {
  const normalize = file => process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  const own = normalize(path.resolve(__dirname, "../../lib/loginDeliveryRuntime.js"));
  const selected = path.resolve(process.env.LOGIN_DELIVERY_RUNTIME);
  if (normalize(selected) !== own) {
    const previous = Module._load;
    Module._load = function(request, parent, isMain) {
      let resolved;
      try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
      return previous.call(this, typeof resolved === "string" && path.isAbsolute(resolved) && normalize(resolved) === own ? selected : request, parent, isMain);
    };
  }
}
