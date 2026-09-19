"use strict";
// Client RPC text may arrive as bytes or a tagged string. Normalize only these
// representations; keep controller validation and request-size limits intact.
function clientText(value, limit) {
  if (value && ["wstring", "token", "rawstr"].includes(value.type)) value = value.value;
  if (Buffer.isBuffer(value)) {
    if (value.length > limit) return null;
    value = value.toString("utf8");
  }
  return typeof value === "string" && value.length <= limit ? value : null;
}
function installHUD(Service, controller, catalog) {
  const reply = (session, action) => {
    try { return JSON.stringify({ success:true, ...action(), ...controller.snapshot(session) }); }
    catch(error) { return JSON.stringify({success:false,message:String(error.message).slice(0,500)}); }
  };
  Service.prototype.Handle_AutoMiningGetState = (args,session) => reply(session,()=> args?.[0] ? {catalog:catalog()} : {});
  Service.prototype.Handle_AutoMiningSetSettings = (args,session) => reply(session,()=>({message:controller.applySettings(session,clientText(args?.[0],100000))}));
  Service.prototype.Handle_AutoMiningControl = (args,session) => reply(session,()=>{
    const action = clientText(args?.[0],3);
    if (!["on","off"].includes(action)) throw new Error("Unknown AutoMining control.");
    return {message:controller.command(session,{action})};
  });
}
module.exports = { installHUD, clientText };
