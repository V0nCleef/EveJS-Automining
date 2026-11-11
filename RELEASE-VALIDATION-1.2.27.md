# AutoMining 1.2.27 validation

Minimum Launcher: 1.0.80. Declared EveJS release: 261108.1.
Backends: Native and Docker. Launcher API and client-menu API remain v1.
Shared login runtime SHA-256:
82b7bbe8b43121c8f407aeb3eb576dd730fb40d1720028ac26717ad0cf3a21c5.

## Verified coverage

- Independent retail Docker 261108.1: Unicode OK receipts, separate
  AutoMiningLoginReady probe/readiness calls, one Shared Mods entry per mod,
  settings/HUD opening and a clean reconnect. The owned archive companion was
  explicitly migrated with stopped-client checks; reconnect did not change it.
- 23 focused Node policy/payload checks, 12 isolated Python menu checks and
  Python 2 grammar; five authored ZIP/journal/shared-client/rollback controls.
- Actual legacy companion definitions acknowledged legacy readiness, and the
  actual menu invoked its HUD handler up to an authored Window.Open endpoint.
  No login owner was fabricated; opening after logout was refused.
- Actual public menu registry: readiness, all nine language labels, duplicate
  replacement, isolated cleanup, character/relogin and qualified legacy fallback.
  These headless controls used an authored menu factory rather than native UI.
- Four retained native source/codec controls accepted valid Unicode receipts
  and rejected a wrong nonce while preserving native acknowledgement. Older
  fixture version labels were not independently attested; these controls do not
  certify fresh retail support for those releases.
- Earlier shared-runtime qualification: 82 Node and 33 Python lifecycle checks,
  14 loadout checks and 13 isolated Linux transport/routing checks. The loadout
  controls used released Haulers 0.5.4 and DroneClassBalance 0.2.6 hooks, plus
  authored unfamiliar-mod cases. Some client bodies and services were fixtures;
  the exact reported third-party loadout was only partly reproduced.

## Limits

No retained 0.12.8 adapter was available. Actual legacy-fallback graphics and
Native/older fresh retail runs were not performed for this update. Python 3
service/window fixtures do not replace retail Python 2 UI execution. No fresh
mining/PVE gameplay, persistence migration or soak test is claimed. Later policy
and menu changes received focused checks rather than a repeat of the full suite.

## Source identity

All product executable files are byte-identical to the validated candidate.
Public preparation changed only documentation and two test configuration paths;
private evidence and recovered retail code are not distributed. The source
repository uses loader.js; the install ZIP ships that same file as
loader.js.disabled for Launcher-controlled activation.
