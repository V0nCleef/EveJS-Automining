'use strict';
// Exact native ledger source with an in-memory repository. Only the authored
// AutoMining statistics file is persisted; no server database or world opens.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createStatistics}=require('../lib/statistics');
const root=process.env.AUTOMINING_NATIVE_ROOT;
if(!root)throw Error('Set AUTOMINING_NATIVE_ROOT to reviewed 261125.3 source');
const sourceFile=path.join(root,'server/src/services/mining/miningLedgerState.js');
const version=JSON.parse(fs.readFileSync(path.join(root,'config/version.json'))).evejsVersion;

test(`${version} native cycle replay, failed commit and reload never double-count AutoMining statistics`,{skip:!['261125.3','261126.2'].includes(version)},t=>{
  const tempBase=path.resolve(__dirname,'../.test-runtime');fs.mkdirSync(tempBase,{recursive:true});
  const temp=fs.mkdtempSync(path.join(tempBase,'ledger-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  let now=Date.now(),table=null,failWrite=false;
  const clone=value=>structuredClone(value);
  const repo={read:()=>table?{success:true,data:table}:{success:false},write:(name,key,value)=>{
    if(failWrite)return {success:false,errorMsg:'AUTHORED_COMMIT_REFUSED'};
    table=value;return {success:true};
  }};
  const load=()=>{
    const dependencies={clone:{cloneValue:clone},config:{},gameStore:{mayMutateTable:()=>true},
      tableRepository:{createTableRepository:()=>repo},serviceHelpers:{currentFileTime:()=>BigInt(now)*10000n+116444736000000000n,
        normalizeBigInt:(value,fallback)=>{try{return BigInt(value);}catch{return fallback;}}},
      structureState:{getStructureByID:()=>null},itemTypeRegistry:{resolveItemByTypeID:()=>({categoryID:25,groupID:450})}};
    const context={module:{exports:{}},__dirname:path.dirname(sourceFile),require(id){
      if(id==='path')return path;
      const name=path.basename(id).replace(/\.js$/,'');
      if(dependencies[name])return dependencies[name];
      throw Error('Unexpected native ledger dependency '+id);
    }};
    vm.runInNewContext(fs.readFileSync(sourceFile,'utf8'),context,{filename:sourceFile});
    return context.module.exports;
  };
  const filename=path.join(temp,'statistics.json'),options={clock:()=>now,typeVolume:()=>0.1,isDroneType:id=>id===900};
  const session={characterID:42},event={characterID:42,typeID:123,moduleTypeID:800,quantity:100,quantityWasted:2,yieldKind:'ore',extractionID:'module:10:20:50:1000'};
  let ledger=load(),stats=createStatistics(filename,options);stats.attachLedger(ledger);now++;
  const record=()=>ledger.recordMiningLedgerEvent({...event,eventDateMs:now});
  const first=record();assert.equal(first.success,true);assert.equal(first.data.entryID,1);
  assert.equal(record().duplicate,true);assert.equal(stats.snapshot(session).totals.units,100);
  assert.equal(ledger.getCareerOreQuantities(42).quantities['450'],100);
  stats.flush();ledger=load();stats=createStatistics(filename,options);stats.attachLedger(ledger);
  assert.equal(record().duplicate,true);assert.equal(stats.snapshot(session,{period:'tracked'}).totals.units,100);
  const before=JSON.stringify(table);failWrite=true;
  const refused=ledger.recordMiningLedgerEvent({...event,extractionID:'module:10:20:50:2000',eventDateMs:now});
  assert.equal(refused.success,false);assert.equal(JSON.stringify(table),before);
  assert.equal(stats.snapshot(session,{period:'tracked'}).totals.units,100);
  failWrite=false;
  const drone=ledger.recordMiningLedgerEvent({...event,moduleTypeID:900,quantity:50,extractionID:'drone:10:21:50:2000',eventDateMs:now});
  assert.equal(drone.success,true);assert.equal(drone.data.entryID,2);
  const totals=stats.snapshot(session,{period:'tracked'}).totals;
  assert.equal(totals.units,150);assert.equal(totals.moduleVolume,10);assert.equal(totals.droneVolume,5);
  assert.equal(ledger.getCareerOreQuantities(42).quantities['450'],150);
  stats.flush();
});
