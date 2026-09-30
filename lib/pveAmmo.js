"use strict";
const path=require("node:path");
const idOf=s=>Number(s?.characterID||s?.charid||0),shipOf=s=>Number(s?.shipID||s?.shipid||0);
const dockOf=s=>Number(s?.structureID||s?.structureid||s?.stationID||s?.stationid||0);
const families=new Set(["laserTurret","hybridTurret","projectileTurret","precursorTurret","missileLauncher","vortonProjector"]);
const supportedFamilies=new Set(["laserTurret","hybridTurret","projectileTurret","precursorTurret","missileLauncher"]);
const quantity=r=>Number(r?.singleton)>0?1:Math.max(0,Math.floor(Number(r?.quantity??r?.stacksize)||0));
const usable=r=>quantity(r)>0&&Number(r?.moduleState?.damage||0)<1;
const status={ready:"PVE ammunition is ready.",missing:"PVE ammunition needs compatible charges.",reload:"Reloading PVE ammunition.",
  stock:"PVE ammunition source is short of stock.",capacity:"PVE ammunition cargo capacity reached.",source:"PVE ammunition source is unavailable.",receipt:"PVE ammunition transfer could not be confirmed."};

// Fitting discovery and receipts are read-only. Restock/reload use the same
// native permission and charge operations as a manual inventory/module action.
function createPVEAmmo({root,destinations,clock=Date.now,native=null}) {
  let runtime,chargeIndex;const catalogs=new Map();
  function deps() {
    if(native)return native;if(runtime)return runtime;
    const load=p=>require(path.join(root,"server/src",p)),fit=load("services/fitting/liveFittingState.js"),
      dogma=load("space/runtime/entityDogmaView.js"),weapon=load("space/combat/weaponDogma.js"),group=load("services/moduleGrouping/moduleGroupingRuntime.js"),
      types=load("services/inventory/itemTypeRegistry.js"),items=load("services/inventory/itemStore.js"),Broker=load("services/inventory/invBrokerService.js"),
      Dogma=load("services/dogma/dogmaService.js"),drone=load("services/drone/droneDogma.js"),fitting=load("_secondary/fitting/fittingRuntime.js"),
      snapshot=load("space/runtime/weaponSnapshot.js"),auto=load("space/runtime/autoTargetingMissiles.js");
    function broker(session,id) {
      const b=Object.create(Broker.prototype);b._boundContexts=new Map();let context=null;
      b._getBoundContext=()=>context;b._makeBoundSubstruct=value=>{context=value;return value;};
      b.Handle_GetInventoryFromId([id],session,{});return b;
    }
    // Avoid constructors: native observers belong to their original services.
    const service=Object.create(Dogma.prototype);
    runtime={types:()=>types.listItemTypes(),type:id=>types.resolveItemByTypeID(id),fitted:ship=>dogma.getEntityRuntimeFittedItems(ship),
      ship:(session,ship)=>dogma.getEntityRuntimeShipItem(ship),online:fit.isModuleOnline,family:weapon.resolveWeaponFamily,
      groups:type=>fit.getModuleChargeGroupIDs(type),compatible:fit.isChargeCompatibleWithModule,capacity:fit.getModuleChargeCapacity,
      optional:weapon.isChargeOptionalTurretWeapon,master:(ship,module)=>group.getMasterModuleID(ship,module)||module,
      loaded:(ship,module)=>dogma.getEntityRuntimeLoadedCharge(ship,module),pending:id=>Dogma._testing.getPendingModuleReloads().has(id),
      list:(session,id,flag,all=false,ownerID=idOf(session))=>items.listContainerItems(all?null:ownerID,id,flag),
      capacityCargo:(session,id)=>Object.fromEntries(broker(session,id).Handle_GetCapacity([5],session,{}).args.entries),
      move:(session,ship,source,row,qty)=>broker(session,ship).Handle_Add([row.itemID,source.locationID],session,{flag:5,qty}),
      load:(session,ship,master,charge)=>service.Handle_LoadAmmo([ship,[master],[charge],ship],session),
      offensiveUsable:(ship,module,charge)=>{
        const value=snapshot.buildWeaponSnapshotForEntity(ship,module,charge);
        return value&&supportedFamilies.has(value.family)&&!value.isDefenderMissile&&!auto.isAutoTargetingMissileCharge(charge)&&
          Object.values(value.rawShotDamage||{}).some(n=>Number(n)>0);
      },activeDrones:(session,ship,ids)=>{
        const scene=load("space/runtime.js").getSceneForSession(session),droneRuntime=load("services/drone/droneRuntime.js");
        return ids.map(id=>scene?.getEntityByID(id)).filter(e=>droneRuntime.isDroneEntity(e)&&Number(e.ownerID)===idOf(session)&&Number(e.controllerID)===ship.itemID);
      }};
    runtime.droneUsable=(session,ship,row)=>{
      if(Number(row.categoryID||types.resolveItemByTypeID(row.typeID)?.categoryID)!==18)return false;
      const snapshot=drone.resolveDroneCombatSnapshot(row,ship);
      if(!snapshot||Object.values(snapshot.rawShotDamage||{}).reduce((n,v)=>n+Math.max(0,Number(v)||0),0)<=0)return false;
      const attributes=fitting.getShipFittingSnapshot(idOf(session),ship.itemID,{shipItem:dogma.getEntityRuntimeShipItem(ship)}).shipAttributes||{};
      return Number(attributes[fit.getAttributeIDByNames("maxActiveDrones")])>0&&
        Number(attributes[fit.getAttributeIDByNames("droneBandwidth")])>=Math.max(0,fit.getTypeAttributeValue(row.typeID,"droneBandwidthUsed"));
    };
    return runtime;
  }
  function identity(session,ship) {
    if(!(idOf(session)>0)||!ship||Number(ship.itemID)!==shipOf(session))return false;
    const record=deps().ship(session,ship);
    return record&&Number(record.itemID)===shipOf(session)&&Number(record.ownerID)===idOf(session)&&
      (!dockOf(session)||Number(record.locationID)===dockOf(session));
  }
  function catalog(ship) {
    const n=deps(),fitted=n.fitted(ship).filter(item=>families.has(n.family(item)));
    const signature=ship.itemID+":"+fitted.map(item=>[item.itemID,item.typeID,item.flagID,n.online(item),n.master(ship.itemID,item.itemID)].join(":")).sort().join("|");
    if(catalogs.has(signature))return catalogs.get(signature);
    if(!chargeIndex) {
      chargeIndex=new Map();
      for(const type of n.types())if(Number(type.categoryID)===8&&type.published!==false) {
        if(!chargeIndex.has(Number(type.groupID)))chargeIndex.set(Number(type.groupID),[]);
        chargeIndex.get(Number(type.groupID)).push(type);
      }
    }
    const rows=new Map(),modules=[];
    for(const item of fitted) {
      const compatible=[];
      for(const groupID of n.groups(item.typeID))for(const type of chargeIndex.get(Number(groupID))||[])if(n.compatible(item.typeID,type.typeID)) {
        compatible.push(Number(type.typeID));
        rows.set(Number(type.typeID),{typeID:Number(type.typeID),name:String(type.name||type.typeID),reusable:n.family(item)==="laserTurret"});
      }
      modules.push({item,compatible:compatible.sort((a,b)=>a-b),optional:n.optional(item),master:Number(n.master(ship.itemID,item.itemID)),online:n.online(item),supported:supportedFamilies.has(n.family(item))});
    }
    const result={signature,modules,rows:[...rows.values()].sort((a,b)=>a.typeID-b.typeID)};
    if(catalogs.size>=64)catalogs.delete(catalogs.keys().next().value);catalogs.set(signature,result);return result;
  }
  function cargo(session,ship) {return deps().list(session,ship.itemID,5).filter(usable);}
  function sourceItems(session,source){return deps().list(session,source.locationID,source.kind==="container"?null:source.flagID,source.kind==="container",source.ownerID);}
  const count=(rows,id)=>rows.filter(r=>Number(r.typeID)===Number(id)).reduce((sum,r)=>sum+quantity(r),0);
  function inspect(session,s,ship) {
    if(!identity(session,ship))return {items:[],sourceKey:s.pveAmmoSourceKey||"personal",sourceLabel:"",stationID:dockOf(session),ready:false,missing:[],status:status.missing,reason:"missing"};
    const n=deps(),fit=catalog(ship),stock=cargo(session,ship),loaded=[],missing=[],banks=new Map();let gunReady=false;
    for(const entry of fit.modules) {
      const charge=n.loaded(ship,entry.item);if(usable(charge))loaded.push(charge);
      if(entry.online&&entry.supported&&(entry.optional||usable(charge)&&entry.compatible.includes(Number(charge.typeID)))&&
        (!n.offensiveUsable||n.offensiveUsable(ship,entry.item,charge)))gunReady=true;
      if(entry.online&&entry.supported&&!entry.optional) {
        if(!banks.has(entry.master))banks.set(entry.master,[]);banks.get(entry.master).push({...entry,charge});
        if(!usable(charge)||!entry.compatible.includes(Number(charge.typeID)))missing.push(Number(entry.item.itemID));
      }
    }
    const dronesReady=droneReady(session,s,ship),ready=gunReady||dronesReady,pending=fit.modules.some(entry=>entry.online&&n.pending(entry.item.itemID));
    return {fit,stock,banks,items:fit.rows.map(row=>({...row,loaded:count(loaded,row.typeID),cargo:count(stock,row.typeID),target:Number(s.pveAmmoTargets?.[row.typeID])||0})),
      sourceKey:s.pveAmmoSourceKey||"personal",sourceLabel:s.pveAmmoSourceLabelKey===s.pveAmmoSourceKey?s.pveAmmoSourceLabel||"":"",stationID:dockOf(session),ready,gunReady,dronesReady,pending,missing,
      status:pending?status.reload:missing.length||!ready?status.missing:status.ready,reason:pending?"reload":missing.length||!ready?"missing":"ready"};
  }
  function view(session,s,ship) {
    const result=inspect(session,s,ship);delete result.fit;delete result.stock;delete result.banks;
    if(s.pveAmmoReason&&s.pveAmmoReason!=="ready") {result.reason=s.pveAmmoReason;result.status=status[result.reason]||status.missing;}
    if(result.pending){result.reason="reload";result.status=status.reload;}
    result.ready=result.ready&&!result.pending&&!["reload","receipt","source"].includes(result.reason);
    return result;
  }
  function reload(session,s,ship,current) {
    const n=deps();s.pveAmmoChoices||={shipID:ship.itemID,types:{}};
    if(s.pveAmmoChoices.shipID!==ship.itemID)s.pveAmmoChoices={shipID:ship.itemID,types:{}};
    let waiting=false;let changed=0;
    for(const [master,entries] of current.banks) {
      const nativeTypes=[...new Set(entries.map(e=>Number(e.charge?.typeID)||0).filter(id=>id>0))];
      if(nativeTypes.length>1)continue; // Preserve a manually mixed bank.
      const selected=nativeTypes[0]||Number(ship.activeModuleEffects?.get(master)?.chargeTypeID)||s.pveAmmoChoices.types[master]||
        entries[0].compatible.find(id=>Number(s.pveAmmoTargets?.[id])>0&&current.stock.some(row=>Number(row.typeID)===id));
      if(nativeTypes[0])s.pveAmmoChoices.types[master]=nativeTypes[0];
      if(!selected||!entries.every(e=>e.compatible.includes(selected)))continue;
      if(entries.some(e=>n.pending(e.item.itemID))){waiting=true;continue;}
      if(entries.every(e=>usable(e.charge)&&quantity(e.charge)>=n.capacity(e.item.typeID,selected)))continue;
      if(entries.some(e=>ship.activeModuleEffects?.has(e.item.itemID)||ship.activeModuleEffects?.has(master)))continue;
      const source=current.stock.find(row=>Number(row.typeID)===selected);if(!source)continue;
      n.load(session,ship.itemID,master,source.itemID);s.pveAmmoChoices.types[master]=selected;
      if(entries.some(e=>n.pending(e.item.itemID)))waiting=true;
      if(++changed>=8)break;
    }
    return waiting;
  }
  function restock(session,s,ship,current) {
    if(s.pveAmmoRestock===false||!current.items.some(row=>row.target>row.cargo))return null;
    let source;
    try{source=destinations.storage(session,dockOf(session),s.pveAmmoSourceKey||"personal");}
    catch{return "source";}
    s.pveAmmoSourceLabel=source.label;s.pveAmmoSourceLabelKey=s.pveAmmoSourceKey;
    const n=deps();let moves=0,reason=null;
    for(const target of current.items.filter(row=>row.target>row.cargo)) {
      // Revalidate ancestry and query access on every bounded native transfer.
      let needed=target.target-count(cargo(session,ship),target.typeID);
      const rows=sourceItems(session,source)
        .filter(row=>Number(row.typeID)===target.typeID&&usable(row)).sort((a,b)=>Number(a.itemID)-Number(b.itemID));
      if(!rows.length){reason||="stock";continue;}
      for(const row of rows) {
        if(needed<=0)break;if(moves>=16)return reason||"reload";
        if(!identity(session,ship)||!dockOf(session))return "source";
        try{destinations.storage(session,dockOf(session),source.key,source);}catch{return "source";}
        const capacity=n.capacityCargo(session,ship.itemID),volume=Number(n.type(target.typeID)?.volume);
        if(!(volume>0)||!Number.isFinite(capacity.capacity)||!Number.isFinite(capacity.used))return "capacity";
        const qty=Math.min(needed,quantity(row),row.singleton?1:Infinity,Math.max(0,Math.floor((capacity.capacity-capacity.used+1e-8)/volume)));
        if(!qty){reason="capacity";break;}
        const beforeCargo=count(cargo(session,ship),target.typeID),beforeSource=count(sourceItems(session,source).filter(usable),target.typeID);
        try{n.move(session,ship.itemID,source,row,qty);}catch{return "source";}
        const gained=count(cargo(session,ship),target.typeID)-beforeCargo,
          removed=beforeSource-count(sourceItems(session,source).filter(usable),target.typeID);
        if(gained!==qty||removed!==qty)return "receipt";
        needed-=qty;moves++;
        if(needed>0&&qty<Math.min(quantity(row)+qty,row.singleton?1:Infinity))reason="capacity";
      }
      if(needed>0)reason||="stock";
    }
    return reason;
  }
  function tick(session,s,scene,ship) {
    if(!s.enabled||s.job!=="pve")return view(session,s,ship);
    const signature=JSON.stringify([shipOf(session),dockOf(session),s.pveAmmoRestock,s.pveAmmoSourceKey,s.pveAmmoTargets]);
    if(s.pveAmmoUpdate?.signature===signature&&clock()-s.pveAmmoUpdate.at<5000)return view(session,s,ship);
    s.pveAmmoUpdate={signature,at:clock()};s.pveAmmoReason=null;
    if(!identity(session,ship))return view(session,s,ship);
    const inSpace=!dockOf(session);
    if(inSpace&&(!scene||scene.getShipEntityForSession(session)!==ship||ship.pendingWarp||ship.mode==="WARP"||ship.pendingDock||ship.cloaked))return view(session,s,ship);
    let current=inspect(session,s,ship),waiting=reload(session,s,ship,current);
    if(dockOf(session)) {
      // Loading first makes targets refer to actual cargo stock, independent of
      // rounds consumed by topping up already loaded banks.
      current=inspect(session,s,ship);s.pveAmmoReason=restock(session,s,ship,current);
      current=inspect(session,s,ship);waiting=reload(session,s,ship,current)||waiting;
      // Empty banks may have consumed the initial stock; restore the cargo
      // target on the next bounded tick before releasing standby readiness.
      if(current.items.some(row=>row.target>count(cargo(session,ship),row.typeID)))s.pveAmmoReason||="reload";
    }
    if(waiting)s.pveAmmoReason||="reload";
    return view(session,s,ship);
  }
  function ready(session,s,ship) {
    const current=inspect(session,s,ship);
    return current.ready&&!current.pending&&!["reload","receipt","source"].includes(s.pveAmmoReason);
  }
  function selectDrones(session,s,payload) {
    if(!payload||payload.shipID!==shipOf(session)||typeof payload.groupKey!=="string"||payload.groupKey!==s.pveDroneGroupKey||
      !Array.isArray(payload.ids)||payload.ids.length>256||payload.ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error("Invalid PVE action.");
    s.pveAmmoDroneGroup={shipID:payload.shipID,groupKey:payload.groupKey,ids:[...new Set(payload.ids)]};
    return true;
  }
  function droneReady(session,s,ship) {
    const group=s.pveAmmoDroneGroup;
    if(!s.pveDronesEnabled||!s.pveDroneGroupKey||!group||group.shipID!==ship.itemID||group.groupKey!==s.pveDroneGroupKey)return false;
    const active=deps().activeDrones?.(session,ship,[...(s.pveManagedDroneIDs||[])])||[];
    return active.some(row=>deps().droneUsable?.(session,ship,row)===true)||
      deps().list(session,ship.itemID,87).some(row=>group.ids.includes(Number(row.itemID))&&usable(row)&&deps().droneUsable?.(session,ship,row)===true);
  }
  return {tick,view,ready,selectDrones};
}
module.exports={createPVEAmmo};
