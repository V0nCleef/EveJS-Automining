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
function installHUD(Service, controller, catalog, destinations = null) {
  const reply = (session, action) => {
    try { return JSON.stringify({ success:true, ...action(), ...controller.snapshot(session) }); }
    catch(error) { return JSON.stringify({success:false,message:String(error.message).slice(0,500)}); }
  };
  Service.prototype.Handle_AutoMiningGetState = (args,session) => reply(session,()=> args?.[0] ? {catalog:catalog()} : {});
  Service.prototype.Handle_AutoMiningFindStations = (args,session) => reply(session,()=>destinations.search(clientText(args?.[0],200),session));
  Service.prototype.Handle_AutoMiningResolveStations = (args,session) => reply(session,()=>destinations.resolveStationIDs(JSON.parse(clientText(args?.[0],512)),session));
  Service.prototype.Handle_AutoMiningStorages = (args,session) => reply(session,()=>({storages:destinations.storages(session, Number(args?.[0]))}));
  Service.prototype.Handle_AutoMiningHaulReady = (args,session) => reply(session,()=>({ready:controller.clientReady(session,1,1)}));
  Service.prototype.Handle_AutoMiningDronesReady = (args,session) => reply(session,()=>{controller.dronesReady(session);return {};});
  Service.prototype.Handle_AutoMiningDroneClaim = (args,session) => reply(session,()=>controller.droneClaim(session,clientText(args?.[0],64)));
  Service.prototype.Handle_AutoMiningDroneSync = (args,session) => reply(session,()=>controller.droneSync(session,clientText(args?.[0],64),args?.[1]));
  Service.prototype.Handle_AutoMiningDroneResult = (args,session) => reply(session,()=>{const ids=args?.[2]?.type==="list"?args[2].items:args?.[2];controller.droneResult(session,clientText(args?.[0],64),clientText(args?.[1],500),ids);return {};});
  Service.prototype.Handle_AutoMiningRatGroups = (args,session) => reply(session,()=>({ready:controller.ratGroups(session,clientText(args?.[0],20000))}));
  Service.prototype.Handle_AutoMiningHaulAction = (args,session) => reply(session,()=>({trip:controller.haulAction(session,clientText(args?.[0],64),clientText(args?.[1],20),clientText(args?.[2],200))}));
  Service.prototype.Handle_AutoMiningCancelHaul = (args,session) => reply(session,()=>{controller.cancelHaul(session,"Return trip cancelled.");return {};});
  Service.prototype.Handle_AutoMiningSetSettings = (args,session) => reply(session,()=>({message:controller.applySettings(session,clientText(args?.[0],100000))}));
  Service.prototype.Handle_AutoMiningControl = (args,session) => reply(session,()=>{
    const action = clientText(args?.[0],3);
    if (!["on","off"].includes(action)) throw new Error("Unknown AutoMining control.");
    return {message:controller.command(session,{action})};
  });
}
module.exports = { installHUD, clientText };
