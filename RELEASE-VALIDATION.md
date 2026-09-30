# AutoMining 1.2.14 release validation

Validated on 30 September 2026. The user confirmed the installed 1.2.14 build working in Native EveJS 0.12.9 with EVE client 3396210, including the escort stopping when its final eligible fleetmate leaves the grid.

## Package provenance

The public ZIP contains 64 production files from the exact installed and tested 1.2.14 freeze. Only README.md changes for public documentation. Code, translations, approved artwork and delivery assets remain byte-identical. Tests, private logs, player configuration, databases and development tooling are excluded from the install ZIP.

- Public asset: `AutoMining-1.2.14.zip`
- SHA-256: `634f4295baa28ed57529926d8b68caf8a8691e2bf5e054bf435aaa3ed7daaa97`
- Bytes: 10,105,041
- The matching `.zip.sha256` and `.update.json` are release assets.

## Automated checks

- 423 Node unit checks pass across the 44 self-contained suites, covering Mining, Hauling, Boosting, PVE, inventory admission, profiles, fleet coordination, drone/rat transitions, statistics and delivery.
- Three older test fixtures were updated for explicit current defaults, saved Boosting profiles and Mining/fleet-hangar compression waiting. No production changes were needed.
- Authored HUD behavior, artwork-cache/RPC checks and complete nine-language emission checks pass. These use native UI stand-ins and do not prove GPU rendering.
- The public loader passes the actual 0.12.9 passive native service harness with filesystem writes blocked and no running world tick.
- Earlier checks on this identical production freeze include 112 focused Node checks, 16 login companion and 10 PVE client checks, Python 2.7-compatible grammar and production JavaScript syntax.
- Joint delivery with the installed Launcher menu bridge measures 261,915 / 262,144 bytes with the fixture token. Artwork transfers separately; future bootstrap changes must recheck that narrow headroom.

The legacy mining-compatibility suite requires separate reviewed original/patched EveJS fixtures and is not included in the 423 check count. Live Docker gameplay and fresh live 0.12.8 coverage were not performed. Manifest support is separate from current live confirmation.

## Update and rollback

Stop clients/server before updating. Preserve character settings, fleet presets, statistics and Launcher profile preferences. Update through Launcher Mods or Add ZIP, restart the server and reconnect clients. Restore the previous mod version with the preserved data if rollback is needed.

The promo uses a user-supplied recording of the installed menu. Editorial captions explain available features; they do not add controls or redesign the HUD.
