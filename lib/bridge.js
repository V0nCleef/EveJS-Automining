"use strict";

// Appended to the verified mining module in memory. All dogma calculations,
// inventory ownership, crystal matching and local-grid eligibility stay native.
module.exports = `
function autoMiningCandidate(scene, ship, entry) {
  return { ...entry, id: entry.entity.itemID,
    name: (resolveItemByTypeID(entry.state.yieldTypeID) || {}).name || entry.entity.typeName || entry.entity.itemName || "",
    distance: getMiningCommandSurfaceDistance(scene, ship, entry.entity) };
}
Object.defineProperty(module.exports, "__autoMiningBridge", { value: {
  modules(entity) {
    return resolveEntityFittedItems(entity).filter(isModuleOnline).map(item => {
      const effect = findMiningEffectRecordForModule(item);
      const snapshot = effect && buildEntityMiningSnapshot(entity, item, effect);
      return snapshot ? { item, effect, snapshot } : null;
    }).filter(Boolean);
  },
  candidates(scene, entity) {
    return resolveMineableCandidates(scene, entity).map(entry => autoMiningCandidate(scene, entity, entry));
  },
  target(scene, ship, id) {
    const entity = scene.getEntityByID(id);
    if (!entity || !isMineableStaticEntity(entity) || !canEntitiesInteractLocally(ship, entity)) return null;
    const state = getMineableState(scene, id);
    return state && state.remainingQuantity > 0 ? autoMiningCandidate(scene, ship, {entity,state}) : null;
  },
  hasRoom(scene, ship, id) {
    const state = getMineableState(scene, id);
    return state ? resolveDestinationFlagForPlayer(ship, state.yieldTypeID).availableVolume >= state.unitVolume : null;
  },
  compatible(scene, entity, module, rock, now, ignoreRange = false) {
    return (ignoreRange || rock.distance <= module.snapshot.maxRangeMeters) &&
      isMiningSnapshotCompatibleWithState(module.snapshot, rock.state) &&
      resolveDestinationFlagForPlayer(entity, rock.state.yieldTypeID).availableVolume >= rock.state.unitVolume;
  },
}});
`;
