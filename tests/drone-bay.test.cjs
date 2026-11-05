"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDroneBay, DRONE_BAY_FLAG } = require("../lib/droneBay");

function bay(rows) {
  return createDroneBay("unused", { native: { listContainerItems: (owner, shipID, flagID) => {
    assert.equal(owner, null, "bay lookup is owner agnostic");
    assert.equal(flagID, DRONE_BAY_FLAG, "bay flag");
    return rows;
  } } });
}

test("drone bay reports only stocked drones of the active ship", () => {
  const api = bay([
    { itemID: 11, typeID: 24698, categoryID: 18, quantity: 1 },
    { itemID: 12, typeID: 24698, categoryID: 18, quantity: 0 },
    { itemID: 13, typeID: 1234, categoryID: 6, quantity: 1 }
  ]);
  assert.deepEqual(api({ shipID: 100 }), { shipID: 100, itemIDs: [11] });
});

test("drone bay is empty without an active ship", () => {
  const api = bay([]);
  assert.deepEqual(api({}), { shipID: 0, itemIDs: [] });
});

test("stack quantities count actual drones while native singletons remain one",()=>{
 const api=bay([{itemID:11,categoryID:18,quantity:5,stacksize:5,singleton:0},
  {itemID:12,categoryID:18,quantity:-1,stacksize:1,singleton:1}]);
 assert.deepEqual(api({shipID:100}),{shipID:100,itemIDs:[11,12],quantities:{11:5,12:1}});
});

test("drone bay survives a failing inventory projection", () => {
  const api = createDroneBay("unused", { native: { listContainerItems: () => { throw new Error("boom"); } } });
  const result = api({ shipID: 7 });
  assert.equal(result.shipID, 7);
  assert.deepEqual(result.itemIDs, []);
  assert.match(result.error, /boom/);
});

test("native assembled drones remain visible while docked and in space", () => {
  // Native inventory stores each assembled drone as one singleton, not a
  // positive-quantity stack. This is the shape observed in a real ship bay.
  const rows = Array.from({ length: 10 }, (_, index) => ({
    itemID: 9000000000000 + index, typeID: index < 5 ? 10250 : 2203,
    categoryID: 18, singleton: 1, quantity: -1, stacksize: 1
  }));
  const api = bay(rows);
  const expected = { shipID: 100, itemIDs: rows.map(row => row.itemID) };
  assert.deepEqual(api({ shipID: 100, stationID: 600 }), expected);
  assert.deepEqual(api({ shipid: 100, stationID: null }), expected);
});

test("mixed native bay rows exclude empty stacks and non-drone singletons", () => {
  const api = bay([
    { itemID: 11, categoryID: 18, singleton: 1, quantity: -1, stacksize: 1 },
    { itemID: 12, categoryID: 18, singleton: 0, quantity: 3, stacksize: 3 },
    { itemID: 13, categoryID: 18, singleton: 0, quantity: 0, stacksize: 0 },
    { itemID: 14, categoryID: 6, singleton: 1, quantity: -1, stacksize: 1 },
    { itemID: 15, categoryID: 18, singleton: 0, quantity: -1, stacksize: 0 }
  ]);
  assert.deepEqual(api({ shipID: 100 }).itemIDs, [11, 12]);
});
