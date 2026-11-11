"use strict";
// One reusable entry point; never copies a runtime or mutates a native source tree.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const modRoot = path.resolve(__dirname, ".."), taskRoot = path.resolve(modRoot, "..");
function argument(name) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  if (!process.argv[at + 1] || process.argv[at + 1].startsWith("--")) throw Error("Missing value for " + name);
  return process.argv[at + 1];
}
const flags = new Set(["--runtime", "--out", "--python", "--legacy-root"]);
for (let i = 2; i < process.argv.length; i += 2) {
  if (!flags.has(process.argv[i])) throw Error("Unknown qualification option " + process.argv[i]);
  argument(process.argv[i]);
}
const selected = path.resolve(argument("--runtime") || process.env.LOGIN_DELIVERY_RUNTIME || path.join(modRoot, "lib/loginDeliveryRuntime.js"));
const own = path.join(modRoot, "lib/loginDeliveryRuntime.js");
const output = path.resolve(argument("--out") || path.join(taskRoot, "evidence/runtime-qualification"));
const relativeOutput = path.relative(taskRoot, output);
if (!relativeOutput || relativeOutput === ".." || relativeOutput.startsWith(".." + path.sep) || path.isAbsolute(relativeOutput)) {
  throw Error("Qualification output must stay inside the assigned task folder");
}
let cursor = taskRoot;
for (const part of relativeOutput.split(path.sep)) {
  cursor = path.join(cursor, part);
  if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error("Qualification output cannot traverse links or junctions");
}
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const python = argument("--python") || process.env.EVEJS_PYTHON || "python";
const nativeRoot = path.resolve(process.env.EVEJS_LOGIN_NATIVE_ROOT || path.join(taskRoot, "integration/native/EveJS-261108.1"));
const preload = path.join(__dirname, "support/runtimeOverride.cjs");
fs.mkdirSync(output, { recursive: true });
const report = { selectedRuntime: selected, vendoredRuntime: own, nativeRoot, python,
  runtimeSha256: null, vendoredSha256: hash(own), byteParity: false, runtimeStable: false, stages: [], legacy0128: null };
if (!fs.existsSync(selected)) {
  report.status = "MISSING_RUNTIME";
  fs.writeFileSync(path.join(output, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
  console.error("Missing selected runtime: " + selected); process.exit(1);
}
report.runtimeSha256 = hash(selected); report.byteParity = report.runtimeSha256 === report.vendoredSha256;
const env = { ...process.env, LOGIN_DELIVERY_RUNTIME: selected, EVEJS_LOGIN_NATIVE_ROOT: nativeRoot,
  EVEJS_LOGIN_VENDOR_ROOT: process.env.EVEJS_LOGIN_VENDOR_ROOT || path.join(taskRoot, "integration/vendor"),
  EVEJS_HANDSHAKE_FIXTURE: path.join(nativeRoot, "server/src/network/tcp/handshake.js"), EVEJS_PYTHON: python,
  PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8",
  NODE_OPTIONS: '--require "' + preload.replace(/\\/g, "/") + '"' };
delete env.EVEJS_DATA_ROOT;
function run(name, command, args, input) {
  const result = spawnSync(command, args, { cwd: modRoot, env, input, encoding: "utf8", timeout: 120000,
    windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const log = (result.stdout || "") + (result.stderr || "");
  fs.writeFileSync(path.join(output, name + ".log"), log);
  report.stages.push({ name, passed: result.status === 0, exitCode: result.status,
    error: result.error?.message || null, tests: Number(log.match(/^# tests (\d+)/m)?.[1] || log.match(/Ran (\d+) tests/)?.[1] || 0) });
  console.log(name + ": " + (result.status === 0 ? "PASS" : "FAIL"));
  return result;
}
run("runtime-selection", process.execPath, ["-e", "const assert=require('node:assert/strict');const s=require('./tests/support/runtimeUnderTest.cjs');assert.equal(require('./lib/loginDeliveryRuntime'),s.api);console.log(JSON.stringify({selected:s.file,modImportUsesSelected:true}));"]);
const tests = ["login-runtime-regression.test.cjs", "login-runtime-contract.test.cjs", "login-receipt-wire.test.cjs", "login-mod-coexistence.test.cjs",
  "login-registration.test.cjs", "login-helper-routing.test.cjs", "login-delivery.test.cjs", "login-emission.test.cjs"];
run("node-contracts", process.execPath, ["--test", "--test-reporter=tap", ...tests.map(file => path.join(__dirname, file))]);
run("python-lifecycle", python, ["-B", path.join(__dirname, "test_login_companion.py")]);
run("python-menu-adapter", python, ["-B", path.join(__dirname, "test_menu_adapter.py")]);
run("registration-reuse", process.execPath, [path.join(__dirname, "shared-menu-delivery.cjs")]);
const generator = spawnSync(process.execPath, ["-e", "const f=require('./tests/support/loginFixture.cjs'),a=require('./lib/loginDelivery');const h=f.fixture([{id:'automining',source:a.createDelivery(process.cwd(),{token:'fixture-server'}).source}]);const s=new h.Handshake();s._sendPacket(f.frame('77'));process.stdout.write(f.codec.marshalDecodeExact(s.frames[0].subarray(4))[1][0].subarray(5));"],
  { cwd: modRoot, env, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
if (generator.status === 0) run("python27-grammar", python, ["-B", "-W", "ignore::DeprecationWarning", path.join(__dirname, "login-python27-grammar.py")], generator.stdout);
else report.stages.push({ name: "python27-grammar", passed: false, error: generator.stderr || generator.error?.message || "payload generation failed" });

const explicitLegacy = argument("--legacy-root") || process.env.EVEJS_LOGIN_LEGACY_ROOT;
const candidates = explicitLegacy ? [path.resolve(explicitLegacy)] : [];
const legacyRoot = candidates.find(folder => fs.existsSync(path.join(folder, "server/src/network/tcp/handshake.js")));
if (legacyRoot) {
  const probe = run("legacy0128-adapter", process.execPath, [path.join(__dirname, "support/probeNativeAdapter.cjs"), legacyRoot]);
  try { report.legacy0128 = JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1)); }
  catch (_) { report.legacy0128 = { status: "UNSUPPORTED", reason: probe.stderr || "native probe did not return a result" }; }
} else report.legacy0128 = { status: "MISSING", checked: candidates, reason: "No existing 0.12.8 source root at the checked paths; no download/copy was made" };
report.runtimeStable = hash(selected) === report.runtimeSha256;
const core = report.byteParity && report.runtimeStable && report.stages.every(stage => stage.passed);
const legacy = report.legacy0128.status === "PASS";
report.status = core && (!explicitLegacy || legacy) ? legacy ? "PASS" : "PASS_CORE_LEGACY_NOT_QUALIFIED" : "FAIL";
fs.writeFileSync(path.join(output, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, byteParity: report.byteParity, runtimeStable: report.runtimeStable,
  selectedRuntime: selected, runtimeSha256: report.runtimeSha256, nodeTests: report.stages.find(s => s.name === "node-contracts")?.tests,
  pythonTests: report.stages.find(s => s.name === "python-lifecycle")?.tests, legacy0128: report.legacy0128.status,
  report: path.join(output, "qualification.json") }, null, 2));
process.exitCode = report.status === "FAIL" ? 1 : 0;
