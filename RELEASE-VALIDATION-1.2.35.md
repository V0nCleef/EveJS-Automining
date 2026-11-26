# AutoMining 1.2.35 validation

This release declares EveJS 261126.2 and 261125.3 compatibility while retaining
261108.1 and 261115.2. It resolves the Launcher's unknown-version warning for
the reviewed 261126.2 server.

## Implementation

The only production-code change since 1.2.33 admits the reviewed 261125.3 native
mining source identities. That mining source is byte-identical in 261126.2.
Both releases keep native settlement, yielded-ore residue rules and cycle-keyed
ledger commits. AutoMining appends its bridge in memory and never applies the
legacy mining patch to these builds. Unknown source edits remain refused.

The 261126.2 source comparison found 19 logical changes across server source and
configuration. All 44 directly referenced AutoMining native files were unchanged,
including the mining runtime, handshake/codec, drone and movement handlers,
command access, damage hooks and ledger. Relevant indirect changes to fighter
persistence, structure presentation, migration, TCP startup and XMPP were reviewed.
Client delivery, job logic, targeting rules and state formats are unchanged.

## Checks repeated for this release

Windows, Node 26.13.1 and Python 3.11:

| Check | Result |
| --- | --- |
| General Node suite | 554 pass, 0 fail, 5 Linux-only skips |
| 261108.1 native mining controls | 14 pass, 0 fail, 2 newer-build skips |
| 261115.2 mining, authority, ledger and handshake controls | 20 pass, 0 fail, 3 newer-build skips |
| 261125.3 same focused controls | 23 pass, 0 fail |
| 261126.2 same focused controls | 23 pass, 0 fail |
| Exact native mining source plus injected bridge | Passed on all four declared builds |
| Login delivery ABI | 24 pass; four unavailable historical codec fixtures excluded |
| Authored client Python | All 18 scripts passed, including menu/HUD, native groups, mining/hauling/PVE workers and login lifecycle |
| Actual synthetic archive operations | Five controls passed: shared archive preservation, owned migration/recovery, foreign-change refusal and invalid-backup refusal |

Windows sandbox restrictions initially refused hard links used by the state
preservation fixtures. The unchanged tests passed with the required filesystem
access; mutable fixtures stayed inside the test workspace. The pinned third-party
loadout fixture was unavailable and was excluded from the Python login selection.

## Existing runtime evidence and limits

The earlier 261125.3 candidate passed actual native GridCheck controls for mining,
two neutral pilots, normal native belt rats and precise damage-source retaliation.
Its client companion is unchanged here. Earlier offline review of exact EVE
24.02 build 3724492 resolved all 66 AutoMining and 11 shared-menu import sites,
checked native group/widget/menu contracts, and reviewed the signed-function
transport. The legacy archive patcher correctly refuses that unfamiliar command
member; modern login delivery is the supported route for this build.

This release pass started no game client, graphical session, world or network
listener. It does not claim fresh modded-client UI acceptance, Docker/Linux/Proton
gameplay, a new 261126.2 AutoMining combat run, or a long fleet/hauling soak.
Native and Launcher-managed Docker backends and existing Windows/Linux helpers
remain supported; gameplay verification here is bounded as described above.

Close EVE clients and stop the server, update AutoMining through Launcher > Mods,
then restart and log in. Keep the existing mod folder and enabled state. The
package ships its loader disabled for fresh installation, as previous releases do.
