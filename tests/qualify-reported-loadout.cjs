"use strict";
// Optional qualification of already-retained release fixtures. Never downloads or installs.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const task = path.resolve(__dirname, "../.."), mod = path.join(task, "automining");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  if (!["--runtime", "--menu", "--python", "--out"].includes(name) || !value || value.startsWith("--")) throw Error("Invalid qualification option " + name);
  args.set(name, value);
}
const runtime = path.resolve(args.get("--runtime") || process.env.LOGIN_DELIVERY_RUNTIME || path.join(mod, "lib/loginDeliveryRuntime.js"));
const menu = path.resolve(args.get("--menu") || process.env.EVEJS_LOGIN_CAPTURED_MENU || path.join(task, "evidence/shared-menu-abi-final/typical/captured-loader.cjs"));
const output = path.resolve(args.get("--out") || path.join(task, "evidence/reported-loadout"));
const relative = path.relative(task, output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Output must stay inside the assigned task root");
let cursor = task;
for (const part of relative.split(path.sep)) {
  cursor = path.join(cursor, part);
  if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error("Output cannot traverse links");
}
fs.mkdirSync(output, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { selectedRuntime: runtime, runtimeSha256: sha(runtime), vendoredSha256: sha(path.join(mod, "lib/loginDeliveryRuntime.js")),
  capturedMenu: menu, capturedMenuSha256: sha(menu), packageIdentities: path.join(task, "evidence/loadout-package-identities.json") };
report.byteParity = report.runtimeSha256 === report.vendoredSha256;
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(__dirname, "login-reported-loadout.test.cjs")], {
  cwd: mod, encoding: "utf8", timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, LOGIN_DELIVERY_RUNTIME: runtime, EVEJS_LOGIN_CAPTURED_MENU: menu,
    EVEJS_PYTHON: args.get("--python") || process.env.EVEJS_PYTHON || "python",
    EVEJS_LOADOUT_REPORT: path.join(output, "cases.json"),
    PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
});
const log = (result.stdout || "") + (result.stderr || "");
fs.writeFileSync(path.join(output, "tests.log"), log);
report.tests = Number(log.match(/^# tests (\d+)/m)?.[1] || 0);
report.failures = Number(log.match(/^# fail (\d+)/m)?.[1] || 0);
report.runtimeStable = sha(runtime) === report.runtimeSha256;
report.menuStable = sha(menu) === report.capturedMenuSha256;
report.status = result.status === 0 && report.byteParity && report.runtimeStable && report.menuStable ? "PASS_BOUNDED_FIXTURE_COVERAGE" : "FAIL";
report.error = result.error?.message || null;
fs.writeFileSync(path.join(output, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (report.status === "FAIL") process.exitCode = 1;
