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

test("drone bay survives a failing inventory projection", () => {
  const api = createDroneBay("unused", { native: { listContainerItems: () => { throw new Error("boom"); } } });
  const result = api({ shipID: 7 });
  assert.equal(result.shipID, 7);
  assert.deepEqual(result.itemIDs, []);
  assert.match(result.error, /boom/);
});
