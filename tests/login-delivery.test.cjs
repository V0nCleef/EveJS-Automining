const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { buildClientSource, emittedBootstrap } = require('../lib/clientSource');
const { spawnSync } = require('node:child_process');
const python = process.env.EVEJS_PYTHON || 'python';
const api = require('../lib/loginDelivery');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.EVEJS_HANDSHAKE_FIXTURE, 'utf8');
const envelope = expression => { const b = Buffer.from(expression, 'ascii'), h = Buffer.alloc(5); h[0] = 0x74; h.writeUInt32LE(b.length, 1); return Buffer.concat([h, b]); };
test('login delivery probes available native files without imposing a source-text allowlist', () => {
  const nativeRoot = path.resolve(process.env.EVEJS_HANDSHAKE_FIXTURE, '../../../../..');
  assert.equal(api.supportsRoot(nativeRoot), true);
  assert.equal(api.supportsRoot(nativeRoot, 'docker'), true, 'Docker uses the same required login files and runtime capability adapter');
  assert.equal(api.supportsRoot(nativeRoot, 'unknown'), false);
  assert.equal(api.supportsRoot(path.join(nativeRoot, 'absent')), false);
  assert.equal('supportsSource' in api, false);
  assert.equal('extendSource' in api, false, 'Production never rewrites the private native builder');
});
test('composition keeps the original login expression and result even when companion imports fail', () => {
  const delivery = api.createDelivery(root);
  const original = envelope("(__import__('sys').stdout.write('BUILTIN_OK\\n'), 77)[1]");
  const result = delivery.compose(original);
  assert.equal(result[0], 0x74);
  assert.equal(result.readUInt32LE(1), result.length - 5);
  const probe = spawnSync(python, ['-c', "import sys; result=eval(sys.stdin.read()); assert result==77; print('RESULT_OK')"],
    { input: result.subarray(5).toString('ascii'), encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /BUILTIN_OK/);
  assert.match(probe.stdout, /RESULT_OK/);
  assert.match(probe.stdout, /AUTOMINING_LOGIN:FAILED/);
});
test('malformed envelope is refused without modifying its bytes', () => {
  const original = Buffer.from([0x4e]);
  assert.throws(() => api.createDelivery(root).compose(original), /envelope/);
  assert.deepEqual(original, Buffer.from([0x4e]));
});

test('compressed outer delivery retains exact UTF-8 source, credentials and companion within unchanged bounds', () => {
  const delivery = api.createDelivery(root);
  const expression = delivery.compose(envelope('None')).subarray(5).toString('ascii');
  const encoded = expression.match(/b64decode\('([A-Za-z0-9+/=]+)'\)/)[1];
  assert.ok(encoded.length <= 240 * 1024);
  const outer = zlib.inflateSync(Buffer.from(encoded, 'base64')).toString('utf8');
  assert.ok(Buffer.byteLength(outer, 'utf8') <= 240 * 1024);
  assert.ok(outer.startsWith('# coding: utf-8\n'));
  assert.ok(outer.includes('_am_token = ' + JSON.stringify(delivery.token) + '\n'));
  assert.ok(outer.includes('_am_version = ' + JSON.stringify(api.VERSION) + '\n'));
  const inner = JSON.parse(outer.match(/\n_am_source64 = (.+)\n/)[1]);
  assert.equal(zlib.inflateSync(Buffer.from(inner, 'base64')).toString('utf8'), buildClientSource(root));
  assert.ok(outer.endsWith(emittedBootstrap(fs.readFileSync(path.join(root, 'client/login.py'), 'utf8'))));
  assert.ok(expression.endsWith(')(None)'));
});

test('corrupt compressed companion preserves the original login result and reports failure', () => {
  const delivery = api.createDelivery(root);
  const expression = delivery.compose(envelope("(__import__('sys').stdout.write('BUILTIN_OK\\n'), 77)[1]")).subarray(5).toString('ascii');
  const corrupted = expression.replace(/b64decode\('[A-Za-z0-9+/=]+'\)/, "b64decode('YmFk')");
  const probe = spawnSync(python, ['-c', "import sys; result=eval(sys.stdin.read()); assert result==77; print('RESULT_OK')"],
    { input: corrupted, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /BUILTIN_OK/); assert.match(probe.stdout, /RESULT_OK/); assert.match(probe.stdout, /AUTOMINING_LOGIN:FAILED/);
});
test('capability probe does not mark HUD ready; acknowledgement is scoped to this server and version', () => {
  const delivery = api.createDelivery(root, { token: 'server-A' });
  let calls = 0;
  const controller = { clientReady: () => calls++ };
  const session = { charid: 42 };
  for (const args of [['server-B', api.VERSION, 1], ['server-A', 'old', 1]]) {
    assert.equal(JSON.parse(delivery.ready(args, session, controller)).success, false);
  }
  assert.equal(JSON.parse(delivery.ready(['server-A', api.VERSION, 1], {}, controller)).success, false);
  assert.equal(JSON.parse(delivery.ready(['server-A', api.VERSION, 0], session, controller)).success, true);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(delivery.ready(['server-A', api.VERSION, 1], session, controller)).success, true);
  assert.equal(calls, 1);
});
test('registered initializer receives the common context and preserves exact authored UTF-8 bootstrap bytes', () => {
  const delivery = api.createDelivery(root, { token: 'server-A' });
  assert.ok(delivery.source.startsWith('_am_context = _evejs_context\n'));
  const encoded = delivery.source.match(/b64decode\('([A-Za-z0-9+/=]+)'\)/)[1];
  const initializer = zlib.inflateSync(Buffer.from(encoded, 'base64')).toString('utf8');
  assert.ok(initializer.includes('_am_token = "server-A"'));
  assert.ok(initializer.endsWith(emittedBootstrap(fs.readFileSync(path.join(root, 'client/login.py'), 'utf8'))));
  assert.doesNotMatch(delivery.source, /buildTidiSignedFunc|__amPreviousLogin/);
});

test('wire text readiness enables the real controller HUD command; invalid credentials stay rejected', () => {
  const { createController } = require('../lib/controller');
  const delivery = api.createDelivery(root, { token: 'server-A' });
  const forms = [value => value, value => Buffer.from(value),
    ...['wstring', 'token', 'rawstr'].flatMap(type => [
      value => ({ type, value }), value => ({ type, value: Buffer.from(value) })])];
  for (const encode of forms) {
    const events = [];
    const session = { characterID: 42, sendNotification: (...args) => events.push(args) };
    const controller = createController(() => null, () => null);
    const probe = delivery.ready([encode('server-A'), encode(api.VERSION), 0], session, controller);
    assert.equal(JSON.parse(probe).success, true);
    assert.notEqual(controller.command(session, { action: 'help' }), 'AutoMining settings opened.');
    assert.deepEqual(events, []);
    const ready = delivery.ready([encode('server-A'), encode(api.VERSION), 1], session, controller);
    assert.equal(JSON.parse(ready).success, true);
    assert.equal(controller.command(session, { action: 'help' }), 'AutoMining settings opened.');
    assert.deepEqual(events, [['OnAutoMiningOpen', 'clientID', []]]);
  }
  const controller = { clientReady() { assert.fail('invalid request became ready'); } };
  for (const bad of [Buffer.from('server-B'), { type: 'other', value: 'server-A' },
    { toString: () => 'server-A' }, Buffer.alloc(10000), null]) {
    assert.equal(JSON.parse(delivery.ready([bad, Buffer.from(api.VERSION), 1], { charid: 42 }, controller)).success, false);
  }
});
