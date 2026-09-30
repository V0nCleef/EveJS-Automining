const {test}=require('node:test'),assert=require('node:assert/strict');
const {installHUD}=require('../lib/hud');
function fixture(){
  const calls=[],session={characterID:1,shipID:10},Service=function(){};
  const controller={snapshot:()=>({enabled:true,job:'pve'}),
    pvePlan:(session,raw)=>{calls.push(['plan',session,raw]);if(raw===null)throw Error('Invalid PVE action.');return {pve:{job:null}};},
    pveAction:(session,id,action,raw)=>{calls.push(['action',session,id,action,raw]);return {job:{id,nonce:'current'}};},
    pveFleets:()=>[{fleetID:7}],reinforcementCall:()=>({status:'Waiting'}),
    pveHeartbeat:(session,id)=>{calls.push(['heartbeat',session,id]);return true;},
    pveAmmoGroups:(session,raw)=>{calls.push(['groups',session,raw]);return {pveAmmo:{ready:true}};},
    jobProfile:(session,job)=>{calls.push(['profile',session,job]);return {settings:{job,pveDronesEnabled:false},fields:['pveDronesEnabled'],revision:4,job};}};
  installHUD(Service,controller,()=>[]);return {rpc:new Service(),calls,session};
}
test('native tagged route JSON stays bounded and controller-owned; malformed oversized paths fail without mutation',()=>{
  const f=fixture(),raw=JSON.stringify({offerID:'incident',shipID:10,systems:Array.from({length:51},(_,i)=>300+i),homeSystems:[300]});
  const response=JSON.parse(f.rpc.Handle_AutoMiningPVEPlan([{type:'wstring',value:raw}],f.session));
  assert.equal(response.success,true);assert.deepEqual(f.calls[0],['plan',f.session,raw]);
  const invalid=JSON.parse(f.rpc.Handle_AutoMiningPVEPlan(['x'.repeat(16385)],f.session));assert.equal(invalid.success,false);assert.equal(f.calls[1][2],null);
  const action=JSON.parse(f.rpc.Handle_AutoMiningPVEAction([Buffer.from('job'),'authorizeRoute',Buffer.from(raw)],f.session));
  assert.equal(action.pve.job.nonce,'current');assert.deepEqual(f.calls[2],['action',f.session,'job','authorizeRoute',raw]);
});
test('dedicated heartbeat and native selected-group attestation retain exact owned IDs without action polling',()=>{
  const f=fixture();assert.equal(JSON.parse(f.rpc.Handle_AutoMiningPVEHeartbeat([{type:'wstring',value:'job'}],f.session)).ready,true);
  const raw=JSON.stringify({shipID:10,groupKey:'["combat","one"]',ids:[700]});
  assert.equal(JSON.parse(f.rpc.Handle_AutoMiningPVEAmmoGroups([raw],f.session)).pveAmmo.ready,true);
  assert.deepEqual(f.calls,[['heartbeat',f.session,'job'],['groups',f.session,raw]]);
});
test('readonly per-job preview returns target fields and revision without changing current snapshot or invoking control/save',()=>{
  const f=fixture(),result=JSON.parse(f.rpc.Handle_AutoMiningJobProfile([{type:'wstring',value:'pve'}],f.session));
  assert.deepEqual(result.fields,['pveDronesEnabled']);assert.equal(result.settings.pveDronesEnabled,false);assert.equal(result.revision,4);assert.equal(result.enabled,true);
  assert.deepEqual(f.calls,[['profile',f.session,'pve']]);assert.deepEqual(JSON.parse(f.rpc.Handle_AutoMiningPVEFleets([],f.session)).pveFleets,[{fleetID:7}]);
});
