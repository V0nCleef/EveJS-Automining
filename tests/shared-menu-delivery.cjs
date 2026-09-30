"use strict";
// Run the real public bridge and both authored builder additions in memory.
// No server start, RPCs, bootstrap execution or filesystem writes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const api = require('../lib/loginDelivery');
const handshake = process.env.EVEJS_HANDSHAKE_FIXTURE;
const client = process.argv[2];
const source = fs.readFileSync(handshake, 'utf8');
const framework = fs.readFileSync(path.join(client, 'shared_menu.py'));
const adapter = fs.readFileSync(path.join(__dirname, '../client/menu.py'));
const frozen = {framework:framework.toString('base64'),
 frameworkDigest:crypto.createHash('sha256').update(framework).digest('hex'),
 entries:[{id:'automining',source:adapter.toString('base64')}],
 handshakeSha256:crypto.createHash('sha256').update(source).digest('hex')};
const template = fs.readFileSync(path.join(client, 'shared_menu_loader.cjs'), 'utf8')
 .replace('/*__FROZEN_PAYLOAD__*/',JSON.stringify(frozen));
const builders = source.slice(source.indexOf('function buildMarshaledString'),source.indexOf('const DEV_CHAT_ROLE'));
const scope = {Buffer,console:{log(){},error(){}},config:{dev:{}},
 SEED_SKILL_EXTRACTOR_ACCESS_TOKEN:false,isSkillExtractorAccessTokenCompatibilityEnabled:()=>false};
vm.createContext(scope);
const delivery = api.createDelivery(path.resolve(__dirname,'..'),{token:'menu-integration'});
scope[api.LOADER_KEY]={delivery};
let compiled = false;
function Module() {}
Module.prototype._compile = function(content,filename) {
 assert.equal(filename,handshake);
 compiled=true;
 vm.runInContext(builders+'\n'+content.slice(source.length)+'\nthis.packet=buildTidiSignedFunc(1);',scope);
};
const officialRoot = path.resolve(handshake,'../../../../..');
// Launcher preloads its shared bridge before the selected mod loaders.
vm.runInNewContext(template,{Buffer,console:{log(){}},__dirname:path.join(officialRoot,'.evejs-launcher','shared-menu','fixture'),
 require:name=>name==='module'?Module:require(name)});
new Module()._compile(api.extendSource(source),handshake);
assert.equal(compiled,true);
const packet=scope.packet;
assert.equal(packet[0],0x74);assert.equal(packet.readUInt32LE(1),packet.length-5);
assert.ok(packet.length-5<=256*1024,'Current combined payload exceeded AutoMining\'s reviewed expression budget');
const expression=packet.toString('ascii',5);
assert.match(expression,/<automining-delivery>/);
assert.match(expression,/<evejs-shared-mod-menu>/);
const menu64=expression.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)[1];
const bootstrap=Buffer.from(menu64,'base64').toString('utf8');
const frozen64=bootstrap.match(/b64decode\('([A-Za-z0-9+/=]+)'\)/)[1];
const captured=JSON.parse(Buffer.from(frozen64,'base64'));
assert.equal(Buffer.from(captured.framework,'base64').compare(framework),0);
assert.equal(Buffer.from(captured.entries[0].source,'base64').compare(adapter),0);
assert.equal(captured.entries[0].id,'automining');
const original=vm.runInNewContext(builders+'\nbuildTidiSignedFunc(1)',{Buffer,config:{dev:{}},
 SEED_SKILL_EXTRACTOR_ACCESS_TOKEN:false,isSkillExtractorAccessTokenCompatibilityEnabled:()=>false});
assert.ok(expression.endsWith('('+original.toString('ascii',5)+'))'));
console.log(JSON.stringify({result:'PASS: actual Launcher bridge preserves the native builder and AutoMining companion, with exact menu entrypoint bytes.',
 originalBytes:original.length-5,jointExpressionBytes:packet.length-5,autoMiningExpressionBound:256*1024}));
