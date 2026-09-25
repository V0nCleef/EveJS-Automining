"use strict";

// Appended to the verified mining module in memory. All dogma calculations,
// inventory ownership, crystal matching and local-grid eligibility stay native.
module.exports = `
// One short-lived public-grid inventory is shared by every AutoMining pilot
// in this scene. Ship range, visibility, depletion and filters stay per pilot.
const autoMiningFields = new WeakMap();
function autoMiningFieldEntities(scene, grid) {
  if (!grid) return [];
  let grids = autoMiningFields.get(scene);
  if (!grids) { grids = new Map(); autoMiningFields.set(scene, grids); }
  const source = scene.staticEntities;
  const now = Date.now();
  if (grids.size > 32) for (const [key, cached] of grids) if (now >= cached.expires) grids.delete(key);
  let entry = grids.get(grid);
  if (!entry || entry.source !== source || entry.length !== source.length || now >= entry.expires) {
    const ids = [];
    for (const rock of source) {
      if (isMineableStaticEntity(rock) &&
          (scene.getLivePublicGridClusterKeyForEntity?.(rock) || scene.getPublicGridClusterKeyForEntity(rock)) === grid)
        ids.push(rock.itemID);
    }
    entry = { source, length: source.length, ids, expires: now + 2000 };
    grids.set(grid, entry);
  }
  return entry.ids.map(id => scene.getEntityByID(id)).filter(rock => rock && isMineableStaticEntity(rock) &&
    (scene.getLivePublicGridClusterKeyForEntity?.(rock) || scene.getPublicGridClusterKeyForEntity(rock)) === grid);
}
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
  loadedCrystal(entity, module) {
    return resolveEntityLoadedCharge(entity, module.item);
  },
  crystalPlan(scene, ship, module, rocks, now, approach) {
    if (module.snapshot.family !== "ore") return null;
    // 0.12.9 removed miningModuleUsesCrystals from miningRuntime. Read the
    // native fitting attributes directly on both versions (charge size/group).
    const fitting = lazyRequire("../fitting/liveFittingState");
    const attributes = fitting.getTypeAttributeMap(module.item.typeID) || {};
    if (![128, 604].some(id => Number.isFinite(Number(attributes[id])) && Number(attributes[id]) > 0)) return null;
    const loaded = this.loadedCrystal(ship, module);
    const bare = { ...module, snapshot: { ...module.snapshot, chargeTypeID: 0, crystalTargetTypeListID: 0 } };
    const target = rocks.find(rock => this.compatible(scene, ship, bare, rock, now, approach));
    if (!target) return null;
    // Follow the ordered filter's first eligible rock. A crystal for a later
    // entry must not silently skip a higher-priority ore or grade.
    if (loaded && this.compatible(scene, ship, module, target, now, approach)) return null;
    const owner = resolveEntityCharacterID(ship);
    const attribute = fitting.getAttributeIDByNames("specializationAsteroidTypeList") || 3148;
    const charges = listContainerItems(owner, ship.itemID, ITEM_FLAGS.CARGO_HOLD)
      .filter(item => Number(item.ownerID) === owner && Number(item.locationID) === ship.itemID &&
        Number(item.flagID) === ITEM_FLAGS.CARGO_HOLD && Number(item.stacksize ?? item.quantity) > 0 &&
        Number(item.moduleState?.damage || 0) < 1 && isChargeCompatibleWithModule(module.item.typeID, item.typeID))
      .sort((a, b) => a.itemID - b.itemID);
    const charge = charges.find(item => isCrystalTargetCompatibleWithYield({
      chargeTypeID: item.typeID, crystalTargetTypeListID: fitting.getTypeAttributeMap(item.typeID)?.[attribute] || 0,
    }, target.state));
    if (!charge && !loaded) return null;
    return { loadedID: loaded?.itemID || 0, chargeID: charge?.itemID || 0, chargeTypeID: Number(charge?.typeID || 0) };
  },
  surveyGrid(scene, ship) {
    return scene.getLivePublicGridClusterKeyForEntity?.(ship) || scene.getPublicGridClusterKeyForEntity(ship);
  },
  miningSite(scene, ship) {
    const grid = this.surveyGrid(scene, ship);
    return autoMiningFieldEntities(scene, grid).some(rock => canEntitiesInteractLocally(ship, rock));
  },
  surveyResource(scene, ship, previousID) {
    // One remembered resource normally suffices. Only search for a replacement
    // when it disappears, depletes or belongs to a different local grid.
    if (previousID && this.target(scene, ship, previousID)) return previousID;
    const grid = this.surveyGrid(scene, ship);
    if (!grid) return null;
    ensureSceneMiningState(scene);
    for (const rock of autoMiningFieldEntities(scene, grid)) {
      if (!canEntitiesInteractLocally(ship, rock)) continue;
      if (getMineableState(scene, rock.itemID)?.remainingQuantity > 0) return rock.itemID;
    }
    return null;
  },
  candidates(scene, entity) {
    ensureSceneMiningState(scene);
    const grid = this.surveyGrid(scene, entity);
    if (!grid) return [];
    return autoMiningFieldEntities(scene, grid)
      .filter(rock => canEntitiesInteractLocally(entity, rock))
      .map(rock => ({entity:rock, state:getMineableState(scene, rock.itemID)}))
      .filter(entry => entry.state && entry.state.remainingQuantity > 0)
      .map(entry => autoMiningCandidate(scene, entity, entry));
  },
  target(scene, ship, id) {
    const entity = scene.getEntityByID(id);
    if (!entity || !isMineableStaticEntity(entity) || !canEntitiesInteractLocally(ship, entity)) return null;
    const grid = this.surveyGrid(scene, ship);
    if (!grid || (scene.getLivePublicGridClusterKeyForEntity?.(entity) || scene.getPublicGridClusterKeyForEntity(entity)) !== grid) return null;
    const state = getMineableState(scene, id);
    return state && state.remainingQuantity > 0 ? autoMiningCandidate(scene, ship, {entity,state}) : null;
  },
  hasRoom(scene, ship, id) {
    const state = getMineableState(scene, id);
    return state ? resolveDestinationFlagForPlayer(ship, state.yieldTypeID).availableVolume >= state.unitVolume : null;
  },
  oreHold(scene, ship, matches, now, threshold = 95, allowBoostOnly = false) {
    const storage = getPlayerShipStorageSnapshot(ship);
    if (!storage) return null;
    const flagID = [182, 134].find(flag => getShipHoldCapacityByFlag(storage.resourceState, flag) > 0);
    if (!flagID) return null;
    const capacity = getShipHoldCapacityByFlag(storage.resourceState, flagID);
    const free = getAvailableVolumeForFlag(storage, flagID);
    const modules = this.modules(ship, now).filter(m => m.snapshot.family === "ore");
    // Leave before the hold reaches its last awkward fraction of a cycle.
    let full = (modules.length > 0 || allowBoostOnly) && free <= capacity * (100 - threshold) / 100;
    // A positive sliver is full only when matching, usable ore exists but no
    // compatible unit fits. Capacity-free checks keep this distinct from range.
    if (!full && modules.length && free < capacity) {
      const eligible = rock => rock && rock.state.yieldKind === "ore" && matches(rock.name) &&
        resolveDestinationFlagForPlayer(ship, rock.state.yieldTypeID).flagID === flagID &&
        modules.some(m => isMiningSnapshotCompatibleWithState(m.snapshot, rock.state));
      const known = [...(ship.lockedTargets?.keys() || []), ...(ship.pendingTargetLocks?.keys() || [])]
        .map(id => this.target(scene, ship, id)).filter(eligible);
      if (known.some(rock => free >= rock.state.unitVolume)) return { flagID, capacity, used: capacity - free, free, full: false };
      const ore = this.candidates(scene, ship).filter(eligible);
      full = ore.length > 0 && ore.every(rock => free < rock.state.unitVolume);
    }
    return { flagID, capacity, used: capacity - free, free, full };
  },
  compatible(scene, entity, module, rock, now, ignoreRange = false) {
    return (ignoreRange || rock.distance <= module.snapshot.maxRangeMeters) &&
      isMiningSnapshotCompatibleWithState(module.snapshot, rock.state) &&
      resolveDestinationFlagForPlayer(entity, rock.state.yieldTypeID).availableVolume >= rock.state.unitVolume;
  },
}});
`;
