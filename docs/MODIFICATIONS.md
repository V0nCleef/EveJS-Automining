# Local modifications

Two changes are carried on top of upstream **v1.2.23**. Neither changes the mod
version. Both are self-contained and are offered upstream as a pull request.

| # | File | Change | Size |
|---|---|---|---|
| 1 | `lib/commands.js` | Register only ASCII names in `AVAILABLE_SLASH_COMMANDS` | +13 / −2 |
| 2 | `lib/commands.js`, `lib/controller.js` | Let the plain-chat form `!automining` open the settings window before the client reports `hudReady` | +10 / −1 |

`lib/commands.js` also carries two diagnostic lines (`plain-chat …` and
`plain-chat open …`) that make the two code paths visible in the server log.
They can be dropped without changing behaviour.

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

The plain-chat wrapper tags the parsed command, and only that path skips the
gate:

```js
// lib/commands.js — installPlainChat()
const reply = controller.command(args[0], { ...command, plainChat: true });

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

## Verification

On top of tag `v1.2.23`:

```sh
node --check lib/controller.js
node --check lib/commands.js
node tests/automining.test.cjs        # 77/77
node tests/command-locales.test.cjs   # 1/1
```

The focused suite was run in full: 51 of 58 files pass. The 7 failures
(`compat-261018`, `compat-261028`, `future-version`, `login-delivery`,
`login-emission`, `mining-compatibility`, `state-preservation`) require the
reviewed EveJS server trees via `AUTOMINING_NATIVE_ROOT` / `EVEJS_TEST_ROOT` and
**fail identically on a pristine v1.2.23 checkout**, so they are environmental,
not regressions.

Runtime check on a Docker deployment: the loader logs
`[AutoMining] v1.2.23 loaded.` followed by
`[AutoMining] slash list registered: <existing>,automining (ascii-only)`, and a
non-staff character gets `AutoMining settings opened.` plus `OnAutoMiningOpen`.

## Notes

- Both `.js` files are CRLF in the release ZIP; keep CRLF so later patches apply.
- Reverting is a plain `git revert` of the commits.
