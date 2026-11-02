# Local modifications

Two changes are carried on top of upstream **v1.2.23**. Neither changes the mod
version. Both are self-contained and are offered upstream as a pull request.

| # | File | Change | Size |
|---|---|---|---|
| 1 | `lib/commands.js` | Register only ASCII names in `AVAILABLE_SLASH_COMMANDS` | +13 / −2 |
| 2 | `lib/commands.js`, `lib/controller.js` | Let the plain-chat form `!automining` open the settings window before the client reports `hudReady` | +10 / −1 |
| 3 | `lib/commands.js` | Add `atm` as a plain alias of `automining` (same `hudReady` rule) | +3 / −0 |
| 4 | `lib/industrialAutomation.js` | Identify compressors by the native effect only (all fitted compressor types), no type whitelist | +10 / −5 |
| 5 | `lib/droneBay.js` (new), `lib/controller.js`, `lib/hud.js`, `client/drones.py`, `client/hud.py` | Filter the drone-group list by the active ship's bay and show counts | new |

Three diagnostic log lines make the code paths visible in the server log:
`slash list registered: … (ascii-only)` and `plain-chat … char=…` from
`lib/commands.js`, and `plain-chat open char=… hudReady=…` from
`lib/controller.js`. They can be dropped without changing behaviour.

---

## 1. Slash registration stays ASCII-only

### Symptom

With AutoMining loaded next to other loader mods, **every mod's slash command
disappeared** from the client's command list — not just AutoMining's. Plain `!`
chat commands kept working.

### Root cause

`installChat()` pushed every translated command name into
`exports.AVAILABLE_SLASH_COMMANDS`:

```js
for (const name of COMMAND_NAMES.filter(value => !value.includes(" "))) {
  if (!exports.AVAILABLE_SLASH_COMMANDS.includes(name)) exports.AVAILABLE_SLASH_COMMANDS.push(name);
}
```

The EVE client decodes that list with a character-map decoder. A single
non-ASCII entry (CJK, Cyrillic, accented variants) makes the decode of the whole
list fail, so the client discards all of it — and takes every other mod's
`/command` with it.

### Change

Register the ASCII name only, and sweep the array so names already pushed by an
earlier mod are removed as well:

```js
if (!exports.AVAILABLE_SLASH_COMMANDS.includes("automining")) exports.AVAILABLE_SLASH_COMMANDS.push("automining");
for (let index = exports.AVAILABLE_SLASH_COMMANDS.length - 1; index >= 0; index -= 1) {
  if (!/^[A-Za-z0-9_]+$/.test(String(exports.AVAILABLE_SLASH_COMMANDS[index]))) {
    exports.AVAILABLE_SLASH_COMMANDS.splice(index, 1);
  }
}
console.log("[AutoMining] slash list registered: " + exports.AVAILABLE_SLASH_COMMANDS.join(",") + " (ascii-only)");
```

`parse()` is untouched, so localized aliases remain usable in plain chat
(`!自动采矿 on`, `!minage automatique on`, …). Only the client-visible slash
list is ASCII.

### Behaviour matrix

| Case | Before | After |
|---|---|---|
| Clean list `["ash"]` | `["ash","automining", …localized aliases…]` | `["ash","automining"]` |
| Another mod already pushed `"自動採掘"` | whole list fails to decode in the client | offending entry dropped, the rest kept |
| `!自动采矿 on` in chat | parses | parses (unchanged) |

---

## 2. `!automining` opens the settings window before `hudReady`

### Symptom

For non-staff accounts the settings window often did not open: typing
`!automining` produced no window and only a status line. GM accounts, and any
account whose client companion had already reported readiness, were unaffected.

### Root cause

The `help` action was gated on the session flag `s.hudReady`, which is only set
after the client companion's ready report:

```js
if (cmd.action === "help" && s.hudReady) {
  session.sendNotification("OnAutoMiningOpen", "clientID", []);
  return "AutoMining settings opened.";
}
```

`/automining` goes through the server's native GM check, so non-staff accounts
can only reach the mod through the plain-chat path (`broadcastLocalMessage` /
`sendChannelMessage`, wrapped by `installPlainChat`). When the companion report
is late or missing, that path produced no window.

### Change

The plain-chat wrapper tags the parsed command when the player actually prefixed
it with `!`, and only that path skips the gate:

```js
// lib/commands.js — installPlainChat()
const plainChat = /^\s*!/.test(String(args[index] ?? ""));
const reply = controller.command(args[0], plainChat ? { ...command, plainChat: true } : command);

// lib/controller.js
if (cmd.action === "help" && (s.hudReady || cmd.plainChat === true)) {
  const characterID = Number(session.characterID || session.charid || 0);
  console.log("[AutoMining] plain-chat open char=" + characterID + " hudReady=" + (s.hudReady === true));
  session.sendNotification("OnAutoMiningOpen", "clientID", []);
  return "AutoMining settings opened.";
}
```

### Why not simply drop the gate

`help` doubles as the status command when the client is not ready — bare
`automining` and `/automining` fall through to the status line. Removing the gate
outright changes that contract and breaks a dozen existing tests that assert
`bare command → status`. Tagging only the plain-chat path keeps every other
behaviour identical.

### Behaviour matrix

| Input | `hudReady` false | `hudReady` true |
|---|---|---|
| `!automining` (plain chat) | **opens window** (new) | opens window |
| `automining` (bare) | status line (unchanged) | opens window |
| `/automining` (slash, GM-checked) | status line (unchanged) | opens window |
| `!automining status` | status line (unchanged) | status line (unchanged) |

`hudReady` still gates HUD rendering elsewhere; this change only affects opening
the settings window. The native GM check on `/automining` is unchanged.

---

## 3. `atm`: an alias for `automining`

### Why

A shorter name for the same command, nothing more. It is a plain alias: it has no
dedicated semantics and follows exactly the same rule as `automining`.

### Change

`atm` is added to `COMMAND_NAMES` and to the ASCII slash list
(`["automining", "atm"]`), and that is the whole change. `parse()` is untouched —
a bare `atm` returns `help` exactly like `automining`, so the window opens under
the same `hudReady` rule and the status line is printed until the client
companion reports ready. Any argument keeps the normal parser, so `atm on`,
`atm status` and `atm veldspar` behave exactly like their `automining`
equivalents.

```js
for (const asciiName of ["automining", "atm"]) {
  if (!exports.AVAILABLE_SLASH_COMMANDS.includes(asciiName)) exports.AVAILABLE_SLASH_COMMANDS.push(asciiName);
}
```

### Behaviour matrix (identical to `automining`)

| Input | `hudReady` false | `hudReady` true |
|---|---|---|
| `atm` (bare) | status line | opens window |
| `!atm` (plain chat) | opens window (change 2 path) | opens window |
| `/atm` (slash) | status line (after the native GM check) | opens window |
| `atm status` | status (unchanged) | status (unchanged) |
| `atm on` / `atm off` | toggles (unchanged) | toggles (unchanged) |

> Note: `/atm` still passes through the server's native slash handling and its GM
> check. Non-staff accounts have no way to use any `/` command, so for them the
> usable form remains `!atm`, exactly as with `!automining`.

---

## 4. Compressor detection follows the fitting, not a type list

### Symptom

Only three asteroid-ore compressors were recognised. Fitting an ice, gas,
mercoxit or moon-ore compressor left the whole industrial section unusable: no
module row, no interval setting, and the automation never started.

### Root cause

The module scan required a hard-coded type list:

```js
const ORE_COMPRESSOR_TYPES = new Set([62622, 62625, 62632]); // asteroid ore only
find(e => CORE_EFFECTS.has(e.effectID) ||
  ORE_COMPRESSOR_TYPES.has(typeID) && Number(e.effectID) === 8364)
```

### Evidence

In SDE build 3396210 every published compressor (group 4174, 12 types:
asteroid ore, ice, gas, mercoxit and moon ore in Medium/Large/Capital) carries
`effectID 8364 = industrialItemCompression`; nothing else uses that effect.

### Change

Identify the module by the effect alone; the type list is gone:

```js
const effect = fit.getTypeEffectRecords(item.typeID).find(e =>
  CORE_EFFECTS.has(Number(e.effectID)) || Number(e.effectID) === COMPRESSOR_EFFECT);
```

With no compressor fitted the scan returns no compressor module, so the feature
stays idle instead of pretending to run. Names come from the fitted item itself,
and the nine-language catalogue now says "Compressor" / "Automatic Compressor"
instead of "Asteroid Ore Compressor".

---

## 5. Drone groups follow the active ship's bay

### Symptom

The "drone group to launch" dropdown listed every group the character had ever
saved — often ten or more — including groups for other ships. While docked the
native drone-bay view has no data at all, so the list was the only thing to go on.

### Root cause

The client enumerated the native group store with no ship context:

```python
groups = GetDroneGroupsController().GetGroupsByName()   # all saved groups
```

Group membership is drone item IDs, and the server (not the client) knows which
drones are in the active ship's bay.

### Change

A new request returns the bay contents from the server inventory projection, which
is authoritative docked and in space:

```js
// lib/droneBay.js
listContainerItems(null, shipID, DRONE_BAY_FLAG)   // item IDs of this ship's bay
// lib/hud.js
Handle_AutoMiningDroneBay → { bay: { shipID, itemIDs } }
```

The client intersects those IDs with each group's `droneIDs`:

- groups with at least one drone in the bay are listed, sorted by how many they
  contain, labelled `Name (n)`;
- groups belonging to other ships disappear;
- if the bay is empty, the full list is kept so a group can still be preselected;
- duplicate placeholder rows are dropped.

No new catalogue entry is required: the count is language neutral, and the
existing labels are reused.

---

## Verification

On top of tag `v1.2.23`:

```sh
node --check lib/controller.js
node --check lib/commands.js
node tests/automining.test.cjs        # 79/79
node tests/industrial-automation.test.cjs  # 10/10
node tests/drone-bay.test.cjs         # 3/3
node tests/command-locales.test.cjs   # 1/1
```

`tests/automining.test.cjs` covers the new behaviour: the `plainChat` tag is
applied by `installPlainChat()`, the tagged command opens while `hudReady` is
false, `atm` opens from slash / plain chat / bare form, and `atm` stays in the
ASCII-only slash list. The original gate test was extended rather than removed,
so the bare/slash contract stays pinned. `tests/industrial-automation.test.cjs`
checks all twelve compressor types and the idle state when none is fitted;
`tests/drone-bay.test.cjs` covers the bay request and its failure modes. The
nine-language catalogue is validated by `buildClientSource()` on every login
delivery (matching key count, placeholders and whitespace per entry).

The focused suite was run in full: 47 of 54 files pass. The 7 failures
(`compat-261018`, `compat-261028`, `future-version`, `login-delivery`,
`login-emission`, `mining-compatibility`, `state-preservation`) require the
reviewed EveJS server trees via `AUTOMINING_NATIVE_ROOT` / `EVEJS_TEST_ROOT` and
**fail identically on a pristine v1.2.23 checkout**, so they are environmental,
not regressions.

Runtime check on a Docker deployment: the loader logs
`[AutoMining] v1.2.23 loaded.` followed by
`[AutoMining] slash list registered: <existing>,automining,atm (ascii-only)`, and
a non-staff character gets `AutoMining settings opened.` plus `OnAutoMiningOpen`.

## Notes

- Both `.js` files are CRLF in the release ZIP; keep CRLF so later patches apply.
- Reverting is a plain `git revert` of the commits.
