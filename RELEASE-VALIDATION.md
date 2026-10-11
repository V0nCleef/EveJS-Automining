# AutoMining 1.2.15 release validation

Validated on 11 October 2026 in isolated Grid Check 0.2.0, Native EveJS 0.12.9 and EVE client 3396210. The production installation was left unchanged.

## Tested behavior

- Focused controller, crystals and Fleet Command regression checks: 86 passed. Earlier burst/industrial/rat/job checks also passed.
- HUD fixtures cover first-tab order, pulse acknowledgement, the shared native ore filter, readable results, recipient notices, protected fields, unrelated personal edits and restoration.
- All nine authored and delivered language catalogues cover the new labels, hints, states, errors and results.
- Real three-client fleet checks verified selection, ore-order delivery, Start, Stop + recall, Recall and nonleader rejection. The separate window preserves the main page.
- Real miner checks verified targeting and activation of two Strip Miner I modules on the commanded Veldspar while the personal Scordite filter stayed saved. Five deployed Mining Drone I physically returned to the bay after Stop + recall.
- Native LeaveFleet and commander Stop restored both mining settings and ore filters. Disconnect/session replacement, leadership and job changes have focused regression coverage.
- A disposable Porpoise matched the user's fitted Mining Foreman Burst equipment and charges. Its native cycle was 60 seconds; a 90-second interval produced successful starts 89.217 seconds apart, with an idle gap. Both controls reset to 60 seconds.
- Actual combined Launcher menu/login delivery: 261655 / 262144 expression bytes, using a full UUID token. The Fleet Command helper loads on demand.

## Publication checks

The final release checkout passed 99 focused controller, fleet-order, burst and login-delivery checks, plus HUD and nine-language checks. The extracted ZIP passed the passive native service harness in Grid Check with filesystem writes blocked. All 68 ZIP members and updater/checksum files were verified before upload.

## Package provenance

All production code, translations and artwork are copied byte-for-byte from the tested candidate. Only README and release manifest metadata are changed for publication. The ZIP contains production files only; repository tests, private logs, screenshots, videos, player settings, databases and test-environment tooling are excluded. Matching ZIP checksum and updater descriptor are separate release assets.

## Coverage limits

Native English rendering was inspected; nine-language contents and delivery were checked offline. Not every burst variant was fitted. Mining locks/module activation and drone return were verified, without a measured harvested-yield claim. Unchanged cross-system hauling/PVE routes, Docker gameplay and fresh 0.12.8 gameplay were not repeated for this update. Declared compatibility is separate from live verification.

## Update and rollback

Close clients and stop the server, then update AutoMining through Launcher Mods or Add ZIP. Restart the server and reconnect clients. Preserve character/job settings, fleet presets, statistics and Launcher profile preferences. Fleet Command orders are temporary and do not migrate. Restore the previous ZIP with the preserved data if rollback is needed.
