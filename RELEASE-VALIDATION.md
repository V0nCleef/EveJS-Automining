# AutoMining 1.2.16 release validation

Validated on 12 October 2026 in isolated Grid Check 0.2.0, Native EveJS 0.12.9 and EVE client 3396210. The production mod and Grid Check configuration were preserved.

## Changes verified

- Empty-filter crystal preparation: a real Retriever with two Modulated Strip Miner II modules arrived in an Average Gneiss Deposit with incompatible Simple Asteroid Mining Crystal Type B II loaded and only Simple crystals in cargo. Both empty personal and fleet filters remained empty. Native crystal handling unloaded the incompatible crystals and both strip miners acquired Gneiss III-Grade and activated bare.
- Fleet Command drone targeting: the real leader window presents a Mining drones tab with target priority and Focus/Spread controls. A Porpoise and Retriever showed the commander's effective values and protected controls while retaining personal preferences. Unrelated Apply operations preserved those preferences. Restore personal drone targeting and native LeaveFleet cleared the override correctly; a nonleader command was rejected.
- Drone gameplay: five individually grouped Mining Drone I focused one Gneiss rock under a fleet order, then spread across five different rocks after restoring the pilot's personal settings. Strip miners continued operating during the drone-only order.
- Dual Porpoise bursts: both fitted Mining Foreman Burst modules resumed after staggered native reload completion. The Laser Field Enhancement Charge module activated 334 ms after readiness; the Mining Laser Optimization Charge module activated 605 ms after readiness. At configured 85-second intervals, consecutive successful starts were 85.549 and 85.551 seconds apart. These intervals remain independent per module.

## Focused checks

- 145 controller, crystal, burst, fleet-order, mining-drone, industrial and rat regression checks passed, including preservation of active laser cycles and target locks through drone-only orders and restoration.
- HUD fixtures passed for the new command page, strict two-field requests, Mining/Boosting recipient notices, protected controls, personal Apply values and restoration.
- Main and Fleet Command language-catalogue checks passed for all nine existing languages. Login delivery checks: 12 passed.
- Actual combined Launcher menu/login delivery remained 261655 / 262144 expression bytes with a full UUID token; the new window code loads on demand.
- The real native crystal planner bridge and passive native service-load harness passed. The passive harness blocked filesystem writes and reported none.
- Native screenshots were inspected for the command window and recipient's Mining drones page. Test clients and the owned Grid Check server were closed after testing.

## Coverage limits

Fresh live coverage is Native 0.12.9 with English rendering. Other language contents and delivery were checked offline. Docker, 0.12.8, unchanged hauling/PVE routes and every crystal/burst variant were not retested. The anomaly check proves target acquisition and module activation; it does not claim a measured harvested yield. An 85-second interval is a test override, not a new default.

## Installation

Close production clients, stop the server and Launcher, then update the mod with a rollback copy. Preserve player/job settings, statistics, fleet presets and Launcher profile preferences. Temporary fleet orders do not persist across sessions. This release was not installed into the maintainer's production Launcher during publication.

## Package provenance

Runtime code, translations and artwork match the tested candidate byte-for-byte. Only version metadata and public documentation change for publication. The package includes the native helper, legacy helper, patch asset and Launcher updater metadata. Private evidence, player data, videos and test tooling are excluded. All ZIP members and release assets are verified before publication.
