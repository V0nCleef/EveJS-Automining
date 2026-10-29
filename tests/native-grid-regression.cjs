"use strict";
// Run the native spatial/controller regression, then the existing feature
// scenarios with the removed cluster API absent. No player database is opened.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const { spawnSync } = require("node:child_process");
const root = process.env.AUTOMINING_NATIVE_ROOT;
if (!root) throw Error("Set AUTOMINING_NATIVE_ROOT to reviewed EveJS 261028.1 source");
function run(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true,
    timeout: 30000, env: process.env });
  if (result.status !== 0) throw Error((result.stdout || "") + (result.stderr || "") + (result.error?.message || ""));
}
run(["--test", path.join(__dirname, "compat-261028.test.cjs"), path.join(__dirname, "grid.test.cjs")]);
const modernRunner = `
  const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
  const file=path.resolve(process.argv[1]);
  let source=fs.readFileSync(file,'utf8').replace(/getPublicGridClusterKeyForEntity: \\(\\) => "stale-belt",/g,'');
  source=source.replace(/getLivePublicGridClusterKeyForEntity|getPublicGridClusterKeyForEntity/g,'getGridBubbleIDForEntity');
  const testModule=new Module(file,module);testModule.filename=file;
  testModule.paths=Module._nodeModulePaths(path.dirname(file));testModule._compile(source,file);
`;
for (const name of ["boosters-rats", "fleet-ore", "fleet-groups", "pve", "pve-deployment", "combat-statistics"]) {
  run(["-e", modernRunner, path.join(__dirname, name + ".test.cjs")]);
  console.log("PASS: native grid fixture " + name);
}
console.log("PASS: native bubble/controller/mining regression and six feature suites.");
