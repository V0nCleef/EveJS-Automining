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
