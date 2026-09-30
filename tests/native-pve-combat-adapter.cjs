"use strict";
// Passive native imports plus pure calculations on isolated records. Never
// create a scene, run a tick, activate a module or call the persistent damage API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=fs.realpathSync(process.argv[2]),late=process.argv[3]==='late';
process.env.EVEJS_GAMESTORE_OWNER_ROLE='reader';
const blockedWrites=[],deny=name=>()=>{blockedWrites.push(name);throw Error('Read-only native load attempted '+name);};
for(const name of ['writeFile','appendFile','mkdir','rename','unlink','rm','rmdir','copyFile','truncate','chmod','chown','symlink','link','utimes','write','writev']) {
  if(fs[name])fs[name]=deny(name);if(fs[name+'Sync'])fs[name+'Sync']=deny(name+'Sync');if(fs.promises[name])fs.promises[name]=deny('promises.'+name);
}
fs.createWriteStream=deny('createWriteStream');
const readFlag=flags=>typeof flags==='number'?!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):['r','rs','sr'].includes(flags||'r');
for(const name of ['open','openSync']) {const original=fs[name];fs[name]=function(file,flags,...args){if(!readFlag(flags))return deny(name)();return original.call(this,file,flags,...args);};}
const open=fs.promises.open;fs.promises.open=function(file,flags,...args){if(!readFlag(flags))return deny('promises.open')();return open.call(this,file,flags,...args);};
const canonical=p=>path.resolve(p).toLowerCase(),loggerPath=canonical(require.resolve(path.join(root,'server/src/utils/logger')));
const logger=new Proxy({},{get:(_,key)=>key==='isVerboseDebugEnabled'?()=>false:()=>{}}),originalLoad=Module._load;
Module._load=function(request,parent,isMain){if(!Module.isBuiltin(request)&&canonical(Module._resolveFilename(request,parent,isMain))===loggerPath)return logger;return originalLoad.apply(this,arguments);};
const load=file=>require(path.join(root,'server/src',file)),damagePath=path.join(root,'server/src/space/runtime/targetDamageApplication.js');
try {
  if(late)load('space/runtime/targetDamageApplication.js');
  const automining=require('../loader').install(root);assert.equal(automining.active,true);
  assert.ok(automining.delivery,'Supported native login companion must fit the existing payload bound');
  const imports=[],installedLoad=Module._load;
  Module._load=function(request,parent,isMain){
    const result=installedLoad.apply(this,arguments);
    if(!late&&!Module.isBuiltin(request)&&canonical(Module._resolveFilename(request,parent,isMain))===canonical(damagePath)){
      assert.equal(result.applyWeaponDamageToTarget._autoMiningCombatStatistics,automining.statistics,'Wrap before importer can destructure native damage');
      assert.equal(result.applyWeaponDamageToTarget._autoMiningReinforcementAttack,automining.controller,'Committed-attack hook must precede native consumer destructuring');
      imports.push(parent?.filename||'unknown');
    }
    return result;
  };
  // Import the actual consumers. Their normal calls retain the function they
  // destructure here; checking only a later export replacement would miss that.
  for(const file of ['space/runtime/weaponCycle.js','space/runtime/moduleRuntimeCallbacks.js','space/runtime/missileEntity.js','services/drone/droneRuntime.js','services/fighter/fighterRuntime.js'])load(file);
  const nativeDamage=load('space/runtime/targetDamageApplication.js');
  const runtime=load('space/runtime.js');
  for(const name of ['addTarget','removeTarget','activateGenericModule','deactivateGenericModule']) {
    assert.equal(typeof runtime._testing.SolarSystemScene.prototype[name],'function','Native scene '+name);
  }
  if(!late)assert.equal(runtime.droneInterop.applyWeaponDamageToTarget._autoMiningCombatStatistics,automining.statistics,'Native raw drone/fighter bridge retained wrapped damage');
  if(late){assert.equal(nativeDamage.applyWeaponDamageToTarget._autoMiningCombatStatistics,undefined,'Cached seam must remain unavailable');assert.equal(nativeDamage.applyWeaponDamageToTarget._autoMiningReinforcementAttack,undefined);}
  else {assert.ok(imports.some(file=>/weaponCycle|moduleRuntimeCallbacks|missileEntity|droneRuntime|fighterRuntime/.test(file)),'Real consumer import inspected');
    const consumer=new Module(path.join(__dirname,'isolated-combat-consumer.cjs'),module);consumer.filename=consumer.id;consumer.paths=module.paths;
    consumer._compile('const {applyWeaponDamageToTarget}=require('+JSON.stringify(damagePath)+'); module.exports=applyWeaponDamageToTarget;',consumer.filename);
    assert.equal(consumer.exports._autoMiningCombatStatistics,automining.statistics,'Direct compile and destructured reference retain hook');}
  const dogma=load('space/runtime/entityDogmaView.js'),fit=load('services/fitting/liveFittingState.js'),group=load('services/moduleGrouping/moduleGroupingRuntime.js');
  const weapon=load('space/runtime/weaponSnapshot.js'),bank=load('space/runtime/groupedWeaponBank.js'),scope=load('space/destiny/identity/interactionScope.js');
  const world=load('space/worldData.js'),damage=load('space/combat/damage.js'),drone=load('services/drone/droneRuntime.js'),auto=load('space/runtime/autoTargetingMissiles.js'),types=load('services/inventory/itemTypeRegistry.js');
  for(const [value,names] of [[dogma,['getEntityRuntimeFittedItems','getEntityRuntimeLoadedCharge']],
    [fit,['isModuleOnline']], [group,['getMasterModuleID']], [weapon,['buildWeaponSnapshotForEntity']],
    [bank,['resolveGroupedWeaponBankContext','buildBankedWeaponSnapshot']], [scope,['resolveEntityInteractionScope','canEntitiesInteractLocally']],
    [world,['ensureLoaded']], [damage,['getEntityMaxHealthLayers','getEntityCurrentHealthLayers','applyDamageToEntity']],
    [drone,['commandEngage','commandReturnBay','isDroneEntity']], [auto,['isAutoTargetingMissileCharge']], [types,['resolveItemByTypeID']],
    [nativeDamage,['applyWeaponDamageToTarget']]])for(const name of names)assert.equal(typeof value[name],'function','Native PVE export '+name);
  const base={moduleID:1,durationMs:1000,optimalRange:10000,damageMultiplier:2,rawShotDamage:{em:4,thermal:6}};
  const snapshot=bank.buildBankedWeaponSnapshot(base,{launchModuleIDs:[1,2,3]});assert.equal(snapshot.bankSize,3);assert.equal(snapshot.rawShotDamage.em,12);assert.equal(snapshot.optimalRange,10000);assert.equal(snapshot.durationMs,1000);
  // Real static types and native dogma calculators, over isolated fitted rows.
  // Charge choice and actual skill effects must alter range/damage/cycle before
  // the bank scales the shot; no activation or persistent fitting is involved.
  const typeRows=types.listItemTypes(),type=name=>{const row=typeRows.find(r=>r.name===name);assert.ok(row,name);return row;};
  const hull={...type('Merlin'),itemID:987650001,ownerID:0},rail={...type('125mm Railgun I'),itemID:987650002,locationID:hull.itemID,flagID:27};
  const charge=name=>({...type(name),itemID:987650003,locationID:hull.itemID,flagID:27,quantity:50,stacksize:50});
  const host={kind:'ship',itemID:hull.itemID,pilotCharacterID:0},context={shipItem:hull,fittedItems:[rail],activeModuleContexts:[],hiddenModifierItems:[],additionalLocationModifierSources:[],directModuleModifierEntries:[],directChargeModifierEntries:[]};
  const calculate=(name,skills=new Map())=>weapon.buildWeaponSnapshotForEntity(host,rail,charge(name),{...context,skillMap:skills});
  const antimatter=calculate('Antimatter Charge S'),iron=calculate('Iron Charge S');
  const total=s=>Object.values(s.rawShotDamage).reduce((n,v)=>n+v,0);
  assert.equal(antimatter.family,'hybridTurret');assert.ok(iron.optimalRange>antimatter.optimalRange);assert.ok(total(antimatter)>total(iron));
  const skills=new Map(['Sharpshooter','Rapid Firing','Small Hybrid Turret'].map(name=>{const row=type(name);return [row.typeID,{typeID:row.typeID,skillLevel:5}];}));
  const skilled=calculate('Antimatter Charge S',skills);assert.ok(skilled.optimalRange>antimatter.optimalRange);assert.ok(skilled.durationMs<antimatter.durationMs);assert.ok(total(skilled)>total(antimatter));
  const skilledBank=bank.buildBankedWeaponSnapshot(skilled,{launchModuleIDs:[rail.itemID,987650004,987650005]});
  assert.equal(skilledBank.optimalRange,skilled.optimalRange);assert.equal(skilledBank.durationMs,skilled.durationMs);assert.ok(Math.abs(total(skilledBank)/skilledBank.durationMs-3*total(skilled)/skilled.durationMs)<1e-9);
  const isolated={kind:'ship',itemID:987654321,shieldCapacity:0,armorHP:0,structureHP:12,conditionState:{damage:0}};
  const computed=damage.applyDamageToEntity(isolated,{em:500});assert.equal(computed.success,true);assert.equal(computed.data.beforeLayers.structure,12);assert.equal(computed.data.afterLayers.structure,0);assert.equal(computed.data.destroyed,true);
  const layer=computed.data.perLayer.find(l=>l.layer==='structure');assert.equal(Math.min(layer.appliedEffective,layer.beforeHP-layer.afterHP),12);
  assert.equal(scope.resolveEntityInteractionScope({itemID:1}).valid,true);assert.equal(scope.resolveEntityInteractionScope({itemID:1,abyssalRunID:5,abyssalRoomIndex:0}).scoped,true);
  const fixtureSession={characterID:987654321};
  assert.equal(automining.statistics.snapshot(fixtureSession).combatAvailable,!late);
  assert.equal(automining.controller.combatStatisticsEnabled(fixtureSession),false);
  assert.equal(automining.controller.snapshot(fixtureSession).pve.deployment.automaticAvailable,!late);
  assert.deepEqual(blockedWrites,[]);
  console.log('PASS: real native PVE/combat exports, bank scaling, isolated HP receipt, '+(late?'late cached combat unavailable with mod active':'combat wrapped before native destructured consumers')+'; no writes, ticks or persistent combat/inventory/movement calls.');
}catch(error){console.error(error.stack);console.error('Blocked writes:',blockedWrites);process.exitCode=1;}
