# AutoMining 1.0.4 verification

Checked locally on 18 September 2026. First public release approved after the Mining Surveyor command was confirmed working and the compressed-resource picker was corrected.

## Ore picker correction

Version 1.0.4 excludes the 62 legacy Batch Compressed entries which slipped through 1.0.3. The regression test failed before the fix and passes afterward. The actual server catalog also passes a check that no entry contains the word Compressed anywhere in its name. The remaining 240 entries retain raw ore, ice and gas. No saved filters are rewritten.

## Automated coverage

- 43 focused Node tests (including the compressed-resource catalog regression): commands, filtering, distinct targets/sharing, ranges, nearest/furthest, immediate filter and full-hold unlock including deferred cycles and pending locks, normal stopping, approach, compression, survey timing, persistence, old-profile preservation, HUD validation, character isolation, direct feedback and target reuse.
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

Server hooks load in memory; EveJS source files are not rewritten. The mining runtime must match its verified hash. The client helper patches only `eve/client/script/ui/eveCommands.pyj` inside the copied client's `code.ccp`, requiring the supported original hash.

Server settings live in `config/autoMining.players.json`. Launcher settings use stable per-profile mod storage. Client receipts and backups live in `.automining` beside the copied client's archive, outside the replaceable package. The helper journals swaps and refuses unexpected modified entries.

The updater uses V0nCleef/EveJS-Automining, tags `v<version>`, asset `AutoMining-<version>.zip`, and its `.update.json` sidecar. Version 1.0.4 is the first public release; earlier version numbers were private test builds.
