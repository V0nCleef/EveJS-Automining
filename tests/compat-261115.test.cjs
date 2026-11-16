'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.AUTOMINING_NATIVE_ROOT;
if(!root)throw Error('Set AUTOMINING_NATIVE_ROOT to an attested 261115.2 fixture');
const {installChat}=require('../lib/commands');
const policy=require(path.join(root,'server/src/services/chat/commands/commandAccess.js'));
const roles=require(path.join(root,'server/src/services/account/accountRoleProfiles.js'));
const text=fs.readFileSync(path.join(root,'server/src/services/chat/chatCommands.js'),'utf8');
function fixture(){
 const calls=[],nativeResult={handled:true,message:'native dispatcher'},denied={handled:true,message:'native denial'};
 const start=text.indexOf('function executeClientChatCommand('),end=text.indexOf('\nfunction executeChatCommand(',start);
 assert(start>0&&end>start);
 const context={module:{exports:{}},isChatCommandText:m=>m.startsWith('/'),normalizeCommandName:s=>s.toLowerCase(),
  mayRunChatCommand:policy.mayRunChatCommand,handledResult:()=>denied,executeChatCommand:()=>nativeResult};
 vm.runInNewContext(text.slice(start,end)+'\nmodule.exports=executeClientChatCommand;',context);
 const exports={executeClientChatCommand:context.module.exports,executeChatCommand:context.executeChatCommand,AVAILABLE_SLASH_COMMANDS:[]};
 const originalClient=exports.executeClientChatCommand;
 const controller={command:(session,command)=>{calls.push({session,command});return 'AutoMining handled';}};
 return {exports,originalClient,calls,controller,nativeResult,denied};
}
test('261115.2 client dispatcher reaches AutoMining exactly once for staff and retains native player denial',()=>{
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config/version.json'))).evejsVersion,'261115.2');
 const f=fixture(),staff={accountRole:roles.MAX_ACCOUNT_ROLE},player={accountRole:0n};
 // The old internal-export-only hook cannot affect this native lexical call.
 assert.equal(f.originalClient(staff,'/automining on'),f.nativeResult);
 installChat(f.exports,f.controller,{mayRunClientCommand:policy.mayRunChatCommand});
 assert.equal(f.exports.executeClientChatCommand(staff,'/AutoMining on').message,'AutoMining handled');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].command.action,'on');
 assert.equal(f.exports.executeClientChatCommand(player,'/automining on'),f.denied);
 assert.equal(f.calls.length,1);
 assert.equal(f.exports.executeClientChatCommand(player,'/giveitem me'),f.denied);
 assert.equal(f.exports.executeClientChatCommand(player,'/help'),f.nativeResult);
 assert.equal(f.exports.executeClientChatCommand(staff,'/giveitem me'),f.nativeResult);
});
test('missing new client policy fails closed while legacy internal dispatch remains usable',()=>{
 const f=fixture(),staff={accountRole:roles.MAX_ACCOUNT_ROLE};
 installChat(f.exports,f.controller);
 assert.equal(f.exports.executeClientChatCommand(staff,'/automining on'),f.nativeResult);
 assert.equal(f.calls.length,0);
 assert.equal(f.exports.executeChatCommand(staff,'/automining on').message,'AutoMining handled');
 assert.equal(f.calls.length,1);
});
