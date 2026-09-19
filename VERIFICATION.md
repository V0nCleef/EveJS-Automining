# Current 1.0.7 candidate verification — unreleased

Local user acceptance passed: HUD/settings, automatic locking/mining, survey, arrival retry, Stop and fresh Launcher relaunch with saved settings and Off preserved. The small arrival delay was confirmed after the client finished warp.

The paired Launcher 1.0.61 candidate now supplies opt-in automatic client preparation. All 28 synthetic helper/Launcher cases pass, including the three formerly failing shared-client/backend paths and older-Launcher update rejection before cleanup. Generic Launcher tests additionally cover exact version/source/client scope, one repair attempt, corrupt records, malformed replies, failed repairs and running-client refusal. This is synthetic coverage, not live Docker acceptance. The final packaged pair still needs manual validation.

The author guide update is staged separately in eight languages. Nothing is published. The historical checkpoints below describe prior builds and must not be read as the current candidate's release status.

---

# Unreleased 1.0.7 login-delivery candidate

- 79 Node tests pass: existing mining behavior, original/patched core compatibility, payload composition, returned-result preservation and scoped readiness.
- 11 authored Python lifecycle tests pass with simulated services under Python 3. No claim of a live Python 2.7 client test.
- 16 migration/Launcher tests pass using synthetic ZIP archives. Actual helper archive I/O and Launcher update/rollback/profile preparation run against fixtures. The rollback fixture substitutes a tiny synthetic bytecode patcher because no vendor client data is used.
- Two native mining-bridge checks pass against the preserved original and patched EveJS server source with simulated dependencies.
- The local Launcher API source snapshot labels itself 1.0.56. Tests simulate its version field at the existing minimum 1.0.57; this is not a test of the installed Launcher executable.
- No live installation, running game, public release, or author guide changed.
- Release gates: actual client upgrade/launch, native settings window and survey, reconnect/character switching, other active mods and shared-client installations. Confirm companion installation errors and a mod-off server cannot leave active handlers in a reused client process.

The older sections below record prior versions, not validation of this new delivery path.

# AutoMining 1.0.6 verification

Earlier-version verification is retained below as historical evidence. New native rendering and complete live gameplay are not asserted. This release does not add a new Docker gameplay verification.

## 1.0.6 mining runtime compatibility

Supports the reviewed original and crystal-cancellation-patched EveJS 0.12.8 mining runtime. The bundled fallback applies in memory only; an already fixed runtime passes through unchanged. Unknown content and damaged fallback patches fail closed. The same reviewed source is accepted with LF or CRLF newlines.

Validation: 74 Node checks pass, including six compatibility checks. The actual mining-runtime bridge check passes on both reviewed source baselines. No live game or client-file test was performed for this release.

Validation commands (set EVEJS_TEST_ROOT to original EveJS and EVEJS_PATCHED_TEST_ROOT to the patched tree):

```powershell
node --test tests/*.test.cjs
node tests/native-bridge.cjs $env:EVEJS_TEST_ROOT
node tests/native-bridge.cjs $env:EVEJS_PATCHED_TEST_ROOT
```

The client companion and installer are unchanged from local 1.0.9. No EVE Online client files are needed for these checks. Changes from private 1.0.6-1.0.9 checkpoints below are included in this release; their historical test limits still apply.

## Private 1.0.9 checkpoint: warp pause and resource labels

- 68 Node checks pass. Warp requests interrupt deferred mining cycles and cancel mining target locks without issuing Stop to the ship. Repeated warp ticks do not repeat module work. Saved On remains unchanged; cancellation resumes only while enabled; a pilot already Off, or pressing Stop during warp, stays Off.
- Arrival outside a mining grid pauses mining, survey and compression; presence checks back off to five seconds. A changed grid resumes promptly when it contains ore, ice or gas. Gas-filter tests assign separate clouds to gas harvesters, share when needed, and exclude incompatible ore lasers.
- The actual server catalog contains 240 raw resources including gas and ice, with compressed products excluded. The supported native mining bridge accepts gas snapshots for gas resources and rejects ore/ice mismatches. HUD labels now explicitly identify ore, ice and gas; UI/RPC stand-in checks pass. In-game verification of this version remains pending.

## Private 1.0.8 checkpoint: automatic survey at mining locations

- 63 Node checks pass. New coverage verifies no survey requests outside resource grids, no requests during warp, immediate scheduling on arrival, the configured interval thereafter, depleted-site waiting, and the six-second minimum between requests. Ore, ice and gas qualify independently of ore filters and mining-module range.
- Presence checks use one remembered resource, with five-second checks and empty-site backoff. The two-minute populated-site test performs one resource search; survey off performs no location checks. The injected bridge is exercised against the actual supported mining source with isolated dependencies, including cached-resource reuse without field enumeration, cross-grid exclusion and depletion.
- This version adds no drone automation and changes no other mod. Client code is identical to 1.0.7. The user confirmed the installed 1.0.8 survey change works in game.

## Private 1.0.7 checkpoint: HUD layout and immediate priority changes

- 60 Node checks pass, including every change between the four priorities through chat and HUD settings. Deferred cycles stop through native target loss, pending locks cancel, distant priority starts approach on the next tick, and unrelated combat targets survive. Saving the same priority does not interrupt mining; off/docked changes only update preferences. Steady mining still avoids repeated field discovery.
- Status, scope and priority explanations use native label auto-sizing instead of fixed heights and line limits. The supported client's LabelCore source confirms text sizing and resizing on width changes. Ore-picker arrow text is escaped so the client does not interpret the left arrow as markup.
- Authored HUD checks pass with UI/RPC stand-ins. Native visual layout and live mining interruption still need an in-game test.
- The patched Python 2.7 archive parses, embeds the exact companion/HUD source and preserves all 391 original nested code objects. Python 2 syntax validation passes.
- Production Launcher lifecycle passes in temporary fixtures: enable, verify, per-character preparation, update and restore. Both profile settings and server preferences remain byte-identical; unrelated archive entries and the original client backup are preserved. Docker backend and container preload paths pass; no live Docker gameplay was exercised.

## Private 1.0.6 checkpoint: target priorities

- 57 Node checks: new volume ranking uses quantity times unit volume; ties use distance then ID; filters, separate miners and range limits remain enforced.
- Volume priority checks the same effective ship attributes used by the native Surveyor button; missing capability pauses it, restored capability resumes it, and no extra scans are sent.
- Whole-belt approach chooses a higher-priority distant rock even when lower-priority ore is reachable. It keeps its destination during travel, handles depletion, and waits for active cycles before moving.
- Effective range gains and expiry update target eligibility and approach distance, including mixed-range miners. Cross-grid resources are excluded. The original survey function still filters visible entities and its configured distance limit. The bridge passes the tick timestamp to native mining snapshots and native burst collection.
- HUD checks cover four choices, dynamic search-area explanations, saving/restoring volume settings and existing Apply/Start controls. Launcher per-character settings also include both volume priorities.
- The actual supported mining source was exercised with isolated dependencies; a real boosted in-game fleet and native HUD layout remain unverified.

## Earlier 1.0.5 settings-window correction

Version 1.0.5 normalizes client text at the HUD RPC boundary. Byte-buffer requests previously produced `Invalid AutoMining settings request`, preventing both Apply and Start / Resume. The same normalization handles Start/Stop control strings. Two new regression tests reproduced the failure before the fix and pass afterward: saving 180 seconds and starting/stopping while docked across supported text representations, plus malformed/oversized/stale request rejection. Five focused HUD tests passed after the change. The user confirmed the Save button works in game after installing 1.0.5. Start/Stop with client text representations passed automated checks.

## Docker support

The manifest supports Native and Launcher-managed Docker. Production Launcher tests using the Docker backend passed helper install/verify/profile preparation/update/restore, separate character profiles and settings preservation. The generated preload uses `/app/mods/<folder>/loader.js`; the standard EveJS Compose configuration binds the host `config` directory to `/app/config`.

Disposable Node 24 Linux containers loaded the mod and its bridge into the actual supported mining source, with other native dependencies isolated. HUD requests saved 180 seconds and enabled automation while docked. A replacement container recovered the same settings from the bind mount. All 45 Node tests passed in Linux. No live server, client, game database or named volume was mounted. Full Docker gameplay has not been exercised.

## Ore picker correction

Version 1.0.4 excludes the 62 legacy Batch Compressed entries which slipped through 1.0.3. The regression test failed before the fix and passes afterward. The actual server catalog also passes a check that no entry contains the word Compressed anywhere in its name. The remaining 240 entries retain raw ore, ice and gas. No saved filters are rewritten.

## Automated coverage

- 45 focused Node tests (including catalog and client-text regressions; all pass in Linux Docker): commands, filtering, distinct targets/sharing, ranges, nearest/furthest, immediate filter and full-hold unlock including deferred cycles and pending locks, normal stopping, approach, compression, survey timing, persistence, old-profile preservation, HUD validation, character isolation, direct feedback and target reuse.
- Actual EveJS 0.12.8 mining source with isolated dependencies: injected bridge uses native module selection, surface range, resource compatibility, destination hold capacity and depletion. Direct target lookup and non-resource handling checked.
- Actual static data and native resource classification: 240 published raw ore/ice/gas entries; unique valid names, cached once, compressed products excluded.
- Client companion with isolated Python services: native CmdMiningScan, preserved command-service handlers, handshake, profile delivery and warp/dock/busy/unavailable guards.
- Authored HUD with UI/RPC stand-ins: searchable lists, arrows, clear/apply, start/stop, timer, drafts, stale-save rejection, unchanged-list redraw avoidance, direct confirmation and closing on character change. This is not a native rendering test.
- Production Launcher 1.0.56 lifecycle in temporary server/client fixtures: manifest, per-profile Configure settings, install/verify/prepare, enabled update and disable/restoration. Two profile files and server preferences remain byte-identical after update. Original client backup and unrelated archive entries are preserved.
- Patched Python 2.7 outer command module parses; original nested vendor code is preserved. No original client bytes are included in the package.

The user confirmed locking, mining, furthest selection and the native Mining Surveyor in game, then confirmed the survey command works after the feedback fix. A user screenshot also shows the settings window rendered in game. Custom scan timing, persistent On across travel/login, full-hold unlock and compression have automated coverage; separate live gameplay confirmation has not been recorded for each.

## Gameplay checks for further validation

1. Restart the updated server and client through the Launcher. Type `/automining`: confirm the window opens and all controls fit.
2. Add Scordite with **>**, click **Apply settings**, then **Start / Resume**. Confirm excluded ore unlocks immediately. Remove with **<**, or clear and apply, to allow all again.
3. Enable survey and set 30 seconds. Confirm the native Mining Surveyor repeats. Try `/automining survey off` and `on`; confirm the direct notification and window setting agree. Leave survey off if preferred.
4. Fill the destination mining hold: ore targets should unlock without waiting for another cycle. Make room and confirm automatic resumption.
5. Leave AutoMining on, dock/undock and relog. Confirm it resumes. Turn it off and relog to confirm it stays off. Check another character remains independent.
6. Enable compression near an accessible active compressor. Check eligible stacks compress within ten seconds, then confirm it waits when access or range is lost.

## Boundaries

The chat screenshot and server logs establish that survey toggles were processed while chat acknowledgements were missing. The new direct client notification provides a separate feedback path; it does not claim to repair the underlying EveJS chat transport.

Server hooks load in memory; EveJS source files are not rewritten. The mining runtime must match one of the reviewed source fingerprints. The client helper patches only `eve/client/script/ui/eveCommands.pyj` inside the copied client's `code.ccp`, requiring the supported original hash.

Server settings live in `config/autoMining.players.json`. Launcher settings use stable per-profile mod storage. Client receipts and backups live in `.automining` beside the copied client's archive, outside the replaceable package. The helper journals swaps and refuses unexpected modified entries.

The updater uses V0nCleef/EveJS-Automining, tags `v<version>`, asset `AutoMining-<version>.zip`, and its `.update.json` sidecar. Version 1.0.4 is the first public release; earlier version numbers were private test builds.
