"use strict";

// Read the scene's current interaction grid, never an estimated distance or
// a single partition box. Adjacent boxes may belong to one native bubble.
// Keep private/dungeon scope and visibility decisions with each native caller.
function publicGrid(scene, entity) {
  if (!scene || !entity) return null;
  if (typeof scene.getGridBubbleIDForEntity === "function") {
    // 261028.1: AddBall/re-box/remove own membership. An unregistered Ball has
    // no grid; do not revive it from a cached publicGridKey or its position.
    return scene.getGridBubbleIDForEntity(entity) ?? null;
  }
  // Reviewed older scenes retain their native live cluster authority.
  return scene.getLivePublicGridClusterKeyForEntity?.(entity) ||
    scene.getPublicGridClusterKeyForEntity?.(entity) || null;
}

module.exports = { publicGrid };
