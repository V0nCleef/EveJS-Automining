'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.EVEJS_LOGIN_NATIVE_ROOT;
if(!root)throw Error('Set EVEJS_LOGIN_NATIVE_ROOT to an attested 261115.2 fixture');
const file=path.join(root,'server/src/network/tcp/handshake.js');
const codec=require(path.join(root,'server/src/network/tcp/utils/marshal.js'));
const roles=require(path.join(root,'server/src/services/account/accountRoleProfiles.js'));
const api=require('../lib/loginDeliveryRuntime'),delivery=require('../lib/loginDelivery');
function fixture(enabled){
 const config={serverHealthWindowEnabled:enabled,dev:{}};
 const healthFile=path.join(root,'server/src/services/serverHealth/serverHealthClientDelivery.js');
 const healthContext={module:{exports:{}},__dirname:path.dirname(healthFile),require(name){
  if(name==='fs'||name==='path')return require(name);
  if(name.endsWith('config'))return config;
  if(name.endsWith('accountRoleProfiles'))return roles;
  throw Error('Unexpected health dependency '+name);
 }};
 vm.runInNewContext(fs.readFileSync(healthFile,'utf8'),healthContext,{filename:healthFile});
 const logger=new Proxy({}, {get:()=>()=>{}});
 const context={Buffer,module:{exports:{}},__dirname:path.dirname(file),process:{platform:process.platform},require(name){
  const normalized=name.replace(/\\/g,'/');
  if(['path','crypto'].includes(name))return require(name);
  if(normalized.endsWith('/utils/marshal'))return codec;
  if(name==='../gameFrame')return require(path.join(root,'server/src/network/gameFrame.js'));
  if(normalized.endsWith('/utils/logger'))return logger;
  if(normalized.endsWith('/accountRoleProfiles'))return roles;
  if(normalized.endsWith('/protocolProfile'))return {CLIENT_COMPATIBILITY_PROFILE:{},PROXY_NODE_ID:1,SEED_SKILL_EXTRACTOR_ACCESS_TOKEN:false};
  if(normalized.endsWith('/config'))return config;
  if(normalized.endsWith('/serverHealthClientDelivery'))return healthContext.module.exports;
  return {};
 }};
 // Add only a test export. The upstream signed-function builder and role
 // dispatch remain byte-exact, unlike the older marker-builder fixture.
 vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.fixtureSigned=buildTidiSignedFunc;',context,{filename:file});
 function Host(){} Host.prototype._compile=function(){};
 const runtime=api.createRuntime(root,{moduleHost:Host,codec,logger});
 const companion=delivery.createDelivery(path.resolve(__dirname,'..'),{token:'261115-source-control'});
 runtime.register({id:'automining',source:companion.source});
 const Service=context.module.exports;
 assert.equal(runtime.attach(Service),true);
 return {Service};
}
for(const enabled of [false,true])for(const staff of [false,true])test(`261115.2 original login/health payload survives AutoMining composition: enabled=${enabled}, staff=${staff}`,()=>{
 const {Service}=fixture(enabled),frames=[];
 const signed=Service.fixtureSigned(123,{accountRole:staff?roles.MAX_ACCOUNT_ROLE:0n});
 const native=signed.toString('latin1',5);
 assert.equal(native.includes('SERVER_HEALTH_WINDOW:OK'),enabled&&staff);
 assert.ok(native.includes('EnableSimDilation'));
 const original=codec.encodePacket(['',[signed,0],{type:'dict',entries:[['context','keep']]},
  {type:'dict',entries:[['challenge_responsehash','55087'],['keep','native']]}]);
 const session=Object.assign(Object.create(Service.prototype),{userId:42,clientId:123,encrypted:false,socket:{write:p=>frames.push(p)}});
 session._sendPacket(original);
 assert.equal(frames.length,1);
 const before=codec.marshalDecodeExact(original.subarray(4)),after=codec.marshalDecodeExact(frames[0].subarray(4));
 assert.equal(after[1][1],0);
 assert.deepEqual(after[2],before[2]);assert.deepEqual(after[3],before[3]);
 assert.ok(after[1][0].toString('latin1',5).endsWith('('+native+')'),'Exact native signed function runs first, preserving health source and its role decision');
 assert.ok(after[1][0].includes(Buffer.from('<evejs-login-delivery-v1>')));
});
