'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{test}=require('node:test');
const nativeRoot=process.env.AUTOMINING_NATIVE_ROOT;
if(!nativeRoot)throw Error('Set AUTOMINING_NATIVE_ROOT');
const candidate=path.resolve(__dirname,'..');
const fixture=fs.mkdtempSync(path.join(candidate,'../future-version-fixture-'));
const mining=fs.readFileSync(path.join(nativeRoot,'server/src/services/mining/miningRuntime.js'),'utf8');
const handshake=fs.readFileSync(path.join(nativeRoot,'server/src/network/tcp/handshake.js'),'utf8');
function makeRoot(name, miningSource, handshakeSource) {
  const root=path.join(fixture,name);
  fs.mkdirSync(path.join(root,'server/src/services/mining'),{recursive:true});
  fs.mkdirSync(path.join(root,'server/src/network/tcp'),{recursive:true});
  fs.mkdirSync(path.join(root,'client'),{recursive:true});
  fs.writeFileSync(path.join(root,'server/package.json'),JSON.stringify({version:'991231.99'}));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'991231.99'}));
  fs.writeFileSync(path.join(root,'server/src/services/mining/miningRuntime.js'),miningSource);
  fs.writeFileSync(path.join(root,'server/src/network/tcp/handshake.js'),handshakeSource);
  return root;
}
const future=makeRoot('same-reviewed-source',mining,handshake);
const changed=makeRoot('actual-seam-drift',mining.replace('function tickScene(scene, now)','function removedTickScene(scene, now)'),handshake.replace('function buildTidiSignedFunc(clientId)','function removedTidiSignedFunc(clientId)'));
test('unknown future version loads the verified bridge and prepares login delivery from unchanged source identity',()=>{
  const run=spawnSync(process.execPath,['-e',`
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    const [candidate,root]=process.argv.slice(1);
    for(const method of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync'])fs[method]=()=>{throw Error('Unexpected write '+method);};
    const loader=require(path.join(candidate,'loader.js')).install(root);
    assert.equal(loader.active,true);assert.ok(loader.delivery,'Unchanged source selects native login delivery');
    const result=require(path.join(candidate,'helper.js')).execute({protocol:1,requestId:'future-version',action:'prepare_profile',
      runtime:{evejsRoot:root,backend:'native',evejsVersion:'991231.99',clientRoot:path.join(root,'client')},
      mod:{root,path:candidate},settings:{profile:{}}});
    assert.equal(result.success,true);assert.equal(result.environment.AUTOMINING_CLIENT_DELIVERY,'login-v1');
    console.log('PASS: future 991231.99 loader and helper use verified source without any version allowlist or writes.');
  `,candidate,future],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,(run.stdout||'')+(run.stderr||''));
  console.log(run.stdout.trim());
});
test('a future release with actual mining/login seam drift remains refused',()=>{
  const compat=require('../lib/miningCompatibility'),delivery=require('../lib/loginDelivery');
  const changedMining=fs.readFileSync(path.join(changed,'server/src/services/mining/miningRuntime.js'),'utf8');
  assert.notEqual(changedMining,mining);assert.equal(compat.supportsMiningSource(changedMining),false);
  assert.throws(()=>compat.prepareMiningSource(changedMining),/Unsupported/);
  assert.equal(delivery.supportsRoot(changed),false);
  const run=spawnSync(process.execPath,['-e',`
    const assert=require('node:assert/strict'),path=require('node:path');const [candidate,root]=process.argv.slice(1);
    assert.equal(require(path.join(candidate,'loader.js')).install(root).active,false);
  `,candidate,changed],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,(run.stdout||'')+(run.stderr||''));
});
