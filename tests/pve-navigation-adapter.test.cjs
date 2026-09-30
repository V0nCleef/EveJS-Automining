const {test}=require('node:test'),assert=require('node:assert/strict');
const {installNavigation}=require('../lib/departure');
function fixture() {
  const events=[],session={},options={pve:true};
  class Service {}
  for(const name of ['Handle_CmdWarpToStuff','Handle_CmdWarpToStuffAutopilot','Handle_CmdDock','Handle_CmdFollowBall','Handle_CmdStargateJump','Handle_CmdOrbit'])
    Service.prototype[name]=function(args){events.push(['native',name,args]);return 77;};
  const controller={departureOptions:()=>options,cancelHaul:()=>events.push(['cancel']),pveNavigation:(s,kind,args)=>{events.push(['grant',kind,args]);return true;}};
  const departure={run:(s,fn)=>{events.push(['recall']);return fn();},cancel:()=>{}};
  installNavigation(Service,controller,departure);return {service:new Service(),session,controller,events,options};
}
test('native autopilot single-gate args map to exact native item warp10000 grant before recall and original',()=>{
  const f=fixture();assert.equal(f.service.Handle_CmdWarpToStuffAutopilot([900],f.session),77);
  assert.deepEqual(f.events,[['grant','warp',{warpType:'item',targetID:900,minRange:10000,fleet:false}],['recall'],['native','Handle_CmdWarpToStuffAutopilot',[900]]]);
});
test('home native dock checks exact target grant and keeps native recall path',()=>{
  const f=fixture();assert.equal(f.service.Handle_CmdDock([600,10],f.session),77);
  assert.deepEqual(f.events,[['grant','dock',{targetID:600}],['recall'],['native','Handle_CmdDock',[600,10]]]);
});
test('wrong native-shaped autopilot or dock target cancels owned PVE before ordinary manual move',()=>{
  for(const method of ['Handle_CmdWarpToStuffAutopilot','Handle_CmdDock']){
    const f=fixture();f.controller.pveNavigation=()=>false;assert.equal(f.service[method]([999],f.session),77);
    assert.deepEqual(f.events.map(e=>e[0]),['cancel','recall','native']);
  }
});
test('ordinary non-PVE autopilot remains native; tagged char warp preserves current grant values',()=>{
  const f=fixture();f.options.pve=false;f.controller.pveNavigation=()=>false;f.service.Handle_CmdWarpToStuffAutopilot([900],f.session);assert.deepEqual(f.events.map(e=>e[0]),['recall','native']);
  const g=fixture();g.service.Handle_CmdWarpToStuff([{type:'wstring',value:'char'},42],g.session,{minRange:0,fleet:false});
  assert.deepEqual(g.events[0],['grant','warp',{warpType:'char',targetID:42,minRange:0,fleet:false}]);
});
test('stale owned orbit retries before cancellation/native movement; manual mismatch and normal native results stay unchanged',()=>{
  const f=fixture();f.controller.pveOrbitNavigation=()=>({allowed:false,skipped:true});
  assert.deepEqual(f.service.Handle_CmdOrbit([200,10000],f.session),{type:'dict',entries:[['_amPVEOrbitSkipped',true]]});assert.deepEqual(f.events,[]);
  f.controller.pveOrbitNavigation=()=>({allowed:true,skipped:false});assert.equal(f.service.Handle_CmdOrbit([200,10000],f.session),77);assert.deepEqual(f.events.map(row=>row[0]),['native']);
  const g=fixture();g.controller.pveOrbitNavigation=()=>({allowed:false,skipped:false});assert.equal(g.service.Handle_CmdOrbit([999,10000],g.session),77);assert.deepEqual(g.events.map(row=>row[0]),['cancel','native']);
});
