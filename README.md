# AutoMining 1.2.27

Requires EveJS Launcher **1.0.80 or newer**. Qualified release: EveJS
**261108.1**, with Native and Launcher-managed Docker delivery support.

This update fixes login coexistence with mods that change the login handshake,
supports Docker login delivery, and keeps the existing legacy companion usable
for shared clients. Shared Mods opens the existing AutoMining HUD on either path.
Mining, hauling, boosting, PVE, saved-state formats and languages are unchanged.

## Update

Update the Launcher first. Close EVE clients and stop the game server, update the
existing AutoMining entry through Launcher > Mods, then restart and log in again.

If the client already has AutoMining's archive companion, normal launch preserves
that installation. To move to login delivery, use AutoMining's **Install/Recover**
action with the clients closed. It restores only AutoMining's owned command entry,
using the existing hash, backup and stopped-client checks. Refresh the server
profile after the update so Shared Mods captures the current menu entrypoint.

The tested release declaration is 261108.1. Retained older source/codec controls
passed, but do not establish fresh retail support. Version 0.12.8 is not claimed
by this update because its adapter was unavailable for qualification. Existing
Native/legacy guards remain; no new runtime version denylist was added.

## Validation

An independent Docker 261108.1 retail client showed AutoMining and Buyers once
each in Shared Mods, opened both windows, loaded AutoMining settings, acknowledged
separate login probe/readiness calls, and repeated this on clean reconnect without
client archive changes after the explicit migration. These are delivery and UI
checks, not fresh mining gameplay or soak coverage.

See [release validation](RELEASE-VALIDATION-1.2.27.md) for the focused controls and
limits. RELEASE-VALIDATION.md records historical 1.2.26 gameplay validation.
Developer test requirements are documented in tests/LOGIN-QUALIFICATION.md.
