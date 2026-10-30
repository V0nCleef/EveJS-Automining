'use strict';
// Actual native movement queue and Stop command; only persistence, history
// transport and the tick clock are stand-ins. No database or client is opened.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.argv[2]);
const queue=require(path.join(root,'server/src/space/runtime/scene/movementQueue.js'));
const {createMovementStopSpeedCommands}=require(path.join(root,'server/src/space/destiny/commands/stopSpeedCommands.js'));
function fixture(createHauling){
 const ship={itemID:10,mode:'GOTO',position:{x:900,y:0,z:0},velocity:{x:-70,y:0,z:0},direction:{x:-1,y:0,z:0}};
 const origin={systemID:30,x:0,y:0,z:0};ship.targetPoint=origin;
 const session={characterID:42,shipID:10,sendNotification(){}};
 const actions=[],scene={...queue,systemID:30,getShipEntityForSession:()=>ship,getCurrentSimTimeMs:()=>10000,
  queueBallparkAction(entity,label,apply){actions.push({entity,label,apply});},
  applyDestinyTickList(){for(const action of actions.splice(0))action.apply();},queueBubbleHistory(){}};
 const commands=createMovementStopSpeedCommands({magnitude:v=>Math.hypot(v.x,v.y,v.z),cloneVector:v=>({...v}),
  clearTrackingState(){},persistShipEntity(){},armMovementTrace(){},logMovementDebug(){}});
 scene.stopShipEntity=(entity,options)=>commands.stopShipEntity(scene,entity,options);
 scene.stop=s=>commands.stop(scene,s);
 const state={job:'mining',enabled:true,haulInterrupted:true,haul:{id:'queued-native-return',phase:'returning',shipID:10,
  origin,moving:'approach',started:Date.now(),heartbeat:Date.now(),changed:Date.now()}};
 const hauling=createHauling({getSpace:()=>({getSceneForSession:()=>scene}),save:()=>''});
 return {scene,ship,state,hauling,actions,act:action=>hauling.action(session,state,'queued-native-return',action),session};
}
if(process.argv[3]){
 const f=fixture(require(path.resolve(process.argv[3])).createHauling);
 assert.equal(f.act('position').atOrigin,true);
 assert.equal(f.ship.mode,'GOTO');assert.equal(f.scene.hasQueuedMovementChange(f.ship),true);
 assert.throws(()=>f.act('complete'),/Mining position has not been reached/);
 console.log('BASELINE REPRODUCED: native Stop queued, premature atOrigin=true, immediate completion rejects GOTO.');
}
const create=require('../lib/hauling').createHauling;
for(const startingMode of ['GOTO','STOP']){
 const f=fixture(create);f.ship.mode=startingMode;
 assert.notEqual(f.act('position').atOrigin,true);
 assert.equal(f.scene.hasQueuedMovementChange(f.ship),true);
 for(let n=0;n<3;n++)assert.notEqual(f.act('position').atOrigin,true);
 assert.equal(f.actions.length,1,'Polls must not requeue Stop');
 assert.equal(f.hauling.canMine(f.session,f.state,f.scene,f.ship),false);
 f.scene.applyDestinyTickQueue();assert.equal(f.ship.mode,'STOP');
 assert.equal(f.act('position').atOrigin,true);f.act('complete');
 assert.equal(f.state.haul,null);assert.equal(f.state.enabled,true);
}
const manual=fixture(create);manual.act('position');
manual.scene.queueMovementChange(manual.ship,'manual-follow',()=>{manual.ship.mode='FOLLOW';});
manual.scene.applyDestinyTickQueue();
assert.throws(()=>manual.act('position'),/changed manually/);assert.equal(manual.actions.length,0);
console.log('PASS: actual native Stop waits for Destiny application, keeps mining enabled and preserves later manual movement.');
