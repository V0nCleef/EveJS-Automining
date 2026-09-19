const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const stage = path.resolve(__dirname, '..');
assert.ok(process.env.EVEJS_TEST_ROOT && process.env.EVEJS_PATCHED_TEST_ROOT, 'Set EVEJS_TEST_ROOT and EVEJS_PATCHED_TEST_ROOT to the reviewed original and patched EveJS trees');
const compat = require(path.join(stage, 'lib/miningCompatibility'));
const stock = fs.readFileSync(path.join(process.env.EVEJS_TEST_ROOT, 'server/src/services/mining/miningRuntime.js'), 'utf8');
const patched = fs.readFileSync(path.join(process.env.EVEJS_PATCHED_TEST_ROOT, 'server/src/services/mining/miningRuntime.js'), 'utf8');
const bridge = fs.readFileSync(path.join(stage, 'lib/bridge.js'), 'utf8');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function load(diskSource) {
  const state = { logs: [], errors: [], compiled: [] };
  const Module = function() {};
  Module.prototype._compile = function(content) { state.compiled.push(content); };
  Module._load = () => ({});
  Module.isBuiltin = () => false;
  Module._resolveFilename = request => request;
  const originalCompile = Module.prototype._compile;
  const context = { module: { exports: {} }, __dirname: stage, process: { platform: process.platform },
    console: { log: x => state.logs.push(x), error: x => state.errors.push(x) },
    require(id) {
      if (id === 'node:fs') return { existsSync: () => true, readFileSync: () => diskSource };
      if (id === 'node:path') return path;
      if (id === 'node:crypto') return crypto;
      if (id === 'node:module') return Module;
      if (id === 'node:worker_threads') return { isMainThread: true };
      if (id === './lib/miningCompatibility') return compat;
      if (id === './lib/loginDelivery') return { supportsRoot: () => false };
      if (id === './lib/bridge') return bridge;
      if (id === './lib/controller') return { createController: () => ({}) };
      if (id === './lib/preferences') return { createPreferences: () => ({}) };
      if (id === './lib/compression') return { createCompression: () => ({}) };
      if (id === './lib/catalog') return { createCatalog: () => ({}) };
      if (id === './lib/hud') return { installHUD() {} };
      if (id === './lib/commands') return {};
      throw Error(`Unexpected dependency ${id}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(stage, 'loader.js'), 'utf8'), context);
  const miningPath = path.resolve(stage, '../../server/src/services/mining/miningRuntime.js');
  return { state, api: context.module.exports, hooked: Module.prototype._compile !== originalCompile,
    compile: source => Module.prototype._compile.call({}, source, miningPath) };
}
test('stock EveJS uses bundled fallback without changing input source', () => {
  const before = digest(stock);
  assert.equal(compat.supportsMiningSource(stock), true);
  assert.equal(compat.prepareMiningSource(stock), patched);
  assert.equal(digest(stock), before);
  const f = load(stock);
  assert.equal(f.hooked, true);
  f.compile(stock);
  assert.equal(f.state.compiled[0], patched + '\n' + bridge);
  assert.equal(f.state.errors.length, 0);
  new vm.Script(f.state.compiled[0]);
});
test('already patched EveJS uses native fix unchanged and does not double-apply', () => {
  assert.equal(compat.supportsMiningSource(patched), true);
  assert.equal(compat.prepareMiningSource(patched), patched);
  assert.equal(compat.prepareMiningSource(compat.prepareMiningSource(stock)), patched);
  const f = load(patched);
  assert.equal(f.hooked, true);
  f.compile(patched);
  assert.equal(f.state.compiled[0], patched + '\n' + bridge);
  assert.equal(f.state.errors.length, 0);
});
test('unknown disk baseline remains blocked before any loader hook', () => {
  const unknown = stock + '\n// unsupported mutation';
  assert.equal(compat.supportsMiningSource(unknown), false);
  assert.throws(() => compat.prepareMiningSource(unknown), /Unsupported/);
  const f = load(unknown);
  assert.equal(f.hooked, false);
  assert.match(f.state.errors[0], /Unsupported miningRuntime/);
});
test('intervening source transformation remains blocked from bridge injection', () => {
  const unknown = stock + '\n// another loader changed source';
  const f = load(stock);
  f.compile(unknown);
  assert.equal(f.state.compiled[0], unknown);
  assert.match(f.state.errors[0], /bridge disabled/);
});
test('damaged bundled patch fails closed', () => {
  const context = { module: { exports: {} }, __dirname: path.join(stage, 'lib'), Buffer,
    require(id) {
      if (id === 'node:fs') return { readFileSync: () => 'invalid patch' };
      if (id === 'node:path') return path;
      if (id === 'node:crypto') return crypto;
      throw Error(id);
    } };
  vm.runInNewContext(fs.readFileSync(path.join(stage, 'lib/miningCompatibility.js'), 'utf8'), context);
  assert.throws(() => context.module.exports.prepareMiningSource(stock), /Missing bundled/);
  assert.equal(context.module.exports.prepareMiningSource(patched), patched, 'native fix never needs bundled patch');
});

test('both reviewed baselines work with LF and CRLF line endings', () => {
  for (const newline of ['\n', '\r\n']) {
    const normalize = source => source.replace(/\r\n/g, '\n').replace(/\n/g, newline);
    const original = normalize(stock);
    const fixed = normalize(patched);
    assert.equal(compat.prepareMiningSource(original), fixed);
    assert.equal(compat.prepareMiningSource(fixed), fixed);
    const f = load(original);
    assert.equal(f.hooked, true);
    f.compile(original);
    assert.equal(f.state.compiled[0], fixed + '\n' + bridge);
    assert.equal(f.state.errors.length, 0);
  }
});
