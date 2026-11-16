# AutoMining 1.2.30 release validation

Requires Launcher **1.0.86 or newer**. This version retains the Native/Docker
delivery implementations and declares EveJS261108.1/261115.2 compatibility.
Current native qualification targets261115.2 and client build3396210.

## User-visible changes

- Retain native groups in arrival, rat-mining, rat-fighter and PVE selectors,
  including groups whose drones are deployed. Keep saved/draft/missing/empty choices.
- Show owned units aboard the active ship, owned+controlled deployed drones,
  confirmed unmatched membership and unchecked membership separately.
- Reject stale or wrong-owner/ship/flag/native-kind selection before claiming a
  launch. Accept positive stacks and assembled singleton quantity-1. No native
  group/member mutation, ID rebinding, guessed assignment or manual-drone adoption.
- Point recovery help to Launcher Settings > Recover drone groups, with all EVE
  clients closed first. All eight translated catalogues retain that exact action.
- Support the261115.2 client command-dispatch seam while preserving native staff
  policy and unrelated dispatch. Server/controller and shared login ABI are intact.

## Executed coverage

- **123current-version offline cases**:42Python drone/launch/group/selector cases,
 32standalone/common login companion cases,35Node drone/RPC cases, and14native
  command/login/health cases. One older pinned third-party control is separate.
- Full authored HUD and nine-language authored/emitted localisation harnesses;
  99additional emitted availability/recovery message/language checks.
-14synthetic Native/Docker helper action/foreign-ownership controls; passive
  native mining/return/launch adapter authority checks with all writes denied.
- Python2.7 grammar parsing of the actual emitted companion and bounded login
  expression. Real bounded composition passes without changing the shared runtime.
- Actual Launcher1.0.86 release selection, sidecar validation, discovery, ZIP
  inspection, manifest parsing and complete enabled1.2.29->1.2.30 synthetic update.
  The historical folder and three state files stay byte-exact. The old missing
  sidecar compatibility field reproduces the install rejection; corrected metadata
  is derived from the actual ZIP manifest and matches it exactly.
- Native preference bytes and prior read-only inventory snapshots reproduce
  unmatched membership and exact valid selection in data-only fixtures. Selection
  is intercepted before claim/launch; these fixtures do not perform recovery.
- The coordinator applied the exact package and generic Launcher recovery through
  the real product paths. AutoMining state, original native profiles, game data,
  client core files and configuration were preserved. The user then confirmed
  the final pair working with **two real characters** and accepted release.

Earlier private native261115.2 checks qualified3953persisted ore units and real
HUD Start/Resume, deployed-group visibility and recall controls. Those historical
checks supplement the final user acceptance; they are not a new broad soak run.

## Artifact and source identity

The release's SHA256SUMS and ZIP checksum asset record the final public ZIP
digest. A ZIP cannot embed its own final checksum; these external assets are
the artifact identity record.
Corrected sidecar:
fb097ef31b1d9e68c1c5e1594ac3df52a5f2599a7c95ab9acf95b91decffdbae.
Privacy-only packaging changes three documentation entries and substitutes
synthetic character/ship IDs in one test fixture. All71runtime members and the
corrected sidecar remain byte-identical to the accepted package;194of198ZIP
members are unchanged. Their canonical runtime-member inventory SHA-256 is
a37dac448e8d5a4cad0b6c17325acf18cfe39d3aa48829891296fc386b0b6c74.
The public ZIP passes CRC, privacy scanning and actual Launcher1.0.86 package
inspection; its extracted emitted companion matches the accepted bundle exactly.
Public source documentation records final acceptance. Bundled pre-acceptance
status notes remain historical; this record states current qualification.

## Limits

No fresh Docker gameplay, broad fleet/hauling/rat-response coverage or long soak
is claimed. Retained older source controls do not establish fresh older retail
support;0.12.8 is not newly claimed. The native group controller caches preferences
and can write them back, so external recovery requires all EVE clients closed.
