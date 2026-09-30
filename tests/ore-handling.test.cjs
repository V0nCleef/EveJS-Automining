"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createOreHandling } = require("../lib/oreHandling");
function fixture() {
  let rows = [{ itemID: 1, typeID: 100, quantity: 100 }, { itemID: 2, typeID: 200, quantity: 5 }], used = 0, calls = [], canRows = [];
  const session = { characterID: 42 }, ship = { itemID: 10, position: { x: 0, y: 0, z: 0 }, mode: "STOP" };
  const entity = { position: { x: 275, y: 0, z: 0 } }, scene = { systemID: 30, getEntityByID: () => entity };
  const s = { oreMode: "jettison", stackFleetHangar: false }, hold = { flagID: 134, full: true };
  const native = { type: id => id === 23 ? { capacity: 1000 } : { categoryID: id === 100 ? 25 : 4, groupID: 1, volume: 1 },
    list: (_, location, flag) => location === 50 ? canRows : flag === 134 ? rows : [], can: () => ({ typeID: 23, locationID: 30, expiresAtMs: 99999 }), simTime: () => 0,
    capacity: () => ({ capacity: 1000, used }), stack: () => { calls.push("stack"); const seen=new Map();rows=rows.filter(row=>{if(seen.has(row.typeID)){seen.get(row.typeID).quantity+=row.quantity;return false;}seen.set(row.typeID,row);return true;}); },
    move: (_, can, ship, ids, quantity) => { calls.push(["move", can, quantity]); const row = rows.find(row => row.itemID === ids[0]); used += quantity; row.quantity -= quantity; canRows.push({itemID:row.itemID+100,typeID:row.typeID,quantity}); },
    jettison: (_, ids) => { calls.push(["jettison", ids]); const ore = rows.filter(row => ids.includes(row.itemID)); used += ore.reduce((n,row)=>n+row.quantity,0); canRows.push(...ore); rows = rows.filter(row => !ids.includes(row.itemID)); return { containerID: 50, jettisonedToCanIDs: ids }; },
    abandon: (_, id) => { calls.push(["abandon", id]); return true; },
    seed: (_, ship, row, flag, quantity) => { row.quantity -= quantity; rows.push({ itemID: 99, typeID: row.typeID, quantity }); return 99; } };
  const ore = createOreHandling("", { native, save: () => "", logError: () => {} });
  return { ore, s, session, ship, scene, hold, native, calls, rows: () => rows, add: row => rows.push(row), entity,
    dump: now => ore.jettison(session,s,scene,ship,hold,now) };
}
test("creates native can with ore only, persists identity, then reuses it without jettison", () => {
  const f=fixture();f.dump(0);assert.deepEqual(f.s.jettisonCan,{containerID:50,shipID:10,systemID:30,abandoned:false});
  assert.equal(f.s.jettisonEvent.quantity,100);assert.equal(f.s.jettisonEvent.at,0);
  assert.equal(f.rows()[0].typeID,200);f.add({itemID:3,typeID:100,quantity:50});f.dump(5000);
  assert.equal(f.calls.filter(x=>x[0]==="jettison").length,1);assert.deepEqual(f.calls.at(-1),["move",50,50]);
});
test("new huge stack splits through native operation within can capacity", () => {
  const f=fixture();f.rows()[0].quantity=2000;f.dump(0);assert.deepEqual(f.calls[0],["jettison",[99]]);assert.equal(f.rows()[0].quantity,1000);
});
test("abandon existing tracked can uses native permission authority and keeps same can", () => {
  const f=fixture();f.dump(0);f.s.jettisonAbandon=true;f.add({itemID:3,typeID:100,quantity:50});f.dump(5000);
  assert.ok(f.calls.some(x=>x[0]==="abandon"&&x[1]===50));assert.equal(f.s.jettisonCan.abandoned,true);
});
test("out of range replaces can, cooldown bounds native attempts", () => {
  const f=fixture();f.dump(0);f.entity.position.x=3000;f.add({itemID:3,typeID:100,quantity:50});
  f.native.jettison=()=>{f.calls.push("cooldown");return {errorMsg:"JETTISON_COOLDOWN",retryAfterMs:180000};};
  f.dump(5000);f.dump(6000);assert.equal(f.calls.filter(x=>x==="cooldown").length,1);
});
test("permission failure never creates replacement or bypasses native custody", () => {
  const f=fixture();f.dump(0);f.add({itemID:3,typeID:100,quantity:50});f.native.move=()=>{throw Error("access denied");};f.dump(5000);
  assert.equal(f.calls.filter(x=>x[0]==="jettison").length,1);assert.match(f.s.oreStatus,/access denied/);
});
test("stacking coalesces duplicate rows and does no operation for single stacks", () => {
  const f=fixture();f.s.oreMode="leave";f.ore.tick(f.session,f.s,f.scene,f.ship,f.hold,0);assert.equal(f.calls.length,0);
  f.add({itemID:3,typeID:100,quantity:50});f.ore.tick(f.session,f.s,f.scene,f.ship,f.hold,5000);f.ore.tick(f.session,f.s,f.scene,f.ship,f.hold,6000);
  assert.deepEqual(f.calls,["stack"]);assert.equal(f.s.stackEvent.merged,1);assert.equal(f.s.stackEvent.at,5000);
});
test("native ice and gas groups are excluded from automatic ore disposal", () => {
  const f=fixture();f.native.type=id=>id===23?{capacity:1000}:{categoryID:25,groupID:465,volume:1};f.dump(0);assert.equal(f.calls.length,0);
});

test("void native transfer and StackAll refusal never emit completion events", () => {
  const f=fixture();f.native.jettison=()=>({containerID:50,jettisonedToCanIDs:[1]});f.dump(0);
  assert.equal(f.s.jettisonEvent,undefined);assert.match(f.s.oreStatus,/could not be confirmed/);
  f.s.oreMode="leave";f.add({itemID:3,typeID:100,quantity:50});f.native.stack=()=>{};
  f.ore.tick(f.session,f.s,f.scene,f.ship,f.hold,5000);assert.equal(f.s.stackEvent,undefined);
});
test("verified partial can refill retains completion evidence while waiting creation cooldown", () => {
  const f=fixture();f.dump(0);f.session._jettisonCooldownUntilMs=180000;f.add({itemID:3,typeID:100,quantity:1500});
  f.dump(5000);assert.equal(f.s.jettisonEvent.quantity,900);assert.equal(f.s.jettisonEvent.at,5000);
  assert.match(f.s.oreStatus,/Ore transferred.*cooldown/);
});

test("creation cooldown does not block reuse when tracked can has room again", () => {
  const f=fixture();f.dump(0);f.s.nextJettison=180000;f.s.jettisonCooldownWaiting=true;f.add({itemID:3,typeID:100,quantity:50});
  f.dump(5000);assert.equal(f.s.jettisonEvent.quantity,50);assert.equal(f.calls.filter(x=>x[0]==="jettison").length,1);
});

test("default fleet-hangar stacking works when ship has no ore hold", () => {
  const f=fixture();f.s.oreMode="leave";f.s.stackFleetHangar=true;let fleet=[{itemID:8,typeID:100,quantity:1},{itemID:9,typeID:100,quantity:1}];
  f.native.list=(_,__,flag)=>flag===155?fleet:[];f.native.capacity=()=>({capacity:100,used:2});
  f.native.stack=(_,ship,flag)=>{assert.equal(flag,155);f.calls.push("stack");fleet=[{itemID:8,typeID:100,quantity:2}];};
  f.ore.tick(f.session,f.s,f.scene,f.ship,null,0);assert.deepEqual(f.calls,["stack"]);assert.equal(f.s.stackEvent.flagID,155);
});

test("new mixed-ore can fills all fitting stacks in the same automatic operation", () => {
  const f=fixture();const originalType=f.native.type;
  f.native.type=id=>id===101?{categoryID:25,groupID:1,volume:1}:originalType(id);
  f.add({itemID:3,typeID:101,quantity:150});
  // Seed consumes only the first small stack. The automatic threshold must
  // not gate the remaining transfer after that seed.
  const originalJettison=f.native.jettison;
  f.native.jettison=(session,ids)=>{const result=originalJettison(session,ids);f.hold.full=false;return result;};
  f.ore.tick(f.session,f.s,f.scene,f.ship,f.hold,0);
  assert.equal(f.calls.filter(x=>x[0]==="jettison").length,1);
  assert.deepEqual(f.calls.filter(x=>x[0]==="move"),[["move",50,150]]);
  assert.deepEqual(f.rows().filter(row=>row.quantity>0).map(row=>row.typeID),[200]);
  assert.equal(f.s.jettisonEvent.quantity,250);
});
