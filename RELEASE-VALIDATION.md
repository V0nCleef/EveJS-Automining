# AutoMining 1.2.23: queued native Stop on hauling return

Release 1.2.23, validated on 30 October 2026.

The release uses the exact installed/tested ZIP, SHA-256
`bc71a954e55c4b0f305cc4f140082576feeb3fc7fc9d435bc40d48046bff3ac4`.
Its bundled README and validation document are pre-publication snapshots.
Only these two public source documents were updated for publication; runtime,
client, descriptor and artwork members match the tested package.

The unchanged 1.2.22 build reproduced the reported failure in an isolated real
EVE client under GridCheck 0.3.6 / EveJS 261028.1 / client build 3396210:
station unload, undock, return to the saved position, then OFF with
`Hauling paused: Mining position has not been reached.`

261028.1 queues movement until the next Destiny tick. The old hauling code
acknowledged arrival as soon as native Stop accepted the order, even while the
ship remained in GOTO. The client's immediate completion RPC then rejected it.
`lib/hauling.js` now waits for queued movement to apply and for native STOP mode
before acknowledging arrival. Repeated polls do not queue duplicate Stops.
Later manual commands retain priority, and pending movement cannot authorize
mining or completion. Earlier immediate-Stop scenes retain their existing flow.

The candidate completed **two automatic station unload-and-return trips** with
a Retriever, two Strip Miner Is, a blank ore filter and automatic approach.
After the first return, actual mining filled the disposable test threshold and
started the second trip without another Start. After the second return it stayed
ON for 195 seconds and gained **17787 committed ore units**, while mining
remained active. The temporary 1% test threshold was raised to 95% only on the
last departure so sustained post-return mining could be measured.

54 focused server checks and 9 client-companion checks pass. The reusable
`tests/native-queued-hauling-return.cjs` also reproduces the original error using
the actual native movement queue and Stop implementation, then passes with the
fix, including a later manual movement command. The existing immediate-Stop,
landing, timeout, cargo confirmation, defense and fuel cases remain covered.
All packaged client and translation bytes are unchanged from 1.2.22.

GridCheck used a fresh game store, a test-only market with static catalogues and
no copied orders/trades/receipts, dedicated account/profile and ports 31140-31150.
No player service was controlled. Player package/state/core/database hashes were
checked unchanged before installation. Raw ErrorReports, RPC state samples,
native GridCheck timelines, the baseline capture and final acceptance receipt
remain local. Offline client content/chat timeouts were observed separately;
they do not establish a clean full-client integration or chat result.

This is targeted GridCheck evidence, not a guarantee for every hull, remote
station route, corporation storage, Docker environment or extended session.
The only runtime file changed by this fix is `lib/hauling.js`.

---

# AutoMining 1.2.22: native grid lookup runtime fix

**Release status, 30 October 2026:** the installed 1.2.22 build was reported
working in native gameplay after the fix. This is user-reported confirmation;
it does not establish Docker, all hulls, extended sessions or soak coverage.
The release ZIP is the unchanged installed/tested archive, SHA-256
`0c8b927002b4bbe7ffd21adb8cad4e6a14d66801ce1f36670ab4bd11474d3356`.
Its included documentation predates this confirmation. Runtime, client and
artwork members correspond to this release's source; only the public README
and this validation document contain the later release-status update.

The actual client report on 29 October 2026 established that 1.2.21 restored the UI but Start / Resume switched the job off. Launcher server-console lines 4045, 4899, 4988, 5283 and 5308 record: `Automation stopped after error: scene.getPublicGridClusterKeyForEntity is not a function`. The saved ore filters were empty. This is an API mismatch, not a filter or range error. The controller catches the exception, clears fleet-command overrides and disables the job.

261028.1 replaces cluster-key methods with native `getGridBubbleIDForEntity`. New lib/grid.js reads that authority in mining discovery, boosting, rat defense, fleet ore handling, automatic fleet grouping, PVE/deployment and statistics. Adjacent partition boxes can share a bubble; box keys and distance approximations are not substitutes. Native null membership stays null even if cached box fields exist. Older reviewed scenes retain the existing live-cluster path. Native ownership, AIR/Abyssal isolation, shared dungeon-resource semantics, targetability, range, permissions and committed inventory/statistics handling remain in place.

A failing regression reproduces the exact error and OFF transition using the real 261028.1 spatial topology and grid-bubble modules. After the fix, the same controller with an empty filter locks a target, starts its module, executes the actual native mining-cycle function against in-memory authorities and remains ON on the next tick. An empty grid waits ON. Additional controls exercise adjacent boxes, different bubbles, removal, native AIR/Abyssal scope, shared dungeon resources, invalid scope and targetability.

246 focused checks pass across 16 relevant files. Six existing feature suites also pass with the obsolete grid methods removed from their fixtures, covering boosting/defense, fleet ore transfer, automatic fleet groups, PVE, deployment and combat statistics. No player database or running player service was used by these tests. The user subsequently reported the installed fix working in native gameplay. The earlier 1.2.21 evidence below is retained as historical evidence and did not establish successful live grid lookup.

---

# AutoMining 1.2.21 local compatibility validation

Unpublished local build for EveJS 261028.1, prepared 29 October 2026.

The installed 1.2.20 package was present and loader.js enabled, but its exact mining-source guard refused the new runtime before login delivery initialized. Existing canonical and legacy settings/statistics/fleet groups were present.

Changes: reviewed LF/CRLF native mining baselines; retain new cargo receipts, NPC duplicate/compensation paths, fresh hold occupancy, native AIR settlement, crystals, residue and statistics. No legacy mining patch is applied to 261028.1. Launcher install/verify/profile preparation now reports unsupported mining source before claiming readiness; removal/disable remain available. All existing client sources and nine language catalogs are retained.

Verification: 204 focused Node checks; eight isolated native adapter/bridge checks using copied source, static JSON and a fresh empty SQLite schema; HUD, nine-language catalogs, fleet commands, login companion and the actual public Mods registry. Real native codec packet composition retains AutoMining, Asteroid Erosion and Localtime in either wrapper order (237688 bytes). Shared Launcher menu delivery retains the original login and exact menu entrypoint bytes. No player databases are used by these tests. State tests cover canonical precedence, revisions/history, migration races, failed writes and restart reads.

Limits: native checks execute in memory or passively load native modules; no full server startup, retail-client session, Grid Check gameplay, Docker or soak was performed on 261028.1. The two-client 261018.1 gameplay evidence below is historical coverage. Existing features were retained; this is not a claim of exhaustive gameplay coverage.

The five-file local install uses the existing Launcher lifecycle OS lock, preserves the enabled loader choice, and updates only AutoMining's root-local registry record. No shared core, other mod, global Launcher config, world database, certificate or physical client archive changes are part of this build. A single verified rollback ZIP contains the old AutoMining package and its own state/config copies.

---

# AutoMining 1.2.20 release validation

**Testing so far: isolated Grid Check only. Normal gameplay validation is still pending.**

Two real EVE clients were used inside Grid Check; this is not approval from normal fleet gameplay. No normal Launcher or server installation was modified for this release.

## Changes

- Fleet-hangar delivery now honors the miner's effective automatic-compression
  setting, including temporary Fleet Command overrides. Receiver-first intake
  also checks that setting before transferring ore.
- A miner reaching its unload threshold approaches an accessible stationary
  receiving booster on the same public grid. It brakes inside the native 2500 m
  transfer boundary. Compression shrinking the hold does not cancel delivery.
- Automatic mining movement waits during delivery and resumes after transfer.
  Explicit manual navigation disowns the approach; Start / Resume re-arms it.
- Mining-drone group configuration stays enabled for Mining and Boosting,
  including while docked and with automatic mining-drone orders disabled.
- Added the approach status in all nine client languages. The production default
  fullness threshold remains 95%; only disposable test pilots used 5%.

## Reproduced on the original 1.2.19 build

- In two real Grid Check clients, an active Porpoise core/compressor and a same-
  fleet miner at zero surface distance left raw Veldspar uncompressed even
  though automatic compression was enabled in fleet-hangar mode.
- A full miner remained about 31.4 km from the receiving booster without an
  approach command. Ore remained aboard.
- The Boosting mining-group selector was disabled when mining-drone orders were
  off. A clean Mining selector already worked while docked; the report did not
  reproduce as a blanket station restriction for every job.
- Seven new regression checks fail against the unchanged 1.2.19 controller and
  fleet-ore modules. Their controls pass against the candidate.

## Verified

- 78 focused Node checks pass, covering compression, admission policy, movement
  ownership, manual steering, permissions, fleet changes, ordinary return trips,
  industrial activity, persistence and the unchanged login-delivery size limit.
- HUD and all nine language-catalog checks pass.
- The real docked Boosting dropdown opens, Miners can be clicked in its native
  menu, Apply saves the selected group, and automatic drone orders remain off.
- A real Retriever approaches from 31.4 km, retains delivery after compression
  shrinks the hold below the test threshold, transfers compressed ore through the
  Porpoise fleet hangar into its mining hold, and resumes both native Strip Miner
  I HUD modules without a second Start.
- The final source was reloaded in Grid Check. With compressed-only admission and
  the compressor inactive, 20000 raw Veldspar units remain aboard. Enabling the
  core brings compression online and all 20000 units compress and transfer
  without restarting the miner. Both-form admission then compresses/transfers
  another 1000 units without depositing raw ore.
- Final native runtime hashes match the packaged controller, fleet-ore module,
  HUD and translation sources. The shared Grid Check config, normal mod and
  production server configuration are unchanged. Test clients/server are closed.

## Test harness corrections and limits

The first travel watcher ended before the final bounded transfer batches. A
follow-up without sending Start confirmed completion and both strip miners
active; its original watcher result is retained in local evidence. An older
industrial-activity test failed identically on 1.2.19 because it skipped the
current position acknowledgement; its fixture now uses that public action.

Native gameplay covers two disposable pilots, Porpoise/Retriever, Veldspar and a
public asteroid-belt grid on EveJS 261018.1 / EVE build 3396210. Permission/fleet
loss and manual steering are covered by focused checks, not an exhaustive live
matrix. Anomaly topology, Orca/Rorqual hulls, Docker, other ore families and long
multi-fleet sessions were not freshly exercised. No claim of 100% coverage.

## Package and update

Runtime and client files match the reviewed Grid Check test ZIP byte-for-byte;
only release version and documentation differ. The Launcher GitHub updater
configuration is unchanged, and the release includes its `.update.json` sidecar
and ZIP SHA-256 checksum. Saved player settings and the normal 95% threshold
remain unchanged.

Close EVE clients and stop the server before using **Launcher > Mods > AutoMining
> Update**, or add **AutoMining-1.2.20.zip** to the existing entry. Keep a backup
of settings, statistics and fleet presets before updating.
