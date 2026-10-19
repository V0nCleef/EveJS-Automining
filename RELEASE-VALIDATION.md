# AutoMining 1.2.18 release validation

## Scope

This release recognizes the reviewed EveJS 261018.1 mining and login sources while retaining 0.12.9 compatibility. It preserves the native AIR mining exclusions and crystal durability rules, and moves AutoMining's saved state from `config/` to the server data root's `automining/` folder.

Install/recover migrates legacy files before client preparation. Startup provides the same migration safeguard before enabling hooks. Migration copies exact bytes without deleting sources; existing validated canonical state wins conflicts. Failed migration leaves existing files intact and keeps AutoMining inactive. An explicit injected native fleet filename remains authoritative and shared.

## Evidence

- Sixteen focused preservation checks passed using isolated fixtures copied from actual 0.12.9 and 261018.1 resolver/mining/login sources: helper install/recover, loader fallback, exact bytes, repeated migration, canonical conflicts, failed publication, corrupt input, EVEJS_DATA_ROOT and shared native fleet stores.
- Seventeen existing fleet/statistics regression checks passed. Real 261018.1 passive native handlers loaded without writes, using disposable canonical state and GameStore data.
- Reviewed LF/CRLF mining/login baselines, native AIR/crystal behavior, PVE charge durability and unchanged-source future-version compatibility were checked with focused native adapters. Unrelated source mutations remain refused.
- The unmodified bundled official updater was exercised on a copied 0.12.9 installation upgraded to 261018.1, then repeated. Canonical AutoMining settings survived. A separate first-upgrade test with disabled mods preserved legacy settings without executing helpers or loaders, using the updated Launcher's preservation policy.
- No live game client was written, no live service restarted and no game/rendering launched in the updater laboratory. Public ZIP members retain the exact tested runtime bytes; unchanged members retain their 1.2.17 package bytes.

## Coverage limits

This release has no fresh in-game gameplay coverage or Docker/0.12.8 runtime coverage. Previous two-client Manual fleet gameplay evidence is recorded in [1.2.17 validation](https://github.com/V0nCleef/EveJS-Automining/blob/v1.2.17/RELEASE-VALIDATION.md). Version labels alone do not enable unknown native source changes.

## Update

Close EVE clients and stop the server. Update the Launcher, then use **Mods > AutoMining > Update** or add `AutoMining-1.2.18.zip` before running the EveJS server updater. Keep backups of existing player settings, statistics, fleet presets and Launcher profile preferences. The canonical files are `_local/automining/autoMining.{players,statistics,fleetGroups}.json`, or `automining/` inside `EVEJS_DATA_ROOT` when configured. Legacy config copies are retained for rollback; an older mod still reads those older copies.
