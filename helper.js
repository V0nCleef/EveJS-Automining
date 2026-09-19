"use strict";
const fs = require("node:fs");
const path = require("node:path");
const legacy = require("./helper-legacy");
const { supportsRoot, createDelivery } = require("./lib/loginDelivery");
const { surveySeconds } = require("./lib/settings");
const ACTIONS = new Set(["install", "recover", "verify", "prepare_profile", "prepare_disable", "prepare_remove"]);
function deliveryReport(request, result, method) {
  const features = String(process.env.EVEJS_LAUNCHER_HELPER_FEATURES || "").split(",");
  if (features.includes("client-preparation-v1") && result.success && ["install", "recover"].includes(request.action)) {
    result.clientPreparation = { mode: "verify-install", legacyVersions: ["1.0.6"] };
  }
  // Older Launchers reject unknown reply fields. Report only when the host opts in.
  if (features.includes("client-script-delivery-v1") && result.success) {
    result.clientScriptDelivery = ["prepare_disable", "prepare_remove"].includes(request.action) ? "none" : method;
  }
  return result;
}
function profileEnvironment(request) {
  const p = request.settings?.profile || {};
  const prefs = { apply: p.apply === true, ores: String(p.ores || ""), order: p.order || "nearest",
    approach: p.approach === true, compress: p.compress === true, lock: p.lock !== false,
    survey: p.survey === true, surveySeconds: surveySeconds(p.surveySeconds) };
  const file = request.profile?.modDataRoot && path.join(request.profile.modDataRoot, "preferences.json");
  const stored = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : {};
  prefs.surveyDefaulted = !Object.prototype.hasOwnProperty.call(stored, "survey");
  return JSON.stringify(prefs);
}
function execute(request) {
  if (!ACTIONS.has(request.action)) throw Error("Unsupported AutoMining helper action");
  const root = request.runtime.evejsRoot || request.mod.root;
  if (!supportsRoot(root, request.runtime.backend || "native")) {
    const result = legacy.execute(request);
    if (request.action === "prepare_profile") result.environment.AUTOMINING_CLIENT_DELIVERY = "legacy";
    return deliveryReport(request, result, "client-script-patch");
  }
  if (!["prepare_disable", "prepare_remove"].includes(request.action)) {
    // Check bundled sources before restoring a working archive companion.
    createDelivery(fs.realpathSync(request.mod.path));
  }
  const clientRoot = fs.realpathSync(request.runtime.clientRoot);
  const state = path.join(clientRoot, ".automining");
  const receiptFile = path.join(state, "receipt.json");
  if (fs.existsSync(path.join(state, "pending.json"))) {
    if (["verify", "prepare_profile"].includes(request.action)) {
      throw Error("AutoMining client installation needs recovery before profile preparation.");
    }
    legacy.recoverSwap(clientRoot, state, path.join(clientRoot, "code.ccp"), receiptFile);
  }
  const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, "utf8")) : null;
  if (receipt && (receipt.clientRoot !== clientRoot || !["active", "restored"].includes(receipt.status))) {
    throw Error("Unrecognized AutoMining client receipt; existing files preserved");
  }
  if (receipt?.status === "active") {
    if (["prepare_profile", "verify"].includes(request.action)) {
      // Shared clients may still need the legacy companion for another root.
      // Do not restore archives during a routine launch or while clients use them.
      const result = legacy.execute(request);
      if (request.action === "prepare_profile") result.environment.AUTOMINING_CLIENT_DELIVERY = "legacy";
      return deliveryReport(request, result, "client-script-patch");
    }
    // Normal Update calls the OLD helper's cleanup first. Also cover direct
    // package replacements and the next enable of a previously disabled mod.
    legacy.execute({ ...request, action: "prepare_disable" });
  }
  const result = { protocol: request.protocol, requestId: request.requestId, success: true,
    state: "ready", message: "AutoMining login delivery configured; readiness is checked after character login.",
    restartRequired: [], contributions: [], environment: {}, arguments: [] };
  if (request.action === "prepare_profile") {
    result.environment.AUTOMINING_PROFILE_SETTINGS = profileEnvironment(request);
    result.environment.AUTOMINING_CLIENT_DELIVERY = "login-v1";
  }
  if (["prepare_disable", "prepare_remove"].includes(request.action)) result.message = "AutoMining client cleanup complete.";
  return deliveryReport(request, result, "login-handshake");
}
if (require.main === module) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  const request = JSON.parse(fs.readFileSync(arg("--request"), "utf8"));
  let result;
  try { result = execute(request); }
  catch (error) {
    result = { protocol: request.protocol, requestId: request.requestId, success: false, state: "failed",
      message: String(error.message).replace(/[\x00-\x20\x7f]+/g, " ").slice(0, 4000),
      restartRequired: [], contributions: [], environment: {}, arguments: [] };
  }
  fs.writeFileSync(arg("--result"), JSON.stringify(result));
  if (!result.success) process.exitCode = 1;
}
module.exports = { execute, profileEnvironment };
