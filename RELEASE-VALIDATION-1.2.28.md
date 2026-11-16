# AutoMining 1.2.28 candidate validation

Unpublished compatibility candidate for EveJS 261115.2. Minimum Launcher 1.0.80;
Native and Docker declarations have corresponding existing implementations.
Held pending actual new-version GridCheck and combined-mod runtime acceptance.

Source baseline: public AutoMining 1.2.27 commit
0986770cbc186287e9e72c0eb2377fcf1c670c89; all 190 baseline files checked against
the current GitHub tree. Target archive SHA-256:
899ca7dd19abd4d9441966a60bbecc37008b459284c0601ae2af8edc29271be0.

## Change

261115.2 client routes use executeClientChatCommand, whose lexical call bypasses
an exported executeChatCommand replacement. Wrap both dispatch exports before
native consumers capture them. The new client route checks the actual native
mayRunChatCommand policy for AutoMining; player denial and unrelated native
commands remain unchanged. No source hash was added: miningRuntime is byte-exact
to the already reviewed 261108.1 source and the legacy mining patch never runs.
No job, drone, skill, inventory, saved-state, or shared login ABI change.

## Executed coverage

- 584 focused Node passes, including original 261115.2 login builder/codec with
  native GM health source enabled/disabled and staff/player roles. Exact native
  payload and verification data survive composition. Two Linux-only TCP tests
  are skipped on Windows.
- Ten state preservation checks on disposable fixtures, including byte-exact
  migration, native data-root resolution, no-clobber races, malformed-state
  refusal and failed-publication recovery. Hard-link tests ran outside the
  sandbox; live data was never accessed.
- Nine native-source adapter programs exercise hook attachment, client command
  authority, mining bridge, drone APIs/identity/skill/bandwidth authority,
  inventory/ore/ammo guards, hauling return and queued movement, and combat
  adapters. Fake rows/sockets and native source imports do not boot a world.
- Authored Python client suites and 27 retained pinned third-party loadout
  controls. Pinned older mod source tests use the 261108.1 fixture they support;
  these do not establish combined 261115.2 support.

Native adapter fixture uses 261115.2 source from the verified archive, synthetic
empty SQL world tables, and existing reference static data. Two old fixture
assumptions were repaired: a missing scene visibility mixin and new native
blood-stained-stars/flashpoint custody dependencies in extracted inventory bodies.

## Limits

No new server stack, real Docker transport, retail UI, gameplay, persisted-world
mining, client archive migration, or soak run is claimed at this checkpoint.
261115.2 GridCheck mining ledger/cargo equality, stacked drone/runtime scenarios,
and combined-mod acceptance remain mandatory before full validation. The shared
login runtime is unchanged; older retail evidence remains historical.
