# AutoMining 1.2.30

Requires EveJS Launcher **1.0.86 or newer**. AutoMining supports mining, hauling,
boosting and PVE jobs with Fleet Command, temporary orders, automatic drone
handling, ore transport and pilot/fleet statistics.

This update adds EveJS **261115.2** compatibility and keeps native drone groups
visible in arrival, rat-mining, rat-fighter and PVE selectors. Labels distinguish
owned drones in your current ship, deployed drones, unmatched saved membership
and membership that has not been checked. Refresh keeps your saved and unsaved
choices, including missing and empty selections.

If a saved group has no matches, refresh first. If it remains unmatched, **close
EVE**, then use **Launcher Settings > Recover drone groups**. Reopen EVE and
refresh groups. Recovery uses verified native preference history. If it cannot
verify membership, group your current drones in EVE's Drones window.

AutoMining preserves native group identities and does not guess memberships from
group names or drone types. Already deployed groups remain visible without being
relaunched or automatically adopted as managed drones. Launch still requires
native membership, current ownership, your active ship and the existing server
grant. Saved-state formats and the shared login-delivery runtime are unchanged.

## Update

Update to Launcher **1.0.86** first. Close EVE clients and stop the game server,
update the existing AutoMining entry through **Launcher > Mods**, then restart
and log in again. Retain the existing folder and enabled state. Refresh the
server profile after updating so Shared Mods captures the current entrypoint.

The separate AutoMining **Install/Recover** action migrates an archive companion
to login delivery; **Recover drone groups** is the Launcher settings action for
native group preferences. Existing ownership, hash and stopped-client checks apply.
Native and Launcher-managed Docker delivery implementations remain available.

## Validation

The user accepted the final Launcher1.0.86 + AutoMining1.2.30 pair with two real
characters after generic group recovery. Offline checks cover ownership, group
identity, all four selectors, login delivery, localisation and package updates.
See [release validation](RELEASE-VALIDATION-1.2.30.md) for precise coverage/limits.
The public ZIP preserves the accepted runtime byte-for-byte. Public packaging
only removes private references from three documents and substitutes synthetic
IDs in one test fixture. This repository's current validation record supersedes
the ZIP's earlier candidate-status wording.

No fresh Docker gameplay or broad fleet/hauling/rat-response soak is claimed.
Historical validation records remain available. Developer fixture requirements
are documented in tests/LOGIN-QUALIFICATION.md.
