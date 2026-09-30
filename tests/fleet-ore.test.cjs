"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createFleetOre}=require("../lib/fleetOre");
function fixture(){
  let now=0,refuse=false,voidMove=false,compression=false,guestAccess=true,serial=1000;const calls=[],rows=[],sessions=new Map(),states=new Map(),ships=new Map();
  const fleet={fleetID:10,members:new Map([[1,{}],[2,{}]])};
  const scene={systemID:300,getShipEntityForSession:s=>ships.get(s.characterID),getLivePublicGridClusterKeyForEntity:()=>"belt"};
  const booster={characterID:1,shipID:101},miner={characterID:2,shipID:102};sessions.set(1,booster);sessions.set(2,miner);
  states.set(1,{job:"boosting",enabled:true,receiveFleetOre:true,compressorEnabled:false});states.set(2,{job:"mining",enabled:true,oreMode:"fleetHangar"});
  for(const s of [booster,miner])ships.set(s.characterID,{itemID:s.shipID,kind:"ship",mode:"STOP",radius:100,position:{x:(s.characterID-1)*1000,y:0,z:0}});
  const types={10:{volume:1,ore:true},11:{volume:0.1,ore:true,compressed:true},12:{volume:1,ore:false}};
  const capacities=new Map([["101:134",100],["101:155",100],["102:134",100]]);
  const native={fleet:id=>fleet.members.has(id)?fleet:null,local:()=>true,type:id=>types[id],ore:r=>!!types[r.typeID]?.ore,compressed:r=>!!types[r.typeID]?.compressed,
    list:(s,id,flag,all=false)=>rows.filter(r=>r.locationID===id&&r.flagID===flag&&(all||r.ownerID===s.characterID)),
    access:(s,id,flag)=>!(s.characterID===2&&id===101&&flag===155&&!guestAccess),
    capacity:(s,id,flag)=>({capacity:capacities.get(id+":"+flag)||0,used:rows.filter(r=>r.locationID===id&&r.flagID===flag).reduce((n,r)=>n+r.quantity*types[r.typeID].volume,0)}),
    move(s,target,source,row,quantity,flag){calls.push(["move",s.characterID,row.itemID,target,quantity,flag]);if(refuse)throw Error("SHIP_SERVICE_ACCESS_DENIED");if(voidMove)return;
      assert.equal(row.locationID,source);assert(row.quantity>=quantity);row.quantity-=quantity;
      rows.push({itemID:serial++,typeID:row.typeID,locationID:target,flagID:flag,quantity,ownerID:target===101?1:s.characterID});}};
  const ore=createFleetOre({root:"",getSpace:()=>({getSceneForSession:()=>scene}),getSession:id=>sessions.get(id),getState:s=>states.get(s.characterID),native,clock:()=>now,
    compress(sc,s,ship,facilityID){assert.equal(facilityID,101);calls.push(["compress",s.characterID]);if(compression)for(const row of rows)if(row.locationID===ship.itemID&&row.typeID===10)row.typeID=11;return compression?"Compressed":"Waiting";},logError:()=>{}});
  const add=(typeID=10,quantity=20,ownerID=2,locationID=102,flagID=134)=>{const r={itemID:serial++,typeID,quantity,ownerID,locationID,flagID};rows.push(r);return r;};
  return {ore,booster,miner,scene,states,ships,rows,calls,capacities,fleet,sessions,add,
    tick(time=now){now=time;return ore.tick(booster,states.get(1),scene,ships.get(1),null,now);},
    minerTick(time=now){now=time;return ore.tick(miner,states.get(2),scene,ships.get(2),null,now);},
    waiting(){return ore.waitingForCompression(miner,states.get(2),scene,ships.get(2));},
    compress(value){compression=value;},access(value){guestAccess=value;},refuse(value=true){refuse=value;},voidMove(value=true){voidMove=value;}};
}
test("stationary same-fleet raw ore goes through native guest deposit then owner mining hold",()=>{
  const f=fixture();f.add();const result=f.tick();
  assert.equal(f.rows.filter(r=>r.locationID===102).reduce((n,r)=>n+r.quantity,0),0);
  assert.equal(f.rows.filter(r=>r.locationID===101&&r.flagID===134).reduce((n,r)=>n+r.quantity,0),20);
  assert(f.rows.filter(r=>r.locationID===101&&r.quantity>0).every(r=>r.ownerID===1));
  assert.deepEqual(f.calls.map(c=>c[0]),["move","move"]);assert.equal(result.event.quantity,20);assert.equal(result.event.storedUnits,20);
  f.tick(1000);assert.equal(f.calls.length,2);
});
test("compressor-enabled receiver never takes raw ore while native compression is unavailable between intervals",()=>{
  const f=fixture();f.states.get(1).compressorEnabled=true;f.add();assert.equal(f.waiting(),true);
  f.tick();assert.deepEqual(f.calls.map(c=>c[0]),["compress"]);assert.equal(f.rows[0].quantity,20);assert.match(f.tick().status,/Waiting for fleet compression/);
  f.compress(true);f.tick(5000);assert.equal(f.waiting(),false);assert.equal(f.rows.filter(r=>r.locationID===101&&r.flagID===134&&r.typeID===11).reduce((n,r)=>n+r.quantity,0),20);
});
test("already compressed ore transfers while raw stays, excluding ice gas and non-ore rows",()=>{
  const f=fixture();f.states.get(1).compressorEnabled=true;f.add(10,20);f.add(11,30);f.add(12,40);f.tick();
  assert.equal(f.rows.filter(r=>r.locationID===102&&r.typeID===10).reduce((n,r)=>n+r.quantity,0),20);
  assert.equal(f.rows.filter(r=>r.locationID===102&&r.typeID===12).reduce((n,r)=>n+r.quantity,0),40);
  assert.equal(f.rows.filter(r=>r.locationID===101&&r.flagID===134&&r.typeID===11).reduce((n,r)=>n+r.quantity,0),30);
});
test("scope fleet range movement travel and opt-in gate every handoff without any navigation",()=>{
  for(const change of [f=>f.states.get(1).receiveFleetOre=false,f=>f.states.get(2).enabled=false,f=>f.states.get(2).job="pve",
    f=>f.fleet.members.delete(2),f=>f.ships.get(1).velocity={x:1,y:0,z:0},f=>f.ships.get(2).position.x=5000,
    f=>f.states.get(1).haul={phase:"outbound"},f=>f.sessions.set(2,{characterID:2})]){
    const f=fixture();f.add();change(f);f.tick();assert.equal(f.calls.length,0);
  }
});
test("bounded capacity and mixed-owner fleet hangar drain obey native refusal and verified receipts",()=>{
  const f=fixture();f.add(10,15,99,101,155);f.capacities.set("101:134",10);f.tick();
  assert.equal(f.rows.filter(r=>r.flagID===134&&r.locationID===101).reduce((n,r)=>n+r.quantity,0),10);
  const denied=fixture();denied.add();denied.refuse();assert.match(denied.tick().status,/paused/);assert.equal(denied.rows[0].quantity,20);assert.equal(denied.tick().event,null);
  const voided=fixture();voided.add();voided.voidMove();assert.match(voided.tick().status,/could not be confirmed/);assert.equal(voided.tick().event,null);
});
test("waiting helper is true only with raw ore and nearby enabled compressor receiver",()=>{
  const f=fixture();f.states.get(1).compressorEnabled=true;f.add(11,20);assert.equal(f.waiting(),false);
  f.add();assert.equal(f.waiting(),true);f.ships.get(1).position.x=5000;assert.equal(f.waiting(),false);
  f.ships.get(1).position.x=0;f.states.get(1).compressorEnabled=false;assert.equal(f.waiting(),false);
});
test("inaccessible guest hangar does not pause raw miner, normal miner motion stays permitted",()=>{
  const f=fixture();f.states.get(1).compressorEnabled=true;f.add();f.access(false);assert.equal(f.waiting(),false);f.tick();assert.equal(f.calls.length,0);
  f.access(true);f.ships.get(2).velocity={x:10,y:0,z:0};assert.equal(f.waiting(),true);f.compress(true);f.tick(5000);
  assert.equal(f.rows.filter(r=>r.locationID===102).reduce((n,r)=>n+r.quantity,0),0);
});
test("full booster storage retains deposits while native miner compression still proceeds",()=>{
  const f=fixture();f.add(10,100,1,101,134);f.add(10,100,1,101,155);f.add(10,20);f.states.get(1).compressorEnabled=true;f.compress(true);
  assert.equal(f.waiting(),true);assert.match(f.tick().status,/storage is full/);assert.equal(f.waiting(),false);
  assert.equal(f.rows.filter(r=>r.locationID===102&&r.typeID===11).reduce((n,r)=>n+r.quantity,0),20);
  assert.equal(f.calls.filter(c=>c[0]==="move").length,0);
});

test("other explicit ore modes never deposit or wait for fleet compression",()=>{
  for(const oreMode of ["leave","jettison","unload","pickup",undefined]) {
    const f=fixture();f.states.get(2).oreMode=oreMode;f.states.get(1).compressorEnabled=true;f.add();
    assert.equal(f.waiting(),false);f.tick();assert.equal(f.calls.length,0);assert.equal(f.rows[0].quantity,20);
  }
});

test("miner delivery status distinguishes receiver range permission raw compression and confirmed receipt",()=>{
  const f=fixture();f.add();f.states.get(1).receiveFleetOre=false;
  assert.match(f.minerTick().status,/enabled receiver/);assert.equal(f.calls.length,0);
  f.states.get(1).receiveFleetOre=true;f.ships.get(1).position.x=10000;
  assert.match(f.minerTick(5000).status,/2500 m/);
  f.ships.get(1).position.x=0;f.access(false);assert.match(f.minerTick(10000).status,/hangar access/);
  f.access(true);f.states.get(1).compressorEnabled=true;assert.equal(f.minerTick(15000).status,"Waiting for fleet compression.");
  f.compress(true);f.tick(15000);assert.equal(f.minerTick(15000).status,"Ore delivered to the booster's fleet hangar.");
  assert.equal(f.states.get(2).fleetOreEvent.quantity,20);
});

test("miner uses both storage buffers and boundary surface distance without automatic approach",()=>{
  const f=fixture();f.add();f.add(10,100,1,101,134);f.add(10,100,1,101,155);
  assert.equal(f.minerTick().status,"Fleet ore storage is full.");
  f.rows.find(r=>r.locationID===101&&r.flagID===155).quantity=80;
  f.ships.get(2).position.x=2700;assert.equal(f.minerTick(5000).status,"Ore ready for delivery to the fleet hangar.");
  f.tick(5000);assert.equal(f.rows.filter(r=>r.locationID===102).reduce((n,r)=>n+r.quantity,0),0);
  assert(f.calls.every(c=>c[0]==="move"));
});
