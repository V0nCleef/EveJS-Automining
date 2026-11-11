"use strict";
// Real helper/legacy ZIP + journal operations, only against authored owned fixtures.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const task = path.resolve(__dirname, "../.."), root = path.join(task, "test-work/client-delivery-migration");
assert.ok(root.startsWith(task + path.sep));
let cursor = task;
for (const part of path.relative(task, root).split(path.sep)) {
  cursor = path.join(cursor, part);
  if (fs.existsSync(cursor)) assert.equal(fs.lstatSync(cursor).isSymbolicLink(), false);
}
fs.mkdirSync(root, { recursive: true });
const marker = path.join(root, "fixture-owner.json");
if (fs.existsSync(marker)) assert.equal(JSON.parse(fs.readFileSync(marker)).purpose, "owned AutoMining archive policy fixture");
else fs.writeFileSync(marker, JSON.stringify({ purpose: "owned AutoMining archive policy fixture", task }));
const client = path.join(root, "client"), state = path.join(client, ".automining"), scratch = path.join(root, "scratch");
for (const folder of [client, state, scratch]) fs.mkdirSync(folder, { recursive: true });
process.env.TEMP = scratch; process.env.TMP = scratch;
process.env.EVEJS_LAUNCHER_HELPER_FEATURES = "client-script-delivery-v1,client-preparation-v1";
delete process.env.EVEJS_DATA_ROOT;
const serverRoot = path.join(root, "server-root");
for (const relative of ["server/src/services/mining", "server/src/network/tcp/utils"]) fs.mkdirSync(path.join(serverRoot, relative), { recursive: true });
const mining = process.env.EVEJS_TEST_MINING_SOURCE;
assert.ok(mining && fs.statSync(mining).isFile(), "Set EVEJS_TEST_MINING_SOURCE to an existing supported miningRuntime.js fixture; no installation is searched");
fs.copyFileSync(mining, path.join(serverRoot, "server/src/services/mining/miningRuntime.js"));
// Availability markers only; no server class or account/store module is executed.
for (const file of ["server/src/network/tcp/handshake.js", "server/src/network/tcp/utils/marshal.js"]) fs.writeFileSync(path.join(serverRoot, file), "// authored helper availability fixture\n");
const helper = require("../helper.js"), legacy = require("../helper-legacy.js");
const archive = path.join(client, "code.ccp"), receiptFile = path.join(state, "receipt.json");
const original = Buffer.from("AUTHORED ORIGINAL COMMAND ENTRY"), patched = Buffer.from("AUTHORED PATCHED COMMAND ENTRY");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const python = process.env.EVEJS_PYTHON || "python", cases = [];
function py(script, args = []) {
  const result = spawnSync(python, ["-B", "-c", script, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
function reset(command = patched) {
  assert.equal(fs.existsSync(path.join(state, "pending.json")), false);
  py("import sys,zipfile,base64; z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('eve/client/script/ui/eveCommands.pyj',base64.b64decode(sys.argv[2]));z.writestr('other-mod/unique.pyj',b'UNRELATED OWNED FIXTURE');z.close()", [archive, command.toString("base64")]);
  fs.writeFileSync(path.join(state, "original.pyj"), original);
  fs.writeFileSync(receiptFile, JSON.stringify({ status: "active", clientRoot: fs.realpathSync(client), originalEntryHash: sha(original), installedEntryHash: sha(patched) }));
}
function request(action, backend = "docker") {
  return { protocol: "evejs_launcher_mod_v1", requestId: "owned-fixture", action,
    mod: { root: serverRoot, path: path.resolve(__dirname, "..") },
    runtime: { backend, evejsRoot: serverRoot, clientRoot: client }, settings: { profile: {} } };
}
function verifyZip(expected) {
  const entries = JSON.parse(py("import sys,zipfile,json,base64;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))", [archive]));
  assert.equal(Buffer.from(entries["eve/client/script/ui/eveCommands.pyj"], "base64").toString(), expected.toString());
  assert.equal(Buffer.from(entries["other-mod/unique.pyj"], "base64").toString(), "UNRELATED OWNED FIXTURE");
  assert.equal(Object.keys(entries).length, 2);
}
reset();
const before = sha(fs.readFileSync(archive));
for (const backend of ["native", "docker"]) {
  const result = helper.execute(request("prepare_profile", backend));
  assert.equal(result.environment.AUTOMINING_CLIENT_DELIVERY, "legacy");
  assert.equal(sha(fs.readFileSync(archive)), before);
}
cases.push({ name: "shared physical archive stays unchanged on Native/Docker profile preparation", passed: true });
const installed = helper.execute(request("install"));
assert.equal(installed.clientScriptDelivery, "login-handshake");
assert.equal(JSON.parse(fs.readFileSync(receiptFile)).status, "restored"); verifyZip(original);
assert.equal(helper.execute(request("prepare_profile")).environment.AUTOMINING_CLIENT_DELIVERY, "login-v1");
cases.push({ name: "explicit Docker install restores only owned entry and prepares login-v1", passed: true });
const rollbackBytes = fs.readFileSync(archive), backup = path.join(state, "code.ccp.before-1234567890");
fs.writeFileSync(backup, rollbackBytes);
fs.writeFileSync(path.join(state, "pending.json"), JSON.stringify({ clientRoot: fs.realpathSync(client), backup,
  beforeHash: sha(rollbackBytes), afterHash: "0".repeat(64), receipt: { status: "restored", clientRoot: fs.realpathSync(client) } }));
fs.unlinkSync(archive);
legacy.recoverSwap(fs.realpathSync(client), state, archive, receiptFile);
assert.deepEqual(fs.readFileSync(archive), rollbackBytes); assert.equal(fs.existsSync(path.join(state, "pending.json")), false); verifyZip(original);
cases.push({ name: "actual interrupted archive swap rolls back from verified journal backup", passed: true });
reset(Buffer.from("AUTHORED FOREIGN COMMAND CHANGE"));
const changed = sha(fs.readFileSync(archive));
assert.throws(() => helper.execute(request("recover")), /refusing unsafe restoration/);
assert.equal(sha(fs.readFileSync(archive)), changed); assert.equal(JSON.parse(fs.readFileSync(receiptFile)).status, "active");
cases.push({ name: "changed command entry refuses cleanup and remains unchanged", passed: true });
reset(); fs.writeFileSync(path.join(state, "original.pyj"), "AUTHORED CORRUPT BACKUP");
const active = sha(fs.readFileSync(archive));
assert.throws(() => helper.execute(request("recover")), /backup is invalid/);
assert.equal(sha(fs.readFileSync(archive)), active); assert.equal(fs.existsSync(path.join(state, "pending.json")), false);
// Leave one valid owned active fixture as the reusable checkpoint.
fs.writeFileSync(path.join(state, "original.pyj"), original);
cases.push({ name: "invalid original backup refuses restoration without archive mutation", passed: true });
const report = { cases, clientRoot: client, noClientLaunched: true, unrelatedEntryPreserved: true,
  actualLegacyHelperUnchanged: true, serverFixture: "exact mining source plus authored login-availability marker files; no server started" };
fs.writeFileSync(path.join(task, "evidence/client-archive-migration.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
