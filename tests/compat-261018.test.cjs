'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const root=process.env.AUTOMINING_NATIVE_ROOT;
if(!root)throw Error('Set AUTOMINING_NATIVE_ROOT to the reviewed server tree');
const mining=fs.readFileSync(path.join(root,'server/src/services/mining/miningRuntime.js'),'utf8');
const handshake=fs.readFileSync(path.join(root,'server/src/network/tcp/handshake.js'),'utf8');
const compat=require('../lib/miningCompatibility'),delivery=require('../lib/loginDelivery');
test('261018.1 mining is passed through exactly for reviewed LF/CRLF sources and rejects unrelated mutations',()=>{
  for(const newline of ['\n','\r\n']) {
    const source=mining.replace(/\r\n/g,'\n').replace(/\n/g,newline);
    assert.equal(compat.supportsMiningSource(source),true);
    assert.equal(compat.prepareMiningSource(source),source,'No legacy short-cycle patch may touch native AIR/durability/season behavior');
    assert.equal(compat.supportsMiningSource(source+'\n// unknown change'),false);
    assert.throws(()=>compat.prepareMiningSource(source+'\n// unknown change'),/Unsupported/);
  }
});
test('261018.1 login supports reviewed LF/CRLF sources and refuses unrelated mutations',()=>{
  for(const newline of ['\n','\r\n']) {
    const source=handshake.replace(/\r\n/g,'\n').replace(/\n/g,newline);
    assert.equal(delivery.supportsSource(source),true);
    assert.match(delivery.extendSource(source).slice(source.length),/__amPreviousLogin/);
    const unknown=source+'\n// unknown change';
    assert.equal(delivery.supportsSource(unknown),false);assert.equal(delivery.extendSource(unknown),unknown);
  }
});
