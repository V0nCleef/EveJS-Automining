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
  hasSurveyor(entity) {
    // Same two effective ship attributes used by the native Mining Surveyor
    // button. Passive fitting state already reflects online modules/implants.
    const attributes = entity.passiveDerivedState?.attributes;
    if (!attributes) return false;
    const fitting = lazyRequire("../fitting/liveFittingState");
    return ["integratedMiningScanner", "miningScannerUpgrade"].some(name =>
      Number(attributes[fitting.getAttributeIDByNames(name)]) > 0);
  },
  modules(entity, now) {
    return resolveEntityFittedItems(entity).filter(isModuleOnline).map(item => {
      const effect = findMiningEffectRecordForModule(item);
      const snapshot = effect && buildEntityMiningSnapshot(entity, item, effect, { nowMs: now });
      return snapshot ? { item, effect, snapshot } : null;
    }).filter(Boolean);
  },
  boostSignature(entity, modules, now) {
    return JSON.stringify(modules.map(({item}) => [item.itemID,
      commandBurstRuntime.collectModifierEntriesForItem(entity, item, now)]));
  },
  surveyGrid(scene, ship) {
    return scene.getPublicGridClusterKeyForEntity(ship);
  },
  surveyResource(scene, ship, previousID) {
    // One remembered resource normally suffices. Only search for a replacement
    // when it disappears, depletes or belongs to a different local grid.
    if (previousID && this.target(scene, ship, previousID)) return previousID;
    const grid = this.surveyGrid(scene, ship);
    if (!grid) return null;
    ensureSceneMiningState(scene);
    for (const rock of scene.staticEntities) {
      if (!isMineableStaticEntity(rock) ||
          scene.getPublicGridClusterKeyForEntity(rock) !== grid ||
          !canEntitiesInteractLocally(ship, rock)) continue;
      if (getMineableState(scene, rock.itemID)?.remainingQuantity > 0) return rock.itemID;
    }
    return null;
  },
  candidates(scene, entity) {
    ensureSceneMiningState(scene);
    const grid = scene.getPublicGridClusterKeyForEntity(entity);
    if (!grid) return [];
    return scene.staticEntities
      .filter(rock => isMineableStaticEntity(rock) && canEntitiesInteractLocally(entity, rock) &&
        scene.getPublicGridClusterKeyForEntity(rock) === grid)
      .map(rock => ({entity:rock, state:getMineableState(scene, rock.itemID)}))
      .filter(entry => entry.state && entry.state.remainingQuantity > 0)
      .map(entry => autoMiningCandidate(scene, entity, entry));
  },
  target(scene, ship, id) {
    const entity = scene.getEntityByID(id);
    if (!entity || !isMineableStaticEntity(entity) || !canEntitiesInteractLocally(ship, entity)) return null;
    const grid = scene.getPublicGridClusterKeyForEntity(ship);
    if (!grid || scene.getPublicGridClusterKeyForEntity(entity) !== grid) return null;
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
