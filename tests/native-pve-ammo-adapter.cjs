"use strict";
// Reuse the reader-role, filesystem-write-denial and native logger guard.
// Handler fixtures below execute real native bodies over isolated fake rows;
// no native persistent inventory, session, world or movement is changed.
require('./native-ore-adapter.cjs');
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const root=process.argv[2],load=p=>require(path.join(root,'server/src',p));
const types=load('services/inventory/itemTypeRegistry.js'),fit=load('services/fitting/liveFittingState.js'),weapon=load('space/combat/weaponDogma.js'),
  Dogma=load('services/dogma/dogmaService.js'),Broker=load('services/inventory/invBrokerService.js'),items=load('services/inventory/itemStore.js');
const rows=types.listItemTypes(),rail=rows.find(r=>r.name==='125mm Railgun I'),ammo=rows.find(r=>r.name==='Antimatter Charge S'),large=rows.find(r=>r.name==='Antimatter Charge L');
assert.ok(rail&&ammo&&large);assert.equal(weapon.resolveWeaponFamily(rail),'hybridTurret');
assert.equal(fit.isChargeCompatibleWithModule(rail.typeID,ammo.typeID),true);assert.equal(fit.isChargeCompatibleWithModule(rail.typeID,large.typeID),false);
assert.ok(fit.getModuleChargeGroupIDs(rail.typeID).has(ammo.groupID));assert.ok(fit.getModuleChargeCapacity(rail.typeID,ammo.typeID)>1);
assert.equal(typeof Dogma._testing.getPendingModuleReloads,'function');assert.equal(typeof Dogma.prototype.Handle_LoadAmmo,'function');
const noop=()=>{},log=new Proxy({},{get:()=>noop}),session={characterID:900000001,shipID:900000010,stationID:900000020};
// Exercise the exact factory binding shim with the real native bind/capacity
// bodies, supplying only isolated ship lookup and capacity inputs.
let bound=null;
const record={itemID:session.shipID,locationID:session.stationID,ownerID:session.characterID};
const bindGlobals={log,Number,Boolean,ITEM_FLAGS:items.ITEM_FLAGS,findCharacterShip:()=>record,findShipItemById:()=>record,findItemById:()=>record,
  describeSessionHydrationState:()=> 'isolated',throwWrappedUserError:key=>{throw Error(key);}};
const bind=vm.runInNewContext('({'+Broker.prototype.Handle_GetInventoryFromId.toString()+'}).Handle_GetInventoryFromId',bindGlobals);
const shim=Object.create(Broker.prototype);shim._boundContexts=new Map();shim._getBoundContext=()=>bound;shim._makeBoundSubstruct=value=>{bound=value;return value;};
for(const name of ['_getCorporationOffice','_getNativeWreckRecord','_getStructureForInventoryID','_getCorporationOfficeDivisionAncestorContext','_getSpaceContainerScopeAccessError','_getMobileTractorUnitCargoAccessError'])shim[name]=()=>null;
shim._isControlledStructureInventoryID=()=>false;shim._getCharacterId=()=>session.characterID;shim._getStationId=()=>session.stationID;shim._getShipId=()=>session.shipID;shim._traceInventory=noop;
bind.call(shim,[session.shipID],session,{});
assert.equal(bound.inventoryID,session.shipID);assert.equal(bound.kind,'shipInventory');assert.equal(bound.locationID,session.stationID);assert.equal(bound.flagID,5);
shim._ensureSecureContainerGeneralAccess=noop;shim._calculateCapacity=(sess,context,flag)=>{assert.equal(context,bound);assert.equal(flag,5);return shim._buildCapacityInfo(50,12);};
const capacity=vm.runInNewContext('({'+Broker.prototype.Handle_GetCapacity.toString()+'}).Handle_GetCapacity',{log,String,JSON});
assert.deepEqual(Object.fromEntries(capacity.call(shim,[5],session,{}).args.entries),{capacity:50,used:12});
let nativeMoveCount=0,allowed=true;
const source={itemID:900000030,ownerID:session.characterID,typeID:ammo.typeID,locationID:session.stationID,flagID:4,quantity:50,singleton:0};
let cargo=null;
const move={_traceInventory:noop,_getBoundContext:()=>({inventoryID:session.shipID}),_normalizeInventoryId:(v,d)=>Number(v)||d,
  _extractKwarg:(k,n)=>k[n],_normalizeQuantityArg:v=>v,_findTransferSourceItem:()=>({item:source}),_isTransferSourceLocationMatch:()=>true,
  _getPendingStructureUnanchorContainerAncestor:()=>null,_getAuthoritativeTransferSourceContainerIDs:()=>[],_canTakeFromCorporationHangarSourceAncestry:()=>allowed,
  _resolveDestinationForMove:()=>({locationID:session.shipID,flagID:5}),_getShipInventoryRecord:()=>({itemID:session.shipID}),
  _tryLoadChargeFromInventoryAdd:()=>({handled:false}),_listFittedItemsForFitHost:()=>[],_getAuthoritativeTransferSourceLocationID:()=>session.stationID,
  _resolveAppliedMoveQuantity:(row,dest,q)=>q,_checkCapacityForMove:()=>({success:true}),_isStructureCoreInstallMove:()=>false,
  _isMtuSpaceComponentLootMove:()=>false,_isPlayerSpaceContainerLootMove:()=>false,_resolveShipModuleFitOnlineChanges:()=>[],
  _moveSourceItemToDestination:(sess,descriptor,destination,q)=>{nativeMoveCount++;source.quantity-=q;cargo={...source,itemID:900000031,locationID:session.shipID,flagID:5,quantity:q};return {success:true,data:{changes:[]}};},
  _resolveMovedItemID:()=>cargo.itemID};
const proxy=new Proxy(move,{get:(o,key)=>key in o?o[key]:String(key).startsWith('_validate')||key==='_evaluatePlayerSpaceContainerLootMove'||key==='_syncStructureServiceModuleMove'?()=>({success:true}):noop});
const addGlobals={log,Number,Set,Array,JSON,ITEM_FLAGS:items.ITEM_FLAGS,SLOT_FAMILY_FLAGS:{rig:[]},starbaseInventoryRuntime:{isStarbaseStorage:()=>false},
  isDirectSpaceUnanchoredStructureHullInventoryRecord:()=>false,isShipFittingFlag:()=>false,maybeExpireEmptySpaceContainer:noop,
  buildCrpAccessDeniedInsufficientRolesValues:()=>({}),throwWrappedUserError:key=>{throw Error(key);}};
const nativeAdd=vm.runInNewContext('({'+Broker.prototype.Handle_Add.toString()+'}).Handle_Add',addGlobals);
assert.equal(nativeAdd.call(proxy,[source.itemID,source.locationID],session,{flag:5,qty:8}),900000031);
assert.equal(source.quantity,42);assert.equal(cargo.quantity,8);assert.equal(nativeMoveCount,1);
allowed=false;assert.throws(()=>nativeAdd.call(proxy,[source.itemID,source.locationID],session,{flag:5,qty:1}),/CrpAccessDenied/);assert.equal(nativeMoveCount,1);

const fitted=[{...rail,itemID:900000100,ownerID:session.characterID,locationID:session.shipID,flagID:27},
  {...rail,itemID:900000101,ownerID:session.characterID,locationID:session.shipID,flagID:28}],loaded=new Map();
const dogmaGlobals={log,Number,Math,Array,ITEM_FLAGS:items.ITEM_FLAGS,GROUP_SCAN_PROBE_LAUNCHER:-1,
  normalizeAmmoLoadRequests:ids=>ids,summarizeAmmoLoadRequests:()=> 'isolated',findItemById:id=>fitted.find(m=>m.itemID===id)||(cargo.itemID===id?cargo:null),
  getLoadedChargeByFlag:(owner,id,flag)=>loaded.get(flag),isChargeCompatibleWithModule:fit.isChargeCompatibleWithModule,getModuleChargeCapacity:fit.getModuleChargeCapacity,
  isDockedSession:s=>!!s.stationID,
  moveItemToLocation:(id,location,flag,q)=>{cargo.quantity-=q;loaded.set(flag,{...ammo,itemID:900000200+flag,quantity:q,locationID:location,flagID:flag});return {success:true,data:{changes:[]}};},
  mergeItemStacks:(id,target,q)=>{cargo.quantity-=q;const row=[...loaded.values()].find(r=>r.itemID===target);row.quantity+=q;return {success:true,data:{changes:[]}};}};
const nativeLoad=vm.runInNewContext('({'+Dogma.prototype.Handle_LoadAmmo.toString()+'}).Handle_LoadAmmo',dogmaGlobals);
const handlers={_getShipID:()=>session.shipID,_resolveAmmoLocationID:id=>id,_getCharID:()=>session.characterID,_getDogmaInventoryOwnerID:()=>session.characterID,
  _expandGroupedModuleIDs:()=>fitted.map(m=>m.itemID),_resolveRequestedAmmoTypeID:()=>ammo.typeID,
  _resolveAmmoSourceStacks:()=>[cargo],_getModuleReloadTimeMs:()=>5000,
  _captureChargeStateSnapshot:(owner,id,flag)=>({quantity:loaded.get(flag)?.quantity||0}),_captureChargeItemSnapshot:(owner,id,flag)=>loaded.get(flag)};
const nativeService=new Proxy(handlers,{get:(o,key)=>key in o?o[key]:noop});
assert.equal(nativeLoad.call(nativeService,[session.shipID,[fitted[0].itemID],[cargo.itemID],session.shipID],session),null);
assert.equal(cargo.quantity,0);assert.equal([...loaded.values()].reduce((n,r)=>n+r.quantity,0),8);
assert.equal(typeof load('services/drone/droneDogma.js').resolveDroneCombatSnapshot,'function');
assert.equal(typeof load('_secondary/fitting/fittingRuntime.js').getShipFittingSnapshot,'function');
console.log('PASS: actual native ammo group/size/capacity policy plus synchronous native Add/LoadAmmo bodies on isolated rows, grouped cargo-to-loaded receipt, ancestry denial; no persistent handlers or world invoked.');
