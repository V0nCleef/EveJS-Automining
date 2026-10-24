# AutoMining 1.2.19 release validation

## Changes

The native warp-landing handoff can temporarily reject point navigation after
the ship has left WARP mode. AutoMining waits for that handoff instead of
switching off. The final return uses a 1 km arrival area and one native Stop;
it does not wait for exact coordinates, zero speed or a settling timer.
Strip miners can work on compatible ore already in range during the owned
return approach. Other mining movement and drone arrival wait for trip completion.

The origin is captured when mining starts and stays fixed through automatic
ore approaches, station returns and braking drift. Deliberate pilot navigation
replaces it at the stopped location; a new warp captures its landing point.
If the hold fills during manual movement, its current position becomes the origin.
The default trigger remains 95%. Saved settings and Launcher updating are retained.

## Evidence

- 137 focused Node checks passed for hauling, controller return integration,
  navigation hooks, ordinary mining and fleet ore handling; 9 client navigation
  checks passed. The prior installed build fails the three new controller
  behavior regressions and passes its other 77 checks in that same A/B run.
- The original 1.2.18 landing rejection was reproduced through passive native
  0.12.9 and 261018.1 adapters without writes. The earlier test.1 candidate also
  completed two real-client 5% unload/return cycles with one initial Start and
  two active strip miners after each return.
- The final test.2 runtime was installed locally with a rollback backup and
  byte verification of all 70 package files. Player settings, statistics,
  fleet presets, profile settings, other mods and server config were preserved.
- The user tested the final AutoMining behavior in game and explicitly approved
  this release on 2026-10-24. No new Grid Check run was performed for that final
  iteration, at the user's request; the earlier test.1 footage is not evidence
  of the final 1 km behavior.
- Public runtime files match the user-approved test.2 ZIP exactly. Only release
  version/documentation differ. Launcher GitHub update configuration is unchanged.

## Coverage limits

Fresh final gameplay approval covers the user's Native 261018.1 setup. This
release does not claim new Docker, 0.12.8, 0.12.9 live-client, cross-system,
corporation-storage or Upwell return coverage. Existing movement interruption,
ship/system checks, unload confirmation, Defense and timeouts remain enforced.

## Update

Close EVE clients and stop the server. In the Launcher use
**Mods > AutoMining > Update**, or add **AutoMining-1.2.19.zip** to the same entry.
Back up saved settings/statistics/fleet presets and Launcher profile preferences.
Start the server and reconnect. To roll back, stop clients/server and restore
the previous package while retaining the backed-up saved data.
