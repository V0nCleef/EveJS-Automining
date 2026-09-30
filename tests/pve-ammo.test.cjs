const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPVEAmmo}=require('../lib/pveAmmo');
const {featurePreferences,featureRequest}=require('../lib/featureSettings');
const {captureProfile,switchProfile}=require('../lib/jobProfiles');
function fixture() {
  let now=0,catalogReads=0;const moves=[],loads=[],pending=new Set();
  const session={characterID:1,shipID:10,stationID:20},ship={itemID:10,ownerID:1,locationID:20,activeModuleEffects:new Map()};
  const modules=[{itemID:100,typeID:50,flagID:27},{itemID:101,typeID:50,flagID:28}];
  const loaded=new Map(),inventory=[{itemID:500,typeID:2,locationID:20,flagID:4,quantity:100}];
  const typeRows=[{typeID:2,groupID:7,categoryID:8,published:true,name:'Ammo A',volume:1},
    {typeID:3,groupID:7,categoryID:8,published:true,name:'Ammo B',volume:1},
    {typeID:4,groupID:8,categoryID:8,published:true,name:'Mining crystal',volume:1},
    {typeID:5,groupID:7,categoryID:8,published:true,name:'Oversized',volume:5},
    {typeID:6,groupID:7,categoryID:8,published:false,name:'Hidden',volume:1}];
  const s={...featurePreferences({job:'pve'}),enabled:true,job:'pve'},source={key:'personal',ownerID:1,locationID:20,flagID:4,kind:'personal',label:'Personal'};
  const native={types:()=>{catalogReads++;return typeRows;},type:id=>typeRows.find(t=>t.typeID===id),fitted:()=>modules,
    ship:()=>ship,online:()=>true,family:()=> 'hybridTurret',groups:()=>new Set([7]),compatible:(m,c)=>[2,3].includes(c),capacity:()=>2,
    optional:()=>false,master:()=>100,loaded:(ship,m)=>loaded.get(m.itemID),pending:id=>pending.has(id),
    list:(sess,id,flag)=>inventory.filter(r=>r.locationID===id&&(flag===null||r.flagID===flag)),
    capacityCargo:()=>({capacity:50,used:inventory.filter(r=>r.locationID===10).reduce((n,r)=>n+Math.max(0,r.quantity),0)}),
    move:(sess,id,src,row,qty)=>{moves.push({id,source:src.locationID,itemID:row.itemID,qty});row.quantity-=qty;inventory.push({...row,itemID:1000+moves.length,locationID:id,flagID:5,quantity:qty});},
    load:(sess,id,master,chargeID)=>{loads.push({master,chargeID});const source=inventory.find(r=>r.itemID===chargeID);for(const m of modules){
      const old=loaded.get(m.itemID),need=2-(old?.quantity||0),qty=Math.min(need,source.quantity);if(qty>0){source.quantity-=qty;loaded.set(m.itemID,{typeID:source.typeID,quantity:(old?.quantity||0)+qty});}}}
  };
  const destinations={storage:(sess,id,key,expected)=>{if(id!==20||key!==source.key||expected&&expected!==source)throw Error('changed');return source;}};
  const service=createPVEAmmo({native,destinations,clock:()=>now});
  return {session,ship,s,source,modules,loaded,inventory,native,destinations,service,moves,loads,pending,typeRows,next:()=>now+=5000,catalogReads:()=>catalogReads};
}
test('catalogue uses native compatibility and all bank-member loaded counts; charge index is cached across snapshots',()=>{
  const f=fixture();f.loaded.set(100,{typeID:2,quantity:2});f.loaded.set(101,{typeID:2,quantity:2});
  let view=f.service.view(f.session,f.s,f.ship);assert.deepEqual(view.items.map(r=>r.typeID),[2,3]);assert.equal(view.items[0].loaded,4);assert.equal(view.ready,true);
  f.inventory.push({itemID:701,typeID:2,locationID:10,flagID:5,quantity:8});view=f.service.view(f.session,f.s,f.ship);assert.equal(view.items[0].cargo,8);assert.equal(f.catalogReads(),1);
  f.modules[0].typeID=51;f.native.compatible=(m,c)=>m===51?c===3:[2,3].includes(c);view=f.service.view(f.session,f.s,f.ship);assert.deepEqual(view.missing,[100]);assert.equal(f.catalogReads(),1);
});
test('verified dock reloads configured empty bank, then restores cargo target independently of loaded quantities',()=>{
  const f=fixture();f.s.pveAmmoTargets={2:10};let view=f.service.tick(f.session,f.s,null,f.ship);
  assert.deepEqual(f.loads,[{master:100,chargeID:1001}]);assert.equal(view.items[0].loaded,4);assert.equal(view.items[0].cargo,6);assert.equal(f.service.ready(f.session,f.s,f.ship),false);
  f.next();view=f.service.tick(f.session,f.s,null,f.ship);assert.equal(view.items[0].cargo,10);assert.equal(f.service.ready(f.session,f.s,f.ship),true);
  assert.equal(f.inventory.find(r=>r.itemID===500).quantity,86);assert.equal(f.loads.length,1);
});
test('current loaded type is preserved over configured alternative; no configured choice leaves empty bank missing',()=>{
  const f=fixture();f.loaded.set(100,{typeID:3,quantity:1});f.loaded.set(101,{typeID:3,quantity:1});
  f.inventory.push({itemID:701,typeID:3,locationID:10,flagID:5,quantity:6},{itemID:702,typeID:2,locationID:10,flagID:5,quantity:6});f.s.pveAmmoTargets={2:6};
  f.service.tick(f.session,f.s,null,f.ship);assert.deepEqual(f.loads,[{master:100,chargeID:701}]);assert.equal(f.loaded.get(100).typeID,3);
  const g=fixture();g.inventory.push({itemID:701,typeID:2,locationID:10,flagID:5,quantity:6});assert.equal(g.service.tick(g.session,g.s,null,g.ship).ready,false);assert.equal(g.loads.length,0);
});
test('native pending/active banks remain untouched, and wrong ship/dock identity never transfers',()=>{
  const f=fixture();f.s.pveAmmoTargets={2:10};f.inventory.push({itemID:701,typeID:2,locationID:10,flagID:5,quantity:10});f.pending.add(100);
  assert.equal(f.service.tick(f.session,f.s,null,f.ship).reason,'reload');assert.equal(f.loads.length,0);
  const g=fixture();g.s.pveAmmoTargets={2:10};g.ship.locationID=21;g.service.tick(g.session,g.s,null,g.ship);assert.equal(g.moves.length,0);assert.equal(g.loads.length,0);assert.equal(g.service.ready(g.session,g.s,g.ship),false);
});
test('partial stock, native capacity including other cargo, access denial and unverifiable receipts remain visible',()=>{
  const f=fixture();f.s.pveAmmoTargets={2:20};f.native.load=()=>{};f.inventory[0].quantity=3;
  assert.equal(f.service.tick(f.session,f.s,null,f.ship).reason,'stock');assert.equal(f.moves[0].qty,3);assert.equal(f.service.ready(f.session,f.s,f.ship),false);
  const g=fixture();g.s.pveAmmoTargets={2:20};g.native.capacityCargo=()=>({capacity:50,used:49});g.native.load=()=>{};
  assert.equal(g.service.tick(g.session,g.s,null,g.ship).reason,'capacity');assert.equal(g.moves[0].qty,1);
  const h=fixture();h.s.pveAmmoTargets={2:20};h.destinations.storage=()=>{throw Error('denied');};assert.equal(h.service.tick(h.session,h.s,null,h.ship).reason,'source');assert.equal(h.moves.length,0);
  const j=fixture();j.s.pveAmmoTargets={2:20};j.native.move=()=>{};assert.equal(j.service.tick(j.session,j.s,null,j.ship).reason,'receipt');assert.equal(j.service.ready(j.session,j.s,j.ship),false);
  f.loaded.set(100,{typeID:2,quantity:1});assert.equal(f.service.ready(f.session,f.s,f.ship),true,'A confirmed stock warning cannot strand usable offense');
  assert.equal(f.service.view(f.session,f.s,f.ship).ready,true);
  f.pending.add(101);assert.equal(f.service.ready(f.session,f.s,f.ship),false,'A newly pending native reload invalidates readiness before the next tick');
  assert.equal(f.service.view(f.session,f.s,f.ship).ready,false);assert.equal(f.service.view(f.session,f.s,f.ship).reason,'reload');
});
test('singleton reusable damaged crystals count as items; burned-out crystals never satisfy stock or readiness',()=>{
  const f=fixture();f.native.family=()=> 'laserTurret';f.loaded.set(100,{typeID:2,quantity:-1,singleton:1,moduleState:{damage:.8}});f.loaded.set(101,{typeID:2,quantity:-1,singleton:1,moduleState:{damage:1}});
  f.inventory.push({itemID:701,typeID:2,locationID:10,flagID:5,quantity:-1,singleton:1,moduleState:{damage:.5}});
  const view=f.service.view(f.session,f.s,f.ship);assert.equal(view.items[0].loaded,1);assert.equal(view.items[0].cargo,1);assert.equal(view.items[0].reusable,true);assert.deepEqual(view.missing,[101]);
});
test('accessible corporation division stock uses verified corporation ownership, with native transfer custody and receipts unchanged',()=>{
  const f=fixture(),reads=[];Object.assign(f.source,{key:'corp:30:115',kind:'corporation',ownerID:7,locationID:30,flagID:115});
  f.s.pveAmmoSourceKey=f.source.key;f.s.pveAmmoTargets={2:6};Object.assign(f.inventory[0],{ownerID:7,locationID:30,flagID:115});
  f.loaded.set(100,{typeID:2,quantity:2});f.loaded.set(101,{typeID:2,quantity:2});
  f.native.list=(session,id,flag,all=false,owner=session.characterID)=>{reads.push({id,owner:all?null:owner});return f.inventory.filter(row=>row.locationID===id&&(flag===null||row.flagID===flag)&&(all||(row.ownerID??1)===owner));};
  const move=f.native.move;f.native.move=(...args)=>{move(...args);f.inventory.at(-1).ownerID=1;};
  const view=f.service.tick(f.session,f.s,null,f.ship);assert.equal(view.items[0].cargo,6);assert.equal(view.reason,'ready');assert.equal(f.moves.length,1);
  assert.equal(f.inventory[0].quantity,94);assert.ok(reads.filter(row=>row.id===30).every(row=>row.owner===7));assert.equal(f.service.ready(f.session,f.s,f.ship),true);
});
test('no-charge civilian weapons are ready; flight reload stays native and never pulls station stock',()=>{
  const f=fixture();f.native.optional=()=>true;f.native.groups=()=>new Set();assert.equal(f.service.ready(f.session,f.s,f.ship),true);
  const g=fixture();g.session.stationID=0;g.ship.locationID=300;g.s.pveAmmoTargets={2:10};g.inventory.push({itemID:701,typeID:2,locationID:10,flagID:5,quantity:6});
  const scene={getShipEntityForSession:()=>g.ship};g.service.tick(g.session,g.s,scene,g.ship);assert.equal(g.moves.length,0);assert.equal(g.loads.length,1);assert.equal(g.service.ready(g.session,g.s,g.ship),true);
});
test('ammo preferences validate bounds and preserve per-type targets across profile switches/refits',()=>{
  const old=featurePreferences({job:'pve'});assert.equal(old.pveAmmoRestock,true);assert.deepEqual(old.pveAmmoTargets,{});assert.equal(old.pveAmmoSourceKey,'personal');
  for(const targets of [{2:-1},{2:1000001},{2:1.5},{'02':1},Array(513).fill(1)])assert.throws(()=>featureRequest({pveAmmoTargets:targets},old),/ammunition/);
  const targets=Object.fromEntries(Array.from({length:200},(_,i)=>[i+1,i]));const current={...old,pveAmmoTargets:targets,pveAmmoSourceKey:'corp:70:115'};
  const saved=captureProfile(current);assert.deepEqual(saved.pveAmmoTargets,targets);
  assert.deepEqual(switchProfile({job:'pve'},{...current,job:'mining',jobProfiles:{pve:saved}}).pveAmmoTargets,targets);
});
test('drones-only readiness requires current native selected combat group, owned usable drones and ship identity; no-offense/offline/Vorton fits stay blocked',()=>{
  const f=fixture();assert.equal(f.service.ready(f.session,f.s,f.ship),false);
  f.modules.length=0;assert.equal(f.service.ready(f.session,f.s,f.ship),false);
  f.s.pveDronesEnabled=true;f.s.pveDroneGroupKey='["combat","one"]';f.native.droneUsable=(session,ship,row)=>row.typeID===90;
  f.inventory.push({itemID:777,typeID:90,locationID:10,flagID:87,quantity:-1,singleton:1});
  assert.equal(f.service.ready(f.session,f.s,f.ship),false);f.service.selectDrones(f.session,f.s,{shipID:10,groupKey:f.s.pveDroneGroupKey,ids:[777]});
  assert.equal(f.service.ready(f.session,f.s,f.ship),true);
  assert.throws(()=>f.service.selectDrones(f.session,f.s,{shipID:11,groupKey:f.s.pveDroneGroupKey,ids:[777]}),/Invalid/);
  f.inventory.length=0;f.s.pveManagedDroneIDs=new Set([777]);f.native.activeDrones=()=>[{itemID:777,typeID:90}];assert.equal(f.service.ready(f.session,f.s,f.ship),true,'Owned native live drones remain offense after leaving bay');
  f.s.pveDroneGroupKey='["different","group"]';assert.equal(f.service.ready(f.session,f.s,f.ship),false);
  const g=fixture();g.loaded.set(100,{typeID:2,quantity:2});g.loaded.set(101,{typeID:2,quantity:2});g.native.online=()=>false;assert.equal(g.service.ready(g.session,g.s,g.ship),false);
  g.native.online=()=>true;g.native.family=()=> 'vortonProjector';assert.equal(g.service.ready(g.session,g.s,g.ship),false);assert.deepEqual(g.service.view(g.session,g.s,g.ship).items.map(r=>r.typeID),[2,3]);
});
