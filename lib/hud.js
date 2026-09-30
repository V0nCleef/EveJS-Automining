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
    try {
      const result = action();
      return JSON.stringify({ success:true, ...controller.snapshot(session), ...result });
    }
    catch(error) { return JSON.stringify({success:false,message:String(error.message).slice(0,500)}); }
  };
  Service.prototype.Handle_AutoMiningGetState = (args,session) => reply(session,()=> args?.[0] ? {catalog:catalog()} : {});
  Service.prototype.Handle_AutoMiningJobProfile = (args,session) => reply(session,()=>controller.jobProfile(session,clientText(args?.[0],16)));
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
  Service.prototype.Handle_AutoMiningJettison = (args,session) => reply(session,()=>({oreHandling:controller.jettison(session)}));
  Service.prototype.Handle_AutoMiningTransportReady = (args,session) => reply(session,()=>({ready:controller.transportReady(session)}));
  Service.prototype.Handle_AutoMiningFleetReady = (args,session) => reply(session,()=>({ready:controller.fleetReady(session)}));
  Service.prototype.Handle_AutoMiningFleetAction = (args,session) => reply(session,()=>({fleet:controller.fleetAction(session,clientText(args?.[0],32),clientText(args?.[1],20000))}));
  Service.prototype.Handle_AutoMiningBelts = (args,session) => reply(session,()=>({belts:controller.searchBelts(session,clientText(args?.[0],200))}));
  Service.prototype.Handle_AutoMiningBeltCatalog = (args,session) => reply(session,()=>controller.catalogBelts(session,args?.[0] ?? 0,args?.[1] ?? 500));
  Service.prototype.Handle_AutoMiningPVEReady = (args,session) => reply(session,()=>({ready:controller.pveReady(session)}));
  Service.prototype.Handle_AutoMiningPVEAction = (args,session) => reply(session,()=>({pve:controller.pveAction(session,clientText(args?.[0],64),clientText(args?.[1],32),clientText(args?.[2],16384))}));
  Service.prototype.Handle_AutoMiningPVEFleets = (args,session) => reply(session,()=>({pveFleets:controller.pveFleets(session)}));
  Service.prototype.Handle_AutoMiningCallReinforcements = (args,session) => reply(session,()=>({reinforcement:controller.reinforcementCall(session)}));
  Service.prototype.Handle_AutoMiningPVEPlan = (args,session) => reply(session,()=>controller.pvePlan(session,clientText(args?.[0],16384)));
  Service.prototype.Handle_AutoMiningPVEAmmoGroups = (args,session) => reply(session,()=>controller.pveAmmoGroups(session,clientText(args?.[0],16384)));
  Service.prototype.Handle_AutoMiningPVEHeartbeat = (args,session) => reply(session,()=>({ready:controller.pveHeartbeat(session,clientText(args?.[0],64))}));
  Service.prototype.Handle_AutoMiningTransportRequest = (args,session) => reply(session,()=>({pickup:controller.transportRequest(session)}));
  Service.prototype.Handle_AutoMiningTransportAction = (args,session) => reply(session,()=>{
    const transport = controller.transportAction(session,clientText(args?.[0],64),clientText(args?.[1],32),clientText(args?.[2],20000));
    return { transport, job: transport?.job || null, authorized: transport?.authorized === true };
  });
  Service.prototype.Handle_AutoMiningStopFleet = (args,session) => reply(session,()=>controller.stopFleet(session));
  Service.prototype.Handle_AutoMiningStatistics = (args,session) => reply(session,()=>({statistics:controller.statistics(session,clientText(args?.[0],10) || "pilot",clientText(args?.[1],12) || "session")}));
  Service.prototype.Handle_AutoMiningResetStatistics = (args,session) => reply(session,()=>({statistics:controller.resetStatistics(session)}));
  Service.prototype.Handle_AutoMiningStatisticsSessions = (args,session) => reply(session,()=>({sessions:controller.statisticsSessions(session,args?.[0] ?? 0,args?.[1] ?? 20)}));
  Service.prototype.Handle_AutoMiningSetSettings = (args,session) => reply(session,()=>({message:controller.applySettings(session,clientText(args?.[0],100000))}));
  Service.prototype.Handle_AutoMiningControl = (args,session) => reply(session,()=>{
    const action = clientText(args?.[0],3);
    if (!["on","off"].includes(action)) throw new Error("Unknown AutoMining control.");
    return {message:controller.command(session,{action})};
  });
}
module.exports = { installHUD, clientText };
