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
