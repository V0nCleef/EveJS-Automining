"use strict";
// Run both load orders in separate processes so Node's module cache cannot
// hide a missed hook.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const [root, autoMiningLoader, autopilotLoader] = process.argv.slice(2);
if (!root || !autoMiningLoader || !autopilotLoader) {
  console.error("Usage: node tests/recall-loader-compat.cjs <EveJS root> <AutoMining loader> <autopilotJumpZero loader>");
  process.exit(2);
}
for (const order of ["automining-first", "autopilot-first"]) {
  const args = [path.join(__dirname, "native-load.cjs"), root, autoMiningLoader, autopilotLoader];
  if (order === "autopilot-first") args.push(order);
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    console.error(`Recall loader compatibility failed (${order}): ${result.error?.message || `exit ${result.status}`}`);
    process.exit(1);
  }
}
console.log("PASS: recall guards attached with both loader orders.");
