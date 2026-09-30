"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHaulDestinations } = require("../lib/haulDestinations");
function fixture() {
  const office={officeID:777,stationID:600,impounded:false};const allowed=new Set([116]);
  const rows=[
    {itemID:8,typeID:12,ownerID:99,locationID:777,flagID:116,singleton:1,itemName:"Corp ore box"},
    {itemID:9,typeID:12,ownerID:99,locationID:8,flagID:0,singleton:1,itemName:"Inner box"},
    {itemID:10,typeID:12,ownerID:99,locationID:777,flagID:117,singleton:1,itemName:"Hidden box"},
    {itemID:11,typeID:12,ownerID:99,locationID:777,flagID:116,singleton:0},
    {itemID:12,typeID:12,ownerID:42,locationID:777,flagID:116,singleton:1},
    {itemID:20,typeID:100,ownerID:42,locationID:8,flagID:0,quantity:10},
    {itemID:21,typeID:100,ownerID:99,locationID:8,flagID:0,quantity:20},
    {itemID:22,typeID:100,ownerID:100,locationID:8,flagID:0,quantity:30},
  ];
  class Broker { constructor(){assert.fail("Read-only discovery must not register inventory observer");} _canQueryCorporationHangarFlag(_,flag){return allowed.has(flag);} }
  const modules={
    "worldData.js":{ensureLoaded:()=>({stationsById:new Map([[600,{stationID:600,solarSystemID:30}]]),solarSystemsById:new Map()})},
    "itemStore.js":{listContainerItems:(owner,location,flag)=>rows.filter(row=>(owner==null||row.ownerID===owner)&&row.locationID===location&&(flag==null||row.flagID===flag))},
    "corporationRuntimeState.js":{getCorporationOffices:()=>[office],getCorporationDivisionNames:()=>({2:"Ore",3:"Other"})},
    "invBrokerService.js":Broker,"itemTypeRegistry.js":{resolveItemByTypeID:()=>({name:"Cargo box"})},
    "cargoContainerRuntime.js":{isCargoContainerType:item=>item.typeID===12},"structureState.js":{}
  };
  return {d:createHaulDestinations("",file=>modules[path.basename(file)]),session:{characterID:42,corporationID:99},office,allowed,rows};
}
test("discovers only assembled corporation containers under queryable nonimpounded division ancestry",()=>{
  const f=fixture();const options=f.d.storages(f.session,600);
  assert.deepEqual(options.map(row=>row.key),["personal","corp:777:116","corpcontainer:777:116:8","corpcontainer:777:116:8:9"]);
  const inner=options.at(-1);assert.equal(inner.kind,"container");assert.equal(inner.ownerID,99);
  assert.deepEqual(inner.ancestry,{corporationID:99,officeID:777,stationID:600,divisionFlagID:116,containerIDs:[8,9]});
  assert.equal(f.d.storage(f.session,600,inner.key,inner).locationID,9);
});
test("moving container, removing query role, or impounding office invalidates saved selection",()=>{
  const f=fixture();const selected=f.d.storage(f.session,600,"corpcontainer:777:116:8:9");
  f.rows[1].locationID=777;f.rows[1].flagID=116;
  assert.throws(()=>f.d.storage(f.session,600,selected.key,selected),/no longer available/);
  f.allowed.clear();assert.throws(()=>f.d.storage(f.session,600,"corpcontainer:777:116:8"),/no longer available/);
  f.allowed.add(116);f.office.impounded=true;assert.deepEqual(f.d.storages(f.session,600).map(row=>row.key),["personal"]);
});
test("container totals follow native owner-blind inventory semantics for mixed custody owners",()=>{
  const f=fixture();const selected=f.d.storage(f.session,600,"corpcontainer:777:116:8");
  assert.deepEqual(f.d.totals(selected),{100:60});
  assert.throws(()=>f.d.storage(f.session,600,selected.key,{...selected,ancestry:{...selected.ancestry,containerIDs:[500,8]}}),/no longer available/);
});

test("fleet hangar receipts include other depositors while mining hold stays pilot scoped",()=>{
  const f=fixture();
  f.rows.push({itemID:30,typeID:100,ownerID:42,locationID:900,flagID:155,quantity:10},
    {itemID:31,typeID:100,ownerID:99,locationID:900,flagID:155,quantity:20},
    {itemID:32,typeID:100,ownerID:42,locationID:900,flagID:134,quantity:30},
    {itemID:33,typeID:100,ownerID:99,locationID:900,flagID:134,quantity:40});
  assert.deepEqual(f.d.cargo(f.session,900,155).map(row=>row.itemID),[30,31]);
  assert.deepEqual(f.d.cargo(f.session,900,134).map(row=>row.itemID),[32]);
});
