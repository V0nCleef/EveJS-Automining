"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path"), fs = require("node:fs"), { spawnSync } = require("node:child_process");
const { createReportedHarness, menuFile } = require("./support/reportedLoadoutHarness.cjs");
const python = process.env.EVEJS_PYTHON || "python";
const rows = [];
const thirdPartyRefusals = [];
function run(order, options = {}) {
  const h = createReportedHarness(order, options), session = h.session(), { original, sent } = h.login(session);
  const value = h.decodeFrame(sent), source = value[1][0].toString("latin1", 5);
  const client = spawnSync(python, ["-B", path.join(__dirname, "support/executeReportedClient.py")], {
    input: JSON.stringify({ expression: source }), encoding: "utf8", timeout: 30000, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", AUTOMINING_CLIENT_DELIVERY: "login-v1", AUTOMINING_PROFILE_SETTINGS: "" },
  });
  assert.equal(client.status, 0, client.stderr + client.stdout);
  const result = JSON.parse(client.stdout);
  assert.equal(result.result, 77);
  assert.equal(result.output.split("NATIVE_ONCE").length - 1, 1);
  assert.equal(value[1][1], 0);
  const before = h.codec.marshalDecodeExact(original.subarray(4));
  assert.deepEqual(value[2], before[2]); assert.deepEqual(value[3], before[3]);
  const reply = session._handleFuncResult(["challenge", Buffer.from(result.output), 77]);
  assert.equal(reply.done, true); assert.equal(session.state, "DONE");
  const rpc = h.reported.scan.prototype.Handle_AutoMiningLoginReady;
  const events = [], player = { charid: 42, sendNotification: (...args) => events.push(args) };
  const readyCalls = result.requests.filter(row => row[0] === "ready");
  if (result.autoReady) {
    assert.deepEqual(readyCalls.map(row => row[3]), [0, 1], "real companion probes before readiness acknowledgement");
    assert.equal(JSON.parse(rpc(readyCalls[0].slice(1), player)).success, true);
    assert.notEqual(h.reported.controller.command(player, { action: "help" }), "AutoMining settings opened.");
    assert.deepEqual(events, []);
    assert.equal(JSON.parse(rpc(readyCalls[1].slice(1), player)).success, true);
    assert.equal(h.reported.controller.command(player, { action: "help" }), "AutoMining settings opened.");
    assert.deepEqual(events, [["OnAutoMiningOpen", "clientID", []]]);
  } else {
    assert.deepEqual(readyCalls, []);
    assert.notEqual(h.reported.controller.command(player, { action: "help" }), "AutoMining settings opened.");
  }
  const receipts = result.output.split(/\r?\n/).map(line => line.match(/^EVEJS_LOGIN:v1:([0-9a-f]{32}):([^:]+):(OK|FAILED)$/))
    .filter(Boolean).map(match => ({ nonce: match[1], id: match[2], status: match[3] }));
  const row = { order, releasedAuto: options.releasedAuto === true, markerFitting: options.markerFitting === true,
    autoReady: result.autoReady, assignments: result.assignments, readinessCalls: readyCalls,
    receipts, erosionCompositions: h.reported.erosionCompositions, erosionActive: result.erosionActive, erosionHooks: result.erosionHooks,
    pythonOutput: result.output, serverLogs: h.logs, haulerLogs: h.haulerLogs,
    nativeResult: result.result, nativeComplete: session.state === "DONE", packetBytes: sent.length, hudOpenAfterClientAck: events.length === 1 };
  rows.push(row);
  return { h, result, row };
}
function count(result, key) { return result.assignments.filter(name => name === key).length; }

for (const order of [["solo", "auto"], ["auto", "solo"]]) test("published AutoMining 1.2.26 order control: " + order.join(" -> "), () => {
  const { h, result } = run(order, { releasedAuto: true });
  const works = order[0] === "solo";
  assert.equal(result.autoReady, works);
  assert.equal(count(result, "_evejs_automining_login_v1"), works ? 1 : 0);
  assert.equal(count(result, "_evejs_ourmods_fitting_runtime"), 1);
  assert.equal(h.logs.some(text => /Login source changed by another mod/.test(text)), !works);
});

const orders = [
  ["menu", "solo", "auto"], ["auto", "solo", "menu"],
  ["menu", "solo", "erosion", "auto"], ["auto", "erosion", "solo", "menu"],
  ["menu", "unknown", "solo", "auto"], ["auto", "solo", "unknown", "menu"],
  ["menu", "moon", "solo", "family-dcb", "erosion", "auto", "haulers"],
  ["haulers", "auto", "erosion", "family-dcb", "solo", "moon", "menu"],
];
for (const order of orders) test("candidate exact released hook/client sources: " + order.join(" -> "), () => {
  const { h, result, row } = run(order);
  assert.equal(result.autoReady, true);
  assert.equal(count(result, "_evejs_automining_login_v1"), 1);
  assert.equal(count(result, "_evejs_ourmods_fitting_runtime"), 1, "Solo/DCB share one selected released fitting initializer");
  assert.deepEqual(row.receipts.map(r => [r.id, r.status]), [["automining", "OK"], ["launcher.shared-menu", "FAILED"]]);
  assert.equal(new Set(row.receipts.map(r => r.nonce)).size, 1);
  // Actual root menu is Python 2.7 source; its Python 3 failure is intentional and bounded.
  // This is isolation coverage, never a successful retail menu-UI claim.
  assert.ok(fs.readFileSync(menuFile, "utf8").includes("EVEJS_MOD_MENU:REGISTERED:v1"));
  assert.equal(h.logs.some(text => /Login source changed by another mod/.test(text)), false);
  assert.equal(h.logs.some(text => /automining client-failed|automining delivery-failed/.test(text)), false);
  assert.equal(h.logs.filter(text => /launcher.shared-menu client-failed/.test(text)).length, 1);
  if (order.includes("unknown")) {
    assert.equal(h.Service.prototype.futureAddonInfo.call({}), 61);
  }
  if (order.includes("erosion")) {
    assert.equal(row.erosionCompositions, 1); assert.equal(result.erosionActive, true); assert.equal(result.erosionHooks, 3);
    assert.equal(count(result, "_evejs_asteroid_erosion_v1"), 1);
    assert.equal(result.output.split("ASTEROID_EROSION:READY:0.2.0").length - 1, 1);
  }
  if (order.includes("haulers")) {
    assert.equal(result.output.split("HAULER_EXEC").length - 1, 1, "authored Hauler client marker through released composer");
    assert.equal(h.haulerLogs.filter(text => /CLIENT_REPORT.*CATALOG_READY/.test(text)).length, 1);
    assert.equal(h.reported.moon.enabled, false);
  }
});

for (const order of [["menu", "solo", "auto"], ["auto", "solo", "menu"]]) test("authored fitting execution marker once in both candidate orders: " + order.join(" -> "), () => {
  const { result } = run(order, { markerFitting: true });
  assert.equal(result.autoReady, true);
  assert.equal(result.output.split("FITTING_ONCE").length - 1, 1);
});

test("released Haulers independently refuses an unfamiliar body edit before its compile hook", () => {
  const order = ["haulers", "unknown", "auto"];
  const expected = "[EmpireHaulers] native login body or insertion seam changed";
  assert.throws(() => createReportedHarness(order), error => error.message === expected);
  thirdPartyRefusals.push({ order, expected, scope: "Released Haulers source guard; not a common runtime or AutoMining failure" });
});

test("persist reported loadout qualification receipts", () => {
  if (!process.env.EVEJS_LOADOUT_REPORT) return;
  const task = path.resolve(__dirname, "../.."), out = path.resolve(process.env.EVEJS_LOADOUT_REPORT), relative = path.relative(task, out);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  let cursor = task;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) assert.equal(fs.lstatSync(cursor).isSymbolicLink(), false);
  }
  fs.writeFileSync(out, JSON.stringify({ cases: rows, thirdPartyRefusals, limits: [
    "Native class and codec with fake authenticated session, account/storage/gameplay services excluded",
    "Exact released Solo/DCB fitting bundles create one owner; Python 3 fixture cannot qualify retail fitting bytecode/UI seams",
    "Actual root menu source produces FAILED in Python 3; optional failure must leave real AutoMining ready",
    "Hauler program is an authored additive marker; released composer and receipt parser are exact",
    "Moon retirement hook uses synthetic empty viability target inventory; moon gameplay/retirement not exercised",
    "unknown layer is an authored prefix/interior source edit, not an additional downloaded mod",
    "Erosion client installs three real wrappers on authored fake Park/Asteroid classes; no rendering/mining gameplay",
    "No exact AutopilotJumpZero 1.2.2, autoSkyhookDeploy, or FourModeAsteroidBelts 0.2.3 bytes found in bounded local search",
  ] }, null, 2) + "\n");
});
