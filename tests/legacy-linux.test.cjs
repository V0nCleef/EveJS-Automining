"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync, spawn } = require("node:child_process");
const legacy = require("../helper-legacy");
const python = process.env.EVEJS_PYTHON || "python3";
const linux = { skip: process.platform !== "linux" };
function py(code, ...args) {
  const r = spawnSync(python, ["-I", "-c", code, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); return r.stdout;
}
function fixture(t) {
  const base = path.resolve(__dirname, "../.test-runtime"); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "linux-archive-"));
  t.after(() => { assert.ok(root.startsWith(base + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const archive = path.join(root, "code.ccp");
  py("import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.comment=b'preserve archive comment'; " +
    "i=zipfile.ZipInfo('other-mod/unique.pyj',(2020,1,2,3,4,6)); i.comment=b'keep member comment'; i.external_attr=0o640<<16; " +
    "z.writestr(i,b'UNRELATED BYTES'); z.writestr('eve/client/script/ui/eveCommands.pyj',b'ORIGINAL'); z.close()", archive);
  fs.chmodSync(archive, 0o640);
  return { root, archive };
}
test("Linux archive replacement preserves unrelated contents, metadata and permissions", linux, t => {
  const f = fixture(t), output = path.join(f.root, "entry.pyj"), input = path.join(f.root, "replacement.pyj");
  assert.equal(legacy.readEntry(f.archive, output).toString(), "ORIGINAL");
  fs.writeFileSync(input, "REPLACEMENT"); legacy.replaceEntry(f.archive, input);
  const result = JSON.parse(py("import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); i=z.getinfo('other-mod/unique.pyj'); " +
    "assert z.testzip() is None; print(json.dumps([z.read('eve/client/script/ui/eveCommands.pyj').decode()," +
    "z.read(i).decode(),z.comment.decode(),i.comment.decode(),i.date_time,i.external_attr]))", f.archive));
  assert.deepEqual(result, ["REPLACEMENT", "UNRELATED BYTES", "preserve archive comment", "keep member comment", [2020, 1, 2, 3, 4, 6], 0o640 << 16]);
  assert.equal(fs.statSync(f.archive).mode & 0o777, 0o640);
});
test("Linux interrupted swap restores the verified backup and preserves unrelated files", linux, t => {
  const f = fixture(t), state = path.join(f.root, ".automining"); fs.mkdirSync(state);
  const backup = path.join(state, "code.ccp.before-12345"), receipt = path.join(state, "receipt.json");
  fs.copyFileSync(f.archive, backup); const before = fs.readFileSync(f.archive);
  fs.writeFileSync(path.join(state, "unknown.txt"), "PRESERVE");
  fs.writeFileSync(path.join(state, "pending.json"), JSON.stringify({ clientRoot: f.root, backup,
    beforeHash: crypto.createHash("sha256").update(before).digest("hex"), afterHash: "0".repeat(64), receipt: {} }));
  fs.unlinkSync(f.archive); legacy.recoverSwap(f.root, state, f.archive, receipt);
  assert.deepEqual(fs.readFileSync(f.archive), before);
  assert.equal(fs.existsSync(path.join(state, "pending.json")), false);
  assert.equal(fs.readFileSync(path.join(state, "unknown.txt"), "utf8"), "PRESERVE");
});
async function fakeClient(t, root, argument = path.join(root, "exefile.exe")) {
  fs.writeFileSync(path.join(root, "exefile.exe"), "AUTHORED EXECUTABLE PATH FIXTURE");
  const child = spawn(process.execPath, ["-e", "console.log('ready');setInterval(()=>{},1000)"], {
    argv0: argument, cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  await new Promise((resolve, reject) => { child.once("error", reject); child.stdout.once("data", resolve); });
  return child;
}
test("Linux stop guard catches the selected Wine-style client and preserves other installations", linux, async t => {
  const f = fixture(t), other = fixture(t).root;
  const unrelated = await fakeClient(t, other);
  assert.doesNotThrow(() => legacy.ensureStopped(f.root));
  const owned = await fakeClient(t, f.root);
  assert.throws(() => legacy.ensureStopped(f.root), /Close EVE clients/);
  assert.equal(unrelated.exitCode, null); assert.equal(owned.exitCode, null);
});

test("Linux stop guard refuses case-variant Wine paths without terminating the client", linux, async t => {
  const f = fixture(t);
  const argument = ("Z:" + path.join(f.root, "exefile.exe").replaceAll("/", "\\"))
    .replace("linux-archive-", "LINUX-ARCHIVE-");
  const child = await fakeClient(t, f.root, argument);
  assert.throws(() => legacy.ensureStopped(f.root), /Close EVE clients/);
  assert.equal(child.exitCode, null);
});

test("Linux stop guard preserves different physical clients whose directories differ only in case", linux, async t => {
  const f = fixture(t), selected = path.join(f.root, "Client"), other = path.join(f.root, "client");
  fs.mkdirSync(selected); fs.mkdirSync(other, { recursive: true });
  const a = fs.statSync(selected, { bigint: true }), b = fs.statSync(other, { bigint: true });
  if (a.ino === b.ino && a.dev === b.dev) return t.skip("Requires distinct case-sensitive directories");
  const child = await fakeClient(t, other);
  assert.doesNotThrow(() => legacy.ensureStopped(selected));
  assert.equal(child.exitCode, null);
});
