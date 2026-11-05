"use strict";
const marker = Symbol.for("evejs.automining.manualModuleStops.v1");

// Observe only a successful player Dogma deactivation. AutoMining's own
// timers/travel/fuel stops call the scene directly and never pass this hook.
function installManualModuleStops(Service, controller, logError = console.error) {
  const proto = Service?.prototype, original = proto?.Handle_Deactivate;
  if (typeof original !== "function") return false;
  if (original[marker] === controller) return true;
  const wrapped = function(args, session) {
    const result = original.apply(this, arguments);
    if (result === 1) {
      try { controller.manualModuleStop(session, Number(args?.[0])); }
      catch (error) { logError(`[AutoMining] Manual module stop observation failed: ${error.message}`); }
    }
    return result;
  };
  wrapped[marker] = controller;
  proto.Handle_Deactivate = wrapped;
  return true;
}

module.exports = { installManualModuleStops };
