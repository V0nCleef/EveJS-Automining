"use strict";
const path = require("node:path");
const { shipHealth } = require("./defense");
const characterID = s => Number(s.characterID || s.charid || 0);
const shipID = s => Number(s.shipID || s.shipid || 0);

function createDeparture({ getSpace, getDrones, getItem, bayFlag, controller, userError,
  clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 180000 }) {
  const operations = new WeakMap();
  function cancel(session, reason = "Departure cancelled.", pause = true) {
    const op = operations.get(session);
    if (!op) return;
    operations.delete(session);
    op.cancelled = reason;
    if (characterID(session) === op.owner) controller.departureEnded(session, reason, pause);
  }
  function controlled(scene, ship, owner) {
    const runtime = getDrones();
    const entities = scene.droneEntityIDs instanceof Set
      ? [...scene.droneEntityIDs].map(id => scene.getEntityByID(id))
      : [...scene.dynamicEntities.values()];
    return entities.filter(d => runtime.isDroneEntity(d) && Number(d.controllerID) === ship.itemID && Number(d.ownerID) === owner);
  }
  function run(session, proceed) {
    // Replacement is explicit: the older RPC fails and can never move the ship.
    cancel(session, "Departure replaced by a new destination.", false);
    controller.departureEnded(session, "", false);
    const options = controller.departureOptions(session);
    if (!options.enabled) return proceed();
    const scene = getSpace().getSceneForSession(session), ship = scene?.getShipEntityForSession(session);
    if (!ship || ship.pendingWarp || ship.mode === "WARP") return proceed();
    if (options.retreatLayer) return retreat(session, scene, ship, options, proceed);
    const owner = characterID(session), drones = controlled(scene, ship, owner);
    if (!drones.length) return proceed();
    const op = { scene, ship: ship.itemID, owner, started: clock(), ids: new Set(), cancelled: "",
      haulID: controller.departureOptions(session).haulID };
    operations.set(session, op);
    return waitForBay(session, ship, op, proceed);
  }
  function retreat(session, scene, ship, options, proceed) {
    // Survival takes priority over drone recovery. Issue the ordinary native
    // return order, but a refused order must never cancel an emergency warp.
    const drones = controlled(scene, ship, characterID(session));
    if (!drones.length) return proceed();
    const runtime = getDrones();
    const recall = drones.filter(drone => drone.droneCommand !== runtime.DRONE_COMMAND_RETURN_BAY)
      .map(drone => drone.itemID);
    if (recall.length) {
      try { runtime.commandReturnBay(session, recall); }
      catch { /* The ship still needs to leave. */ }
    }
    if (options.retreatLayer === "armor" || retreatIsUrgent(ship))
      return proceed();
    const op = { scene, ship: ship.itemID, owner: characterID(session), started: clock(),
      cancelled: "", haulID: options.haulID };
    operations.set(session, op);
    controller.departureStarted(session);
    return waitForRetreatBay(session, ship, op, proceed);
  }
  function retreatIsUrgent(ship) {
    const shield = shipHealth(ship).shield;
    return shield === null || shield <= 0 || Number(ship.conditionState?.armorDamage || 0) > 0;
  }
  async function waitForRetreatBay(session, ship, op, proceed) {
    try {
      while (controlled(op.scene, ship, op.owner).length && clock() - op.started < timeout &&
             !retreatIsUrgent(ship)) {
        if (op.cancelled) throw Error(op.cancelled);
        if (controller.departureOptions(session).haulID !== op.haulID ||
            characterID(session) !== op.owner || shipID(session) !== op.ship ||
            getSpace().getSceneForSession(session) !== op.scene ||
            op.scene.getShipEntityForSession(session) !== ship ||
            ship.pendingWarp || ship.mode === "WARP" || session.stationID || session.stationid)
          throw Error("Defense retreat cancelled after a ship or location change.");
        await sleep(250);
      }
      if (op.cancelled) throw Error(op.cancelled);
      if (operations.get(session) !== op || controller.departureOptions(session).haulID !== op.haulID ||
          characterID(session) !== op.owner || shipID(session) !== op.ship ||
          getSpace().getSceneForSession(session) !== op.scene ||
          op.scene.getShipEntityForSession(session) !== ship ||
          ship.pendingWarp || ship.mode === "WARP" || session.stationID || session.stationid)
        throw Error("Defense retreat cancelled after a ship or location change.");
    } catch (error) {
      if (operations.get(session) === op) {
        operations.delete(session);
        controller.departureEnded(session, error.message, true);
      }
      return userError(error.message);
    }
    operations.delete(session);
    controller.departureEnded(session, "", false);
    return proceed();
  }
  async function waitForBay(session, ship, op, proceed) {
    try {
      controller.departureStarted(session);
      // Hold position, including cancelling an earlier docking approach.
      op.scene.stop(session);
      while (true) {
        if (op.cancelled) throw Error(op.cancelled);
        if (op.haulID && controller.departureOptions(session).haulID !== op.haulID) throw Error("Hauling departure cancelled.");
        if (!session.socket || session.socket.destroyed || characterID(session) !== op.owner || shipID(session) !== op.ship ||
            getSpace().getSceneForSession(session) !== op.scene || op.scene.getShipEntityForSession(session) !== ship ||
            ship.pendingWarp || ship.mode === "WARP" || session.stationID || session.stationid) {
          throw Error("Departure cancelled after a connection, ship or location change.");
        }
        if (clock() - op.started >= timeout) throw Error("Drone recall timed out. Travel cancelled; check drone range and bay capacity.");
        const runtime = getDrones(), recall = [];
        for (const drone of controlled(op.scene, ship, op.owner)) {
          if (!op.ids.has(drone.itemID)) {
            op.ids.add(drone.itemID);
            // Alternate Mining Drones may already have ordered this return.
            if (drone.droneCommand !== runtime.DRONE_COMMAND_RETURN_BAY) recall.push(drone.itemID);
          } else if (drone.droneCommand !== runtime.DRONE_COMMAND_RETURN_BAY) {
            throw Error("A drone received another order. Departure cancelled.");
          }
        }
        if (recall.length) {
          // Use the exported native command so other mods see normal player
          // takeover and keep their hands off until the next launch.
          const result = runtime.commandReturnBay(session, recall);
          if (!result || result.type !== "dict" || !Array.isArray(result.entries) || result.entries.length) {
            throw Error("Drone return was refused. Travel cancelled; check drone access and bay capacity.");
          }
        }
        let remaining = 0;
        for (const id of op.ids) {
          const item = getItem(id), entity = op.scene.getEntityByID(id);
          const inBay = item && Number(item.ownerID) === op.owner && Number(item.locationID) === op.ship &&
            // Native assembled inventory rows encode quantity as -1; stacksize
            // is the actual unit count. Never mistake a recovered singleton for
            // a missing drone and discard the pending navigation command.
            Number(item.flagID) === bayFlag() && Number(item.stacksize ?? item.quantity) > 0;
          if (inBay && !entity) continue;
          if (!entity || Number(entity.controllerID) !== op.ship || Number(entity.ownerID) !== op.owner) {
            throw Error("A drone is missing or no longer controlled; return to the bay cannot be confirmed. Travel cancelled.");
          }
          remaining++;
        }
        if (!remaining) break;
        controller.departureProgress(session, `Recalling drones: ${remaining} still outside the bay. Stop cancels departure.`);
        await sleep(500);
      }
    } catch (error) {
      if (operations.get(session) === op) {
        operations.delete(session);
        if (characterID(session) === op.owner) controller.departureEnded(session, error.message, true);
      }
      return userError(error.message);
    }
    // No yield between final inventory confirmation and the original command.
    operations.delete(session);
    controller.departureEnded(session, "", false);
    // Preserve native return values and errors (notably DockingApproach).
    return proceed();
  }
  return { run, cancel, pending: session => operations.has(session) };
}

function createNativeDeparture(root, controller) {
  const load = name => require(path.join(root, "server/src", name));
  const guard = createDeparture({ controller,
    getSpace: () => load("space/runtime.js"), getDrones: () => load("services/drone/droneRuntime.js"),
    getItem: id => load("services/inventory/simulationInventoryProjection.js").findItemById(id),
    bayFlag: () => load("services/inventory/itemStore.js").ITEM_FLAGS.DRONE_BAY,
    userError: message => load("common/machoErrors.js").throwWrappedUserError("CustomNotify", { notify: message }),
  });
  guard.fleetFollowers = session => load("services/fleets/fleetRuntime.js")
    .collectFleetWarpFollowers(characterID(session))
    .filter(member => {
      const follower = member.session;
      const leaderSystem = Number(session.solarsystemid2 || session.solarsystemid || 0);
      const followerSystem = Number(follower?.solarsystemid2 || follower?.solarsystemid || 0);
      return follower && (!leaderSystem || !followerSystem || leaderSystem === followerSystem);
    }).map(member => member.session);
  return guard;
}

function fleetWarpRequested(kwargs) {
  const entries = Array.isArray(kwargs?.entries) ? kwargs.entries
    : kwargs instanceof Map ? [...kwargs.entries()]
    : kwargs && typeof kwargs === "object" ? Object.entries(kwargs) : [];
  const match = entries.find(([key]) => String(key?.value ?? key) === "fleet");
  return match ? Boolean(match[1]?.value ?? match[1]) : false;
}

function installNavigation(Service, controller, departure) {
  for (const name of ["Handle_CmdGotoDirection", "Handle_CmdGotoPoint", "Handle_CmdGotoBookmark", "Handle_CmdOrbit", "Handle_CmdStop", "Handle_CmdFollowBall", "Handle_CmdStargateJump"]) {
    const original = Service.prototype[name];
    if (typeof original !== "function") continue;
    Service.prototype[name] = function(args, session) {
      departure.cancel(session, "Departure cancelled by manual navigation.");
      // Autopilot uses FollowBall and StargateJump for normal travel.
      if (!["Handle_CmdFollowBall", "Handle_CmdStargateJump"].includes(name)) controller.cancelHaul(session, "Return trip cancelled by manual navigation.");
      return original.apply(this, arguments);
    };
  }
  for (const name of ["Handle_CmdWarpToStuff", "Handle_CmdDock", "Handle_CmdWarpToStuffAutopilot"]) {
    const original = Service.prototype[name];
    if (typeof original !== "function") continue;
    Service.prototype[name] = function(args, session) {
      const options = controller.departureOptions(session);
      // Autopilot warp can leave drones behind just like a manual warp.
      if (name === "Handle_CmdWarpToStuff" || name === "Handle_CmdDock" && options.hauling && Number(args?.[0]) !== options.stationID) {
        controller.cancelHaul(session, "Return trip cancelled by manual navigation.");
      }
      const callArgs = arguments;
      const proceed = () => original.apply(this, callArgs);
      if (name === "Handle_CmdWarpToStuff" && fleetWarpRequested(callArgs[2]) && departure.fleetFollowers) {
        const followers = departure.fleetFollowers(session).filter(follower => follower !== session);
        if (followers.length) {
          // Native fleet warp bypasses every follower's RPC handler. Prepare
          // all members before the commander starts the native group warp.
          return Promise.all(followers.map(follower => departure.run(follower, () => true)))
            .then(() => departure.run(session, proceed));
        }
      }
      return departure.run(session, proceed);
    };
  }
}
module.exports = { createDeparture, createNativeDeparture, installNavigation };
