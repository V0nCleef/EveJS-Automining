"use strict";
const { randomUUID } = require("node:crypto");

function validGroupKey(key) {
  if (key === "") return true;
  if (typeof key !== "string" || key.length > 1024) return false;
  try {
    const id = JSON.parse(key);
    return Array.isArray(id) && id.length === 2 && id.every(x => typeof x === "string" && x.length > 0 && x.length <= 256);
  } catch { return false; }
}

// Group membership belongs to the native client. The server authorizes one
// launch request per arrival; it never guesses drone types from group names.
function createDroneLaunch({ getAPI, getSpace, pendingDeparture, clock = Date.now }) {
  function safe(session, s, scene, ship, kind = "arrival") {
    return s.enabled && (kind === "arrival" ? s.launchDrones : s.ratDefenseEnabled) && s.droneClientReady &&
      !s.haul && !pendingDeparture(session) && ship?.kind === "ship" &&
      !session.stationID && !session.stationid && !ship.pendingWarp && ship.mode !== "WARP" &&
      !ship.pendingDock && !ship.dockingTargetID && !ship.cloaked && !ship.isCloaked;
  }
  function invalidate(s) { s.droneLaunchGrant = null; }
  function arm(s) { invalidate(s); s.droneArrival = true; s.nextDroneCheck = 0; }
  function inspect(session, s, scene, ship) {
    const grant = s.droneLaunchGrant;
    if (grant && (clock() > grant.expires || grant.scene !== scene || grant.shipID !== ship?.itemID || !safe(session, s, scene, ship, grant.kind))) invalidate(s);
    const warping = !!(ship?.pendingWarp || ship?.mode === "WARP");
    if (s.enabled && warping && !s.droneWasWarping) arm(s);
    s.droneWasWarping = warping;
  }
  function arrival(session, s, scene, ship, now) {
    if (!s.droneArrival) return;
    if (!s.launchDrones) { s.droneArrival = false; return; }
    if (!safe(session, s, scene, ship) || now < (s.nextDroneCheck || 0)) return;
    s.nextDroneCheck = now + 5000;
    const api = getAPI(), grid = api?.surveyGrid?.(scene, ship);
    if (!grid || !api.surveyResource(scene, ship, null) || api.miningSite?.(scene, ship) === false) return;
    if (requestGroup(session, s, scene, ship, s.droneGroupKey, "arrival")) s.droneArrival = false;
  }
  function requestGroup(session, s, scene, ship, groupKey, kind = "ratFighters") {
    if (!validGroupKey(groupKey) || !groupKey || !safe(session, s, scene, ship, kind)) return false;
    const api = getAPI(), grid = api?.surveyGrid?.(scene, ship);
    if (!grid || api.miningSite?.(scene, ship) === false || kind === "arrival" && !api.surveyResource(scene, ship, null)) return false;
    const grant = { id: randomUUID(), scene, grid, shipID: ship.itemID, characterID: s.characterID,
      groupKey, kind, expires: clock() + 30000, claimed: false };
    s.droneLaunchGrant = grant;
    s.droneStatus = "Requesting launch of the selected drone group.";
    try {
      session.sendNotification("OnAutoMiningLaunchDrones", "clientID", [JSON.stringify({ id: grant.id,
        shipID: grant.shipID, characterID: grant.characterID, groupKey: grant.groupKey, kind })]);
    } catch {
      invalidate(s);
      s.droneStatus = "Drone launch request could not be delivered. Use Start / Resume to try again.";
      return false;
    }
    return true;
  }
  function claim(session, s, id) {
    const g = s.droneLaunchGrant, scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
    if (!g || g.id !== id || g.claimed || clock() > g.expires || g.characterID !== s.characterID ||
        g.shipID !== ship?.itemID || g.scene !== scene ||
        (g.kind === "ratFighters" ? g.groupKey !== s.ratFighterGroupKey :
          g.kind === "ratMiners" ? g.groupKey !== s.ratMiningGroupKey : g.groupKey !== s.droneGroupKey) ||
        !safe(session, s, scene, ship, g.kind) || getAPI()?.surveyGrid(scene, ship) !== g.grid ||
        getAPI()?.miningSite?.(scene, ship) === false) throw Error("Drone launch is no longer authorized.");
    g.claimed = true;
    s.droneStatus = "Drone launch authorized; awaiting the native client.";
    return { groupKey: g.groupKey };
  }
  function result(s, id, message) {
    if (s.droneLaunchGrant?.id !== id) return null;
    const grant = s.droneLaunchGrant;
    s.droneStatus = message || "Drone launch finished.";
    invalidate(s);
    return grant;
  }
  return { arm, inspect, arrival, requestGroup, claim, result, invalidate };
}
module.exports = { createDroneLaunch, validGroupKey };
