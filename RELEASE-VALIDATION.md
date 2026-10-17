# AutoMining 1.2.17 release validation

## Scope

Manual fleet previously disabled its pilot checkboxes and preset editor while the server required a saved preset in that mode. The controls now match the server behavior. Automatic mode continues grouping participating pilots on a settled public grid. No server fleet membership logic changed.

The explanation is corrected in English and all eight existing translations. The authored Chinese fallback matches the shared catalogue; its emitted form is generated from that catalogue.

## Evidence

- The maintainer installed the two-file UI fix and confirmed Manual fleet works with two real clients on Native EveJS 0.12.9.
- Five focused HUD checks fail on the original and pass on the correction, covering Manual editing, Ready/Working pilots, saved selections, draft retention and mode switching.
- The repository HUD regression now checks the corrected Manual/Automatic control states and saving a Manual preset. HUD and language fixtures pass.
- The existing manual-preset backend regression passes. The backend is unchanged.
- The actual client source builder and Launcher shared-menu/login delivery checks pass within the existing delivery limits.
- ZIP members, SHA-256 checksum and Launcher update descriptor are verified against the release source. Unchanged runtime files retain their exact public 1.2.16 package bytes.

## Coverage limits

Fresh in-game confirmation covers two clients on Native 0.12.9. Other languages are checked offline. Docker, 0.12.8 and unrelated mining/hauling/PVE behavior were not retested for this UI correction. Previous 1.2.16 coverage is documented at https://github.com/V0nCleef/EveJS-Automining/blob/v1.2.16/RELEASE-VALIDATION.md.

## Update

Close EVE clients and stop the server, then use EveJS Launcher > Mods > AutoMining > Update or add AutoMining-1.2.17.zip. Restart and reconnect. Preserve player settings, statistics, fleet presets and Launcher profile settings.
