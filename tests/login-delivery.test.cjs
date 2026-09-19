const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const api = require('../lib/loginDelivery');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.EVEJS_HANDSHAKE_FIXTURE, 'utf8');
const envelope = expression => { const b = Buffer.from(expression, 'ascii'), h = Buffer.alloc(5); h[0] = 0x74; h.writeUInt32LE(b.length, 1); return Buffer.concat([h, b]); };
test('known handshake source supports CRLF and LF; unrelated mutation is preserved', () => {
  assert.equal(api.supportsSource(source), true);
  assert.equal(api.supportsSource(source.replace(/\r\n/g, '\n')), true);
  assert.equal(api.supportsSource(source.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')), true);
  assert.equal(api.extendSource(source + '\n// other mod'), source + '\n// other mod');
});
test('composition keeps the original login expression and result even when companion imports fail', () => {
  const delivery = api.createDelivery(root);
  const original = envelope("(__import__('sys').stdout.write('BUILTIN_OK\\n'), 77)[1]");
  const result = delivery.compose(original);
  assert.equal(result[0], 0x74);
  assert.equal(result.readUInt32LE(1), result.length - 5);
  const probe = spawnSync('python', ['-c', "import sys; result=eval(sys.stdin.read()); assert result==77; print('RESULT_OK')"],
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
test('in-memory appended hook calls the existing builder once and falls back on delivery failure', () => {
  // Execute only the authored payload builders, not server startup or the serializer.
  const builders = source.slice(source.indexOf('function buildMarshaledString'), source.indexOf('const DEV_CHAT_ROLE'));
  const suffix = api.extendSource(source).slice(source.length);
  const context = { Buffer, console: { error() {} }, config: { dev: {} }, SEED_SKILL_EXTRACTOR_ACCESS_TOKEN: false,
    isSkillExtractorAccessTokenCompatibilityEnabled: () => false };
  vm.createContext(context);
  vm.runInContext(builders + '\nthis.originalBuild = buildTidiSignedFunc;', context);
  const original = context.originalBuild(1);
  context[api.LOADER_KEY] = { delivery: { compose() { throw Error('fixture'); } } };
  vm.runInContext(suffix + '\nthis.newBuild = buildTidiSignedFunc;', context);
  assert.deepEqual(context.newBuild(1), original);
  context[api.LOADER_KEY].delivery = api.createDelivery(root);
  const composed = context.newBuild(1).subarray(5).toString('ascii');
  assert.ok(composed.endsWith('(' + original.subarray(5).toString('ascii') + ')'));
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
