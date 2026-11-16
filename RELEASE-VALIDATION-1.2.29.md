# AutoMining 1.2.29 candidate validation

Unpublished local drone-selector fix, based on the qualified private 1.2.28
compatibility candidate. EveJS 261115.2 native testing; minimum Launcher 1.0.80.
Native and Docker delivery implementations remain unchanged. No fresh Docker
gameplay or broad drone/rat/hauling soak is claimed.

## Change

The client group reader used drone-bay membership to discard native groups
with no drones aboard whenever another group still matched the bay. Deploying
Miners therefore hid them while Fighters stayed aboard, and vice versa.
Retain the full native group list; use bay counts only for labels and ordering.
Empty/unmatched-bay preselection and existing saved/draft keys remain preserved.
No native group creation, deletion or inferred membership is added. No launch,
recall, ownership, skill, bandwidth, rat-priority or state-migration logic changes.

## Executed checks

- Five regression assertions failed on the previous reader. All eight focused
  reader/HUD-dropdown checks pass with the fix, covering all four consumers,
  stack units, ship changes, deployed groups and saved/unsaved choices.
- The full authored HUD harness, eight authored client launch/ownership checks,
  21 server drone checks and eleven RPC/arrival/grant checks pass. Native adapter
  checks retain the actual 261115.2 skill/bandwidth/bay and return-scope guards.
- In a retained isolated 261115.2 world and real 3396210 client, a native five-unit
  mining stack launched through the displayed Start / Resume button at the
  current belt. A second press after recall launched five miners again while
  AutoMining remained on, with no travel. Both native return-to-bay commands
  returned all five miners; the separate five-unit fighter stack stayed aboard.
- The frozen 1.2.28 companion reproduced the dropdown failure against those real
  deployed drones. Evaluating this exact candidate reader in that private
  companion's namespace retained both groups and the existing selection. Native
  membership and installed mod files were unchanged. This is an in-memory reader
  check, not a claim that the complete 1.2.29 package was installed in retail.
- The private actor's prior ship, station, native group list and settings were
  restored. Its wallet, prior Buyers operation/reserve, mining ledger and frozen
  mod files matched the baseline. Private client/server/market were stopped.

The separate reported Start / Resume failure is not reproduced by these checks.
Existing logs show a live hostile during one attempt; enabled rat response takes
priority over arrival miners. Logs omit group/kind and result text, so they do
not establish a cause for every reported attempt. Launch behavior is unchanged.

Native named-group persistence belongs to the client's own profile. This fix
does not migrate profile namespaces across server-root or account isolation
changes; that is a separate Launcher continuity issue.

## Apply

Keep this candidate local until authorized. Close all EVE clients and stop the
game server before updating the existing mod through the normal Launcher update
transaction. Keep its historical folder and enabled state; do not install a
second copy. Refresh the server profile, start the server and launch a fresh
client to receive the new login companion. Already-running companions retain
their previous code. Existing archive companions continue to use the established
Install/Recover migration and ownership checks.
