"use strict";
function installHUD(Service, controller, catalog) {
  const reply = (session, action) => {
    try { return JSON.stringify({ success:true, ...action(), ...controller.snapshot(session) }); }
    catch(error) { return JSON.stringify({success:false,message:String(error.message).slice(0,500)}); }
  };
  Service.prototype.Handle_AutoMiningGetState = (args,session) => reply(session,()=> args?.[0] ? {catalog:catalog()} : {});
  Service.prototype.Handle_AutoMiningSetSettings = (args,session) => reply(session,()=>({message:controller.applySettings(session,args?.[0])}));
  Service.prototype.Handle_AutoMiningControl = (args,session) => reply(session,()=>{
    if (!["on","off"].includes(args?.[0])) throw new Error("Unknown AutoMining control.");
    return {message:controller.command(session,{action:args[0]})};
  });
}
module.exports = { installHUD };
