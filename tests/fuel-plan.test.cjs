"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHaulDestinations } = require("../lib/haulDestinations");
function fixture() {
  const rows = [{ itemID: 1, typeID: 16272, quantity: 100, ownerID: 42, locationID: 600, flagID: 4 }];
  const cap = { 133: {capacity: 50,used:10}, 5: {capacity:100,used:20} };
  class Broker {
    Handle_GetInventoryFromId() { return this._makeBoundSubstruct({inventoryID:10,kind:"shipInventory"}); }
    Handle_GetCapacity([flag]) { return {args:{entries:Object.entries(cap[flag])}}; }
  }
  const modules = {
    "worldData.js": {ensureLoaded:()=>({stationsById:new Map([[600,{stationID:600,solarSystemID:30}]]),solarSystemsById:new Map()})},
    "itemStore.js": {listContainerItems:(owner,id,flag)=>rows.filter(row=>row.ownerID===owner&&row.locationID===id&&(flag==null||row.flagID===flag))},
    "corporationRuntimeState.js": {getCorporationOffices:()=>[]},
    "invBrokerService.js": Broker,
    "itemTypeRegistry.js": {resolveItemByTypeID:()=>({volume:1})},
    "cargoContainerRuntime.js": {isCargoContainerType:()=>false}, "structureState.js": {}
  };
  const d=createHaulDestinations("", file=>modules[file.split(/[\\/]/).at(-1)]);
  const session={characterID:42};
  const fuel={stationID:600,storageKey:"personal",typeID:16272,targetUnits:80,reserveUnits:10,perCycle:5,useCargo:false};
  return {d,session,fuel,cap,rows};
}
test("fuel plan bounds preferred fuel bay transfer and allows useful partial refill",()=>{
  const f=fixture();const p=f.d.fuelPlan(f.session,10,f.fuel);assert.equal(p.requiredUnits,40);assert.deepEqual(p.transfers,[{itemID:1,sourceLocationID:600,quantity:40,flagID:133}]);
});
test("cargo fallback requires opt-in, counts existing cargo fuel toward target",()=>{
  const f=fixture();f.fuel.useCargo=true;f.rows.push({itemID:2,typeID:16272,quantity:10,ownerID:42,locationID:10,flagID:5});
  const p=f.d.fuelPlan(f.session,10,f.fuel);assert.equal(p.before,10);assert.equal(p.requiredUnits,80);assert.deepEqual(p.transfers.map(x=>[x.flagID,x.quantity]),[[133,40],[5,30]]);
});
test("empty source or insufficient capacity above reserve cannot authorize departure",()=>{
  const f=fixture();f.rows.length=0;assert.throws(()=>f.d.fuelPlan(f.session,10,f.fuel),/ship capacity/);
  f.rows.push({itemID:1,typeID:16272,quantity:100,ownerID:42,locationID:600,flagID:4});f.cap[133].used=45;
  assert.throws(()=>f.d.fuelPlan(f.session,10,f.fuel),/ship capacity/);
});

test("target equal to reserve cannot cause a zero-transfer return-and-restock loop",()=>{
  const f=fixture();f.fuel.targetUnits=f.fuel.reserveUnits;
  assert.throws(()=>f.d.fuelPlan(f.session,10,f.fuel),/target must exceed/);
});
