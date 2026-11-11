"use strict";
// Focused client policy/menu qualification. No automatic archive migration or UI.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const mod = path.resolve(__dirname, ".."), task = path.dirname(mod), out = path.join(task, "evidence/client-delivery-policy");
fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const python = process.env.EVEJS_PYTHON || "python", report = { stages: [], sourceHashes: {}, runtimeSha256: sha(path.join(mod, "lib/loginDeliveryRuntime.js")) };
for (const file of ["lib/loginDelivery.js", "client/menu.py", "helper.js", "helper-legacy.js", "client/login.py", "evejs-launcher.mod.json"]) report.sourceHashes[file] = sha(path.join(mod, file));
const env = { ...process.env, EVEJS_PYTHON: python, EVEJS_HANDSHAKE_FIXTURE: path.join(task, "integration/native/EveJS-261108.1/server/src/network/tcp/handshake.js"),
  PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" };
function run(name, command, args) {
  const result = spawnSync(command, args, { cwd: mod, env, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout || "") + (result.stderr || "");
  fs.writeFileSync(path.join(out, name + ".log"), log);
  report.stages.push({ name, passed: result.status === 0, tests: Number(log.match(/^# tests (\d+)/m)?.[1] || log.match(/Ran (\d+) tests/)?.[1] || 0), error: result.error?.message || null });
}
run("native-docker-policy", process.execPath, ["--test", "--test-reporter=tap", path.join(__dirname, "login-helper-routing.test.cjs"), path.join(__dirname, "login-delivery.test.cjs")]);
run("menu-adapter", python, ["-B", path.join(__dirname, "test_menu_adapter.py")]);
run("menu-python27-grammar", python, ["-B", "-W", "ignore::DeprecationWarning", "-c", "from pathlib import Path;from lib2to3 import pygram,pytree;from lib2to3.pgen2 import driver;driver.Driver(pygram.python_grammar,convert=pytree.convert).parse_string(Path('client/menu.py').read_text(encoding='utf-8').rstrip()+'\\n');print('PASS menu Python2.7 grammar; no Python2 runtime')"]);
const archive = path.join(task, "evidence/client-archive-migration.json");
if (fs.existsSync(archive)) report.ownedArchiveChecks = JSON.parse(fs.readFileSync(archive));
report.sourceStable = Object.entries(report.sourceHashes).every(([file, digest]) => sha(path.join(mod, file)) === digest);
report.status = report.sourceStable && report.stages.every(stage => stage.passed) && report.ownedArchiveChecks?.cases.every(test => test.passed) ? "PASS_FOCUSED_CLIENT_POLICY" : "FAIL";
fs.writeFileSync(path.join(out, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (report.status === "FAIL") process.exitCode = 1;
