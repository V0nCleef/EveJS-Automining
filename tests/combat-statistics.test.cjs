"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createStatistics}=require('../lib/statistics');

function receipt(before=100,after=60,{destroyed=false,destroySuccess=false,applied=before-after}={}) {
  return {damageResult:{success:true,data:{beforeLayers:{shield:0,armor:0,structure:before},
    afterLayers:{shield:0,armor:0,structure:after},perLayer:[{layer:'structure',beforeHP:before,afterHP:after,appliedEffective:applied}],destroyed}},
    destroyResult:destroyed?{success:destroySuccess}:null};
}
function fixture(filename=null) {
  let now=Date.UTC(2026,8,28,12),result=receipt(),calls=0,active=true,throwNative=false;
  const session={characterID:42,shipID:100,clientID:'one'},other={characterID:43,shipID:101,clientID:'two'};
  const ship={kind:'ship',itemID:100,pilotCharacterID:42},peer={kind:'ship',itemID:101,pilotCharacterID:43};
  const target={kind:'ship',itemID:900,typeID:501,nativeNpc:true,operatorKind:'asteroidBeltRat'};
  const entities=new Map([[100,ship],[101,peer],[900,target]]),sessions=new Map([['one',session],['two',other]]);
  const scene={sessions,dynamicEntities:entities,getEntityByID:id=>entities.get(id),getLivePublicGridClusterKeyForEntity:e=>e.grid||'public'};
  const fleet={fleetID:1,members:new Map([[42,{}],[43,{}]])};
  const options={clock:()=>now,getSession:id=>id===42?session:id===43?other:null,getFleet:()=>fleet};
  const stats=createStatistics(filename,options);
  const native={applyWeaponDamageToTarget:function(...args){calls++;assert.equal(this,native);if(throwNative)throw Error('native failure');return result;}};
  const adapters={isActive:()=>active,typeInfo:id=>({groupName:id===501?'Asteroid Angel Cartel Frigate':'Civilian'}),
    scope:e=>({valid:!e.invalid,scoped:!!e.private})};
  assert.equal(stats.attachCombat(native,adapters),true);
  return {stats,native,scene,session,other,ship,peer,target,entities,fleet,options,adapters,
    set:r=>result=r,active:v=>active=v,throws:()=>throwNative=true,advance:ms=>now+=ms,calls:()=>calls,
    hit:(attacker=ship,victim=target)=>native.applyWeaponDamageToTarget(scene,attacker,victim,{em:9999},now,{})};
}
test('committed HP loss caps overkill and counts only successful native final blows',()=>{
  const f=fixture();f.set(receipt(12,0,{applied:500,destroyed:true,destroySuccess:true}));
  const returned=f.hit();assert.equal(returned.damageResult.success,true);
  const s=f.stats.snapshot(f.session);assert.equal(s.combatAvailable,true);assert.equal(s.totals.damageDealt,12);assert.equal(s.totals.ratsDestroyed,1);
  assert.deepEqual(s.totals.recent[0],{kind:'combat',at:f.options.clock(),targetID:900,typeID:501,damage:12,killed:true,source:'weapon'});
  f.hit();assert.equal(f.stats.snapshot(f.session).totals.damageDealt,12,'same committed receipt cannot replay');
  f.set(receipt(12,0,{destroyed:true,destroySuccess:true}));f.hit();assert.equal(f.stats.snapshot(f.session).totals.ratsDestroyed,1,'victim identity can die only once');
});
test('miss, immunity and failed native destruction never manufacture a kill',()=>{
  const f=fixture();for(const r of [null,{damageResult:{success:false}},receipt(100,100)]){f.set(r);f.hit();}
  assert.equal(f.stats.snapshot(f.session).totals.damageDealt,0);
  f.set(receipt(100,0,{destroyed:true,destroySuccess:false}));f.hit();assert.equal(f.stats.snapshot(f.session).totals.damageDealt,100);assert.equal(f.stats.snapshot(f.session).totals.ratsDestroyed,0);
});
test('damage sums committed layer loss after resistance, not incoming damage or restored HP',()=>{
  const f=fixture();f.set({damageResult:{success:true,data:{beforeLayers:{shield:10,armor:20,structure:30},afterLayers:{shield:0,armor:15,structure:32},destroyed:false,
    perLayer:[{beforeHP:10,afterHP:0,appliedEffective:10},{beforeHP:20,afterHP:15,appliedEffective:5},{beforeHP:30,afterHP:32,appliedEffective:50}]}},destroyResult:null});
  f.hit();assert.equal(f.stats.snapshot(f.session).totals.damageDealt,15);
});
test('native values, receiver, arguments and exceptions survive instrumentation',()=>{
  const f=fixture();const r=receipt();f.set(r);assert.equal(f.hit(),r);assert.equal(f.calls(),1);f.throws();assert.throws(()=>f.hit(),/native failure/);
  assert.equal(f.stats.snapshot(f.session).totals.damageDealt,40);const wrapped=f.native.applyWeaponDamageToTarget;
  assert.equal(f.stats.attachCombat(f.native,f.adapters),true);assert.equal(f.native.applyWeaponDamageToTarget,wrapped);
});
test('raw combat drones and fighter proxies attribute only to the live controlling pilot',()=>{
  const f=fixture();for(const kind of ['drone','fighter']){f.set(receipt());f.hit({kind,itemID:500,controllerID:101,ownerID:42,pilotCharacterID:42});}
  assert.equal(f.stats.snapshot(f.other).totals.damageDealt,80);assert.equal(f.stats.snapshot(f.session).totals.damageDealt,0);
  assert.equal(f.stats.snapshot(f.other).totals.recent[0].source,'drone');
  f.set(receipt());f.hit({kind:'drone',controllerID:999,ownerID:42});assert.equal(f.stats.snapshot(f.session).totals.damageDealt,0);
});
test('inactive, player, neutral, private and stale-session targets fail closed',()=>{
  for(const alter of [f=>f.active(false),f=>f.target.nativeNpc=false,f=>{f.target.operatorKind=null;f.target.typeID=999;},
    f=>f.target.private=true,f=>f.ship.invalid=true,f=>f.scene.sessions.delete('one'),
    f=>f.session.shipID=999,f=>f.scene.instanceID=4,f=>f.entities.delete(900)]){
    const f=fixture();alter(f);f.hit();assert.equal(f.stats.snapshot(f.session).totals.damageDealt,0);assert.equal(f.calls(),1);
  }
  const f=fixture();f.target.operatorKind=null;f.hit();assert.equal(f.stats.snapshot(f.session).totals.damageDealt,40,'native pirate group provenance qualifies');
});
test('delayed native missile damage still counts when its pilot moved to another public grid',()=>{
  const f=fixture();f.ship.grid='new public grid';f.target.grid='original public grid';f.hit();assert.equal(f.stats.snapshot(f.session).totals.damageDealt,40);
});
test('eligibility captured before native destruction removes the victim',()=>{
  const f=fixture();const committed=receipt(3,0,{destroyed:true,destroySuccess:true});
  const native={applyWeaponDamageToTarget(){f.entities.delete(900);return committed;}};f.stats.attachCombat(native,f.adapters);
  native.applyWeaponDamageToTarget(f.scene,f.ship,f.target);assert.equal(f.stats.snapshot(f.session).totals.ratsDestroyed,1);
});
test('combat periods, fleet operation, archives and durable run reset remain independent',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'automining-combat-')),file=path.join(dir,'statistics.json'),f=fixture(file);
  try {
    f.set(receipt(10,0,{destroyed:true,destroySuccess:true}));f.hit();f.advance(86400000);f.set(receipt(100,80));f.hit(f.peer);
    assert.equal(f.stats.snapshot(f.session,{period:'today'}).totals.damageDealt,0);
    assert.equal(f.stats.snapshot(f.session,{period:'week'}).totals.damageDealt,10);
    assert.equal(f.stats.snapshot(f.session,{view:'fleet'}).totals.damageDealt,30);
    f.stats.resetRun(f.session);assert.equal(f.stats.snapshot(f.session).totals.ratsDestroyed,0);assert.equal(f.stats.sessions(f.session).rows[0].totals.ratsDestroyed,1);
    assert.equal(f.stats.snapshot(f.session,{period:'tracked'}).totals.damageDealt,10);assert.equal(f.stats.snapshot(f.other).totals.damageDealt,20);
    f.stats.flush();const loaded=createStatistics(file,f.options);assert.equal(loaded.sessions(f.session).rows[0].totals.damageDealt,10);assert.equal(loaded.snapshot(f.session).combatAvailable,false);loaded.flush();
  }finally{f.stats.flush();fs.rmSync(dir,{recursive:true,force:true});}
});
test('old saved totals migrate combat fields as zero without rewriting during a read',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'automining-stats-old-')),file=path.join(dir,'old.json');
  const at=Date.UTC(2026,8,28),total={volume:12,units:120,ores:{}},data={schemaVersion:1,trackedSince:at,characters:{42:{total:{...total},days:{'2026-09-28':{...total}},run:{started:at,total:{...total}},runs:[{started:at,ended:at+1000,total:{...total}}]}}};
  const text=JSON.stringify(data);fs.writeFileSync(file,text);
  try {const s=createStatistics(file,{clock:()=>at+2000});for(const period of ['session','today','week','tracked']){const v=s.snapshot({characterID:42},{period});assert.equal(v.totals.damageDealt,0);assert.equal(v.totals.ratsDestroyed,0);assert.equal(v.totals.volume,12);}
    assert.equal(s.sessions({characterID:42}).rows[0].totals.ratsDestroyed,0);s.flush();assert.equal(fs.readFileSync(file,'utf8'),text);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('split pickup receipts and completion count once; delivery never becomes mining or combat',()=>{
  const f=fixture();assert.equal(f.stats.recordTransport(f.session,'a','pickup',12,false),true);assert.equal(f.stats.recordTransport(f.session,'b','pickup',8,false),true);
  assert.equal(f.stats.recordTransport(f.session,'complete','pickup',0,true),true);assert.equal(f.stats.recordTransport(f.session,'complete','pickup',0,true),false);
  assert.equal(f.stats.recordTransport(f.session,'delivered','delivery',20,true),true);assert.equal(f.stats.recordTransport(f.session,'delivered','delivery',20,true),false);
  const t=f.stats.snapshot(f.session).totals;assert.equal(t.collectedVolume,20);assert.equal(t.deliveredVolume,20);assert.equal(t.pickups,1);assert.equal(t.transportDeliveries,1);
  assert.equal(t.units,0);assert.equal(t.volume,0);assert.equal(t.damageDealt,0);assert.equal(f.stats.snapshot(f.session,{view:'fleet'}).totals.pickups,1);
  f.stats.resetRun(f.session);assert.equal(f.stats.sessions(f.session).rows[0].totals.collectedVolume,20);
});
