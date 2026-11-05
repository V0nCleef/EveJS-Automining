"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {installManualModuleStops}=require("../lib/manualModules");

test("successful native manual deactivation is observed once and retains receiver, args and result",()=>{
 const calls=[],session={characterID:42};
 class Service{Handle_Deactivate(args,s){assert.equal(this.tag,7);assert.equal(s,session);calls.push(["native",args]);return 1;}}
 const controller={manualModuleStop:(s,id)=>{assert.equal(s,session);calls.push(["manual",id]);}};
 assert.equal(installManualModuleStops(Service,controller),true);
 const wrapped=Service.prototype.Handle_Deactivate;
 assert.equal(installManualModuleStops(Service,controller),true);assert.equal(Service.prototype.Handle_Deactivate,wrapped);
 const service=new Service();service.tag=7;
 assert.equal(service.Handle_Deactivate([123,"core"],session),1);
 assert.deepEqual(calls,[["native",[123,"core"]],["manual",123]]);
});

test("native failures and thrown exceptions never create a manual pause",()=>{
 let observed=0;const controller={manualModuleStop:()=>observed++};
 class Refused{Handle_Deactivate(){return 0;}}
 installManualModuleStops(Refused,controller);assert.equal(new Refused().Handle_Deactivate([1],{}),0);
 const failure=Error("native refused");class Throws{Handle_Deactivate(){throw failure;}}
 installManualModuleStops(Throws,controller);assert.throws(()=>new Throws().Handle_Deactivate([1],{}),e=>e===failure);
 assert.equal(observed,0);
});

test("observer errors preserve the accepted native result",()=>{
 class Service{Handle_Deactivate(){return 1;}}
 const errors=[];installManualModuleStops(Service,{manualModuleStop(){throw Error("observer");}},e=>errors.push(e));
 assert.equal(new Service().Handle_Deactivate([1],{}),1);assert.equal(errors.length,1);
 assert.equal(installManualModuleStops(class {},{}),false);
});
