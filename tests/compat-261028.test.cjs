'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.AUTOMINING_NATIVE_ROOT;
if(!root)throw Error('Set AUTOMINING_NATIVE_ROOT to an isolated 261028.1 source fixture');
const file=path.join(root,'server/src/services/mining/miningRuntime.js');
const source=fs.readFileSync(file,'utf8');
const compat=require('../lib/miningCompatibility'),bridge=require('../lib/bridge');

test('261028.1 retains native receipts and cache for both line endings; unknown edits fail closed',()=>{
  for(const newline of ['\n','\r\n']) {
    const text=source.replace(/\r\n/g,'\n').replace(/\n/g,newline);
    assert.equal(compat.supportsMiningSource(text),true);
    assert.equal(compat.prepareMiningSource(text),text);
    new vm.Script(compat.prepareMiningSource(text)+'\n'+bridge);
    assert.equal(compat.supportsMiningSource(text+'\n// unreviewed edit'),false);
    assert.throws(()=>compat.prepareMiningSource(text+'\n// unreviewed edit'),/Unsupported/);
  }
});

test('Launcher preparation refuses a broken mining bridge before reporting login success',()=>{
  const helperFile=path.resolve(__dirname,'../helper.js'),nativeRequire=require('node:module').createRequire(helperFile);
  let migrated=false;
  const context={module:{exports:{}},require(id){
    if(id==='node:fs')return {...fs,readFileSync:()=>source+'\n// drift'};
    if(id==='./lib/statePaths')return {migrateState(){migrated=true;}};
    return nativeRequire(id);
  }};
  vm.runInNewContext(fs.readFileSync(helperFile,'utf8'),context,{filename:helperFile});
  for(const action of ['verify','prepare_profile','install','recover']) {
    assert.throws(()=>context.module.exports.execute({action,runtime:{evejsRoot:root},mod:{}}),/cannot activate/);
  }
  assert.equal(migrated,false);
});

// Execute the actual native function with in-memory authorities. The bridge is
// appended exactly as the loader does; no player DB, world, client or timer runs.
function fixture({npc=false,air=false,grantFails=false,persistent=true,duplicate=false,deltaFails=false,nativeGrid=false}={}) {
  const calls=[],items=[],ledger=[],character={boosters:[],implants:[]};
  const ship={kind:'ship',itemID:10,typeID:100,characterID:42,systemID:300,npc,position:{x:0,y:0,z:0}};
  const rock={kind:'asteroid',itemID:50,typeID:123,position:{x:10,y:0,z:0}};
  const state={remainingQuantity:100,yieldTypeID:123,yieldKind:'ore',unitVolume:1};
  const moduleItem={itemID:20,typeID:200,online:true,flagID:27};
  const skillMap=new Map();
  const snapshot={family:'ore',chargeTypeID:0,miningAmountM3:10,maxRangeMeters:100,
    wasteVolumeMultiplier:1,wasteProbability:0,critChance:0,critQuantityMultiplier:0};
  const scene={systemID:300,staticEntities:[rock],getEntityByID:id=>id===50?rock:null,
    getTargetsForEntity:()=>[50],getEntitySurfaceDistance:()=>10,getPublicGridClusterKeyForEntity:()=> 'belt'};
  if(nativeGrid){
    const topologyFile=path.join(root,'server/src/space/runtime/scene/spatialTopology.js');
    const dependencies={gridBubbles:require(path.join(root,'server/src/space/destiny/visibility/gridBubbles.js')),
      entityID:require(path.join(root,'server/src/space/destiny/identity/entityID.js')),
      abyssalRoomEntity:{isAbyssalRoomEntityAwaitingRelease:()=>false,isAbyssalRoomEntityDeliveryHidden:()=>false},
      runtimeDebugInstrumentation:{logBubbleDebug(){},summarizeBubbleEntity:e=>e.itemID},
      shipCloak:{isEntityCloaked:e=>!!e.cloaked},numbers:require(path.join(root,'server/src/common/numbers'))};
    const topologyContext={module:{exports:{}},__dirname:path.dirname(topologyFile),require(id){
      if(id==='path')return path;const name=path.basename(id).replace(/\.js$/,'');
      if(dependencies[name])return dependencies[name];throw Error('Unexpected topology dependency '+id);
    }};
    vm.runInNewContext(fs.readFileSync(topologyFile,'utf8'),topologyContext,{filename:topologyFile});
    delete scene.getPublicGridClusterKeyForEntity;
    Object.assign(scene,topologyContext.module.exports);
    scene.dynamicEntities=new Map([[ship.itemID,ship]]);
    scene.getEntityByID=id=>Number(id)===50?rock:Number(id)===10?ship:null;
    scene.sessions=new Map([[42,{characterID:42}]]);
    scene.getShipEntityForSession=()=>ship;
    scene.reboxBall(ship);scene.reboxBall(rock);
    Object.assign(ship,{activeModuleEffects:new Map(),lockedTargets:new Map(),pendingTargetLocks:new Map()});
    scene.getTargets=()=>[...ship.lockedTargets.keys()];
    scene.addTarget=(_,id)=>{ship.lockedTargets.set(id,{});return {success:true,data:{pending:false}};};
    scene.activateGenericModule=(_,item,effect,options)=>{
      const active={moduleID:item.itemID,targetID:options.targetID};ship.activeModuleEffects.set(item.itemID,active);
      return {success:true,data:{effectState:active}};
    };
    scene.deactivateGenericModule=(_,id)=>{ship.activeModuleEffects.delete(id);return {success:true};};
    scene.removeTarget=(_,id)=>ship.lockedTargets.delete(id);
    scene.cancelAddTarget=()=>true;scene.stop=()=>true;
    scene.isGlobalBall=()=>false;
  }
  const effect={effectID:67,name:'miningLaser'};
  const grant=(...args)=>{calls.push(['grant',...args]);return grantFails?{success:false}:{success:true,data:{changes:[]}};};
  const cache=require(path.join(root,'server/src/services/mining/shipResourceStateCache'));
  cache._testing.reset();
  const deps={
    numbers:require(path.join(root,'server/src/common/numbers')),
    config:{},logger:{warn(){},debug(){}},dogmaEvents:{queueDogmaEvent(){calls.push(['dogma']);}},
    interactionScope:require(path.join(root,'server/src/space/destiny/identity/interactionScope.js')),
    characterState:{getActiveShipRecord:()=>ship,peekCharacterRecord:()=>character},
    skillState:{getCachedCharacterSkillMap:()=>skillMap},
    itemStore:{ITEM_FLAGS:{CARGO_HOLD:5},grantItemsToCharacterLocation:grant},
    simulationInventoryProjection:{findShipItemById:()=>ship,listContainerItems:()=>items},
    liveFittingState:{getFittedModuleItems:()=>[moduleItem],getLoadedChargeByFlag:()=>null,
      isModuleOnline:item=>item.online,listHiddenModifierItems:()=>[],
      buildShipResourceState:()=>({cargoCapacity:100,generalMiningHoldCapacity:100}),
      getTypeEffectRecords:()=>[effect],getEffectTypeRecord:()=>effect,getTypeAttributeMap:()=>({})},
    itemTypeRegistry:{resolveItemByTypeID:()=>({name:'Veldspar'})},
    shipResourceStateCache:cache,
    miningInventory:{getPreferredMiningHoldFlagForType:()=>134,getShipHoldCapacityByFlag:(_,flag)=>flag===134?100:0},
    miningMath:{computeMiningResult:()=>({normalQuantity:10,wastedQuantity:2,criticalHitQuantity:0,
      rewardedQuantity:10,getTotalTransferredQuantity(){return this.normalQuantity+this.criticalHitQuantity;}})},
    miningDogma:{isMiningEffectRecord:e=>e===effect,resolveMiningFamily:()=> 'ore',buildMiningModuleSnapshot:()=>snapshot},
    commandBurstRuntime:{collectModifierEntriesForItem:()=>[]},wormholeEnvironmentRuntime:{getLocationModifierSourcesForSystem:()=>[]},
    miningRuntimeState:{getMineableState:()=>state,ensureSceneMiningState(){},isMineableStaticEntity:e=>e.kind==='asteroid',
      shouldPersistMineableState:()=>persistent,applyMiningDelta(...args){calls.push(['deplete',...args]);return {success:!deltaFails,data:{depleted:false}};}},
    npcEquipment:{isNativeNpcEntity:e=>!!e.npc,getNpcLoadedChargeForModule:()=>null},
    crystalDurability:require(path.join(root,'server/src/services/dogma/crystalDurability')),
    airMiningSettlement:{isAirRock:()=>air,reconcile(){calls.push(['air-reconcile']);},extract(...args){calls.push(['air-extract',...args]);return {success:true,data:{changes:[]}};}},
    miningCargoCommits:{commit(args){calls.push(['receipt',args]);return {success:!grantFails,duplicate,data:{transferred:10,mined:10,wasted:2,critical:0}};}},
    npcMiningCargo:{refresh(){calls.push(['refresh']);},appendNpcMiningCargoWithReceipt(){calls.push(['npc-grant']);return {success:!grantFails,data:{receipt:{id:'only-this-grant'}}};},
      rollbackNpcMiningCargoGrant(receipt){calls.push(['compensate',receipt]);}},
    miningLedgerState:{recordMiningLedgerEvent:event=>ledger.push(event)},
    dailyGoalsState:{recordActivity(){calls.push(['daily']);}},eventHooks:{trail:{recordMining(){calls.push(['season']);}}},
    achievementRuntime:{recordMining(){calls.push(['achievement']);}},
  };
  const context={module:{exports:{}},__dirname:path.dirname(file),console,require(id){
    if(id==='path')return path;
    return deps[path.basename(id)]||{};
  }};
  vm.runInNewContext(compat.prepareMiningSource(source)+'\n'+bridge,context,{filename:file});
  function run(){return context.module.exports.executeMiningCycle(scene,ship,{targetID:50,moduleID:20},1000,
    {preparedCycle:{moduleItem,snapshot,cycleBoundaryMs:1000}});}
  return {run,calls,items,ship,rock,scene,ledger,cache,api:context.module.exports.__autoMiningBridge};
}

test('native player extraction uses grants/depletion/ledger once and keeps residue, AIR and reward authorities',()=>{
  const f=fixture();assert.equal(f.run().success,true);
  assert.equal(f.calls.filter(c=>c[0]==='grant').length,1);
  const grant=f.calls.find(c=>c[0]==='grant');assert.equal(grant[1],42);assert.equal(grant[3],134);assert.equal(grant[4][0].quantity,10);
  const delta=f.calls.find(c=>c[0]==='deplete');assert.equal(delta[3],10);assert.equal(delta[4],2);
  assert.equal(f.ledger.length,1);assert.equal(f.ledger[0].quantity,10);assert.equal(f.ledger[0].quantityWasted,2);
  for(const name of ['daily','season','achievement'])assert.equal(f.calls.filter(c=>c[0]===name).length,1);
  assert.equal(f.calls.some(c=>c[0]==='receipt'),false);
  const air=fixture({air:true});assert.equal(air.run().success,true);
  assert.equal(air.calls.filter(c=>c[0]==='air-extract').length,1);
  assert.equal(air.calls.some(c=>c[0]==='grant'),false);
});

test('failed player grant cannot deplete ore or record mining statistics',()=>{
  const f=fixture({grantFails:true});assert.equal(f.run().stopReason,'cargo');
  assert.equal(f.calls.some(c=>c[0]==='deplete'),false);assert.equal(f.ledger.length,0);
});

test('new native NPC receipt, duplicate and compensation paths survive bridge injection unchanged',()=>{
  const f=fixture({npc:true});assert.equal(f.run().success,true);
  const commit=f.calls.find(c=>c[0]==='receipt')[1];assert.equal(commit.transferred,10);assert.equal(commit.wasted,2);
  assert.equal(f.calls.find(c=>c[0]==='deplete')[5].committedCargoDelta.transferred,10);assert.equal(f.ledger.length,0);
  const duplicate=fixture({npc:true,duplicate:true});assert.equal(duplicate.run().data.duplicate,true);
  assert.equal(duplicate.calls.some(c=>c[0]==='deplete'),false);
  const fail=fixture({npc:true,grantFails:true});assert.equal(fail.run().success,false);
  assert.equal(fail.calls.some(c=>c[0]==='deplete'),false);
  const compensate=fixture({npc:true,persistent:false,deltaFails:true});assert.equal(compensate.run().success,false);
  assert.equal(compensate.calls.filter(c=>c[0]==='compensate').length,1);
});

test('bridge observes fresh cargo occupancy across cached fitting reads after transfer/compression',()=>{
  const f=fixture();
  const view=()=>f.api.oreHold(f.scene,f.ship,()=>true,1000,95,true);
  assert.equal(view().free,100);
  f.items.push({flagID:134,quantity:96,volume:1});assert.equal(view().free,4);assert.equal(view().full,true);
  f.items[0].volume=0.01;assert.equal(view().free,99.04);assert.equal(view().full,false);
  f.items.length=0;assert.equal(view().free,100);
  assert.equal(f.cache._testing.getStats().builds,1);assert.ok(f.cache._testing.getStats().hits>=4);
});

test('Start with a blank filter survives a real 261028.1 grid lookup and activates mining through the controller',()=>{
  const f=fixture({nativeGrid:true}),errors=[],session=f.scene.sessions.get(42);
  assert.equal(typeof f.scene.getPublicGridClusterKeyForEntity,'undefined');
  const controller=require('../lib/controller').createController(()=>f.api,()=>({getSceneForSession:()=>f.scene}),e=>errors.push(e),
    {get:()=>({job:'mining',ores:[],approach:false,mineDrones:false,launchDrones:false}),save(){}},null,null,null,null);
  controller.command(session,{action:'on'});
  assert.equal(controller.snapshot(session).enabled,true);
  controller.tick(f.scene,1000);
  assert.deepEqual(errors,[],'The real scene must not trigger the exception -> OFF path');
  assert.equal(controller.snapshot(session).enabled,true);
  assert.equal(f.ship.activeModuleEffects.get(20)?.targetID,50);
  assert.equal(f.run().success,true);assert.equal(f.ledger[0].quantity,10);
  controller.tick(f.scene,2000);
  assert.equal(controller.snapshot(session).enabled,true);assert.deepEqual(errors,[]);
});

test('native bubbles, rather than partition boxes, determine resource membership and removal',()=>{
  const f=fixture({nativeGrid:true});
  f.ship.position.x=7864319;f.scene.reboxBall(f.ship);
  f.rock.position.x=7864321;f.scene.reboxBall(f.rock);
  assert.notEqual(f.scene.getPublicGridKeyForEntity(f.ship),f.scene.getPublicGridKeyForEntity(f.rock));
  assert.equal(f.scene.getGridBubbleIDForEntity(f.ship),f.scene.getGridBubbleIDForEntity(f.rock));
  assert.equal(f.api.candidates(f.scene,f.ship).length,1);
  f.rock.position.x=7864320*5;f.scene.reboxBall(f.rock);
  assert.notEqual(f.scene.getGridBubbleIDForEntity(f.ship),f.scene.getGridBubbleIDForEntity(f.rock));
  assert.equal(f.api.candidates(f.scene,f.ship).length,0);
  f.scene.removeBallFromGridBubbles(f.ship);
  assert.equal(f.api.surveyGrid(f.scene,f.ship),null,'Removed balls have no active native bubble');
});

test('native grid membership retains AIR/Abyssal isolation, shared dungeon resources and targetability eligibility',()=>{
  const f=fixture({nativeGrid:true});
  assert.equal(f.api.candidates(f.scene,f.ship).length,1);
  Object.assign(f.rock,{airNpeOwnerCharacterID:99,airNpeOperationID:1,airNpeInstanceID:2});
  assert.equal(f.api.candidates(f.scene,f.ship).length,0);
  assert.equal(f.api.target(f.scene,f.ship,50),null);
  for(const key of ['airNpeOwnerCharacterID','airNpeOperationID','airNpeInstanceID'])delete f.rock[key];
  Object.assign(f.rock,{dungeonSiteInstanceID:99,dungeonRoomKey:'private-room'});
  assert.equal(f.api.candidates(f.scene,f.ship).length,1,'Native ordinary dungeon rocks are shared content, not an AIR owner pocket');
  f.rock.entityInteractionScopeInvalid=true;
  assert.equal(f.api.candidates(f.scene,f.ship).length,0,'Invalid native scope still fails closed');
  delete f.rock.entityInteractionScopeInvalid;
  delete f.rock.dungeonSiteInstanceID;delete f.rock.dungeonRoomKey;
  Object.assign(f.rock,{abyssalRunID:99,abyssalRoomIndex:1});
  assert.equal(f.api.candidates(f.scene,f.ship).length,0);
  delete f.rock.abyssalRunID;delete f.rock.abyssalRoomIndex;
  f.rock.airMiningTargetable=false;
  assert.equal(f.api.candidates(f.scene,f.ship).length,0);
  assert.equal(f.api.miningSite(f.scene,f.ship),false);
});

test('an empty native grid waits with a blank filter instead of switching the job OFF',()=>{
  const f=fixture({nativeGrid:true}),errors=[],session=f.scene.sessions.get(42);
  f.scene.removeBallFromGridBubbles(f.rock);
  const controller=require('../lib/controller').createController(()=>f.api,()=>({getSceneForSession:()=>f.scene}),e=>errors.push(e),
    {get:()=>({job:'mining',ores:[],approach:false,mineDrones:false,launchDrones:false}),save(){}},null,null,null,null);
  controller.command(session,{action:'on'});controller.tick(f.scene,1000);
  assert.deepEqual(errors,[]);assert.equal(controller.snapshot(session).enabled,true);
  assert.equal(f.ship.activeModuleEffects.size,0);
  assert.match(controller.snapshot(session).status,/Waiting/);
});
