# Performance check

Synthetic comparison against the installed 1.0.1 controller: 100 simulated pilots, three mining modules each, 5,000 resources, 120 one-second ticks. Mining cycles finish every 30 seconds. Survey and compression are off.

| Operation | 1.0.1 | 1.0.3 candidate |
| --- | ---: | ---: |
| Full-field discovery calls | 12,000 | 100 |
| Direct assigned-target lookups | 0 | 900 |
| Fitted mining-module snapshots | 12,100 | 2,500 |

Full-field discovery fell by 99.2% in this healthy-mining scenario. Existing targets are reused across cycles; depletion, invalid targets or relevant settings changes cause fresh discovery. Idle searches back off to five seconds. Fitting is checked every five seconds while all known miners work; cycle completion can also refresh it.

Hold checks inspect locked/pending resources using native cached capacity. They do not enumerate the field. Survey follows the player's timer and is off by default. Compression checks every ten seconds when enabled. The window polls every 2.5 seconds while open, sends its cached catalog only when requested, and avoids rebuilding unchanged lists.

This measures controller work with simulated dependencies. It excludes native inventory/dogma cost, database activity, network traffic and rendering. It demonstrates reduced search work, not a guarantee about total server CPU or gameplay lag. Live multi-client observation remains necessary.

## 1.0.6 volume-priority update

Whole-belt discovery occurs when choosing a new primary target. While approaching a valid primary asteroid, each tick looks up that target directly instead of scanning the belt again. Arrival permits one discovery to distribute the miners among reachable asteroids. Assigned mining targets are then reused across cycles.

Active burst modifiers are checked per cached mining module once per automation tick. Only a changed signature triggers an immediate dogma refresh; this check does not enumerate asteroids. Fitting snapshots during steady travel are reused for up to five seconds. Depletion, filter/priority changes, or an invalid target trigger replanning.

Focused checks cover 60 travel ticks with one discovery and one movement command, boosted range gain/loss, short-range miners, and the existing 120-tick healthy-mining reuse check. These are simulated checks, not live server CPU measurements.

Updated controller simulation: 100 pilots x 5,000 asteroids x 120 ticks, three miners each. Both largest-volume scenarios made 100 discoveries total (one per pilot) and 2,500 module snapshot calls. Mining with 30-second cycles made 900 direct target lookups; uninterrupted travel made 11,900 direct lookups and only 100 movement commands. The Surveyor eligibility gate reads already-computed effective ship attributes; it does not issue scans or rebuild ship dogma.
