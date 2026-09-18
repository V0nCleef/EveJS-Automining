"use strict";

// Maximise separate rocks across mixed ranges/crystals. Only displace an earlier
// choice when needed to give an otherwise-sharing module its own eligible rock.
function planDistinct(rows, occupied) {
  const owners = new Map();
  const chosen = new Map();
  function assign(row, visited) {
    const candidates = row.targets.filter(r => !occupied.has(r.id));
    for (const rock of candidates) {
      if (!owners.has(rock.id)) {
        owners.set(rock.id, row);
        chosen.set(row.item.itemID, rock);
        return true;
      }
    }
    for (const rock of candidates) {
      if (visited.has(rock.id)) continue;
      visited.add(rock.id);
      const previous = owners.get(rock.id);
      if (assign(previous, visited)) {
        owners.set(rock.id, row);
        chosen.set(row.item.itemID, rock);
        return true;
      }
    }
    return false;
  }
  for (const row of rows) assign(row, new Set());
  return chosen;
}
module.exports = { planDistinct };
